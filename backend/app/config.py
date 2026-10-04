from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=BACKEND_DIR / ".env", extra="ignore")

    # Cluster lives in ~/Desktop/personal-projects/psqlConnections/cold-emailer-5442
    database_url: str = "postgresql+psycopg://localhost:5442/cold_emailer"
    frontend_url: str = "http://localhost:3000"
    backend_url: str = "http://localhost:8000"
    # OAuth client downloaded from Google Cloud Console ("Web application" type).
    google_client_secrets: Path = BACKEND_DIR / "credentials.json"
    # https://hunter.io/api-keys, used to find people and emails at a company.
    hunter_api_key: str | None = None

    # Accounts are invite-only (created with `python -m app.manage`). Locally anyone gets in;
    # set AUTH_REQUIRED=true when deployed so only those accounts can use the app.
    auth_required: bool = False
    # Session cookie: deployed over https, set COOKIE_SECURE=true. If the frontend and API are on
    # different sites (not just different subdomains), COOKIE_SAMESITE must be "none" (with secure).
    cookie_secure: bool = False
    cookie_samesite: str = "lax"


settings = Settings()
