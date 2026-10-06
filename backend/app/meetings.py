"""Google Meet invites: a Google Calendar event with a Meet link, and an email to the person
with that link, sent as a reply in your conversation with them."""

import time
import uuid
from datetime import datetime, timedelta, timezone

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import gmail
from .models import Contact, ConversationMessage, Email, EmailStatus, Meeting

LINK = "{{meet_link}}"
MEET_POLLS = 3  # Google usually has the link ready at once; otherwise ask again a few times
POLL_SECONDS = 1.0
ENABLE_CALENDAR_URL = "https://console.cloud.google.com/apis/library/calendar-json.googleapis.com"


def now() -> datetime:
    return datetime.now(timezone.utc)


class MeetingError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def calendar_service(creds):
    return build("calendar", "v3", credentials=creds, cache_discovery=False)


def meet_link(event: dict) -> str | None:
    if event.get("hangoutLink"):
        return event["hangoutLink"]
    for entry in (event.get("conferenceData") or {}).get("entryPoints") or []:
        if entry.get("entryPointType") == "video":
            return entry.get("uri")
    return None


def _calendar_error(e: HttpError) -> MeetingError:
    text = str(e)
    if "accessNotConfigured" in text or "has not been used" in text or "is disabled" in text:
        return MeetingError(
            400, f"Turn on the Google Calendar API for your Google Cloud project, then try again: {ENABLE_CALENDAR_URL}"
        )
    if gmail.is_auth_error(e):
        return MeetingError(403, "Reconnect Gmail and allow Popsicle to manage your calendar events.")
    return MeetingError(502, f"Google Calendar error: {e.reason}")


def create_event(cal, *, title: str, start: datetime, end: datetime, time_zone: str, attendee: str, invite: bool) -> dict:
    body = {
        "summary": title,
        "start": {"dateTime": start.isoformat(), "timeZone": time_zone},
        "end": {"dateTime": end.isoformat(), "timeZone": time_zone},
        "attendees": [{"email": attendee}] if invite else [],
        "conferenceData": {
            "createRequest": {"requestId": uuid.uuid4().hex, "conferenceSolutionKey": {"type": "hangoutsMeet"}}
        },
    }
    event = (
        cal.events()
        .insert(calendarId="primary", body=body, conferenceDataVersion=1, sendUpdates="all" if invite else "none")
        .execute()
    )
    for _ in range(MEET_POLLS):
        if meet_link(event):
            break
        time.sleep(POLL_SECONDS)
        event = cal.events().get(calendarId="primary", eventId=event["id"]).execute()
    return event


def _delete_event(cal, event_id: str, invite: bool) -> None:
    """Undo an event whose email couldn't be sent (telling them, if they were invited)."""
    try:
        cal.events().delete(calendarId="primary", eventId=event_id, sendUpdates="all" if invite else "none").execute()
    except Exception:  # noqa: BLE001 - best effort; the original error is what matters
        pass


def reply_target(db: Session, contact: Contact) -> tuple[str | None, str | None, str | None]:
    """(thread id, Message-ID to answer, subject) of the latest conversation with them, so the
    link arrives as a reply. Falls back to the last email sent to them."""
    msg = db.scalars(
        select(ConversationMessage)
        .where(ConversationMessage.contact_id == contact.id)
        .order_by(ConversationMessage.sent_at.desc())
    ).first()
    if msg is not None:
        return msg.gmail_thread_id, msg.rfc_message_id, msg.subject
    email = db.scalars(
        select(Email)
        .where(Email.contact_id == contact.id, Email.status == EmailStatus.SENT, Email.gmail_thread_id.is_not(None))
        .order_by(Email.sent_at.desc())
    ).first()
    if email is not None:
        return email.gmail_thread_id, None, email.subject
    return None, None, None


def reply_subject(subject: str | None, fallback: str) -> str:
    if not subject:
        return fallback
    return subject if subject.lower().startswith("re:") else f"Re: {subject}"


def schedule(
    db: Session,
    contact: Contact,
    *,
    title: str,
    start: datetime,
    minutes: int,
    time_zone: str,
    message: str,
    invite: bool,
) -> Meeting:
    acct = gmail.current_account(db)
    if acct is None:
        raise MeetingError(409, "Connect Gmail first.")
    if not gmail.can(acct, gmail.CALENDAR_SCOPE):
        raise MeetingError(403, "Reconnect Gmail and allow Popsicle to manage your calendar events to create Meet links.")
    try:
        creds = gmail.load_credentials(db)
    except gmail.GmailNotConnected as e:
        raise MeetingError(409, str(e)) from e

    cal = calendar_service(creds)
    end = start + timedelta(minutes=minutes)
    try:
        event = create_event(cal, title=title, start=start, end=end, time_zone=time_zone, attendee=contact.email, invite=invite)
    except HttpError as e:
        raise _calendar_error(e) from e
    link = meet_link(event)
    if not link:
        _delete_event(cal, event["id"], invite)
        raise MeetingError(502, "Google didn't create a Meet link. Try again.")

    body = message.replace(LINK, link) if LINK in message else f"{message.rstrip()}\n\n{link}"
    thread_id, in_reply_to, subject = reply_target(db, contact)
    subject = reply_subject(subject, title)
    try:
        sent = gmail.send(
            gmail.gmail_service(creds), contact.email, subject, body, [], thread_id=thread_id, in_reply_to=in_reply_to
        )
    except Exception as e:
        _delete_event(cal, event["id"], invite)
        raise MeetingError(502, f"The Meet link was made but the email didn't send ({e}), so the event was removed.") from e

    me = acct.email
    meeting = Meeting(
        contact_id=contact.id, title=title, starts_at=start, ends_at=end, time_zone=time_zone, meet_url=link,
        calendar_event_id=event["id"], calendar_url=event.get("htmlLink"), calendar_invite=invite,
        gmail_message_id=sent.get("id"),
    )
    db.add(meeting)
    # Show the email in the conversation right away; the next sync finds it already there.
    db.add(
        ConversationMessage(
            contact_id=contact.id, gmail_message_id=sent.get("id") or f"meet-{uuid.uuid4().hex}",
            gmail_thread_id=sent.get("threadId") or thread_id or "", from_me=True, from_name=None, from_addr=me,
            to_addrs=contact.email, subject=subject, snippet=body[:200], body=body, sent_at=now(),
        )
    )
    db.commit()
    return meeting
