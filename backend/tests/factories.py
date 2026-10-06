"""Small helpers for putting rows in the test database."""

from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.auth import hash_password
from app.models import Attachment, Campaign, CampaignStatus, Company, Contact, Email, EmailStatus, Template, User


def company(db: Session, name="Stripe", **kw) -> Company:
    c = Company(name=name, **kw)
    db.add(c)
    db.commit()
    return c


def contact(db: Session, email="jane@stripe.com", **kw) -> Contact:
    c = Contact(email=email, **kw)
    db.add(c)
    db.commit()
    return c


def campaign(
    db: Session,
    emails: list[tuple[str, str]] = (("jane@stripe.com", EmailStatus.PENDING),),
    *,
    status=CampaignStatus.QUEUED,
    delay_seconds=0,
    company: Company | None = None,
    attachments: list[Attachment] = (),
    **kw,
) -> Campaign:
    """A campaign with one email per (address, status) pair."""
    c = Campaign(
        name=kw.pop("name", "Test batch"),
        subject_template="Hi {{first_name}}",
        body_template="Hello",
        variables=["email"],
        delay_seconds=delay_seconds,
        status=status,
        company=company,
        attachments=list(attachments),
        **kw,
    )
    for addr, st in emails:
        c.emails.append(
            Email(
                to_email=addr,
                subject="Hi",
                body="Hello",
                status=st,
                sent_at=datetime.now(timezone.utc) if st == EmailStatus.SENT else None,
            )
        )
    db.add(c)
    db.commit()
    return c


def sent_email(db: Session, address: str, when: datetime | None = None, contact: Contact | None = None) -> Email:
    """Record that `address` was already emailed."""
    c = campaign(db, [], status=CampaignStatus.COMPLETED)
    e = Email(
        campaign=c, contact=contact, to_email=address, subject="Hi", body="Hello",
        status=EmailStatus.SENT, sent_at=when or datetime.now(timezone.utc),
    )
    db.add(e)
    db.commit()
    return e


def attachment(db: Session, filename="resume.pdf", data=b"%PDF-1.4", content_type="application/pdf") -> Attachment:
    a = Attachment(filename=filename, content_type=content_type, size_bytes=len(data), data=data)
    db.add(a)
    db.commit()
    return a


def template(db: Session, name="Intro", **kw) -> Template:
    t = Template(name=name, subject=kw.pop("subject", "Hi"), body=kw.pop("body", "Hello"), variables=kw.pop("variables", []))
    db.add(t)
    db.commit()
    return t


def user(db: Session, email="me@example.com", password: str | None = "correct horse", name=None) -> User:
    u = User(email=email, name=name, password_hash=hash_password(password) if password else None)
    db.add(u)
    db.commit()
    return u
