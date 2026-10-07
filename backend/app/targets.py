"""The target company list: turning pasted names or domains into companies, and filling in
missing domains. Hunter's company suggestions are free, so neither costs credits."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import hunter
from .models import Company


def _suggestions(query: str) -> list[dict]:
    """Hunter's matches for a name or domain; none when Hunter isn't set up or can't be reached."""
    if not hunter.configured():
        return []
    try:
        return hunter.company_suggestions(query, limit=5)
    except hunter.HunterError:
        return []


def resolve(line: str) -> tuple[str, str | None]:
    """A pasted line -> (name, domain). "stripe.com" gets Hunter's name for it ("Stripe");
    "Stripe" gets a domain only when Hunter knows a company by exactly that name, so a
    guess never attaches the wrong company's domain."""
    line = line.strip()
    suggestions = _suggestions(line)
    domain = hunter.clean_domain(line)
    if domain:
        match = next((s for s in suggestions if s["domain"] == domain and s.get("name")), None)
        return (match["name"] if match else domain.split(".")[0].capitalize()), domain
    match = next((s for s in suggestions if (s.get("name") or "").lower() == line.lower()), None)
    return line, match["domain"] if match else None


def add_many(db: Session, lines: list[str]) -> tuple[list[Company], list[str]]:
    """Add each line as a company. Returns (added, skipped): skipped are blank-free lines
    already on the list (same name or domain) or repeated in the input."""
    existing = db.execute(select(func.lower(Company.name), Company.domain)).all()
    names = {n for n, _ in existing}
    domains = {d for _, d in existing if d}
    added, skipped = [], []
    for raw in lines:
        line = raw.strip()
        if not line:
            continue
        name, domain = resolve(line)
        if name.lower() in names or (domain and domain in domains):
            skipped.append(line)
            continue
        company = Company(name=name[:200], domain=domain)
        db.add(company)
        added.append(company)
        names.add(name.lower())
        if domain:
            domains.add(domain)
    db.commit()
    return added, skipped


FILL_LIMIT = 10  # lookups per request, so each finishes quickly; the page asks for the next piece


def fill_domains(db: Session, after_id: int = 0) -> tuple[int, int, int | None]:
    """Look up domains for the next few companies without one (ids after `after_id`).
    Returns (filled, still missing overall, id to continue after or None when done). Going by id
    means names Hunter doesn't know are looked up once, not again in every piece."""
    if not hunter.configured():
        raise hunter.HunterError(400, "Hunter isn't set up. Add HUNTER_API_KEY to backend/.env and restart the backend.")
    taken = set(db.scalars(select(Company.domain).where(Company.domain.is_not(None))))
    piece = list(
        db.scalars(
            select(Company).where(Company.domain.is_(None), Company.id > after_id).order_by(Company.id).limit(FILL_LIMIT + 1)
        )
    )
    more = len(piece) > FILL_LIMIT
    piece = piece[:FILL_LIMIT]
    filled = 0
    for company in piece:
        _, domain = resolve(company.name)
        if domain and domain not in taken:
            company.domain = domain
            taken.add(domain)
            filled += 1
    db.commit()
    missing = db.scalar(select(func.count()).select_from(Company).where(Company.domain.is_(None))) or 0
    return filled, missing, (piece[-1].id if more else None)
