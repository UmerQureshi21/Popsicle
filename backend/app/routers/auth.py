"""Log in, log out, who am I, and an invite-only sign up."""

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import auth
from ..config import settings
from ..db import get_db
from ..models import User

router = APIRouter(prefix="/api/auth", tags=["auth"])

MIN_PASSWORD_LENGTH = 8
INVITE_ONLY = "Popsicle is invite-only. Ask for access and you'll get an account."


class Credentials(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    email: str
    name: str | None


class Me(BaseModel):
    user: UserOut | None
    auth_required: bool  # false locally: the app is open without logging in


def _out(user: User) -> UserOut:
    return UserOut(email=user.email, name=user.name)


def _find(db: Session, email: str) -> User | None:
    return db.scalars(select(User).where(User.email == email.strip().lower())).first()


@router.get("/me", response_model=Me)
def me(user: User | None = Depends(auth.current_user)):
    return Me(user=_out(user) if user else None, auth_required=settings.auth_required)


@router.post("/login", response_model=UserOut)
def login(body: Credentials, request: Request, response: Response, db: Session = Depends(get_db)):
    email = body.email.strip().lower()
    ip = auth.client_ip(request)
    user = _find(db, email)
    trusted = auth.is_trusted_device(db, request, user)
    auth.check_not_locked(email, ip, trusted)
    # Checked even for emails that aren't allowed, so the answer takes the same time either way.
    password_ok = auth.verify_password(body.password, user.password_hash if user else None)
    if not password_ok or not auth.is_allowed(email):
        auth.record_failure(email, ip, trusted)
        # Same message whether the email or the password is wrong, so emails can't be probed.
        raise HTTPException(401, "That email and password don't match an account.")
    auth.clear_failures(email, ip)
    auth.start_session(db, user, response)
    auth.remember_device(db, request, user, response)
    return _out(user)


@router.post("/signup", response_model=UserOut)
def signup(body: Credentials, request: Request, response: Response, db: Session = Depends(get_db)):
    """Only works for an email on ALLOWED_EMAILS that you've invited (`python -m app.manage invite`)
    and that has no password yet. The website doesn't offer it; this is the server-side lock."""
    email = body.email.strip().lower()
    ip = auth.client_ip(request)
    auth.check_not_locked(email, ip)
    user = _find(db, email)
    if user is None or not auth.is_allowed(email):
        auth.record_failure(email, ip)
        raise HTTPException(403, INVITE_ONLY)
    if user.password_hash:
        raise HTTPException(409, "This email already has an account. Log in instead.")
    if len(body.password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(422, f"Use at least {MIN_PASSWORD_LENGTH} characters.")
    user.password_hash = auth.hash_password(body.password)
    db.commit()
    auth.start_session(db, user, response)
    auth.remember_device(db, request, user, response)
    return _out(user)


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    auth.end_session(db, request, response)
