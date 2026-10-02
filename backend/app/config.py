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


settings = Settings()
