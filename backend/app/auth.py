"""Invite-only accounts: password hashing, sessions, and the "must be logged in" check.

Accounts are only ever created from the command line (`python -m app.manage`), never by the
website. When AUTH_REQUIRED is false (local development) every request is let through; when
it's true (deployed), every API call needs a valid session cookie.
"""

import base64
import hashlib
import hmac
import secrets
import time
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .db import get_db
from .models import AuthSession, User

COOKIE_NAME = "popsicle_session"
SESSION_TTL = timedelta(days=30)

# Requests that must work without a session: Google redirects here at the end of Gmail sign-in,
# and that flow is already tied to a session-protected /api/gmail/connect call by its state value.
PUBLIC_PATHS = {"/api/gmail/callback"}


# ---- Passwords ------------------------------------------------------------

# scrypt (stdlib) with per-password salt. Stored as "scrypt$n$r$p$salt$hash" so the cost can be
# raised later without breaking existing hashes.
_N, _R, _P = 2**14, 8, 1


def _b64(b: bytes) -> str:
    return base64.b64encode(b).decode()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=32)
    return f"scrypt${_N}${_R}${_P}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, stored: str | None) -> bool:
    if not stored:
        # Still do the work, so a missing account takes as long to reject as a wrong password.
        hash_password(password)
        return False
    try:
        _, n, r, p, salt, digest = stored.split("$")
        expected = base64.b64decode(digest)
        actual = hashlib.scrypt(
            password.encode(), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p), dklen=len(expected)
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, expected)


# ---- Brute-force protection -------------------------------------------------

# Wrong passwords are limited per visitor (by IP address), so one person guessing can't lock
# you out of your own account; and, more loosely, per account, so guesses spread over many
# addresses still run out. Kept in memory: a restart resets the counts.
MAX_FAILURES = 5  # per visitor
MAX_FAILURES_PER_ACCOUNT = 20
LOCKOUT_SECONDS = 15 * 60
_failures: dict[str, list[float]] = {}


def client_ip(request: Request) -> str:
    """The visitor's address. Behind the frontend's forwarding, the proxy puts it first in
    X-Forwarded-For (someone calling the backend directly can fake that header, which is why
    the per-account limit exists too)."""
    forwarded = request.headers.get("x-forwarded-for", "")
    first = forwarded.split(",")[0].strip()
    return first or (request.client.host if request.client else "unknown")


def _limits(email: str, ip: str) -> list[tuple[str, int]]:
    return [(f"ip:{ip}", MAX_FAILURES), (f"email:{email}", MAX_FAILURES_PER_ACCOUNT)]


def check_not_locked(email: str, ip: str) -> None:
    now = time.monotonic()
    for key, limit in _limits(email, ip):
        recent = [t for t in _failures.get(key, []) if now - t < LOCKOUT_SECONDS]
        _failures[key] = recent
        if len(recent) >= limit:
            raise HTTPException(429, "Too many attempts. Try again in 15 minutes.")


def record_failure(email: str, ip: str) -> None:
    for key, _ in _limits(email, ip):
        _failures.setdefault(key, []).append(time.monotonic())


def clear_failures(email: str, ip: str) -> None:
    for key, _ in _limits(email, ip):
        _failures.pop(key, None)


# ---- Sessions ---------------------------------------------------------------


def _token_hash(token: str) -> str:
    # Only a hash of the cookie value is stored, so a database leak doesn't hand out sessions.
    return hashlib.sha256(token.encode()).hexdigest()


def start_session(db: Session, user: User, response: Response) -> None:
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    db.add(AuthSession(user_id=user.id, token_hash=_token_hash(token), expires_at=now + SESSION_TTL))
    user.last_login_at = now
    db.commit()
    response.set_cookie(
        COOKIE_NAME,
        token,
        max_age=int(SESSION_TTL.total_seconds()),
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        path="/",
    )


def end_session(db: Session, request: Request, response: Response) -> None:
    token = request.cookies.get(COOKIE_NAME)
    if token:
        s = db.scalars(select(AuthSession).where(AuthSession.token_hash == _token_hash(token))).first()
        if s:
            db.delete(s)
            db.commit()
    response.delete_cookie(COOKIE_NAME, path="/")


def current_user(request: Request, db: Session = Depends(get_db)) -> User | None:
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        return None
    s = db.scalars(select(AuthSession).where(AuthSession.token_hash == _token_hash(token))).first()
    if s is None or s.expires_at <= datetime.now(timezone.utc):
        return None
    return db.get(User, s.user_id)


def require_user(request: Request, user: User | None = Depends(current_user)) -> User | None:
    """Router-level guard. Lets everything through locally; requires a session when AUTH_REQUIRED."""
    if not settings.auth_required or request.url.path in PUBLIC_PATHS:
        return user
    if user is None:
        raise HTTPException(401, "Log in to use Popsicle.")
    return user
