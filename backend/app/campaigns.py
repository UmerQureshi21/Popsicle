"""Turning a compose draft into per-recipient emails, and running a campaign's sends."""

import logging
import os
import random
import socket
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from . import gmail, sending, verification
from .db import SessionLocal
from .models import Attachment, Campaign, CampaignStatus, Company, CompanyStatus, Contact, Email, EmailStatus
from . import safety
from .rendering import enrich, render
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
        elif not safety.is_email(to):
            issues.append(f'"{to}" is not a valid email')
        elif to in seen:
            issues.append("duplicate of an earlier row")
        missing = sorted(set(miss_s + miss_b))
        if missing:
            issues.append("no value for " + ", ".join(missing))
        if safety.has_line_break(subject):
            issues.append("the subject can't contain a line break (check the values used in it)")
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
        if field == "linkedin_url":
            val = safety.safe_url(val)  # never store a link that could run code when clicked
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

# ---- Who sends what -------------------------------------------------------
# More than one server process can be up at once (during a redeploy, the old one keeps running
# while the new one starts). Each claims a batch in the database before sending it and keeps
# renewing that claim; a batch whose claim lapses (its process died) can be picked up again.

WORKER_ID = f"{socket.gethostname()}-{os.getpid()}-{uuid.uuid4().hex[:6]}"[:64]
LEASE = timedelta(seconds=60)
RENEW_EVERY = 15.0  # seconds, well inside LEASE
SWEEP_EVERY = 30.0  # seconds between checks for batches whose process died
ACTIVE = (CampaignStatus.QUEUED, CampaignStatus.SENDING, CampaignStatus.WAITING, CampaignStatus.SCHEDULED)
INTERRUPTED_MID_SEND = (
    "Sending stopped while this email was being handed to Gmail, so it may have gone out. "
    "Check Gmail’s Sent folder before retrying it."
)


def _claim(campaign_id: int) -> bool:
    """Take the batch for this process, unless another live process has it."""
    with SessionLocal() as db:
        got = db.execute(
            update(Campaign)
            .where(
                Campaign.id == campaign_id,
                or_(Campaign.worker_id.is_(None), Campaign.worker_id == WORKER_ID, Campaign.lease_until < now()),
            )
            .values(worker_id=WORKER_ID, lease_until=now() + LEASE)
            .returning(Campaign.id)
        ).first()
        db.commit()
        return got is not None


def _renew(campaign_id: int) -> bool:
    """Extend this process's claim. False if it lost the batch, or the batch was cancelled or
    stopped (possibly by another process), so it must stop sending."""
    with SessionLocal() as db:
        got = db.execute(
            update(Campaign)
            .where(Campaign.id == campaign_id, Campaign.worker_id == WORKER_ID, Campaign.status.in_(ACTIVE))
            .values(lease_until=now() + LEASE)
            .returning(Campaign.id)
        ).first()
        db.commit()
        return got is not None


def _release(campaign_id: int) -> None:
    with SessionLocal() as db:
        db.execute(
            update(Campaign)
            .where(Campaign.id == campaign_id, Campaign.worker_id == WORKER_ID)
            .values(worker_id=None, lease_until=None)
        )
        db.commit()


def start(campaign_id: int) -> None:
    with _lock:
        if campaign_id in _running or not _claim(campaign_id):
            return
        _running.add(campaign_id)
        _cancel_requested.discard(campaign_id)
    threading.Thread(target=_run, args=(campaign_id,), daemon=True, name=f"campaign-{campaign_id}").start()


def is_running(campaign_id: int) -> bool:
    """Being sent by this process, or by another one whose claim is still live."""
    if campaign_id in _running:
        return True
    with SessionLocal() as db:
        c = db.get(Campaign, campaign_id)
        return bool(c and c.worker_id and c.lease_until and c.lease_until > now())


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
    renew_at = time.monotonic() + RENEW_EVERY
    while time.monotonic() < end:
        if campaign_id in _cancel_requested:
            return False
        if campaign_id in _wake_requested:
            _wake_requested.discard(campaign_id)
            return True
        if time.monotonic() >= renew_at:
            # Also how a cancel made through another process reaches this one.
            if not _renew(campaign_id):
                return False
            renew_at = time.monotonic() + RENEW_EVERY
        time.sleep(max(0.0, min(0.5, end - time.monotonic())))
    return campaign_id not in _cancel_requested


def send_now(db: Session, campaign: Campaign) -> None:
    """Move a scheduled batch's time to now and wake its sleeping sender (or start one)."""
    campaign.scheduled_for = now()
    db.commit()
    if campaign.id in _running:
        _wake_requested.add(campaign.id)
    elif not is_running(campaign.id):
        start(campaign.id)
    # Otherwise another process has it; it sees the new time on its next check.


def _wait_for_schedule(db: Session, campaign: Campaign) -> bool:
    """Sleep until a scheduled batch's start time. Returns False if it was cancelled meanwhile."""
    while campaign.scheduled_for and campaign.scheduled_for > now():
        campaign.status = CampaignStatus.SCHEDULED
        db.commit()
        # In short steps, so "send now" from another process is noticed.
        if not _wait(campaign.id, min(SWEEP_EVERY, (campaign.scheduled_for - now()).total_seconds())):
            return False
        db.refresh(campaign)  # "send now" moves the time forward
    return True


def _reserve_slot(db: Session, campaign: Campaign, email: Email) -> bool:
    """Take a slot in the daily limit for this email (marking it as being sent). If the limit is
    used up, mark the batch as waiting and sleep until there's room. Returns False if it was
    cancelled or stopped while waiting."""
    waiting = False
    while (retry_at := sending.reserve(db, email)) is not None:
        if not waiting:
            campaign.status = CampaignStatus.WAITING
            campaign.error = (
                f"Paused at your daily limit of {sending.get_settings(db).daily_limit} emails. "
                "It carries on by itself when the limit resets."
            )
            db.commit()
            waiting = True
        if not _wait(campaign.id, max(1.0, (retry_at - now()).total_seconds())):
            return False
    if waiting:
        campaign.status = CampaignStatus.SENDING
        campaign.error = None
        db.commit()
    return True


def _run(campaign_id: int) -> None:
    try:
        if not _claim(campaign_id):
            return  # missing, or another live process is sending it
        with SessionLocal() as db:
            campaign = db.get(Campaign, campaign_id)
            # Emails handed to Gmail when the server last stopped may have gone out: never resend them blindly.
            db.execute(
                update(Email)
                .where(Email.campaign_id == campaign_id, Email.status == EmailStatus.PENDING, Email.attempted_at.is_not(None))
                .values(status=EmailStatus.FAILED, error=INTERRUPTED_MID_SEND)
            )
            db.commit()
            db.refresh(campaign)
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
                if not _renew(campaign_id):
                    return  # lost the batch, or it was cancelled or stopped elsewhere
                # Also marks the email as being sent, atomically with the limit check.
                if not _reserve_slot(db, campaign, email):
                    break
                try:
                    res = gmail.send(service, email.to_email, email.subject, email.body, attachments)
                    email.status = EmailStatus.SENT
                    email.sent_at = now()
                    email.gmail_message_id = res.get("id")
                    email.gmail_thread_id = res.get("threadId")
                    email.error = None
                    if campaign.company is not None and campaign.company.status == CompanyStatus.NOT_STARTED:
                        campaign.company.status = CompanyStatus.EMAILED
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
                    log.exception("send failed for email %s in campaign %s", email.id, campaign_id)
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
            # Only if it's still ours and still active (not cancelled or stopped elsewhere).
            if _renew(campaign_id):
                db.refresh(campaign)
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
        try:
            _release(campaign_id)
        except Exception:
            log.exception("couldn't release campaign %s", campaign_id)
        with _lock:
            _running.discard(campaign_id)
            _cancel_requested.discard(campaign_id)
            _wake_requested.discard(campaign_id)


def resume_on_startup() -> None:
    """Batches waiting on the daily limit or for their scheduled time pick up again by
    themselves, unless another live process already has them."""
    with SessionLocal() as db:
        idle = db.scalars(
            select(Campaign.id).where(
                Campaign.status.in_([CampaignStatus.WAITING, CampaignStatus.SCHEDULED]),
                or_(Campaign.worker_id.is_(None), Campaign.lease_until < now()),
            )
        ).all()
    for campaign_id in idle:
        start(campaign_id)


def mark_interrupted_on_startup(startup: bool = True) -> None:
    """Batches that were mid-send when their process stopped can be resumed from the UI. Ones
    another live process is still sending are left alone. At startup, rows from before claims
    existed (no claim at all) count as stopped; later, only lapsed claims do, since a new batch
    is claimed a moment after it's created."""
    lapsed = Campaign.lease_until < now()
    with SessionLocal() as db:
        db.execute(
            update(Campaign)
            .where(
                Campaign.status.in_([CampaignStatus.QUEUED, CampaignStatus.SENDING]),
                or_(Campaign.lease_until.is_(None), lapsed) if startup else lapsed,
                Campaign.id.not_in(list(_running) or [-1]),
            )
            .values(
                status=CampaignStatus.INTERRUPTED,
                error="Server restarted while sending. Resume to continue.",
                worker_id=None,
                lease_until=None,
            )
        )
        db.commit()


def sweep() -> None:
    """Pick up batches whose process died: resumable ones are marked, waiting ones restart."""
    mark_interrupted_on_startup(startup=False)
    resume_on_startup()


def start_sweeper(stop: threading.Event | None = None, every: float = SWEEP_EVERY) -> threading.Thread:
    stop = stop or threading.Event()

    def loop():
        while not stop.wait(every):
            try:
                sweep()
            except Exception:
                log.exception("sweep failed")

    t = threading.Thread(target=loop, daemon=True, name="campaign-sweeper")
    t.start()
    return t
