"""A stand-in for Gmail's API client: threads.list (a search by address), threads.get, and the
mailbox's history (getProfile, history.list, messages.get with headers only)."""

import base64
import re
from datetime import datetime, timezone


def b64(text: str) -> str:
    return base64.urlsafe_b64encode(text.encode()).decode().rstrip("=")


def message(
    id: str,
    frm: str,
    to: str,
    body: str = "Hi",
    *,
    subject: str = "Quick question",
    at: datetime = datetime(2026, 10, 1, 12, tzinfo=timezone.utc),
    sent: bool = False,
    cc: str = "",
    html: bool = False,
    draft: bool = False,
) -> dict:
    headers = [{"name": "From", "value": frm}, {"name": "To", "value": to}, {"name": "Subject", "value": subject},
               {"name": "Message-ID", "value": f"<{id}@mail.gmail.com>"}]
    if cc:
        headers.append({"name": "Cc", "value": cc})
    part = {"mimeType": "text/html" if html else "text/plain", "body": {"data": b64(body)}}
    return {
        "id": id,
        "labelIds": ["DRAFT"] if draft else ["SENT"] if sent else ["INBOX"],
        "snippet": body[:100],
        "internalDate": str(int(at.timestamp() * 1000)),
        "payload": {"mimeType": "multipart/alternative", "headers": headers, "parts": [part]},
    }


class _Call:
    def __init__(self, result, fail_next: list[Exception] | None = None):
        self.result = result
        self.fail_next = fail_next if fail_next is not None else []

    def execute(self):
        # Like Google's client, running the same request again tries again.
        if self.fail_next:
            raise self.fail_next.pop(0)
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def not_found():
    from googleapiclient.errors import HttpError

    return HttpError(type("Resp", (), {"status": 404, "reason": "Not Found"})(), b"Requested entity was not found.")


class _History:
    def __init__(self, gmail: "FakeGmail"):
        self.gmail = gmail

    def list(self, userId, startHistoryId, historyTypes, labelId, maxResults, pageToken=None):
        g = self.gmail
        g.history_asks.append((startHistoryId, labelId))
        if int(startHistoryId) < g.history_kept_from:
            return _Call(not_found(), g.fail_next)
        records = [
            {"id": str(hid), "messagesAdded": [{"message": {"id": m["id"], "threadId": tid}}]}
            for hid, tid, m in g.log
            if hid > int(startHistoryId) and labelId in m["labelIds"]
        ]
        start = int(pageToken or 0)
        res = {"history": records[start : start + g.page_size], "historyId": str(g.mailbox)}
        if start + g.page_size < len(records):
            res["nextPageToken"] = str(start + g.page_size)
        return _Call(res, g.fail_next)


class _Messages:
    def __init__(self, gmail: "FakeGmail"):
        self.gmail = gmail

    def get(self, userId, id, format, metadataHeaders):
        g = self.gmail
        g.header_checks.append(id)
        for t in g.data.values():
            for m in t["messages"]:
                if m["id"] == id:
                    headers = [h for h in m["payload"]["headers"] if h["name"] in metadataHeaders]
                    return _Call({"id": id, "payload": {"headers": headers}}, g.fail_next)
        return _Call(not_found(), g.fail_next)


class FakeGmail:
    """threads: thread id -> list of messages. Bump a thread's history with `.add()`; every added
    message also moves the mailbox's history on (`.mailbox`), as Gmail does."""

    def __init__(self, threads: dict[str, list[dict]] | None = None, page_size: int = 100):
        self.data: dict[str, dict] = {}
        self.mailbox = 100  # the mailbox's history id
        self.log: list[tuple[int, str, dict]] = []  # (history id, thread id, message added)
        self.history_kept_from = 0  # older history ids answer 404, like Gmail's after about a week
        self.history_asks: list[tuple[str, str]] = []
        self.header_checks: list[str] = []
        self.page_size = page_size
        self.searches: list[str] = []
        self.downloads: list[str] = []
        self.error: Exception | None = None
        self.fail_next: list[Exception] = []  # errors for the next requests, one each
        for tid, msgs in (threads or {}).items():
            self.add(tid, *msgs)

    def add(self, thread_id: str, *msgs: dict):
        t = self.data.setdefault(thread_id, {"id": thread_id, "historyId": "0", "messages": []})
        t["messages"] += msgs
        t["historyId"] = str(int(t["historyId"]) + 1)
        for m in msgs:
            self.mailbox += 1
            self.log.append((self.mailbox, thread_id, m))

    # googleapiclient shape: service.users().threads().list(...).execute()
    def users(self):
        return self

    def threads(self):
        return self

    def history(self):
        return _History(self)

    def messages(self):
        return _Messages(self)

    def getProfile(self, userId):
        if self.error:
            return _Call(self.error)
        return _Call({"emailAddress": "me@gmail.com", "historyId": str(self.mailbox)}, self.fail_next)

    def list(self, userId, q, maxResults, pageToken=None):
        if self.error:
            return _Call(self.error)
        self.searches.append(q)
        wanted = set(re.findall(r"[\w.+-]+@[\w.-]+", q))
        hits = [
            {"id": t["id"], "historyId": t["historyId"]}
            for t in self.data.values()
            if any(wanted & set(re.findall(r"[\w.+-]+@[\w.-]+", " ".join(h["value"] for h in m["payload"]["headers"]).lower()))
                   for m in t["messages"])
        ]
        start = int(pageToken or 0)
        page = hits[start : start + self.page_size]
        res = {"threads": page}
        if start + self.page_size < len(hits):
            res["nextPageToken"] = str(start + self.page_size)
        return _Call(res, self.fail_next)

    def get(self, userId, id, format):
        self.downloads.append(id if format == "full" else f"{id} ({format})")
        if id not in self.data:
            return _Call(not_found(), self.fail_next)
        return _Call(self.data[id], self.fail_next)
