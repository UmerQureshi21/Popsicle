"""Settings that keep a deployed copy safe: login on, secure cookie, encrypted Gmail login."""

import pytest
from cryptography.fernet import Fernet
from pydantic import ValidationError

from app.config import Settings
from app.main import docs_urls

KEY = Fernet.generate_key().decode()


LOCAL_DB = "postgresql+psycopg://localhost:5442/cold_emailer"
HOSTED_DB = "postgresql+psycopg://postgres:pw@postgres.railway.internal:5432/railway"
DEPLOYED = dict(backend_url="https://popsicle.vercel.app", frontend_url="https://popsicle.vercel.app", database_url=HOSTED_DB)


def make(**values) -> Settings:
    # _env_file=None: ignore backend/.env, so only what the test passes counts.
    values.setdefault("database_url", LOCAL_DB)
    values.setdefault("frontend_url", "http://localhost:3000")
    return Settings(_env_file=None, **values)


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for name in ("AUTH_REQUIRED", "COOKIE_SECURE", "BACKEND_URL", "FRONTEND_URL", "DATABASE_URL", "TOKEN_ENCRYPTION_KEY", "COOKIE_SAMESITE"):
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


def test_api_docs_only_locally():
    assert docs_urls(True)["docs_url"] == "/docs"
    assert docs_urls(False) == {"docs_url": None, "redoc_url": None, "openapi_url": None}


def test_the_test_app_runs_as_local(client):
    assert client.get("/openapi.json").status_code == 200
