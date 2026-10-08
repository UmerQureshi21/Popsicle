"""Gmail OAuth and sending, with Google's Flow, Credentials and API client swapped for fakes."""

import base64
import email
import json
import socket
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import httplib2
import pytest
from google.auth.exceptions import RefreshError, TransportError
from googleapiclient.errors import HttpError
from sqlalchemy import select

from app import gmail
from app.models import GmailAccount
from tests import factories as f


def http_error(status: int, message: str) -> HttpError:
    return HttpError(httplib2.Response({"status": status}), json.dumps({"error": {"message": message}}).encode())


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
            (RefreshError("invalid_grant: Token has been expired or revoked."), True),
        ],
    )
    def test_matrix(self, error, expected):
        assert gmail.is_auth_error(error) is expected


class TestIsNetworkError:
    """Only errors where the request certainly never reached Google count: those are safe to retry."""

    @pytest.mark.parametrize(
        "error, expected",
        [
            (gmail.GmailUnreachable(gmail.UNREACHABLE), True),
            (TransportError("Failed to resolve 'oauth2.googleapis.com'"), True),
            (httplib2.ServerNotFoundError("Unable to find the server at gmail.googleapis.com"), True),
            (socket.gaierror(8, "nodename nor servname provided, or not known"), True),
            (ConnectionRefusedError(), True),
            (TimeoutError(), False),  # may have been sent
            (http_error(500, "Backend Error"), False),
            (RuntimeError("boom"), False),
        ],
    )
    def test_matrix(self, error, expected):
        assert gmail.is_network_error(error) is expected


def test_credentials_file_present(settings, tmp_path):
    assert not gmail.credentials_file_present()
    secrets = tmp_path / "credentials.json"
    secrets.write_text("{}")
    settings(google_client_secrets=secrets)
    assert gmail.credentials_file_present()


def test_client_json_setting_counts_as_set_up(settings, tmp_path):
    settings(google_client_secrets=tmp_path / "missing.json", google_client_secrets_json='{"web": {}}')
    assert gmail.credentials_file_present()


class FakeGoogleFlow:
    """Stands in for google_auth_oauthlib's Flow: records how it was made and what it did."""

    made: list = []

    def __init__(self, token=None, verifier="verifier-123"):
        self.token = token or {"scope": gmail.SEND_SCOPE}
        self.code_verifier = verifier
        self.credentials = SimpleNamespace(to_json=lambda: '{"token": "abc"}')
        self.fetched_with = None

    def authorization_url(self, **kw):
        self.auth_kw = kw
        return "https://accounts.google.com/o/oauth2/auth?x", "state-1"

    def fetch_token(self, authorization_response):
        self.fetched_with = authorization_response
        return self.token


@pytest.fixture
def google_flow(monkeypatch):
    """gmail.Flow.from_client_secrets_file returns `google_flow.next` (a FakeGoogleFlow)."""

    class Factory:
        next = FakeGoogleFlow()
        made: list = []

    factory = Factory()
    factory.made = []

    def from_client_secrets_file(path, scopes, redirect_uri, **kw):
        factory.made.append(dict(path=path, scopes=scopes, redirect_uri=redirect_uri, **kw))
        return factory.next

    def from_client_config(config, scopes, redirect_uri, **kw):
        factory.made.append(dict(config=config, scopes=scopes, redirect_uri=redirect_uri, **kw))
        return factory.next

    monkeypatch.setattr(gmail.Flow, "from_client_secrets_file", staticmethod(from_client_secrets_file))
    monkeypatch.setattr(gmail.Flow, "from_client_config", staticmethod(from_client_config))
    return factory


class TestStartAuth:
    def test_saves_the_attempt_in_the_database(self, db, google_flow):
        from app.models import OAuthState

        assert gmail.start_auth(db) == "https://accounts.google.com/o/oauth2/auth?x"
        (made,) = google_flow.made
        assert made["redirect_uri"] == "http://localhost:8000/api/gmail/callback"
        assert {gmail.SEND_SCOPE, gmail.READ_SCOPE, gmail.CALENDAR_SCOPE} <= set(made["scopes"])
        assert google_flow.next.auth_kw == {"access_type": "offline", "prompt": "consent"}
        saved = db.get(OAuthState, "state-1")
        assert (saved.code_verifier, saved.return_to) == ("verifier-123", "/compose")
        assert gmail.return_path(db, "state-1") == "/compose"

    def test_uses_the_client_json_setting_when_deployed(self, db, google_flow, settings):
        settings(google_client_secrets_json='{"web": {"client_id": "id"}}')
        gmail.start_auth(db)
        (made,) = google_flow.made
        assert made["config"] == {"web": {"client_id": "id"}}
        assert "path" not in made

    def test_remembers_where_to_return_but_only_inside_the_app(self, db, google_flow):
        gmail.start_auth(db, "/conversations")
        assert gmail.return_path(db, "state-1") == "/conversations"
        gmail.forget_state(db, "state-1")
        gmail.start_auth(db, "https://evil.example")
        assert gmail.return_path(db, "state-1") == "/compose"

    def test_unknown_or_missing_state_returns_to_compose(self, db):
        assert gmail.return_path(db, "nope") == "/compose"
        assert gmail.return_path(db, "") == "/compose"

    def test_abandoned_attempts_expire_and_are_cleared(self, db, google_flow):
        from app.models import OAuthState

        old = datetime.now(timezone.utc) - gmail.STATE_TTL - timedelta(minutes=1)
        db.add(OAuthState(state="old", code_verifier=None, return_to="/inbox", created_at=old))
        db.commit()
        assert gmail.return_path(db, "old") == "/compose"  # expired
        gmail.start_auth(db)
        db.expire_all()
        assert db.get(OAuthState, "old") is None


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
    def start(self, db, google_flow, token=None):
        """Begin a connection (saved in the database), and make the flow Google hands back."""
        gmail.start_auth(db, "/conversations")
        google_flow.next = FakeGoogleFlow(token)
        return google_flow.next

    def test_unknown_state(self, db):
        with pytest.raises(ValueError, match="Unknown or expired"):
            gmail.finish_auth(db, "nope", "http://cb")

    def test_an_expired_attempt_cant_be_finished(self, db, google_flow):
        from app.models import OAuthState

        self.start(db, google_flow)
        db.get(OAuthState, "state-1").created_at = datetime.now(timezone.utc) - gmail.STATE_TTL - timedelta(seconds=1)
        db.commit()
        with pytest.raises(ValueError, match="Unknown or expired"):
            gmail.finish_auth(db, "state-1", "http://cb")
        assert db.get(OAuthState, "state-1") is None

    @pytest.mark.parametrize("scope", [f"openid {gmail.SEND_SCOPE}", ["openid", gmail.SEND_SCOPE]])
    def test_saves_the_account_replacing_any_previous_one(self, db, userinfo, google_flow, scope):
        from app.models import OAuthState

        db.add(GmailAccount(email="old@gmail.com", token_json="{}"))
        db.commit()
        flow = self.start(db, google_flow, {"scope": scope})

        # Works in a process that never saw the start: everything it needs is in the database.
        assert gmail.finish_auth(db, "state-1", "http://cb?code=1") == "me@gmail.com"
        assert google_flow.made[-1]["state"] == "state-1"
        assert google_flow.made[-1]["code_verifier"] == "verifier-123"
        assert flow.fetched_with == "http://cb?code=1"
        assert [(a.email, a.token_json, a.scopes) for a in db.scalars(select(GmailAccount))] == [
            ("me@gmail.com", '{"token": "abc"}', f"openid {gmail.SEND_SCOPE}")
        ]
        assert db.get(OAuthState, "state-1") is None  # can't be used twice
        with pytest.raises(ValueError):
            gmail.finish_auth(db, "state-1", "http://cb?code=1")

    @pytest.mark.parametrize("token", [{"scope": "openid email"}, {"scope": None}])
    def test_send_permission_unticked(self, db, userinfo, google_flow, token):
        self.start(db, google_flow, token)
        with pytest.raises(gmail.MissingSendPermission):
            gmail.finish_auth(db, "state-1", "http://cb")
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

    def test_refresh_refused_means_expired(self, db, monkeypatch):
        db.add(GmailAccount(email="me@gmail.com", token_json="{}"))
        db.commit()
        self.use(monkeypatch, FakeCredentials(valid=False, refresh_error=RefreshError("invalid_grant")))
        with pytest.raises(gmail.GmailNotConnected, match=r"^Gmail login expired. Reconnect Gmail.$"):
            gmail.load_credentials(db)

    def test_no_internet_is_not_an_expired_login(self, db, monkeypatch):
        """The error that used to say "Gmail login expired (... NameResolutionError ...)"."""
        db.add(GmailAccount(email="me@gmail.com", token_json='{"token": "old"}'))
        db.commit()
        offline = TransportError("HTTPSConnectionPool(host='oauth2.googleapis.com', port=443): Failed to resolve")
        self.use(monkeypatch, FakeCredentials(valid=False, refresh_error=offline))
        with pytest.raises(gmail.GmailUnreachable, match="internet connection"):
            gmail.load_credentials(db)
        assert gmail.current_account(db).token_json == '{"token": "old"}'  # the login is kept as it was

    def test_other_refresh_errors_are_not_hidden(self, db, monkeypatch):
        db.add(GmailAccount(email="me@gmail.com", token_json="{}"))
        db.commit()
        self.use(monkeypatch, FakeCredentials(valid=False, refresh_error=RuntimeError("boom")))
        with pytest.raises(RuntimeError, match="boom"):
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
