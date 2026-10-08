"""Settings that keep a deployed copy safe: login on, secure cookie, encrypted Gmail login."""

import pytest
from cryptography.fernet import Fernet
from pydantic import ValidationError

from app.config import Settings
from app.main import docs_urls

KEY = Fernet.generate_key().decode()


LOCAL_DB = "postgresql+psycopg://localhost:5442/cold_emailer"
HOSTED_DB = "postgresql+psycopg://postgres:pw@postgres.railway.internal:5432/railway"
DEPLOYED = dict(
    backend_url="https://popsicle.vercel.app", frontend_url="https://popsicle.vercel.app", database_url=HOSTED_DB,
    proxy_secret="p" * 40,
)


def make(**values) -> Settings:
    # _env_file=None: ignore backend/.env, so only what the test passes counts.
    values.setdefault("database_url", LOCAL_DB)
    values.setdefault("frontend_url", "http://localhost:3000")
    return Settings(_env_file=None, **values)


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for name in ("AUTH_REQUIRED", "COOKIE_SECURE", "BACKEND_URL", "FRONTEND_URL", "DATABASE_URL", "TOKEN_ENCRYPTION_KEY", "COOKIE_SAMESITE", "PROXY_SECRET", "GOOGLE_CLIENT_SECRETS_JSON"):
        monkeypatch.delenv(name, raising=False)


class TestLocal:
    def test_open_and_plain_http_by_default(self):
        s = make(backend_url="http://localhost:8000")
        assert (s.is_local, s.auth_required, s.cookie_secure) == (True, False, False)
        assert make(backend_url="http://127.0.0.1:8000").is_local

    def test_login_can_still_be_turned_on(self):
        assert make(backend_url="http://localhost:8000", auth_required=True).auth_required is True


class TestDeployed:
    def test_login_and_secure_cookie_by_default(self):
        s = make(**DEPLOYED, token_encryption_key=KEY)
        assert (s.is_local, s.auth_required, s.cookie_secure) == (False, True, True)

    def test_refuses_to_start_with_login_off(self):
        with pytest.raises(ValidationError, match="AUTH_REQUIRED can only be false on localhost"):
            make(**DEPLOYED, token_encryption_key=KEY, auth_required=False)

    def test_refuses_to_start_without_an_encryption_key(self):
        with pytest.raises(ValidationError, match="Set TOKEN_ENCRYPTION_KEY"):
            make(**DEPLOYED)

    @pytest.mark.parametrize("forgotten", ["backend_url", "frontend_url"])
    def test_a_hosted_database_with_a_forgotten_address_refuses_to_start(self, forgotten):
        values = {**DEPLOYED, "token_encryption_key": KEY}
        values.pop(forgotten)  # back to its localhost default
        with pytest.raises(ValidationError, match=f"Set {forgotten.upper()}"):
            make(**values)

    def test_a_hosted_database_alone_means_deployed(self):
        # Even with both addresses left at localhost, a hosted database gets the deployed rules.
        with pytest.raises(ValidationError):
            make(database_url=HOSTED_DB, backend_url="http://localhost:8000", frontend_url="http://localhost:3000")

    @pytest.mark.parametrize(
        "url, local",
        [(LOCAL_DB, True), ("postgresql+psycopg:///cold_emailer", True), ("postgresql+psycopg://127.0.0.1/x", True),
         (HOSTED_DB, False), ("not a url", False)],
    )
    def test_which_databases_count_as_local(self, url, local):
        from app.config import _database_is_local

        assert _database_is_local(url) is local

    def test_refuses_a_malformed_key(self):
        with pytest.raises(ValidationError, match="isn't a valid key"):
            make(backend_url="http://localhost:8000", token_encryption_key="not-a-key")

    def test_cookies_can_never_be_shared_with_other_sites(self):
        with pytest.raises(ValidationError):
            make(backend_url="http://localhost:8000", cookie_samesite="none")
        assert make(backend_url="http://localhost:8000", cookie_samesite="strict").cookie_samesite == "strict"


class TestHostedDatabaseAddress:
    @pytest.mark.parametrize("prefix", ["postgres://", "postgresql://", "postgresql+psycopg://"])
    def test_railway_style_addresses_use_psycopg(self, prefix):
        s = make(**{**DEPLOYED, "database_url": prefix + "u:pw@db.railway.internal:5432/railway"}, token_encryption_key=KEY)
        assert s.database_url == "postgresql+psycopg://u:pw@db.railway.internal:5432/railway"

    def test_other_drivers_are_left_alone(self):
        assert make(database_url="sqlite:///x.db").database_url == "sqlite:///x.db"


class TestGoogleClientJson:
    WEB = '{"web": {"client_id": "id", "client_secret": "s"}}'

    def test_unset_by_default(self):
        assert make().google_client_secrets_json is None
        assert make(google_client_secrets_json="").google_client_secrets_json is None

    def test_accepts_a_web_client(self):
        assert make(google_client_secrets_json=self.WEB).google_client_secrets_json == self.WEB

    @pytest.mark.parametrize(
        "value, message",
        [("{not json", "isn't valid JSON"), ('{"installed": {}}', "Web application"), ("[1]", "Web application")],
    )
    def test_refuses_anything_else(self, value, message):
        with pytest.raises(ValidationError, match=message):
            make(google_client_secrets_json=value)


def test_api_docs_only_locally():
    assert docs_urls(True)["docs_url"] == "/docs"
    assert docs_urls(False) == {"docs_url": None, "redoc_url": None, "openapi_url": None}


def test_the_test_app_runs_as_local(client):
    assert client.get("/openapi.json").status_code == 200


class TestProxySecret:
    def test_required_when_deployed(self):
        without = {k: v for k, v in DEPLOYED.items() if k != "proxy_secret"}
        with pytest.raises(ValidationError, match="Set PROXY_SECRET"):
            make(**without, token_encryption_key=KEY)
        with pytest.raises(ValidationError, match="Set PROXY_SECRET"):
            make(**without, token_encryption_key=KEY, proxy_secret="short")
        assert make(**without, token_encryption_key=KEY, proxy_secret="x" * 32).proxy_secret


class TestOnlyThroughTheFrontend:
    """Deployed, the API refuses calls that didn't come through the frontend's forwarding."""

    @pytest.fixture
    def deployed(self, settings, monkeypatch):
        from app.config import Settings

        monkeypatch.setattr(Settings, "is_local", property(lambda self: False))
        settings(proxy_secret="s" * 40)

    def test_direct_calls_are_refused(self, client, deployed):
        r = client.get("/api/companies")
        assert (r.status_code, r.json()) == (403, {"detail": "Use Popsicle through its website."})
        assert client.get("/api/companies", headers={"x-popsicle-proxy": "guess"}).status_code == 403

    def test_forwarded_calls_get_through(self, client, deployed):
        assert client.get("/api/auth/me", headers={"x-popsicle-proxy": "s" * 40}).status_code == 200

    def test_the_health_check_is_always_open(self, client, deployed):
        assert client.get("/api/health").status_code == 200

    def test_locally_nothing_is_needed(self, client):
        assert client.get("/api/auth/me").status_code == 200
