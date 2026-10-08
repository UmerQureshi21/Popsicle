import json
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from pydantic import field_validator, model_validator
from sqlalchemy import make_url
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
LOCAL_HOSTS = {"localhost", "127.0.0.1"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    # Cluster lives in ~/Desktop/personal-projects/psqlConnections/cold-emailer-5442
    database_url: str = "postgresql+psycopg://localhost:5442/cold_emailer"
    frontend_url: str = "http://localhost:3000"
    # Where Google sends you back after connecting Gmail. Deployed behind the frontend's /api
    # forwarding, this is the frontend's address.
    backend_url: str = "http://localhost:8000"
    # OAuth client downloaded from Google Cloud Console ("Web application" type).
    google_client_secrets: Path = BACKEND_DIR / "credentials.json"
    # The same JSON pasted in as a setting, for hosts without secret files (Railway). Wins over the file.
    google_client_secrets_json: str | None = None
    # https://hunter.io/api-keys, used to find people and emails at a company.
    hunter_api_key: str | None = None

    # Accounts are invite-only (created with `python -m app.manage`). Unset, login is off on
    # localhost and on everywhere else; it can't be turned off anywhere but localhost.
    auth_required: bool | None = None
    # Session cookie only over https. Unset: off on localhost (plain http), on everywhere else.
    cookie_secure: bool | None = None
    # "none" would let other websites use your session, so it isn't allowed. Keep the frontend
    # and API on one site (the frontend forwards /api to the backend).
    cookie_samesite: Literal["lax", "strict"] = "lax"
    # Encrypts the Gmail login stored in the database. Required when deployed. Make one with:
    # python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    token_encryption_key: str | None = None
    # Shared with the frontend, which adds it to every /api call it forwards. Deployed, calls
    # without it (e.g. straight to the backend's own address) are refused. Any long random string.
    proxy_secret: str | None = None

    @property
    def is_local(self) -> bool:
        """Running on your own machine: the app's addresses and the database all are. Anything
        else (say, a hosted database with BACKEND_URL forgotten) gets the deployed rules."""
        return (
            _is_local_url(self.backend_url)
            and _is_local_url(self.frontend_url)
            and _database_is_local(self.database_url)
        )

    @field_validator("database_url")
    @classmethod
    def _psycopg_driver(cls, url: str) -> str:
        """Hosts (Railway, Heroku) hand out postgres:// or postgresql:// addresses, which would
        make SQLAlchemy look for psycopg2. Popsicle uses psycopg 3."""
        for prefix in ("postgres://", "postgresql://"):
            if url.startswith(prefix):
                return "postgresql+psycopg://" + url.removeprefix(prefix)
        return url

    @field_validator("google_client_secrets_json")
    @classmethod
    def _client_config(cls, value: str | None) -> str | None:
        if not value:
            return None
        try:
            config = json.loads(value)
        except json.JSONDecodeError as e:
            raise ValueError("GOOGLE_CLIENT_SECRETS_JSON isn't valid JSON: paste the whole credentials.json.") from e
        if not isinstance(config, dict) or "web" not in config:
            raise ValueError('GOOGLE_CLIENT_SECRETS_JSON must be a "Web application" OAuth client (its JSON starts with "web").')
        return value

    @model_validator(mode="after")
    def _safe_defaults(self) -> "Settings":
        if self.auth_required is None:
            self.auth_required = not self.is_local
        if self.cookie_secure is None:
            self.cookie_secure = not self.is_local
        if not self.is_local:
            # Refuse to start a deployed copy that would be open to anyone, or would store the
            # Gmail login unencrypted, or that still has a localhost address (forgotten setting).
            for name in ("backend_url", "frontend_url"):
                if _is_local_url(getattr(self, name)):
                    raise ValueError(f"Set {name.upper()} to the app's public address when deployed.")
            if not self.auth_required:
                raise ValueError("AUTH_REQUIRED can only be false on localhost.")
            if not self.token_encryption_key:
                raise ValueError("Set TOKEN_ENCRYPTION_KEY when deployed (see app/config.py for how to make one).")
            if not self.proxy_secret or len(self.proxy_secret) < 32:
                raise ValueError("Set PROXY_SECRET (32+ random characters, the same on the frontend) when deployed.")
        if self.token_encryption_key:
            from cryptography.fernet import Fernet

            try:
                Fernet(self.token_encryption_key)
            except Exception as e:
                raise ValueError("TOKEN_ENCRYPTION_KEY isn't a valid key (see app/config.py for how to make one).") from e
        return self


def _is_local_url(url: str) -> bool:
    return urlparse(url).hostname in LOCAL_HOSTS


def _database_is_local(url: str) -> bool:
    try:
        host = make_url(url).host
    except Exception:
        return False
    return host is None or host in LOCAL_HOSTS  # no host: a local socket


settings = Settings()
