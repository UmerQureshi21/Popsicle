"""A stand-in for Gmail's API client: threads.list (a search by address) and threads.get."""

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
) -> dict:
    headers = [{"name": "From", "value": frm}, {"name": "To", "value": to}, {"name": "Subject", "value": subject},
               {"name": "Message-ID", "value": f"<{id}@mail.gmail.com>"}]
    if cc:
        headers.append({"name": "Cc", "value": cc})
    part = {"mimeType": "text/html" if html else "text/plain", "body": {"data": b64(body)}}
    return {
        "id": id,
        "labelIds": ["SENT"] if sent else ["INBOX"],
        "snippet": body[:100],
        "internalDate": str(int(at.timestamp() * 1000)),
        "payload": {"mimeType": "multipart/alternative", "headers": headers, "parts": [part]},
    }


class _Call:
    def __init__(self, result):
        self.result = result

    def execute(self):
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


class FakeGmail:
    """threads: thread id -> list of messages. Bump a thread's history with `.add()`."""

    def __init__(self, threads: dict[str, list[dict]] | None = None, page_size: int = 100):
        self.data: dict[str, dict] = {}
        self.page_size = page_size
        self.searches: list[str] = []
        self.downloads: list[str] = []
        self.error: Exception | None = None
        for tid, msgs in (threads or {}).items():
            self.add(tid, *msgs)

    def add(self, thread_id: str, *msgs: dict):
        t = self.data.setdefault(thread_id, {"id": thread_id, "historyId": "0", "messages": []})
        t["messages"] += msgs
        t["historyId"] = str(int(t["historyId"]) + 1)

    # googleapiclient shape: service.users().threads().list(...).execute()
    def users(self):
        return self

    def threads(self):
        return self

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
        return _Call(res)

    def get(self, userId, id, format):
        self.downloads.append(id)
        return _Call(self.data[id])
