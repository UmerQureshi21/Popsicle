"""Conversations: each person you've emailed and everything said since, synced from Gmail."""

from fastapi import APIRouter, Depends, HTTPException
from googleapiclient.errors import HttpError
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .. import conversations as svc
from .. import gmail
from ..db import get_db
from ..models import Contact, ConversationMessage, Email, EmailStatus
from ..schemas import ConversationDetail, ConversationMessageOut, ConversationSummary, ConversationSyncOut

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


def _summary(c: Contact, msgs: list[ConversationMessageOut]) -> dict:
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
    msgs = _messages(db, [c.id for c in people], _me(db))
    rows = [ConversationSummary(**_summary(c, msgs[c.id])) for c in people]
    return sorted(rows, key=lambda r: r.last_message_at.timestamp() if r.last_message_at else 0, reverse=True)


@router.get("/{contact_id}", response_model=ConversationDetail)
def get_conversation(contact_id: int, db: Session = Depends(get_db)):
    people = _people(db, contact_id)
    if not people:
        raise HTTPException(404, "You haven't emailed this person yet.")
    msgs = _messages(db, [contact_id], _me(db))[contact_id]
    return ConversationDetail(**_summary(people[0], msgs), messages=msgs)


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
