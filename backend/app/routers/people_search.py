"""Finding people to email at a company, via Hunter.io."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from .. import hunter, verification
from ..campaigns import last_sent_by_address
from ..db import get_db
from ..models import Company, SeenPerson
from ..schemas import (
    CompanySuggestion,
    EmailFinderIn,
    EmailFinderOut,
    FoundPerson,
    HunterStatus,
    NewPeopleIn,
    NewPeopleOut,
    PeopleCount,
    PeopleSearchIn,
    PeopleSearchOut,
    Verification,
    VerifyIn,
    VerifyOut,
)

router = APIRouter(prefix="/api/people-search", tags=["people search"])


def _person(raw: dict, email_key: str) -> FoundPerson | None:
    email = (raw.get(email_key) or "").lower()
    if not email:
        return None
    first, last = raw.get("first_name"), raw.get("last_name")
    return FoundPerson(
        email=email,
        first_name=first,
        last_name=last,
        full_name=" ".join(p for p in (first, last) if p) or None,
        position=raw.get("position"),
        department=raw.get("department"),
        seniority=raw.get("seniority"),
        confidence=raw.get("confidence", raw.get("score")),
        verification_status=(raw.get("verification") or {}).get("status"),
        linkedin_url=raw.get("linkedin") or raw.get("linkedin_url"),
    )


def _mark_already_emailed(db: Session, people: list[FoundPerson]) -> list[FoundPerson]:
    sent = last_sent_by_address(db, [p.email for p in people])
    for p in people:
        p.already_emailed_at = sent.get(p.email)
    return people


def _int(v: float | None) -> int | None:
    return int(v) if v is not None else None


def _call(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except hunter.HunterError as e:
        raise HTTPException(e.status if 400 <= e.status < 600 else 502, str(e)) from e


@router.get("/status", response_model=HunterStatus)
def status():
    if not hunter.configured():
        return HunterStatus(configured=False)
    try:
        account = hunter.account()
    except hunter.HunterError as e:
        return HunterStatus(configured=True, error=str(e))
    # Hunter reports credits as {"used": 3.0, "available": 50.0, "remaining": 47.0}, where
    # "available" is the monthly allowance, not what's left.
    usage = account.get("requests") or {}
    credits = usage.get("credits") or {}
    checks = usage.get("verifications") or {}
    used, total = credits.get("used"), credits.get("available")
    remaining = credits.get("remaining")
    if remaining is None and used is not None and total is not None:
        remaining = total - used
    return HunterStatus(
        configured=True,
        plan_name=account.get("plan_name"),
        credits_used=_int(used),
        credits_total=_int(total),
        credits_remaining=_int(remaining),
        verifications_total=_int(checks.get("available")),
        verifications_remaining=_int(checks.get("remaining")),
        reset_date=account.get("reset_date"),
    )


@router.get("/suggest", response_model=list[CompanySuggestion])
def suggest_companies(q: str = ""):
    """Company autocomplete. Free on Hunter, so it isn't cached."""
    if len(q.strip()) < 2:
        return []
    return [
        CompanySuggestion(name=s.get("name"), domain=s["domain"], logo=s.get("logo"), email_count=s.get("email_count"))
        for s in _call(hunter.company_suggestions, q)
    ]


@router.get("/count", response_model=PeopleCount)
def count_people(query: str):
    """How many people Hunter has at a company in total (free), to explain an empty filtered search."""
    data = _call(hunter.email_count, query)
    return PeopleCount(
        total=data.get("personal_emails") or data.get("total") or 0,
        by_department={k: v for k, v in (data.get("department") or {}).items() if v},
        by_seniority={k: v for k, v in (data.get("seniority") or {}).items() if v},
    )


@router.post("/company", response_model=PeopleSearchOut)
def search_company(body: PeopleSearchIn, db: Session = Depends(get_db)):
    res, cached = _call(
        hunter.domain_search,
        db,
        body.query,
        limit=body.limit,
        offset=body.offset,
        department=body.department,
        seniority=body.seniority,
        job_titles=body.job_titles,
        location=[loc.model_dump(exclude_none=True) for loc in body.location] if body.location else None,
        refresh=body.refresh,
    )
    data, meta = res.get("data") or {}, res.get("meta") or {}
    people = [p for p in (_person(e, "value") for e in data.get("emails") or []) if p]

    # Remember the domain on a company we already know, so the next search can use it.
    org, domain = data.get("organization"), data.get("domain")
    if org and domain:
        company = db.scalars(select(Company).where(func.lower(Company.name) == org.lower())).first()
        if company and not company.domain:
            company.domain = domain
            db.commit()

    return PeopleSearchOut(
        domain=domain,
        organization=org,
        pattern=data.get("pattern"),
        total=meta.get("results") or len(people),
        offset=meta.get("offset", body.offset),
        limit=meta.get("limit", body.limit),
        people=_remember_people(db, people),
        cached=cached,
    )


def _remember_people(db: Session, people: list[FoundPerson]) -> list[FoundPerson]:
    _remember_seen(db, people)
    return _mark_already_emailed(db, people)


def _remember_seen(db: Session, people: list[FoundPerson]) -> None:
    """Note everyone shown, for "Hide people I've already seen"."""
    emails = sorted({p.email.lower() for p in people})
    if emails:
        db.execute(pg_insert(SeenPerson).values([{"email": e} for e in emails]).on_conflict_do_nothing())
        db.commit()


NEW_PAGE = 10  # Hunter charges per page of up to 10 people found, so walk 10 at a time
NEW_MAX_PAGES = 10  # per click: bounds the cost and how long the request takes


@router.post("/company/new", response_model=NewPeopleOut)
def new_people(body: NewPeopleIn, db: Session = Depends(get_db)):
    """The next people at a company you haven't emailed yet (and, with hide_seen, haven't been
    shown before). Walks Hunter's results from the top: pages fetched in the last 30 days are
    saved, so going back over people you already have costs nothing; only new pages use credits."""
    location = [loc.model_dump(exclude_none=True) for loc in body.location] if body.location else None
    hidden = set(db.scalars(select(SeenPerson.email))) if body.hide_seen else set()
    found: list[FoundPerson] = []
    taken: set[str] = set()
    data: dict = {}
    offset = total = pages = paid = 0
    reached_end = False
    while len(found) < body.want and pages < NEW_MAX_PAGES:
        res, cached = _call(
            hunter.domain_search, db, body.query, limit=NEW_PAGE, offset=offset, department=body.department,
            seniority=body.seniority, job_titles=body.job_titles, location=location,
        )
        pages += 1
        paid += 0 if cached else 1
        data, meta = res.get("data") or {}, res.get("meta") or {}
        total = meta.get("results") or 0
        page = _mark_already_emailed(db, [p for p in (_person(e, "value") for e in data.get("emails") or []) if p])
        for p in page:
            if p.already_emailed_at or p.email in taken or p.email.lower() in hidden:
                continue
            taken.add(p.email)
            found.append(p)
            if len(found) == body.want:
                break
        offset += NEW_PAGE
        if not page or offset >= total:
            reached_end = True
            break
    _remember_seen(db, found)
    return NewPeopleOut(
        domain=data.get("domain"), organization=data.get("organization"), pattern=data.get("pattern"), total=total,
        people=found, reached_end=reached_end, pages_checked=pages, pages_paid=paid,
    )


@router.post("/person", response_model=EmailFinderOut)
def find_person(body: EmailFinderIn, db: Session = Depends(get_db)):
    handle = hunter.linkedin_handle(body.linkedin_url) if body.linkedin_url else None
    if body.linkedin_url and body.linkedin_url.strip() and not handle:
        raise HTTPException(422, "That doesn't look like a LinkedIn profile URL (linkedin.com/in/…).")
    if not handle:
        # Without a LinkedIn profile, Hunter needs both a name and where they work.
        if not (body.full_name and body.full_name.strip()):
            raise HTTPException(422, "Give a full name or a LinkedIn profile URL.")
        if not (body.company and body.company.strip()):
            raise HTTPException(422, "Add their company or website domain, or use their LinkedIn profile URL instead.")
    res, cached = _call(
        hunter.email_finder, db, body.company, full_name=body.full_name, linkedin_handle=handle, refresh=body.refresh
    )
    data = res.get("data") or {}
    person = _person(data, "email")
    if person and not person.full_name and body.full_name:
        person.full_name = body.full_name.strip()
    return EmailFinderOut(
        person=_mark_already_emailed(db, [person])[0] if person else None,
        domain=data.get("domain") or (hunter.clean_domain(body.company) if body.company else None),
        company=data.get("company"),
        cached=cached,
    )


@router.post("/verify", response_model=VerifyOut)
def verify_emails(body: VerifyIn, db: Session = Depends(get_db)):
    """Check whether addresses exist (Hunter's Email Verifier). Saved verdicts under 30 days old are
    reused for free unless refresh is set."""
    results = _call(verification.verify, db, body.emails, body.refresh)
    return VerifyOut(
        results=[
            Verification(email=a, status=v.status, score=v.score, checked_at=v.checked_at, cached=cached)
            if v
            else Verification(email=a, status="pending")
            for a, v, cached in results
        ]
    )
