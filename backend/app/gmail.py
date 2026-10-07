"""Gmail OAuth (connect once from the UI) and sending."""

import base64
import json
import os
from email.message import EmailMessage

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import secrets_box
from .config import settings
from .models import Attachment, GmailAccount

# Google may return scopes in a different order than asked.
os.environ.setdefault("OAUTHLIB_RELAX_TOKEN_SCOPE", "1")
if settings.is_local:
    # Only for plain http://localhost; deployed, Google sign-in must use https.
    os.environ.setdefault("OAUTHLIB_INSECURE_TRANSPORT", "1")

SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send"
READ_SCOPE = "https://www.googleapis.com/auth/gmail.readonly"  # replies, for Conversations
CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events"  # Google Meet invites
BASE_SCOPES = ["openid", "https://www.googleapis.com/auth/userinfo.email"]
SCOPES = [*BASE_SCOPES, SEND_SCOPE, READ_SCOPE, CALENDAR_SCOPE]
REDIRECT_PATH = "/api/gmail/callback"

# OAuth flows waiting for Google's redirect, keyed by state (holds the PKCE verifier),
# and the page to return to afterwards.
_pending_flows: dict[str, Flow] = {}
_return_to: dict[str, str] = {}


class GmailNotConnected(Exception):
    pass


class MissingSendPermission(Exception):
    """Google's consent screen lets people untick "Send email on your behalf"."""


class MissingPermission(Exception):
    """An optional permission (reading mail, calendar) wasn't granted when connecting."""


def granted_scopes(acct: GmailAccount) -> list[str]:
    """What the account was allowed to do. Accounts connected before this was recorded could only send."""
    return acct.scopes.split() if acct.scopes else [*BASE_SCOPES, SEND_SCOPE]


def can(acct: GmailAccount | None, scope: str) -> bool:
    return acct is not None and scope in granted_scopes(acct)


def is_auth_error(e: Exception) -> bool:
    """Errors that mean the login itself is unusable, so every send would fail the same way."""
    return isinstance(e, HttpError) and e.resp.status in (401, 403) and (
        e.resp.status == 401 or "insufficient" in str(e).lower() or "scope" in str(e).lower()
    )


def credentials_file_present() -> bool:
    return settings.google_client_secrets.is_file()


def safe_return_path(path: str | None) -> str:
    """Only paths inside the app, so the callback can't be used to redirect anywhere else."""
    return path if path and path.startswith("/") and not path.startswith("//") and "\\" not in path else "/compose"


def pop_return_path(state: str) -> str:
    return _return_to.pop(state, "/compose")


def start_auth(return_to: str = "/compose") -> str:
    flow = Flow.from_client_secrets_file(
        str(settings.google_client_secrets),
        scopes=SCOPES,
        redirect_uri=settings.backend_url + REDIRECT_PATH,
    )
    url, state = flow.authorization_url(access_type="offline", prompt="consent")
    _pending_flows[state] = flow
    _return_to[state] = safe_return_path(return_to)
    return url


def finish_auth(db: Session, state: str, callback_url: str) -> str:
    flow = _pending_flows.pop(state, None)
    if flow is None:
        raise ValueError("Unknown or expired sign-in attempt. Try connecting again.")
    token = flow.fetch_token(authorization_response=callback_url)
    # flow.credentials reports the scopes we asked for; the token response says what was granted.
    granted = token.get("scope") or []
    if isinstance(granted, str):
        granted = granted.split()
    if SEND_SCOPE not in granted:
        raise MissingSendPermission()
    creds = flow.credentials
    email = build("oauth2", "v2", credentials=creds).userinfo().get().execute()["email"].lower()

    # Single-user app: the newly connected account replaces any previous one.
    for acct in db.scalars(select(GmailAccount)):
        db.delete(acct)
    db.flush()
    db.add(GmailAccount(email=email, token_json=secrets_box.seal(creds.to_json()), scopes=" ".join(granted)))
    db.commit()
    return email


def current_account(db: Session) -> GmailAccount | None:
    return db.scalars(select(GmailAccount).order_by(GmailAccount.id.desc())).first()


def load_credentials(db: Session) -> Credentials:
    acct = current_account(db)
    if acct is None:
        raise GmailNotConnected("Gmail is not connected.")
    try:
        info = json.loads(secrets_box.unseal(acct.token_json))
    except secrets_box.CantDecrypt as e:
        raise GmailNotConnected(f"{e} Reconnect Gmail.") from e
    # Only the granted scopes: refreshing with one that wasn't granted fails.
    creds = Credentials.from_authorized_user_info(info, granted_scopes(acct))
    if settings.token_encryption_key and not secrets_box.is_sealed(acct.token_json):
        acct.token_json = secrets_box.seal(acct.token_json)  # saved before encryption was on
        db.commit()
    if not creds.valid:
        if not creds.refresh_token:
            raise GmailNotConnected("Gmail login expired. Reconnect Gmail.")
        try:
            creds.refresh(Request())
        except Exception as e:
            raise GmailNotConnected(f"Gmail login expired ({e}). Reconnect Gmail.") from e
        acct.token_json = secrets_box.seal(creds.to_json())
        db.commit()
    return creds


def gmail_service(creds: Credentials):
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


def send(
    service,
    to: str,
    subject: str,
    body: str,
    attachments: list[Attachment],
    *,
    thread_id: str | None = None,
    in_reply_to: str | None = None,
) -> dict:
    """Send one email. With `thread_id` (and the Message-ID it answers) it's a reply in that
    conversation, for both you and the recipient."""
    msg = EmailMessage()
    msg["To"] = to
    msg["Subject"] = subject
    if in_reply_to:
        msg["In-Reply-To"] = in_reply_to
        msg["References"] = in_reply_to
    msg.set_content(body)
    for a in attachments:
        maintype, _, subtype = (a.content_type or "application/octet-stream").partition("/")
        msg.add_attachment(a.data, maintype=maintype, subtype=subtype or "octet-stream", filename=a.filename)
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
    message = {"raw": raw, **({"threadId": thread_id} if thread_id else {})}
    return service.users().messages().send(userId="me", body=message).execute()
