"""Checks for data that comes from outside (pasted tables, Hunter, Google, email replies)
before it's used somewhere it could do harm: in a link, an email header or a Gmail search."""

import re
from urllib.parse import urlparse

# A real-world email address. Deliberately stricter than the RFC: no commas, quotes, brackets,
# braces or spaces, which could turn one recipient into several in a To: header or change the
# meaning of a Gmail search.
EMAIL = re.compile(
    r"^[A-Za-z0-9._%+'-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$"
)
MAX_URL = 500


def is_email(value: str) -> bool:
    return bool(EMAIL.match(value or ""))


def safe_url(value: str | None) -> str | None:
    """The link if it's a plain http(s) web address, else None. Stops `javascript:` and similar
    links, which would run code in the app when clicked."""
    if not value:
        return None
    value = value.strip()
    if len(value) > MAX_URL or any(c.isspace() or ord(c) < 32 for c in value):
        return None
    if not urlparse(value).scheme and not value.startswith(("/", "\\")):
        value = "https://" + value  # "linkedin.com/in/jane", as people often paste it
    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        return None
    return value


def has_line_break(value: str) -> bool:
    return "\n" in value or "\r" in value


def link_field(value: str | None) -> str | None:
    """For API fields holding a link: empty means none; anything but http(s) is refused."""
    if value is None or not value.strip():
        return None
    url = safe_url(value)
    if url is None:
        raise ValueError("Links must be web addresses starting with https:// or http://")
    return url
