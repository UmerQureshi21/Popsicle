"""Conversations with the people you've emailed: every Gmail thread with each of them,
copied into the database so the Conversations tab can show who replied and what was said.

Syncing searches Gmail for mail from or to those people, a few addresses per search, and
downloads only threads that changed since the last sync.
"""

import base64
import html
import random
import re
import time
from html.parser import HTMLParser
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from email.utils import getaddresses, parseaddr

from sqlalchemy import delete, or_, select, update
from sqlalchemy.orm import Session

from . import gmail
from .safety import is_email
from .models import (
    CompanyStatus,
    Contact,
    ConversationMessage,
    Email,
    EmailStatus,
    GmailAccount,
    MailThread,
)

ADDRESSES_PER_SEARCH = 15  # Gmail search queries have a length limit
MAX_THREADS_PER_SEARCH = 300

# Gmail allows each account 6,000 "quota units" a minute. A search costs 10 units, and
# downloading a whole thread 120 (40 for just its labels), so a big sync would blow through
# that in seconds. Requests are paced to stay under it, with room left for sending email:
# a burst up to BURST_UNITS for an ordinary sync, then UNITS_PER_MINUTE.
UNITS_PER_MINUTE = 4200
BURST_UNITS = 1200
COST_SEARCH, COST_THREAD, COST_LABELS = 10, 120, 40
# If Google still says "slow down", wait and try again: 2, 4, 8… seconds, up to a minute.
RATE_LIMIT_RETRIES = 6
MAX_BACKOFF = 64

# A sync runs in the background (it can take a while), one at a time across every server
# process: it's claimed on the Gmail account's row, and the claim is renewed as it goes. A
# claim not renewed for this long belonged to a process that died, and can be taken over.
SYNC_STALE = timedelta(minutes=10)


@dataclass
class SyncResult:
    threads_checked: int = 0
    threads_downloaded: int = 0
    new_messages: int = 0
    people_checked: int = 0  # progress while it runs
    people_total: int = 0


def now() -> datetime:
    return datetime.now(timezone.utc)


def _wait(seconds: float) -> None:
    time.sleep(seconds)


class Pace:
    """Spends Gmail quota units no faster than UNITS_PER_MINUTE, after an initial burst."""

    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.units = float(BURST_UNITS)
        self.at = clock()

    def spend(self, units: int) -> None:
        t = self.clock()
        self.units = min(BURST_UNITS, self.units + (t - self.at) * UNITS_PER_MINUTE / 60)
        self.at = t
        if self.units < units:
            _wait((units - self.units) * 60 / UNITS_PER_MINUTE)
            self.units, self.at = float(units), self.clock()
        self.units -= units


def _call(pace: Pace, units: int, request):
    """Run a Gmail request within the pace, waiting and retrying if Google says to slow down."""
    for attempt in range(RATE_LIMIT_RETRIES + 1):
        pace.spend(units)
        try:
            return request.execute()
        except Exception as e:
            if not gmail.is_rate_limited(e) or attempt == RATE_LIMIT_RETRIES:
                raise
            _wait(min(MAX_BACKOFF, 2 ** (attempt + 1)) + random.random())


def sync_running(account: GmailAccount) -> bool:
    return account.sync_started_at is not None and account.sync_started_at > now() - SYNC_STALE


def claim_sync(db: Session, account: GmailAccount) -> bool:
    """Start a sync for this account, unless one is already running (anywhere)."""
    got = db.execute(
        update(GmailAccount)
        .where(
            GmailAccount.id == account.id,
            or_(GmailAccount.sync_started_at.is_(None), GmailAccount.sync_started_at < now() - SYNC_STALE),
        )
        .values(sync_started_at=now())
        .returning(GmailAccount.id)
    ).first()
    db.commit()
    db.refresh(account)
    return got is not None


def finish_sync(db: Session, account: GmailAccount, result: "SyncResult | None", error: str | None = None) -> None:
    account.sync_started_at = None
    account.sync_result = {**asdict(result or SyncResult()), "error": error}
    if result is not None:
        account.synced_at = now()
    db.commit()


# ---- Reading Gmail's message format ------------------------------------


def _headers(payload: dict) -> dict[str, str]:
    return {h["name"].lower(): h["value"] for h in payload.get("headers") or []}


def _decode(data: str) -> str:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4)).decode("utf-8", errors="replace")


# Replies come from strangers, so their size is capped before any processing.
MAX_BODY_CHARS = 200_000
_BLOCKS = {"p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6"}


class _TextOnly(HTMLParser):
    """HTML to plain text in one pass (regexes over hostile HTML can take minutes)."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.hidden = 0  # inside <script> or <style>

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style"):
            self.hidden += 1
        elif tag == "br":
            self.parts.append("\n")

    def handle_startendtag(self, tag, attrs):
        if tag == "br":
            self.parts.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style"):
            self.hidden = max(0, self.hidden - 1)
        elif tag in _BLOCKS:
            self.parts.append("\n")

    def handle_data(self, data):
        if not self.hidden:
            self.parts.append(data)


def _html_to_text(markup: str) -> str:
    parser = _TextOnly()
    parser.feed(markup[:MAX_BODY_CHARS])
    parser.close()
    text = "".join(parser.parts)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def _find_part(payload: dict, mime: str) -> str | None:
    if payload.get("mimeType") == mime and (payload.get("body") or {}).get("data"):
        return _decode(payload["body"]["data"])
    for part in payload.get("parts") or []:
        found = _find_part(part, mime)
        if found is not None:
            return found
    return None


def message_text(payload: dict) -> str:
    """The plain-text body of a Gmail message, or its HTML body turned into text."""
    plain = _find_part(payload, "text/plain")
    if plain is not None:
        return plain[:MAX_BODY_CHARS].replace("\r\n", "\n").strip()
    markup = _find_part(payload, "text/html")
    return _html_to_text(markup) if markup is not None else ""


_QUOTE_STARTS = [
    re.compile(r"^On\b[^\n]*(?:\n[^\n]+){0,2}?\bwrote:\s*$", re.M),  # Gmail, Apple Mail
    re.compile(r"^-{2,}\s*Original Message\s*-{2,}", re.M | re.I),  # Outlook
    re.compile(r"^From: [^\n]+\n(?:Sent|Date): ", re.M),  # Outlook, newer
]


def strip_quoted(text: str) -> str:
    """A reply without the earlier messages it quotes, which the conversation already shows."""
    cuts = [m.start() for p in _QUOTE_STARTS if (m := p.search(text))]
    if cuts:
        text = text[: min(cuts)]
    lines = [line for line in text.splitlines() if not line.startswith(">")]
    return "\n".join(lines).strip()


# ---- Syncing -------------------------------------------------------------


def people_emailed(db: Session, contact_ids: list[int] | None = None) -> dict[str, Contact]:
    """Everyone with at least one sent email, by address."""
    q = select(Contact).where(
        Contact.id.in_(select(Email.contact_id).where(Email.status == EmailStatus.SENT))
    )
    if contact_ids is not None:
        q = q.where(Contact.id.in_(contact_ids))
    return {c.email.lower(): c for c in db.scalars(q)}


def _search(service, pace: Pace, query: str) -> list[dict]:
    threads, token = [], None
    while len(threads) < MAX_THREADS_PER_SEARCH:
        res = _call(pace, COST_SEARCH, service.users().threads().list(userId="me", q=query, maxResults=100, pageToken=token))
        threads += res.get("threads") or []
        token = res.get("nextPageToken")
        if not token:
            break
    return threads[:MAX_THREADS_PER_SEARCH]


def _query(addresses: list[str]) -> str:
    # Only well-formed addresses, quoted, so an odd stored address can't change the search
    # (Gmail treats ( ) { } OR - and spaces as search operators).
    any_of = " OR ".join(f'"{a}"' for a in addresses if is_email(a))
    return f"from:({any_of}) OR to:({any_of}) OR cc:({any_of})"


def _drop_unsent(db: Session, thread: dict) -> list[dict]:
    """A thread's messages without drafts: Gmail lists them in the thread like any message,
    but they haven't been sent. A copied message that's gone from the thread or is now a
    draft (copied before drafts were skipped) is removed."""
    messages = [m for m in thread.get("messages") or [] if "DRAFT" not in (m.get("labelIds") or [])]
    db.execute(
        delete(ConversationMessage).where(
            ConversationMessage.gmail_thread_id == thread["id"],
            ConversationMessage.gmail_message_id.not_in([m["id"] for m in messages]),
        )
    )
    return messages


def _store_thread(db: Session, thread: dict, me: str, people: dict[str, Contact]) -> int:
    """Copy a thread's messages (not drafts) for each person on them. Returns how many were new."""
    messages = _drop_unsent(db, thread)
    known = {
        (cid, mid)
        for cid, mid in db.execute(
            select(ConversationMessage.contact_id, ConversationMessage.gmail_message_id).where(
                ConversationMessage.gmail_thread_id == thread["id"]
            )
        )
    }
    new = 0
    for msg in messages:
        payload = msg.get("payload") or {}
        h = _headers(payload)
        from_name, from_addr = parseaddr(h.get("from", ""))
        from_addr = from_addr.lower()
        to = [a.lower() for _, a in getaddresses([h.get("to", ""), h.get("cc", "")]) if a]
        from_me = "SENT" in (msg.get("labelIds") or []) or from_addr == me
        for address in {from_addr, *to}:
            contact = people.get(address)
            if contact is None or (contact.id, msg["id"]) in known:
                continue
            db.add(
                ConversationMessage(
                    contact_id=contact.id,
                    gmail_message_id=msg["id"],
                    gmail_thread_id=thread["id"],
                    rfc_message_id=h.get("message-id"),
                    from_me=from_me,
                    from_name=from_name or None,
                    from_addr=from_addr,
                    to_addrs=", ".join(to),
                    subject=h.get("subject", ""),
                    snippet=html.unescape(msg.get("snippet") or ""),
                    body=message_text(payload),
                    sent_at=datetime.fromtimestamp(int(msg.get("internalDate") or 0) / 1000, timezone.utc),
                )
            )
            known.add((contact.id, msg["id"]))
            new += 1
            # Someone wrote back: their company has replied.
            if not from_me and contact.company and contact.company.status in (CompanyStatus.NOT_STARTED, CompanyStatus.EMAILED):
                contact.company.status = CompanyStatus.REPLIED
    return new


def sync(db: Session, service, account: GmailAccount, contact_ids: list[int] | None = None) -> SyncResult:
    """Bring conversations up to date with Gmail, for everyone emailed (or just `contact_ids`).
    The caller holds the sync claim (claim_sync); it's renewed after each piece of work, along
    with the progress so far, so a long sync isn't mistaken for a dead one."""
    people = people_emailed(db, contact_ids)
    me = account.email.lower()
    result = SyncResult(people_total=len(people))
    pace = Pace()
    addresses = sorted(people)
    seen: set[str] = set()

    def checkpoint():
        account.sync_started_at = now()
        account.sync_result = {**asdict(result), "error": None}
        db.commit()

    for i in range(0, len(addresses), ADDRESSES_PER_SEARCH):
        for t in _search(service, pace, _query(addresses[i : i + ADDRESSES_PER_SEARCH])):
            if t["id"] in seen:
                continue
            seen.add(t["id"])
            result.threads_checked += 1
            stored = db.get(MailThread, t["id"])
            if stored and stored.history_id == t.get("historyId"):
                if not stored.skips_drafts:
                    # Unchanged, but synced before drafts were skipped: its labels are enough
                    # to remove any draft copied then, at a third of the cost.
                    threads = service.users().threads()
                    _drop_unsent(db, _call(pace, COST_LABELS, threads.get(userId="me", id=t["id"], format="minimal")))
                    stored.skips_drafts = True
                    checkpoint()
                continue
            thread = _call(pace, COST_THREAD, service.users().threads().get(userId="me", id=t["id"], format="full"))
            result.new_messages += _store_thread(db, thread, me, people)
            result.threads_downloaded += 1
            # Only a full sync records the thread as done: a sync for some people may have
            # skipped messages to others on the same thread.
            if contact_ids is None:
                history = thread.get("historyId") or t.get("historyId", "")
                if stored is None:
                    db.add(MailThread(gmail_thread_id=t["id"], history_id=history))
                else:
                    stored.history_id = history
                    stored.skips_drafts = True
            checkpoint()
        result.people_checked = min(len(addresses), i + ADDRESSES_PER_SEARCH)
        checkpoint()
    return result
