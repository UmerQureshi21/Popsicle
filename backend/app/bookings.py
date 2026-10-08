"""Booking links: each person gets their own page to pick a time for a call with you.

The open times are your booking hours minus anything already on your Google Calendar. Picking
one creates the Google Meet call (meetings.schedule): a calendar invite to them, and a reply in
your conversation with the link. A link is unguessable, works once, and expires.

The booking page is the one part of Popsicle that works without logging in, so everything it
shows or accepts goes through `page` and `book` here, and nothing else about you leaks out.
"""

import logging
import secrets
import threading
import time as clock
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import gmail, meetings
from .config import settings
from .models import BookingLink, BookingSettings, Contact, ConversationMessage, Meeting

log = logging.getLogger(__name__)

MINUTES = 30  # every call is this long, and times are offered this far apart
VARIABLE = "booking_link"
LINK = "{{booking_link}}"
LINK_TTL = timedelta(days=60)
REUSE_IF_VALID_FOR = timedelta(days=14)  # hand out the same link again while it has this long left
EVENTS_PAGE = 250

# The booking page is public, so it's rate-limited per visitor: each view asks Google Calendar.
RATE_LIMIT = 30
RATE_WINDOW = 600.0  # seconds
_hits: dict[str, list[float]] = {}
_book_lock = threading.Lock()

UNAVAILABLE = "This booking link doesn't work anymore. Reply to the email to find a time."
DEFAULTS = dict(
    enabled=False, host_name="", time_zone="America/Toronto", weekdays=[0, 1, 2, 3, 4],
    day_start=9 * 60, day_end=17 * 60, notice_hours=24, days_ahead=14,
)


def now() -> datetime:
    return datetime.now(timezone.utc)


class BookingError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def get_settings(db: Session) -> BookingSettings:
    s = db.get(BookingSettings, 1)
    if s is None:
        s = BookingSettings(id=1, **DEFAULTS)
        db.add(s)
        db.commit()
    return s


def valid_time_zone(name: str) -> bool:
    try:
        ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return False
    return True


def url(token: str) -> str:
    return f"{settings.frontend_url.rstrip('/')}/book/{token}"


def preview_url() -> str:
    """Stands in for each person's link in the preview; the real ones are made when sending."""
    return url("…")


def first_name(contact: Contact) -> str:
    return contact.first_name or (contact.full_name or "").split(" ")[0] or "there"


def link_for(db: Session, contact: Contact) -> BookingLink:
    """Their link: the same one as before while it has a while left and is unused, else a new one."""
    db.flush()  # a contact made in this transaction needs its id
    at = now()
    existing = db.scalars(
        select(BookingLink)
        .where(BookingLink.contact_id == contact.id, BookingLink.booked_at.is_(None), BookingLink.expires_at > at + REUSE_IF_VALID_FOR)
        .order_by(BookingLink.expires_at.desc())
    ).first()
    if existing is not None:
        return existing
    link = BookingLink(token=secrets.token_urlsafe(24), contact_id=contact.id, expires_at=at + LINK_TTL)
    db.add(link)
    db.flush()
    return link


# ---- Open times -------------------------------------------------------------


def _overlaps(start: datetime, end: datetime, busy: list[tuple[datetime, datetime]]) -> bool:
    return any(start < b_end and end > b_start for b_start, b_end in busy)


def open_slots(s: BookingSettings, busy: list[tuple[datetime, datetime]], at: datetime) -> list[datetime]:
    """Start times (UTC) inside the booking hours, far enough ahead, not overlapping anything busy."""
    tz = ZoneInfo(s.time_zone)
    earliest = at + timedelta(hours=s.notice_hours)
    today = at.astimezone(tz).date()
    out = []
    for d in range(s.days_ahead + 1):
        day = today + timedelta(days=d)
        if day.weekday() not in s.weekdays:
            continue
        for m in range(s.day_start, s.day_end - MINUTES + 1, MINUTES):
            local = datetime.combine(day, time(m // 60, m % 60), tz)
            start = local.astimezone(timezone.utc)
            if start.astimezone(tz).replace(tzinfo=None) != local.replace(tzinfo=None):
                continue  # doesn't exist that day (clocks jumped forward)
            end = start + timedelta(minutes=MINUTES)
            if start >= earliest and not _overlaps(start, end, busy):
                out.append(start)
    return out


def _event_bounds(ev: dict, tz: ZoneInfo) -> tuple[datetime, datetime] | None:
    s, e = ev.get("start") or {}, ev.get("end") or {}
    if s.get("dateTime") and e.get("dateTime"):
        return datetime.fromisoformat(s["dateTime"]), datetime.fromisoformat(e["dateTime"])
    if s.get("date") and e.get("date"):  # all day: midnight to midnight in your time zone
        start = datetime.combine(date.fromisoformat(s["date"]), time(), tz)
        return start, datetime.combine(date.fromisoformat(e["date"]), time(), tz)
    return None


def _is_busy(ev: dict) -> bool:
    if ev.get("status") == "cancelled" or ev.get("transparency") == "transparent":
        return False
    return not any(a.get("self") and a.get("responseStatus") == "declined" for a in ev.get("attendees") or [])


def busy_times(db: Session, s: BookingSettings, start: datetime, end: datetime) -> list[tuple[datetime, datetime]]:
    """Everything on your primary Google Calendar that blocks time, plus calls already set up here."""
    acct = gmail.current_account(db)
    if not gmail.can(acct, gmail.CALENDAR_SCOPE):
        raise BookingError(503, "Booking isn't available right now. Reply to the email to find a time.")
    try:
        cal = meetings.calendar_service(gmail.load_credentials(db))
        events, page_token = [], None
        while True:
            res = (
                cal.events()
                .list(
                    calendarId="primary", timeMin=start.isoformat(), timeMax=end.isoformat(), singleEvents=True,
                    orderBy="startTime", maxResults=EVENTS_PAGE, pageToken=page_token,
                )
                .execute()
            )
            events += res.get("items") or []
            page_token = res.get("nextPageToken")
            if not page_token:
                break
    except Exception as e:  # noqa: BLE001 - not connected, login expired, Google down: all the same to a visitor
        log.warning("booking page couldn't read the calendar: %s", e)
        raise BookingError(503, "Booking isn't available right now. Reply to the email to find a time.") from e
    tz = ZoneInfo(s.time_zone)
    busy = [b for ev in events if _is_busy(ev) and (b := _event_bounds(ev, tz))]
    calls = db.execute(select(Meeting.starts_at, Meeting.ends_at).where(Meeting.starts_at < end, Meeting.ends_at > start))
    return busy + [(a, b) for a, b in calls]


def _window(s: BookingSettings, at: datetime) -> tuple[datetime, datetime]:
    return at, at + timedelta(days=s.days_ahead + 2)


# ---- The public page ----------------------------------------------------------


def check_rate(ip: str) -> None:
    t = clock.monotonic()
    recent = [h for h in _hits.get(ip, []) if t - h < RATE_WINDOW]
    if len(recent) >= RATE_LIMIT:
        _hits[ip] = recent
        raise BookingError(429, "Too many tries. Wait a few minutes and try again.")
    _hits[ip] = [*recent, t]


def _usable(db: Session, token: str, lock: bool = False) -> BookingLink:
    q = select(BookingLink).where(BookingLink.token == token)
    link = db.scalars(q.with_for_update() if lock else q).first()
    # Unknown and expired links get the same answer, so links can't be probed.
    if link is None or (link.booked_at is None and link.expires_at <= now()):
        raise BookingError(404, UNAVAILABLE)
    return link


def _times(m: Meeting | None) -> dict:
    if m is None:  # the call was deleted since
        return {"starts_at": None, "ends_at": None}
    return {"starts_at": m.starts_at.astimezone(timezone.utc), "ends_at": m.ends_at.astimezone(timezone.utc)}


def _booked(link: BookingLink) -> dict | None:
    return _times(link.meeting) if link.booked_at is not None else None


def page(db: Session, token: str) -> dict:
    link = _usable(db, token)
    s = get_settings(db)
    out = {
        "host_name": s.host_name, "first_name": first_name(link.contact), "minutes": MINUTES,
        "time_zone": s.time_zone, "slots": [], "booked": _booked(link),
    }
    if out["booked"]:
        return out
    if not s.enabled:
        raise BookingError(503, "Booking isn't available right now. Reply to the email to find a time.")
    at = now()
    out["slots"] = open_slots(s, busy_times(db, s, *_window(s, at)), at)
    return out


def _when(start: datetime, tz_name: str) -> str:
    local = start.astimezone(ZoneInfo(tz_name))
    return f"{local:%A, %B} {local.day} at {local.hour % 12 or 12}:{local:%M %p %Z}"


def confirmation(name: str, host: str, start: datetime, tz_name: str) -> str:
    return (
        f"Hi {name},\n\nThanks for booking a time! We're set for {_when(start, tz_name)}. "
        f"Here's the Google Meet link:\n\n{meetings.LINK}\n\nYou'll also get a calendar invite. Talk soon,\n{host}"
    )


def book(db: Session, token: str, starts_at: datetime) -> dict:
    """Book `starts_at` through this link, if it's still free. One booking at a time, so two people
    (or two clicks) can't take the same time."""
    if starts_at.tzinfo is None:
        raise BookingError(422, "That time needs a time zone.")
    starts_at = starts_at.astimezone(timezone.utc)
    with _book_lock:
        s = get_settings(db)
        db.execute(select(BookingSettings).where(BookingSettings.id == 1).with_for_update()).one()
        link = _usable(db, token, lock=True)
        if link.booked_at is not None:
            raise BookingError(409, "You've already booked a call. Check your email for the details.")
        if not s.enabled:
            raise BookingError(503, "Booking isn't available right now. Reply to the email to find a time.")
        at = now()
        if starts_at not in open_slots(s, busy_times(db, s, *_window(s, at)), at):
            raise BookingError(409, "That time isn't free anymore. Pick another one.")
        contact = link.contact
        name = first_name(contact)
        try:
            meeting = meetings.schedule(
                db, contact, title=f"Coffee chat: {s.host_name} and {name}", start=starts_at, minutes=MINUTES,
                time_zone=s.time_zone, message=confirmation(name, s.host_name, starts_at, s.time_zone), invite=True,
            )
        except meetings.MeetingError as e:
            db.rollback()
            log.warning("booking through link %s failed: %s", link.id, e)
            raise BookingError(503, "That time couldn't be booked. Reply to the email to find a time.") from e
        link.meeting_id = meeting.id
        link.booked_at = now()
        db.commit()
        return _times(meeting)


# ---- Sending a link from the Inbox ----------------------------------------------


def send_link(db: Session, contact: Contact, message: str) -> BookingLink:
    """Email them their booking link, as a reply in your conversation with them."""
    if not get_settings(db).enabled:
        raise BookingError(409, "Turn on booking links first (Booking hours, at the top of the Inbox).")
    acct = gmail.current_account(db)
    if acct is None:
        raise BookingError(409, "Connect Gmail first.")
    try:
        creds = gmail.load_credentials(db)
    except gmail.GmailNotConnected as e:
        raise BookingError(409, str(e)) from e
    link = link_for(db, contact)
    target = url(link.token)
    body = message.replace(LINK, target) if LINK in message else f"{message.rstrip()}\n\n{target}"
    thread_id, in_reply_to, subject = meetings.reply_target(db, contact)
    subject = meetings.reply_subject(subject, "Finding a time to chat")
    try:
        sent = gmail.send(gmail.gmail_service(creds), contact.email, subject, body, [], thread_id=thread_id, in_reply_to=in_reply_to)
    except Exception as e:
        db.rollback()
        if gmail.is_auth_error(e):
            raise BookingError(403, "Gmail didn't allow sending. Reconnect Gmail, then try again.") from e
        raise BookingError(502, f"The email didn't send ({e}).") from e
    link.emailed_at = now()
    db.add(
        ConversationMessage(
            contact_id=contact.id, gmail_message_id=sent.get("id") or f"booking-{link.token[:12]}",
            gmail_thread_id=sent.get("threadId") or thread_id or "", from_me=True, from_name=None, from_addr=acct.email,
            to_addrs=contact.email, subject=subject, snippet=body[:200], body=body, sent_at=now(),
        )
    )
    db.commit()
    return link
