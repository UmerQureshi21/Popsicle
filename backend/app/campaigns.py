"""Turning a compose draft into per-recipient emails, and running a campaign's sends."""

import logging
import random
import threading
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from . import gmail, sending, verification
from .db import SessionLocal
from .models import Attachment, Campaign, CampaignStatus, Company, Contact, Email, EmailStatus
from .rendering import EMAIL, enrich, render
from .schemas import CampaignDraft, PreviewItem, PreviewOut, SendingQuota, Verification

log = logging.getLogger(__name__)


def now() -> datetime:
    return datetime.now(timezone.utc)


# ---- Preparing ------------------------------------------------------------


def last_sent_by_address(db: Session, addresses: list[str]) -> dict[str, datetime]:
    if not addresses:
        return {}
    rows = db.execute(
        select(Email.to_email, func.max(Email.sent_at))
        .where(Email.to_email.in_(addresses), Email.status == EmailStatus.SENT)
        .group_by(Email.to_email)
    )
    return dict(rows.all())


def prepare(db: Session, draft: CampaignDraft) -> PreviewOut:
    rows = [enrich(r, draft.company) for r in draft.rows]
    sent = last_sent_by_address(db, [r.get("email", "") for r in rows])
    verdicts = verification.fresh(db, [r.get("email", "") for r in rows])
    seen: set[str] = set()
    items: list[PreviewItem] = []

    for i, values in enumerate(rows):
        to = values.get("email", "")
        subject, miss_s = render(draft.subject, values)
        body, miss_b = render(draft.body, values)
        issues: list[str] = []
        if not to:
            issues.append("missing email")
        elif not EMAIL.match(to):
            issues.append(f'"{to}" is not a valid email')
        elif to in seen:
            issues.append("duplicate of an earlier row")
        missing = sorted(set(miss_s + miss_b))
        if missing:
            issues.append("no value for " + ", ".join(missing))
        seen.add(to)

        v = verdicts.get(to)
        if issues:
            status = "invalid"
        elif to in sent and draft.skip_already_sent:
            status = "already_sent"
        elif v and v.status in verification.UNDELIVERABLE:
            status = "undeliverable"
        else:
            status = "ready"
        items.append(
            PreviewItem(
                index=i, to_email=to, subject=subject, body=body, values=values,
                status=status, issues=issues, last_sent_at=sent.get(to),
                verification=Verification(email=v.email, status=v.status, score=v.score, checked_at=v.checked_at, cached=True)
                if v
                else None,
            )
        )

    ready = sum(it.status == "ready" for it in items)
    q = sending.quota(db)
    return PreviewOut(
        items=items,
        ready=ready,
        already_sent=sum(it.status == "already_sent" for it in items),
        invalid=sum(it.status == "invalid" for it in items),
        undeliverable=sum(it.status == "undeliverable" for it in items),
        quota=SendingQuota(**vars(q)),
        sends_now=min(ready, q.remaining),
        sends_later=max(0, ready - q.remaining),
        later_from=q.later_from(min(ready, q.remaining)) if ready > q.remaining else None,
    )


def get_or_create_company(db: Session, name: str | None) -> Company | None:
    name = (name or "").strip()
    if not name:
        return None
    company = db.scalars(select(Company).where(func.lower(Company.name) == name.lower())).first()
    if company is None:
        company = Company(name=name)
        db.add(company)
        db.flush()
    return company


def upsert_contact(db: Session, values: dict[str, str], company: Company | None) -> Contact:
    contact = db.scalars(select(Contact).where(Contact.email == values["email"])).first()
    if contact is None:
        contact = Contact(email=values["email"])
        db.add(contact)
    # Fill in whatever the tuple told us; don't blank out what we already know.
    for field, keys in {
        "full_name": ("full_name", "name"),
        "first_name": ("first_name",),
        "last_name": ("last_name",),
        "title": ("title", "role", "position"),
        "linkedin_url": ("linkedin_url", "linkedin"),
    }.items():
        val = next((values[k] for k in keys if values.get(k)), None)
        if val:
            setattr(contact, field, val)
    if company is not None:
        contact.company = company
    db.flush()
    return contact


def create_campaign(db: Session, draft: CampaignDraft) -> Campaign:
    """Raises ValueError if any row is invalid, nothing would be sent, or the schedule is off."""
    if draft.scheduled_for is not None:
        if draft.scheduled_for.tzinfo is None:
            raise ValueError("The scheduled time needs a timezone.")
        if draft.scheduled_for <= now():
            raise ValueError("Pick a time in the future.")
        if draft.scheduled_for > now() + MAX_SCHEDULE_AHEAD:
            raise ValueError("Schedules can be at most 60 days ahead.")
    preview = prepare(db, draft)
    if preview.invalid:
        bad = [f"row {it.index + 1}: {'; '.join(it.issues)}" for it in preview.items if it.status == "invalid"]
        raise ValueError("Fix these rows first: " + " | ".join(bad))
    if not preview.ready:
        if preview.undeliverable:
            raise ValueError("No one left to email: everyone here was already emailed or has an address that doesn't exist.")
        raise ValueError("Everyone in this list has already been emailed.")

    company = get_or_create_company(db, draft.company)
    attachments = list(db.scalars(select(Attachment).where(Attachment.id.in_(draft.attachment_ids))))
    campaign = Campaign(
        name=draft.name or (company.name if company else "Untitled batch"),
        company=company,
        template_id=draft.template_id,
        subject_template=draft.subject,
        body_template=draft.body,
        variables=draft.variables,
        delay_seconds=draft.delay_seconds,
        status=CampaignStatus.SCHEDULED if draft.scheduled_for else CampaignStatus.QUEUED,
        scheduled_for=draft.scheduled_for,
        attachments=attachments,
    )
    db.add(campaign)

    for it in preview.items:
        contact = upsert_contact(db, it.values, company)
        skipped = it.status in ("already_sent", "undeliverable")
        if it.status == "undeliverable":
            why = f"Hunter says this address doesn't exist (checked {it.verification.checked_at:%b %d, %Y})"
        elif it.last_sent_at:
            why = f"already emailed on {it.last_sent_at:%b %d, %Y}"
        else:
            why = None
        campaign.emails.append(
            Email(
                contact=contact,
                to_email=it.to_email,
                subject=it.subject,
                body=it.body,
                variables={k: it.values[k] for k in draft.variables if k in it.values},
                status=EmailStatus.SKIPPED if skipped else EmailStatus.PENDING,
                error=why if skipped else None,
            )
        )
    db.commit()
    return campaign


# ---- Sending ----------------------------------------------------------------

_lock = threading.Lock()
_running: set[int] = set()
_cancel_requested: set[int] = set()
_wake_requested: set[int] = set()  # scheduled batches told to start early

MAX_SCHEDULE_AHEAD = timedelta(days=60)


def start(campaign_id: int) -> None:
    with _lock:
        if campaign_id in _running:
            return
        _running.add(campaign_id)
        _cancel_requested.discard(campaign_id)
    threading.Thread(target=_run, args=(campaign_id,), daemon=True, name=f"campaign-{campaign_id}").start()


def is_running(campaign_id: int) -> bool:
    return campaign_id in _running


def request_cancel(db: Session, campaign: Campaign) -> None:
    _cancel_requested.add(campaign.id)
    campaign.status = CampaignStatus.CANCELLED
    campaign.finished_at = now()
    db.execute(
        update(Email)
        .where(Email.campaign_id == campaign.id, Email.status == EmailStatus.PENDING)
        .values(status=EmailStatus.CANCELLED)
    )
    db.commit()


def _wait(campaign_id: int, seconds: float) -> bool:
    """Sleep in short steps; returns False if the campaign was cancelled meanwhile.
    Returns early (True) if the batch is told to start now."""
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if campaign_id in _cancel_requested:
            return False
        if campaign_id in _wake_requested:
            _wake_requested.discard(campaign_id)
            return True
        time.sleep(min(0.5, end - time.monotonic()))
    return campaign_id not in _cancel_requested


def send_now(db: Session, campaign: Campaign) -> None:
    """Move a scheduled batch's time to now and wake its sleeping sender (or start one)."""
    campaign.scheduled_for = now()
    db.commit()
    if is_running(campaign.id):
        _wake_requested.add(campaign.id)
    else:
        start(campaign.id)


def _wait_for_schedule(db: Session, campaign: Campaign) -> bool:
    """Sleep until a scheduled batch's start time. Returns False if it was cancelled meanwhile."""
    while campaign.scheduled_for and campaign.scheduled_for > now():
        campaign.status = CampaignStatus.SCHEDULED
        db.commit()
        if not _wait(campaign.id, (campaign.scheduled_for - now()).total_seconds()):
            return False
        db.refresh(campaign)  # "send now" moves the time forward
    return True


def _wait_for_quota(db: Session, campaign: Campaign) -> bool:
    """If the daily limit is used up, mark the batch as waiting and sleep until there's room.
    Returns False if it was cancelled while waiting."""
    q = sending.quota(db)
    if q.remaining > 0:
        return True
    campaign.status = CampaignStatus.WAITING
    campaign.error = f"Paused at your daily limit of {q.daily_limit} emails. It carries on by itself when the limit resets."
    db.commit()
    while q.remaining <= 0:
        if not _wait(campaign.id, max(1.0, (q.next_slot_at - now()).total_seconds())):
            return False
        q = sending.quota(db)
    campaign.status = CampaignStatus.SENDING
    campaign.error = None
    db.commit()
    return True


def _run(campaign_id: int) -> None:
    try:
        with SessionLocal() as db:
            campaign = db.get(Campaign, campaign_id)
            if campaign is None:
                return
            if not _wait_for_schedule(db, campaign):
                return
            campaign.status = CampaignStatus.SENDING
            campaign.started_at = campaign.started_at or now()
            campaign.error = None
            db.commit()

            try:
                service = gmail.gmail_service(gmail.load_credentials(db))
            except gmail.GmailNotConnected as e:
                campaign.status = CampaignStatus.INTERRUPTED
                campaign.error = str(e)
                db.commit()
                return

            attachments = list(campaign.attachments)
            pending = [e.id for e in campaign.emails if e.status == EmailStatus.PENDING]
            for n, email_id in enumerate(pending):
                if campaign_id in _cancel_requested:
                    break
                email = db.get(Email, email_id)
                db.refresh(email)
                if email.status != EmailStatus.PENDING:
                    continue
                if not _wait_for_quota(db, campaign):
                    break
                try:
                    res = gmail.send(service, email.to_email, email.subject, email.body, attachments)
                    email.status = EmailStatus.SENT
                    email.sent_at = now()
                    email.gmail_message_id = res.get("id")
                    email.gmail_thread_id = res.get("threadId")
                    email.error = None
                except Exception as e:
                    if gmail.is_auth_error(e):
                        # Every remaining send would fail the same way; pause so it can resume after reconnecting.
                        log.warning("gmail auth error, pausing campaign %s: %s", campaign_id, e)
                        campaign.status = CampaignStatus.INTERRUPTED
                        campaign.error = (
                            "Gmail didn't allow sending. Reconnect Gmail and tick "
                            "“Send email on your behalf”, then resume."
                        )
                        db.commit()
                        return
                    # One bad address shouldn't stop the batch.
                    log.exception("send failed for %s", email.to_email)
                    email.status = EmailStatus.FAILED
                    email.error = str(e)[:2000]
                db.commit()
                # Randomised spacing so sends don't look machine-generated, never closer than the
                # account-wide minimum gap.
                d = max(campaign.delay_seconds, sending.get_settings(db).min_delay_seconds)
                if n < len(pending) - 1 and d > 0:
                    if not _wait(campaign_id, random.uniform(d * 0.5, d * 1.5)):
                        break

            db.refresh(campaign)
            if campaign.status != CampaignStatus.CANCELLED:
                campaign.status = CampaignStatus.COMPLETED
                campaign.finished_at = now()
            db.commit()
    except Exception:
        log.exception("campaign %s crashed", campaign_id)
        with SessionLocal() as db:
            c = db.get(Campaign, campaign_id)
            if c and c.status == CampaignStatus.SENDING:
                c.status = CampaignStatus.INTERRUPTED
                c.error = "Unexpected error while sending; see server logs."
                db.commit()
    finally:
        with _lock:
            _running.discard(campaign_id)
            _cancel_requested.discard(campaign_id)
            _wake_requested.discard(campaign_id)


def resume_on_startup() -> None:
    """Batches waiting on the daily limit or for their scheduled time pick up again by
    themselves after a restart."""
    with SessionLocal() as db:
        waiting = db.scalars(
            select(Campaign.id).where(Campaign.status.in_([CampaignStatus.WAITING, CampaignStatus.SCHEDULED]))
        ).all()
    for campaign_id in waiting:
        start(campaign_id)


def mark_interrupted_on_startup() -> None:
    """Campaigns that were mid-send when the server stopped can be resumed from the UI."""
    with SessionLocal() as db:
        db.execute(
            update(Campaign)
            .where(Campaign.status.in_([CampaignStatus.QUEUED, CampaignStatus.SENDING]))
            .values(status=CampaignStatus.INTERRUPTED, error="Server restarted while sending. Resume to continue.")
        )
        db.commit()
