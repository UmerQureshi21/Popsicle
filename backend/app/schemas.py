from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ORM(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---- Compose / campaigns -------------------------------------------------


class CampaignDraft(BaseModel):
    company: str | None = None
    name: str | None = None
    subject: str
    body: str
    variables: list[str]  # ordered names of each element in a tuple, must include "email"
    rows: list[dict[str, str]]  # one dict per tuple, keyed by variable name
    attachment_ids: list[int] = []
    template_id: int | None = None
    skip_already_sent: bool = True
    delay_seconds: float = Field(30, ge=0, le=600)
    scheduled_for: datetime | None = None  # start sending at this time instead of now

    @field_validator("variables")
    @classmethod
    def _needs_email(cls, v: list[str]) -> list[str]:
        v = [x.strip().lower() for x in v if x.strip()]
        if "email" not in v:
            raise ValueError('one of the variables must be "email"')
        return v


class Verification(BaseModel):
    email: str
    status: str  # valid | invalid | accept_all | webmail | disposable | unknown | pending
    score: int | None = None
    checked_at: datetime | None = None
    cached: bool = False  # came from a saved result, so no Hunter verification was used


class VerifyIn(BaseModel):
    emails: list[str] = Field(min_length=1, max_length=100)
    refresh: bool = False


class VerifyOut(BaseModel):
    results: list[Verification]


class PreviewItem(BaseModel):
    index: int
    to_email: str
    subject: str
    body: str
    values: dict[str, str]
    # undeliverable: Hunter says the address doesn't exist, so it's skipped like already_sent
    status: Literal["ready", "already_sent", "invalid", "undeliverable"]
    issues: list[str]
    last_sent_at: datetime | None = None
    verification: Verification | None = None  # saved Hunter verdict from the last 30 days


class SendingQuota(BaseModel):
    daily_limit: int
    min_delay_seconds: float
    sent_last_24h: int
    remaining: int
    next_slot_at: datetime
    oldest_sent_at: datetime | None = None


class SendingSettingsIn(BaseModel):
    daily_limit: int = Field(ge=1, le=500)
    min_delay_seconds: float = Field(ge=0, le=600)


class PreviewOut(BaseModel):
    items: list[PreviewItem]
    ready: int
    already_sent: int
    invalid: int
    undeliverable: int
    quota: SendingQuota
    sends_now: int  # how many of the ready emails fit under today's limit
    sends_later: int  # the rest wait until the limit resets
    later_from: datetime | None = None  # when the waiting ones can start going out


class AttachmentOut(ORM):
    id: int
    filename: str
    content_type: str
    size_bytes: int
    created_at: datetime


class EmailOut(ORM):
    id: int
    contact_id: int | None
    to_email: str
    subject: str
    body: str
    variables: dict[str, str]
    status: str
    error: str | None
    sent_at: datetime | None
    created_at: datetime


class CampaignCounts(BaseModel):
    total: int = 0
    pending: int = 0
    sent: int = 0
    failed: int = 0
    skipped: int = 0
    cancelled: int = 0


class CampaignSummary(BaseModel):
    id: int
    name: str
    company_id: int | None
    company_name: str | None
    status: str
    error: str | None
    delay_seconds: float
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None
    scheduled_for: datetime | None = None
    counts: CampaignCounts


class CampaignDetail(CampaignSummary):
    subject_template: str
    body_template: str
    variables: list[str]
    attachments: list[AttachmentOut]
    emails: list[EmailOut]


# ---- Companies / contacts ------------------------------------------------


CompanyStatusName = Literal["not_started", "emailed", "replied", "not_interested"]


class CompanyIn(BaseModel):
    name: str
    domain: str | None = None
    linkedin_url: str | None = None
    notes: str | None = None
    status: CompanyStatusName = "not_started"


class CompanyPatch(BaseModel):
    name: str | None = None
    domain: str | None = None
    linkedin_url: str | None = None
    notes: str | None = None
    status: CompanyStatusName | None = None


class CompaniesBulkIn(BaseModel):
    """Company names or domains, one per entry, e.g. pasted from a list."""

    lines: list[str] = Field(max_length=100)


class CompaniesBulkOut(BaseModel):
    added: list["CompanyOut"]
    skipped: list[str]  # already on the list, or listed twice


class FillDomainsOut(BaseModel):
    filled: int  # companies that got a domain
    missing: int  # companies still without one


class CompanyOut(ORM):
    id: int
    name: str
    domain: str | None
    linkedin_url: str | None
    notes: str | None
    status: CompanyStatusName = "not_started"
    created_at: datetime
    contact_count: int = 0
    emailed_count: int = 0
    last_sent_at: datetime | None = None


class ContactPatch(BaseModel):
    full_name: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    title: str | None = None
    linkedin_url: str | None = None
    notes: str | None = None
    company_id: int | None = None


class ContactOut(ORM):
    id: int
    email: str
    full_name: str | None
    first_name: str | None
    last_name: str | None
    title: str | None
    linkedin_url: str | None
    notes: str | None
    company_id: int | None
    company_name: str | None = None
    created_at: datetime
    sent_count: int = 0
    last_sent_at: datetime | None = None
    last_status: str | None = None


# ---- Templates -----------------------------------------------------------


class TemplateIn(BaseModel):
    name: str
    subject: str
    body: str
    variables: list[str] = []


class TemplateOut(ORM):
    id: int
    name: str
    subject: str
    body: str
    variables: list[str]
    created_at: datetime
    updated_at: datetime


# ---- Misc ----------------------------------------------------------------


class GmailStatus(BaseModel):
    connected: bool
    email: str | None
    credentials_file_present: bool
    can_read: bool = False  # may read replies (Conversations)
    can_meet: bool = False  # may create Google Calendar events with Meet links


class Stats(BaseModel):
    sent_total: int
    sent_last_7_days: int
    companies: int
    contacts: int
    failed_total: int


# ---- Finding people (Hunter.io) -----------------------------------------


class HunterStatus(BaseModel):
    configured: bool
    plan_name: str | None = None
    credits_used: int | None = None
    credits_total: int | None = None  # the monthly allowance
    credits_remaining: int | None = None
    verifications_total: int | None = None  # monthly email verifications, counted separately
    verifications_remaining: int | None = None
    reset_date: str | None = None  # when the allowance resets, e.g. "2026-11-02"
    error: str | None = None


class FoundPerson(BaseModel):
    email: str
    first_name: str | None = None
    last_name: str | None = None
    full_name: str | None = None
    position: str | None = None
    department: str | None = None
    seniority: str | None = None
    confidence: int | None = None  # Hunter's 0-100 score that the email is right
    verification_status: str | None = None  # valid | accept_all | unknown | ...
    linkedin_url: str | None = None
    already_emailed_at: datetime | None = None


class LocationFilter(BaseModel):
    """One place a person can be based. Hunter needs a country (ISO code like "CA") with a city."""

    city: str | None = None
    country: str | None = None
    state: str | None = None  # US state codes only
    continent: str | None = None


class PeopleSearchIn(BaseModel):
    query: str = Field(min_length=1)  # company name or domain
    limit: int = Field(10, ge=1, le=100)
    offset: int = Field(0, ge=0)
    department: str | None = None
    seniority: str | None = None
    job_titles: str | None = None
    location: list[LocationFilter] | None = None  # only people based in any of these places
    refresh: bool = False  # bypass the cache and spend credits again


class PeopleSearchOut(BaseModel):
    domain: str | None
    organization: str | None
    pattern: str | None  # e.g. "{first}.{last}"
    total: int  # how many people Hunter knows at this company
    offset: int
    limit: int
    people: list[FoundPerson]
    cached: bool


class CompanySuggestion(BaseModel):
    name: str | None
    domain: str
    logo: str | None = None
    email_count: int | None = None


class PeopleCount(BaseModel):
    total: int
    by_department: dict[str, int]  # e.g. {"it": 154, "sales": 135}
    by_seniority: dict[str, int]


class EmailFinderIn(BaseModel):
    company: str | None = None  # company name or domain; optional when a LinkedIn URL is given
    full_name: str | None = None
    linkedin_url: str | None = None
    refresh: bool = False


class EmailFinderOut(BaseModel):
    person: FoundPerson | None  # None when Hunter couldn't find an email (no credit used)
    domain: str | None = None  # the domain Hunter searched, e.g. "harvey.ai"
    company: str | None = None  # the company name Hunter matched, if it knows one
    cached: bool


# ---- Conversations ------------------------------------------------------


class ConversationSummary(BaseModel):
    contact_id: int
    email: str
    full_name: str | None
    title: str | None
    linkedin_url: str | None
    company_name: str | None
    company_domain: str | None
    first_emailed_at: datetime | None
    last_message_at: datetime | None
    last_snippet: str
    last_from_me: bool
    replied: bool  # they've written back at least once
    message_count: int
    next_meeting_at: datetime | None = None  # the next Meet call set up with them


class ConversationMessageOut(BaseModel):
    id: str  # Gmail's message id (or "email-<id>" for a sent email not synced yet)
    from_me: bool
    from_name: str | None
    from_addr: str
    to: str
    subject: str
    body: str  # without the quoted earlier messages
    sent_at: datetime
    gmail_thread_id: str | None


class MeetingOut(ORM):
    id: int
    title: str
    starts_at: datetime
    ends_at: datetime
    time_zone: str
    meet_url: str
    calendar_url: str | None
    calendar_invite: bool
    created_at: datetime


class MeetingIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    starts_at: datetime
    duration_minutes: int = Field(ge=5, le=480)
    time_zone: str  # IANA name, e.g. America/Toronto
    message: str = Field(min_length=1, max_length=20_000)  # {{meet_link}} is replaced with the link
    calendar_invite: bool = True  # also send them a Google Calendar invite

    @field_validator("time_zone")
    @classmethod
    def known_time_zone(cls, v: str) -> str:
        from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

        try:
            ZoneInfo(v)
        except (ZoneInfoNotFoundError, ValueError) as e:
            raise ValueError("Unknown time zone.") from e
        return v

    @field_validator("starts_at")
    @classmethod
    def has_time_zone(cls, v: datetime) -> datetime:
        if v.tzinfo is None:
            raise ValueError("The meeting time needs a timezone.")
        return v


class ConversationDetail(ConversationSummary):
    messages: list[ConversationMessageOut]
    meetings: list[MeetingOut] = []


class ConversationSyncOut(BaseModel):
    threads_checked: int
    threads_downloaded: int
    new_messages: int
    synced_at: datetime | None
