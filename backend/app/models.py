"""Database schema.

companies 1──* contacts 1──* emails *──1 campaigns *──* attachments
                                            campaigns *──1 templates

A *campaign* is one batch send (e.g. "10 people at Stripe"). It snapshots the
subject/body it was sent with, so editing a template later never rewrites history.
An *email* is one message to one person, with the exact rendered text and the
variable values used. "Have I already emailed this person?" is answered by
looking for an email row with status='sent' for that address.
"""

from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Table,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, deferred, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class CampaignStatus(StrEnum):
    QUEUED = "queued"
    SENDING = "sending"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    INTERRUPTED = "interrupted"  # server stopped mid-send; can be resumed
    WAITING = "waiting"  # hit the daily send limit; carries on by itself when it resets
    SCHEDULED = "scheduled"  # set to start at a chosen time


class CompanyStatus(StrEnum):
    """Where a target company is in the outreach."""

    NOT_STARTED = "not_started"
    EMAILED = "emailed"  # set automatically when the first email to it is sent
    REPLIED = "replied"
    NOT_INTERESTED = "not_interested"  # not a fit, or they said no


class EmailStatus(StrEnum):
    PENDING = "pending"
    SENT = "sent"
    FAILED = "failed"
    SKIPPED = "skipped"  # e.g. already emailed before
    CANCELLED = "cancelled"


def _created_at() -> Mapped[datetime]:
    return mapped_column(DateTime(timezone=True), server_default=func.now())


class Company(Base):
    __tablename__ = "companies"
    __table_args__ = (Index("uq_companies_name_lower", text("lower(name)"), unique=True),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    domain: Mapped[str | None] = mapped_column(String(200))
    linkedin_url: Mapped[str | None] = mapped_column(String(500))
    notes: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(
        String(20), default=CompanyStatus.NOT_STARTED, server_default=CompanyStatus.NOT_STARTED.value
    )
    created_at: Mapped[datetime] = _created_at()

    contacts: Mapped[list["Contact"]] = relationship(back_populates="company")
    campaigns: Mapped[list["Campaign"]] = relationship(back_populates="company")


class Contact(Base):
    __tablename__ = "contacts"

    id: Mapped[int] = mapped_column(primary_key=True)
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id", ondelete="SET NULL"), index=True)
    email: Mapped[str] = mapped_column(String(320), unique=True)  # always stored lowercase
    full_name: Mapped[str | None] = mapped_column(String(200))
    first_name: Mapped[str | None] = mapped_column(String(100))
    last_name: Mapped[str | None] = mapped_column(String(100))
    title: Mapped[str | None] = mapped_column(String(200))
    linkedin_url: Mapped[str | None] = mapped_column(String(500))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = _created_at()

    company: Mapped[Company | None] = relationship(back_populates="contacts")
    emails: Mapped[list["Email"]] = relationship(back_populates="contact")


class Template(Base):
    __tablename__ = "templates"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    subject: Mapped[str] = mapped_column(Text)
    body: Mapped[str] = mapped_column(Text)
    variables: Mapped[list[str]] = mapped_column(JSONB, default=list)
    created_at: Mapped[datetime] = _created_at()
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


campaign_attachments = Table(
    "campaign_attachments",
    Base.metadata,
    Column("campaign_id", ForeignKey("campaigns.id", ondelete="CASCADE"), primary_key=True),
    Column("attachment_id", ForeignKey("attachments.id", ondelete="CASCADE"), primary_key=True),
)


class Attachment(Base):
    __tablename__ = "attachments"

    id: Mapped[int] = mapped_column(primary_key=True)
    filename: Mapped[str] = mapped_column(String(300))
    content_type: Mapped[str] = mapped_column(String(200))
    size_bytes: Mapped[int] = mapped_column(Integer)
    data: Mapped[bytes] = deferred(mapped_column(LargeBinary))
    created_at: Mapped[datetime] = _created_at()


class Campaign(Base):
    __tablename__ = "campaigns"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(300))
    company_id: Mapped[int | None] = mapped_column(ForeignKey("companies.id", ondelete="SET NULL"), index=True)
    template_id: Mapped[int | None] = mapped_column(ForeignKey("templates.id", ondelete="SET NULL"))
    subject_template: Mapped[str] = mapped_column(Text)
    body_template: Mapped[str] = mapped_column(Text)
    variables: Mapped[list[str]] = mapped_column(JSONB, default=list)
    delay_seconds: Mapped[float] = mapped_column(Float, default=30)
    status: Mapped[str] = mapped_column(String(20), default=CampaignStatus.QUEUED)
    error: Mapped[str | None] = mapped_column(Text)  # why it stopped, if it did
    scheduled_for: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Which server process is sending this batch, and until when its claim holds. A process
    # renews its claim while it works, so two processes (e.g. old and new during a redeploy)
    # never send the same batch.
    worker_id: Mapped[str | None] = mapped_column(String(64))
    lease_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # don't start before this
    created_at: Mapped[datetime] = _created_at()
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    company: Mapped[Company | None] = relationship(back_populates="campaigns")
    emails: Mapped[list["Email"]] = relationship(
        back_populates="campaign", cascade="all, delete-orphan", order_by="Email.id"
    )
    attachments: Mapped[list[Attachment]] = relationship(secondary=campaign_attachments)


class Email(Base):
    __tablename__ = "emails"
    __table_args__ = (Index("ix_emails_to_email_status", "to_email", "status"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    campaign_id: Mapped[int] = mapped_column(ForeignKey("campaigns.id", ondelete="CASCADE"), index=True)
    contact_id: Mapped[int | None] = mapped_column(ForeignKey("contacts.id", ondelete="SET NULL"), index=True)
    to_email: Mapped[str] = mapped_column(String(320))
    subject: Mapped[str] = mapped_column(Text)
    body: Mapped[str] = mapped_column(Text)
    variables: Mapped[dict[str, str]] = mapped_column(JSONB, default=dict)  # the tuple values used
    status: Mapped[str] = mapped_column(String(20), default=EmailStatus.PENDING)
    error: Mapped[str | None] = mapped_column(Text)
    gmail_message_id: Mapped[str | None] = mapped_column(String(100))
    gmail_thread_id: Mapped[str | None] = mapped_column(String(100))
    # Set just before handing the email to Gmail. Still pending with this set means the server
    # stopped mid-send, so it may have gone out: it's never resent automatically.
    attempted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _created_at()

    campaign: Mapped[Campaign] = relationship(back_populates="emails")
    contact: Mapped[Contact | None] = relationship(back_populates="emails")


class HunterLookup(Base):
    """Cached Hunter.io responses, so repeating a search doesn't spend credits again."""

    __tablename__ = "hunter_lookups"

    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(30))  # domain_search | email_finder
    cache_key: Mapped[str] = mapped_column(Text, unique=True)  # kind + the exact query params
    response: Mapped[dict] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class User(Base):
    """Someone allowed into Popsicle. Created only from the command line (app/manage.py)."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True)  # always stored lowercase
    # Null for an invited email that hasn't chosen a password yet (they do that via Sign up).
    password_hash: Mapped[str | None] = mapped_column(String(300))
    name: Mapped[str | None] = mapped_column(String(200))
    created_at: Mapped[datetime] = _created_at()
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)  # sha256 of the cookie value
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = _created_at()


class OAuthState(Base):
    """A Gmail connection in progress, between leaving for Google's consent screen and coming
    back. In the database (not memory) so it survives a restart and works whichever server
    process Google's redirect reaches."""

    __tablename__ = "oauth_states"

    state: Mapped[str] = mapped_column(String(200), primary_key=True)
    code_verifier: Mapped[str | None] = mapped_column(Text)  # PKCE: proves the redirect is ours
    return_to: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime] = _created_at()


class TrustedDevice(Base):
    """A browser you've logged in from before. Guessing passwords elsewhere can't lock it out."""

    __tablename__ = "trusted_devices"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)  # sha256 of the cookie value
    created_at: Mapped[datetime] = _created_at()


class SendingSettings(Base):
    """One row (id=1): how much may be sent, to keep the Gmail account in good standing."""

    __tablename__ = "sending_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    daily_limit: Mapped[int] = mapped_column(Integer)  # emails per rolling 24 hours
    min_delay_seconds: Mapped[float] = mapped_column(Float)  # floor under every batch's own delay
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class EmailVerification(Base):
    """Hunter's latest verdict on whether an address exists, reused for 30 days."""

    __tablename__ = "email_verifications"

    email: Mapped[str] = mapped_column(String(320), primary_key=True)  # lowercase
    status: Mapped[str] = mapped_column(String(30))  # valid | invalid | accept_all | webmail | disposable | unknown
    score: Mapped[int | None] = mapped_column(Integer)
    checked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class GmailAccount(Base):
    __tablename__ = "gmail_accounts"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    token_json: Mapped[str] = mapped_column(Text)
    scopes: Mapped[str | None] = mapped_column(Text)  # space-separated scopes Google granted
    synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))  # last conversation sync
    # A sync in progress (in the background) and how the last one went; see conversations.py.
    sync_started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sync_result: Mapped[dict | None] = mapped_column(JSONB)
    connected_at: Mapped[datetime] = _created_at()


class MailThread(Base):
    """A Gmail thread seen while syncing. Gmail bumps a thread's history id whenever it
    changes, so threads whose id is unchanged aren't downloaded again."""

    __tablename__ = "mail_threads"

    gmail_thread_id: Mapped[str] = mapped_column(String(100), primary_key=True)
    history_id: Mapped[str] = mapped_column(String(40))


class ConversationMessage(Base):
    """One Gmail message to or from someone you've emailed, copied while syncing."""

    __tablename__ = "conversation_messages"
    __table_args__ = (UniqueConstraint("contact_id", "gmail_message_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    contact_id: Mapped[int] = mapped_column(ForeignKey("contacts.id", ondelete="CASCADE"), index=True)
    gmail_message_id: Mapped[str] = mapped_column(String(100))
    gmail_thread_id: Mapped[str] = mapped_column(String(100), index=True)
    rfc_message_id: Mapped[str | None] = mapped_column(String(500))  # Message-ID header, to reply in the thread
    from_me: Mapped[bool] = mapped_column(Boolean)
    from_name: Mapped[str | None] = mapped_column(String(320))
    from_addr: Mapped[str] = mapped_column(String(320))
    to_addrs: Mapped[str] = mapped_column(Text, default="")
    subject: Mapped[str] = mapped_column(Text, default="")
    snippet: Mapped[str] = mapped_column(Text, default="")
    body: Mapped[str] = mapped_column(Text, default="")  # plain text, including any quoted reply
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class Meeting(Base):
    """A Google Meet call set up with someone: a calendar event plus the email with its link."""

    __tablename__ = "meetings"

    id: Mapped[int] = mapped_column(primary_key=True)
    contact_id: Mapped[int] = mapped_column(ForeignKey("contacts.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    time_zone: Mapped[str] = mapped_column(String(64))
    meet_url: Mapped[str] = mapped_column(String(300))
    calendar_event_id: Mapped[str] = mapped_column(String(300))
    calendar_url: Mapped[str | None] = mapped_column(String(1000))
    calendar_invite: Mapped[bool] = mapped_column(Boolean)  # they were also sent a calendar invite
    gmail_message_id: Mapped[str | None] = mapped_column(String(100))
    created_at: Mapped[datetime] = _created_at()
