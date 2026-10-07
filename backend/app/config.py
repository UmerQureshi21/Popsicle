from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from pydantic import model_validator
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

    @property
    def is_local(self) -> bool:
        return urlparse(self.backend_url).hostname in LOCAL_HOSTS

    @model_validator(mode="after")
    def _safe_defaults(self) -> "Settings":
        if self.auth_required is None:
            self.auth_required = not self.is_local
        if self.cookie_secure is None:
            self.cookie_secure = not self.is_local
        if not self.is_local:
            # Refuse to start a deployed copy that would be open to anyone, or would store the
            # Gmail login unencrypted.
            if not self.auth_required:
                raise ValueError("AUTH_REQUIRED can only be false on localhost.")
            if not self.token_encryption_key:
                raise ValueError("Set TOKEN_ENCRYPTION_KEY when deployed (see app/config.py for how to make one).")
        if self.token_encryption_key:
            from cryptography.fernet import Fernet

            try:
                Fernet(self.token_encryption_key)
            except Exception as e:
                raise ValueError("TOKEN_ENCRYPTION_KEY isn't a valid key (see app/config.py for how to make one).") from e
        return self


settings = Settings()
