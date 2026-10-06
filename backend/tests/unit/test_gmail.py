"""Gmail OAuth and sending, with Google's Flow, Credentials and API client swapped for fakes."""

import base64
import email
import json
from types import SimpleNamespace

import httplib2
import pytest
from googleapiclient.errors import HttpError
from sqlalchemy import select

from app import gmail
from app.models import GmailAccount
from tests import factories as f


def http_error(status: int, message: str) -> HttpError:
    return HttpError(httplib2.Response({"status": status}), json.dumps({"error": {"message": message}}).encode())


class FakeFlow:
    def __init__(self, token: dict):
        self.token = token
        self.credentials = SimpleNamespace(to_json=lambda: '{"token": "abc"}')
        self.fetched_with = None

    def fetch_token(self, authorization_response):
        self.fetched_with = authorization_response
        return self.token


@pytest.fixture
def userinfo(monkeypatch):
    """Fake googleapiclient build(): the oauth2 userinfo call returns this email."""
    built = []

    def build(name, version, credentials=None, **kw):
        built.append((name, version, kw))
        execute = lambda: {"email": "Me@Gmail.com"}  # noqa: E731
        return SimpleNamespace(userinfo=lambda: SimpleNamespace(get=lambda: SimpleNamespace(execute=execute)))

    monkeypatch.setattr(gmail, "build", build)
    return built


class TestIsAuthError:
    @pytest.mark.parametrize(
        "error, expected",
        [
            (http_error(401, "Invalid credentials"), True),
            (http_error(403, "Request had insufficient authentication scopes."), True),
            (http_error(403, "Missing scope"), True),
            (http_error(403, "Rate limit exceeded"), False),
            (http_error(400, "Invalid to header"), False),
            (RuntimeError("401"), False),
        ],
    )
    def test_matrix(self, error, expected):
        assert gmail.is_auth_error(error) is expected


def test_credentials_file_present(settings, tmp_path):
    assert not gmail.credentials_file_present()
    secrets = tmp_path / "credentials.json"
    secrets.write_text("{}")
    settings(google_client_secrets=secrets)
    assert gmail.credentials_file_present()


def test_start_auth_remembers_the_flow_by_state(monkeypatch):
    seen = {}

    class Flow:
        @classmethod
        def from_client_secrets_file(cls, path, scopes, redirect_uri):
            seen.update(path=path, scopes=scopes, redirect_uri=redirect_uri)
            return cls()

        def authorization_url(self, **kw):
            seen["kw"] = kw
            return "https://accounts.google.com/o/oauth2/auth?x", "state-1"

    monkeypatch.setattr(gmail, "Flow", Flow)
    assert gmail.start_auth() == "https://accounts.google.com/o/oauth2/auth?x"
    assert seen["redirect_uri"] == "http://backend.test/api/gmail/callback"
    assert gmail.SEND_SCOPE in seen["scopes"]
    assert seen["kw"] == {"access_type": "offline", "prompt": "consent"}
    assert isinstance(gmail._pending_flows["state-1"], Flow)
    assert {gmail.READ_SCOPE, gmail.CALENDAR_SCOPE} <= set(seen["scopes"])
    assert gmail.pop_return_path("state-1") == "/compose"


def test_start_auth_remembers_where_to_return(monkeypatch):
    class Flow:
        @classmethod
        def from_client_secrets_file(cls, path, scopes, redirect_uri):
            return cls()

        def authorization_url(self, **kw):
            return "https://accounts.google.com/x", "state-2"

    monkeypatch.setattr(gmail, "Flow", Flow)
    gmail.start_auth("/conversations")
    assert gmail.pop_return_path("state-2") == "/conversations"
    assert gmail.pop_return_path("state-2") == "/compose"  # used once


@pytest.mark.parametrize(
    "path, expected",
    [
        ("/conversations", "/conversations"),
        ("/conversations?contact=3", "/conversations?contact=3"),
        ("https://evil.example", "/compose"),
        ("//evil.example", "/compose"),
        ("/\\evil.example", "/compose"),
        ("", "/compose"),
        (None, "/compose"),
    ],
)
def test_safe_return_path(path, expected):
    assert gmail.safe_return_path(path) == expected


class TestGrantedScopes:
    def test_older_accounts_could_only_send(self):
        acct = GmailAccount(email="me@gmail.com", token_json="{}")
        assert gmail.granted_scopes(acct) == [*gmail.BASE_SCOPES, gmail.SEND_SCOPE]
        assert gmail.can(acct, gmail.SEND_SCOPE)
        assert not gmail.can(acct, gmail.READ_SCOPE)

    def test_recorded_scopes(self):
        acct = GmailAccount(email="me@gmail.com", token_json="{}", scopes=f"openid {gmail.SEND_SCOPE} {gmail.READ_SCOPE}")
        assert gmail.can(acct, gmail.READ_SCOPE)
        assert not gmail.can(acct, gmail.CALENDAR_SCOPE)

    def test_no_account(self):
        assert not gmail.can(None, gmail.SEND_SCOPE)


class TestFinishAuth:
    def test_unknown_state(self, db):
        with pytest.raises(ValueError, match="Unknown or expired"):
            gmail.finish_auth(db, "nope", "http://cb")

    @pytest.mark.parametrize("scope", [f"openid {gmail.SEND_SCOPE}", ["openid", gmail.SEND_SCOPE]])
    def test_saves_the_account_replacing_any_previous_one(self, db, userinfo, scope):
        db.add(GmailAccount(email="old@gmail.com", token_json="{}"))
        db.commit()
        flow = FakeFlow({"scope": scope})
        gmail._pending_flows["s"] = flow

        assert gmail.finish_auth(db, "s", "http://cb?code=1") == "me@gmail.com"
        assert flow.fetched_with == "http://cb?code=1"
        assert [(a.email, a.token_json, a.scopes) for a in db.scalars(select(GmailAccount))] == [
            ("me@gmail.com", '{"token": "abc"}', f"openid {gmail.SEND_SCOPE}")
        ]
        assert "s" not in gmail._pending_flows

    @pytest.mark.parametrize("token", [{"scope": "openid email"}, {}])
    def test_send_permission_unticked(self, db, userinfo, token):
        gmail._pending_flows["s"] = FakeFlow(token)
        with pytest.raises(gmail.MissingSendPermission):
            gmail.finish_auth(db, "s", "http://cb")
        assert db.scalars(select(GmailAccount)).all() == []


class FakeCredentials:
    def __init__(self, valid=True, refresh_token="r", refresh_error=None):
        self.valid, self.refresh_token, self.refresh_error = valid, refresh_token, refresh_error
        self.refreshed = False

    def refresh(self, request):
        if self.refresh_error:
            raise self.refresh_error
        self.refreshed, self.valid = True, True

    def to_json(self):
        return '{"token": "fresh"}'


class TestLoadCredentials:
    def use(self, monkeypatch, creds):
        monkeypatch.setattr(gmail.Credentials, "from_authorized_user_info", staticmethod(lambda info, scopes: creds))

    def test_not_connected(self, db):
        assert gmail.current_account(db) is None
        with pytest.raises(gmail.GmailNotConnected, match="not connected"):
            gmail.load_credentials(db)

    def test_valid_credentials_are_returned_as_they_are(self, db, monkeypatch):
        db.add(GmailAccount(email="me@gmail.com", token_json='{"token": "t"}'))
        db.commit()
        creds = FakeCredentials()
        self.use(monkeypatch, creds)
        assert gmail.load_credentials(db) is creds
        assert not creds.refreshed

    def test_expired_credentials_are_refreshed_and_saved(self, db, monkeypatch):
        db.add(GmailAccount(email="me@gmail.com", token_json='{"token": "old"}'))
        db.commit()
        creds = FakeCredentials(valid=False)
        self.use(monkeypatch, creds)
        assert gmail.load_credentials(db) is creds
        assert creds.refreshed
        assert gmail.current_account(db).token_json == '{"token": "fresh"}'

    def test_expired_without_refresh_token(self, db, monkeypatch):
        db.add(GmailAccount(email="me@gmail.com", token_json="{}"))
        db.commit()
        self.use(monkeypatch, FakeCredentials(valid=False, refresh_token=None))
        with pytest.raises(gmail.GmailNotConnected, match="expired"):
            gmail.load_credentials(db)

    def test_refresh_fails(self, db, monkeypatch):
        db.add(GmailAccount(email="me@gmail.com", token_json="{}"))
        db.commit()
        self.use(monkeypatch, FakeCredentials(valid=False, refresh_error=RuntimeError("revoked")))
        with pytest.raises(gmail.GmailNotConnected, match=r"expired \(revoked\)"):
            gmail.load_credentials(db)


def test_gmail_service(monkeypatch):
    monkeypatch.setattr(gmail, "build", lambda *a, **kw: (a, kw))
    assert gmail.gmail_service("creds") == (("gmail", "v1"), {"credentials": "creds", "cache_discovery": False})


def test_send_builds_a_mime_message_with_attachments(db):
    sent = {}

    class Service:
        def users(self):
            return self

        def messages(self):
            return self

        def send(self, userId, body):
            sent.update(userId=userId, body=body)
            return self

        def execute(self):
            return {"id": "m1", "threadId": "t1"}

    pdf = f.attachment(db)
    blob = f.attachment(db, filename="data.bin", data=b"\x00\x01", content_type="")
    plain = f.attachment(db, filename="notes", data=b"hi", content_type="text")

    assert gmail.send(Service(), "jane@stripe.com", "Hello Jane", "Body text", [pdf, blob, plain]) == {"id": "m1", "threadId": "t1"}
    assert sent["userId"] == "me"
    msg = email.message_from_bytes(base64.urlsafe_b64decode(sent["body"]["raw"]))
    assert msg["To"] == "jane@stripe.com"
    assert msg["Subject"] == "Hello Jane"
    parts = list(msg.walk())
    assert parts[1].get_payload(decode=True).decode().strip() == "Body text"
    files = {p.get_filename(): (p.get_content_type(), p.get_payload(decode=True)) for p in parts if p.get_filename()}
    assert files == {
        "resume.pdf": ("application/pdf", b"%PDF-1.4"),
        "data.bin": ("application/octet-stream", b"\x00\x01"),
        "notes": ("text/octet-stream", b"hi"),
    }


def test_send_as_a_reply_in_a_thread():
    sent = {}

    class Service:
        def users(self):
            return self

        def messages(self):
            return self

        def send(self, userId, body):
            sent.update(body=body)
            return self

        def execute(self):
            return {"id": "m2", "threadId": "t1"}

    gmail.send(Service(), "douglas@harvey.ai", "Re: Coffee", "Here's the link", [], thread_id="t1", in_reply_to="<m1@mail.gmail.com>")
    assert sent["body"]["threadId"] == "t1"
    msg = email.message_from_bytes(base64.urlsafe_b64decode(sent["body"]["raw"]))
    assert (msg["In-Reply-To"], msg["References"]) == ("<m1@mail.gmail.com>", "<m1@mail.gmail.com>")

    gmail.send(Service(), "douglas@harvey.ai", "Coffee", "Hi", [])
    assert "threadId" not in sent["body"]
    assert email.message_from_bytes(base64.urlsafe_b64decode(sent["body"]["raw"]))["In-Reply-To"] is None
