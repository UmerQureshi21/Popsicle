"""Settings that keep a deployed copy safe: login on, secure cookie, encrypted Gmail login."""

import pytest
from cryptography.fernet import Fernet
from pydantic import ValidationError

from app.config import Settings
from app.main import docs_urls

KEY = Fernet.generate_key().decode()


def make(**values) -> Settings:
    # _env_file=None: ignore backend/.env, so only what the test passes counts.
    return Settings(_env_file=None, **values)


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for name in ("AUTH_REQUIRED", "COOKIE_SECURE", "BACKEND_URL", "TOKEN_ENCRYPTION_KEY", "COOKIE_SAMESITE"):
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
        s = make(backend_url="https://popsicle.vercel.app", token_encryption_key=KEY)
        assert (s.is_local, s.auth_required, s.cookie_secure) == (False, True, True)

    def test_refuses_to_start_with_login_off(self):
        with pytest.raises(ValidationError, match="AUTH_REQUIRED can only be false on localhost"):
            make(backend_url="https://popsicle.vercel.app", token_encryption_key=KEY, auth_required=False)

    def test_refuses_to_start_without_an_encryption_key(self):
        with pytest.raises(ValidationError, match="Set TOKEN_ENCRYPTION_KEY"):
            make(backend_url="https://popsicle.vercel.app")

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
