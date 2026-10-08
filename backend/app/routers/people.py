"""Companies and contacts."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import distinct, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .. import hunter, targets
from ..db import get_db
from ..models import Company, CompanyStatus, Contact, Email, EmailStatus
from ..paging import PageParams, next_offset
from ..schemas import (
    CompaniesBulkIn,
    CompaniesBulkOut,
    CompanyIn,
    CompanyName,
    CompanyOut,
    CompanyPage,
    CompanyPatch,
    ContactOut,
    ContactPage,
    ContactPatch,
    FillDomainsOut,
)

router = APIRouter(prefix="/api", tags=["people"])


# ---- Companies ----------------------------------------------------------


def _company_rows(db: Session, *filters, limit: int | None = None, offset: int = 0) -> list[CompanyOut]:
    sent = Email.status == EmailStatus.SENT
    q = (
        select(
            Company,
            func.count(distinct(Contact.id)),
            func.count(distinct(Email.contact_id)).filter(sent),
            func.max(Email.sent_at).filter(sent),
        )
        .outerjoin(Contact, Contact.company_id == Company.id)
        .outerjoin(Email, Email.contact_id == Contact.id)
        .where(*filters)
        .group_by(Company.id)
        .order_by(func.max(Email.sent_at).filter(sent).desc().nulls_last(), Company.name, Company.id)
        .offset(offset)
        .limit(limit)
    )
    return [
        CompanyOut.model_validate(c).model_copy(
            update=dict(contact_count=n_contacts, emailed_count=n_emailed, last_sent_at=last)
        )
        for c, n_contacts, n_emailed, last in db.execute(q)
    ]


def _company_filters(q: str | None) -> list:
    if not q or not q.strip():
        return []
    like = f"%{q.strip()}%"
    return [or_(Company.name.ilike(like), Company.domain.ilike(like))]


@router.get("/companies", response_model=CompanyPage)
def list_companies(
    status: CompanyStatus | None = None, q: str | None = None, page: PageParams = Depends(), db: Session = Depends(get_db)
):
    """One page of companies, most recently emailed first. The status counts (for the filter
    tabs) and the number missing a domain cover every company matching the search."""
    filters = _company_filters(q)
    by_status = dict(db.execute(select(Company.status, func.count()).where(*filters).group_by(Company.status)).all())
    shown = [*filters, Company.status == status] if status else filters
    total = by_status.get(status, 0) if status else sum(by_status.values())
    items = _company_rows(db, *shown, limit=page.limit, offset=page.offset)
    return CompanyPage(
        items=items, total=total, next_offset=next_offset(page, len(items), total),
        counts={s.value: by_status.get(s, 0) for s in CompanyStatus}, all=sum(by_status.values()),
        missing_domains=db.scalar(select(func.count()).select_from(Company).where(*filters, Company.domain.is_(None))),
    )


@router.get("/companies/names", response_model=list[CompanyName])
def company_names(db: Session = Depends(get_db)):
    """Just the names, for suggestions and filters: small even with many companies."""
    return [CompanyName(id=i, name=n) for i, n in db.execute(select(Company.id, Company.name).order_by(Company.name))]


@router.post("/companies", response_model=CompanyOut, status_code=201)
def create_company(body: CompanyIn, db: Session = Depends(get_db)):
    c = Company(**body.model_dump())
    db.add(c)
    try:
        db.commit()
    except IntegrityError as e:
        raise HTTPException(409, f'A company named "{body.name}" already exists.') from e
    return _company_rows(db, Company.id == c.id)[0]


@router.post("/companies/bulk", response_model=CompaniesBulkOut, status_code=201)
def add_companies(body: CompaniesBulkIn, db: Session = Depends(get_db)):
    """Add a pasted list of company names or domains to the target list."""
    added, skipped = targets.add_many(db, body.lines)
    rows = {r.id: r for r in _company_rows(db, Company.id.in_([c.id for c in added]))}
    return CompaniesBulkOut(added=[rows[c.id] for c in added], skipped=skipped)


@router.post("/companies/fill-domains", response_model=FillDomainsOut)
def fill_domains(after_id: int = 0, db: Session = Depends(get_db)):
    """Find a domain (and so a logo) for the next few companies that don't have one. Free on
    Hunter. Call again with after_id = next_after until next_after is null."""
    try:
        filled, missing, next_after = targets.fill_domains(db, after_id)
    except hunter.HunterError as e:
        raise HTTPException(e.status, str(e)) from e
    return FillDomainsOut(filled=filled, missing=missing, next_after=next_after)


@router.patch("/companies/{company_id}", response_model=CompanyOut)
def update_company(company_id: int, body: CompanyPatch, db: Session = Depends(get_db)):
    c = db.get(Company, company_id)
    if c is None:
        raise HTTPException(404, "Company not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(c, k, v)
    try:
        db.commit()
    except IntegrityError as e:
        raise HTTPException(409, "Another company already has that name.") from e
    return _company_rows(db, Company.id == c.id)[0]


@router.delete("/companies/{company_id}", status_code=204)
def delete_company(company_id: int, db: Session = Depends(get_db)):
    """Contacts and sent history are kept; they just lose the company link."""
    c = db.get(Company, company_id)
    if c is None:
        raise HTTPException(404, "Company not found")
    db.delete(c)
    db.commit()


# ---- Contacts -----------------------------------------------------------


def _contact_rows(db: Session, *filters, limit: int | None = None, offset: int = 0) -> list[ContactOut]:
    sent = Email.status == EmailStatus.SENT
    latest = (
        select(Email.contact_id, Email.status, func.row_number().over(
            partition_by=Email.contact_id, order_by=Email.created_at.desc()
        ).label("rn"))
        .subquery()
    )
    q = (
        select(Contact, Company.name, func.count(Email.id).filter(sent), func.max(Email.sent_at).filter(sent), latest.c.status)
        .outerjoin(Company, Company.id == Contact.company_id)
        .outerjoin(Email, Email.contact_id == Contact.id)
        .outerjoin(latest, (latest.c.contact_id == Contact.id) & (latest.c.rn == 1))
        .where(*filters)
        .group_by(Contact.id, Company.name, latest.c.status)
        .order_by(func.max(Email.sent_at).desc().nulls_last(), Contact.created_at.desc(), Contact.id.desc())
        .offset(offset)
        .limit(limit)
    )
    return [
        ContactOut.model_validate(c).model_copy(
            update=dict(company_name=cname, sent_count=n, last_sent_at=last, last_status=status)
        )
        for c, cname, n, last, status in db.execute(q)
    ]


@router.get("/contacts", response_model=ContactPage)
def list_contacts(
    q: str | None = None, company_id: int | None = None, page: PageParams = Depends(), db: Session = Depends(get_db)
):
    """One page of contacts, most recently emailed first."""
    filters = []
    if company_id is not None:
        filters.append(Contact.company_id == company_id)
    if q and q.strip():
        like = f"%{q.strip()}%"
        filters.append(or_(Contact.email.ilike(like), Contact.full_name.ilike(like), Contact.title.ilike(like)))
    total = db.scalar(select(func.count()).select_from(Contact).where(*filters))
    items = _contact_rows(db, *filters, limit=page.limit, offset=page.offset)
    return ContactPage(items=items, total=total, next_offset=next_offset(page, len(items), total))


@router.patch("/contacts/{contact_id}", response_model=ContactOut)
def update_contact(contact_id: int, body: ContactPatch, db: Session = Depends(get_db)):
    c = db.get(Contact, contact_id)
    if c is None:
        raise HTTPException(404, "Contact not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(c, k, v)
    db.commit()
    return _contact_rows(db, Contact.id == contact_id)[0]


@router.delete("/contacts/{contact_id}", status_code=204)
def delete_contact(contact_id: int, db: Session = Depends(get_db)):
    c = db.get(Contact, contact_id)
    if c is None:
        raise HTTPException(404, "Contact not found")
    db.delete(c)
    db.commit()
