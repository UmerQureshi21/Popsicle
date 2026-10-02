"""Companies and contacts."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import distinct, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import Company, Contact, Email, EmailStatus
from ..schemas import CompanyIn, CompanyOut, CompanyPatch, ContactOut, ContactPatch

router = APIRouter(prefix="/api", tags=["people"])


# ---- Companies ----------------------------------------------------------


def _company_rows(db: Session, company_id: int | None = None) -> list[CompanyOut]:
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
        .group_by(Company.id)
        .order_by(func.max(Email.sent_at).filter(sent).desc().nulls_last(), Company.name)
    )
    if company_id is not None:
        q = q.where(Company.id == company_id)
    return [
        CompanyOut.model_validate(c).model_copy(
            update=dict(contact_count=n_contacts, emailed_count=n_emailed, last_sent_at=last)
        )
        for c, n_contacts, n_emailed, last in db.execute(q)
    ]


@router.get("/companies", response_model=list[CompanyOut])
def list_companies(db: Session = Depends(get_db)):
    return _company_rows(db)


@router.post("/companies", response_model=CompanyOut, status_code=201)
def create_company(body: CompanyIn, db: Session = Depends(get_db)):
    c = Company(**body.model_dump())
    db.add(c)
    try:
        db.commit()
    except IntegrityError as e:
        raise HTTPException(409, f'A company named "{body.name}" already exists.') from e
    return _company_rows(db, c.id)[0]


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
    return _company_rows(db, c.id)[0]


@router.delete("/companies/{company_id}", status_code=204)
def delete_company(company_id: int, db: Session = Depends(get_db)):
    """Contacts and sent history are kept; they just lose the company link."""
    c = db.get(Company, company_id)
    if c is None:
        raise HTTPException(404, "Company not found")
    db.delete(c)
    db.commit()


# ---- Contacts -----------------------------------------------------------


def _contact_rows(db: Session, *filters) -> list[ContactOut]:
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
        .order_by(func.max(Email.sent_at).desc().nulls_last(), Contact.created_at.desc())
    )
    return [
        ContactOut.model_validate(c).model_copy(
            update=dict(company_name=cname, sent_count=n, last_sent_at=last, last_status=status)
        )
        for c, cname, n, last, status in db.execute(q)
    ]


@router.get("/contacts", response_model=list[ContactOut])
def list_contacts(q: str | None = None, company_id: int | None = None, db: Session = Depends(get_db)):
    filters = []
    if company_id is not None:
        filters.append(Contact.company_id == company_id)
    if q:
        like = f"%{q.strip()}%"
        filters.append(or_(Contact.email.ilike(like), Contact.full_name.ilike(like), Contact.title.ilike(like)))
    return _contact_rows(db, *filters)


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
