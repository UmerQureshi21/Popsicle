"""Conversations: each person you've emailed and everything said since, synced from Gmail."""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from googleapiclient.errors import HttpError
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from .. import conversations as svc
from .. import gmail, meetings
from ..db import get_db
from ..models import Contact, ConversationMessage, Email, EmailStatus, Meeting
from ..schemas import (
    ConversationDetail,
    ConversationMessageOut,
    ConversationSummary,
    ConversationSyncOut,
    MeetingIn,
    MeetingOut,
)

router = APIRouter(prefix="/api/conversations", tags=["conversations"])

NEEDS_READ = "Popsicle can't read your Gmail yet. Reconnect Gmail and allow “Read your email” to see replies."


def _messages(db: Session, contact_ids: list[int], me: str) -> dict[int, list[ConversationMessageOut]]:
    """Synced messages per person, plus sent emails that haven't shown up in a sync yet."""
    out: dict[int, list[ConversationMessageOut]] = {cid: [] for cid in contact_ids}
    synced: set[str] = set()
    for m in db.scalars(
        select(ConversationMessage).where(ConversationMessage.contact_id.in_(contact_ids))
    ):
        synced.add(m.gmail_message_id)
        out[m.contact_id].append(
            ConversationMessageOut(
                id=m.gmail_message_id, from_me=m.from_me, from_name=m.from_name, from_addr=m.from_addr,
                to=m.to_addrs, subject=m.subject, body=svc.strip_quoted(m.body) or m.snippet, sent_at=m.sent_at,
                gmail_thread_id=m.gmail_thread_id,
            )
        )
    for e in db.scalars(
        select(Email).where(Email.contact_id.in_(contact_ids), Email.status == EmailStatus.SENT)
    ):
        if e.gmail_message_id in synced:
            continue
        out[e.contact_id].append(
            ConversationMessageOut(
                id=f"email-{e.id}", from_me=True, from_name=None, from_addr=me, to=e.to_email,
                subject=e.subject, body=e.body, sent_at=e.sent_at, gmail_thread_id=e.gmail_thread_id,
            )
        )
    for msgs in out.values():
        msgs.sort(key=lambda m: m.sent_at)
    return out


def _next_meetings(db: Session, contact_ids: list[int]) -> dict[int, datetime]:
    """When each person's next upcoming Meet call is."""
    rows = db.execute(
        select(Meeting.contact_id, func.min(Meeting.starts_at))
        .where(Meeting.contact_id.in_(contact_ids), Meeting.ends_at > meetings.now())
        .group_by(Meeting.contact_id)
    )
    return dict(rows.all())


def _summary(c: Contact, msgs: list[ConversationMessageOut], next_meeting: datetime | None = None) -> dict:
    mine = [m for m in msgs if m.from_me]
    last = msgs[-1] if msgs else None
    return dict(
        contact_id=c.id, email=c.email, full_name=c.full_name, title=c.title, linkedin_url=c.linkedin_url,
        company_name=c.company.name if c.company else None, company_domain=c.company.domain if c.company else None,
        first_emailed_at=mine[0].sent_at if mine else None,
        last_message_at=last.sent_at if last else None,
        last_snippet=(last.body[:200] if last else ""),
        last_from_me=last.from_me if last else True,
        replied=any(not m.from_me for m in msgs),
        message_count=len(msgs),
        next_meeting_at=next_meeting,
    )


def _people(db: Session, contact_id: int | None = None) -> list[Contact]:
    q = (
        select(Contact)
        .where(Contact.id.in_(select(Email.contact_id).where(Email.status == EmailStatus.SENT)))
        .options(selectinload(Contact.company))
    )
    if contact_id is not None:
        q = q.where(Contact.id == contact_id)
    return list(db.scalars(q))


def _me(db: Session) -> str:
    acct = gmail.current_account(db)
    return acct.email if acct else "me"


@router.get("", response_model=list[ConversationSummary])
def list_conversations(db: Session = Depends(get_db)):
    """Everyone you've emailed, most recent conversation first."""
    people = _people(db)
    ids = [c.id for c in people]
    msgs = _messages(db, ids, _me(db))
    upcoming = _next_meetings(db, ids)
    rows = [ConversationSummary(**_summary(c, msgs[c.id], upcoming.get(c.id))) for c in people]
    return sorted(rows, key=lambda r: r.last_message_at.timestamp() if r.last_message_at else 0, reverse=True)


@router.get("/{contact_id}", response_model=ConversationDetail)
def get_conversation(contact_id: int, db: Session = Depends(get_db)):
    people = _people(db, contact_id)
    if not people:
        raise HTTPException(404, "You haven't emailed this person yet.")
    msgs = _messages(db, [contact_id], _me(db))[contact_id]
    calls = db.scalars(select(Meeting).where(Meeting.contact_id == contact_id).order_by(Meeting.starts_at.desc()))
    return ConversationDetail(
        **_summary(people[0], msgs, _next_meetings(db, [contact_id]).get(contact_id)),
        messages=msgs,
        meetings=[MeetingOut.model_validate(m) for m in calls],
    )


@router.post("/{contact_id}/meeting", response_model=MeetingOut, status_code=201)
def schedule_meeting(contact_id: int, body: MeetingIn, db: Session = Depends(get_db)):
    """Create a Google Meet call with them and email them the link."""
    contact = db.get(Contact, contact_id)
    if contact is None:
        raise HTTPException(404, "Contact not found")
    if body.starts_at <= meetings.now():
        raise HTTPException(422, "Pick a time in the future.")
    try:
        meeting = meetings.schedule(
            db, contact, title=body.title.strip(), start=body.starts_at, minutes=body.duration_minutes,
            time_zone=body.time_zone, message=body.message, invite=body.calendar_invite,
        )
    except meetings.MeetingError as e:
        raise HTTPException(e.status, str(e)) from e
    return MeetingOut.model_validate(meeting)


@router.post("/sync", response_model=ConversationSyncOut)
def sync(contact_id: int | None = None, db: Session = Depends(get_db)):
    """Fetch new replies from Gmail, for everyone or one person."""
    acct = gmail.current_account(db)
    if acct is None:
        raise HTTPException(409, "Connect Gmail first.")
    if not gmail.can(acct, gmail.READ_SCOPE):
        raise HTTPException(403, NEEDS_READ)
    try:
        service = gmail.gmail_service(gmail.load_credentials(db))
        result = svc.sync(db, service, acct, None if contact_id is None else [contact_id])
    except svc.AlreadySyncing as e:
        raise HTTPException(409, "Already checking Gmail. Try again in a moment.") from e
    except gmail.GmailNotConnected as e:
        raise HTTPException(409, str(e)) from e
    except HttpError as e:
        if gmail.is_auth_error(e):
            raise HTTPException(403, NEEDS_READ) from e
        raise HTTPException(502, f"Gmail error: {e.reason}") from e
    return ConversationSyncOut(**result.__dict__, synced_at=acct.synced_at)
