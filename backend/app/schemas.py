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

    @field_validator("variables")
    @classmethod
    def _needs_email(cls, v: list[str]) -> list[str]:
        v = [x.strip().lower() for x in v if x.strip()]
        if "email" not in v:
            raise ValueError('one of the variables must be "email"')
        return v


class PreviewItem(BaseModel):
    index: int
    to_email: str
    subject: str
    body: str
    values: dict[str, str]
    status: Literal["ready", "already_sent", "invalid"]
    issues: list[str]
    last_sent_at: datetime | None = None


class PreviewOut(BaseModel):
    items: list[PreviewItem]
    ready: int
    already_sent: int
    invalid: int


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
    counts: CampaignCounts


class CampaignDetail(CampaignSummary):
    subject_template: str
    body_template: str
    variables: list[str]
    attachments: list[AttachmentOut]
    emails: list[EmailOut]


# ---- Companies / contacts ------------------------------------------------


class CompanyIn(BaseModel):
    name: str
    domain: str | None = None
    linkedin_url: str | None = None
    notes: str | None = None


class CompanyPatch(BaseModel):
    name: str | None = None
    domain: str | None = None
    linkedin_url: str | None = None
    notes: str | None = None


class CompanyOut(ORM):
    id: int
    name: str
    domain: str | None
    linkedin_url: str | None
    notes: str | None
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
