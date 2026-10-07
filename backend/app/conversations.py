"""Conversations with the people you've emailed: every Gmail thread with each of them,
copied into the database so the Conversations tab can show who replied and what was said.

Syncing searches Gmail for mail from or to those people, a few addresses per search, and
downloads only threads that changed since the last sync.
"""

import base64
import html
import re
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from email.utils import getaddresses, parseaddr

from sqlalchemy import or_, select, update
from sqlalchemy.orm import Session

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

# A sync runs in the background (it can take a while), one at a time across every server
# process: it's claimed on the Gmail account's row. A claim older than this belonged to a
# process that died, and can be taken over.
SYNC_STALE = timedelta(minutes=10)


@dataclass
class SyncResult:
    threads_checked: int = 0
    threads_downloaded: int = 0
    new_messages: int = 0


def now() -> datetime:
    return datetime.now(timezone.utc)


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


def _html_to_text(markup: str) -> str:
    markup = re.sub(r"(?is)<(script|style).*?</\1>", "", markup)
    markup = re.sub(r"(?i)<br\s*/?>|</(p|div|li|tr|h\d)>", "\n", markup)
    text = html.unescape(re.sub(r"<[^>]+>", "", markup))
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
        return plain.replace("\r\n", "\n").strip()
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


def _search(service, query: str) -> list[dict]:
    threads, token = [], None
    while len(threads) < MAX_THREADS_PER_SEARCH:
        res = service.users().threads().list(userId="me", q=query, maxResults=100, pageToken=token).execute()
        threads += res.get("threads") or []
        token = res.get("nextPageToken")
        if not token:
            break
    return threads[:MAX_THREADS_PER_SEARCH]


def _query(addresses: list[str]) -> str:
    any_of = " OR ".join(addresses)
    return f"from:({any_of}) OR to:({any_of}) OR cc:({any_of})"


def _store_thread(db: Session, thread: dict, me: str, people: dict[str, Contact]) -> int:
    """Copy a thread's messages for each person on them. Returns how many were new."""
    known = {
        (cid, mid)
        for cid, mid in db.execute(
            select(ConversationMessage.contact_id, ConversationMessage.gmail_message_id).where(
                ConversationMessage.gmail_thread_id == thread["id"]
            )
        )
    }
    new = 0
    for msg in thread.get("messages") or []:
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
    The caller holds the sync claim (claim_sync)."""
    people = people_emailed(db, contact_ids)
    me = account.email.lower()
    result = SyncResult()
    addresses = sorted(people)
    seen: set[str] = set()
    for i in range(0, len(addresses), ADDRESSES_PER_SEARCH):
        for t in _search(service, _query(addresses[i : i + ADDRESSES_PER_SEARCH])):
            if t["id"] in seen:
                continue
            seen.add(t["id"])
            result.threads_checked += 1
            stored = db.get(MailThread, t["id"])
            if stored and stored.history_id == t.get("historyId"):
                continue
            thread = service.users().threads().get(userId="me", id=t["id"], format="full").execute()
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
            db.commit()
    db.commit()
    return result

