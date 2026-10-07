"""Shared fixtures. Tests run against a real Postgres database (the models use JSONB, window
functions and FILTER), which is emptied before every test.

Settings are read when `app` is first imported, so the environment is set up here first.
"""

import os
from pathlib import Path

TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL", "postgresql+psycopg://localhost:5442/cold_emailer_test")
# Every table is truncated between tests, so never point this at a real database.
assert TEST_DATABASE_URL.rsplit("/", 1)[-1].endswith("_test"), "TEST_DATABASE_URL must name a *_test database"

os.environ["DATABASE_URL"] = TEST_DATABASE_URL
os.environ["HUNTER_API_KEY"] = "test-hunter-key"
os.environ["AUTH_REQUIRED"] = "false"
os.environ["COOKIE_SECURE"] = "false"
os.environ["GOOGLE_CLIENT_SECRETS"] = str(Path(__file__).parent / "does-not-exist.json")
os.environ["FRONTEND_URL"] = "http://frontend.test"
os.environ["BACKEND_URL"] = "http://localhost:8000"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import create_engine, make_url, text  # noqa: E402

from app import auth, campaigns, gmail  # noqa: E402
from app.db import SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models import Base  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _database():
    """Create the test database for this run and drop it afterwards."""
    url = make_url(TEST_DATABASE_URL)
    admin = create_engine(url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    drop = text(f'DROP DATABASE IF EXISTS "{url.database}" WITH (FORCE)')
    with admin.connect() as conn:
        conn.execute(drop)
        conn.execute(text(f'CREATE DATABASE "{url.database}"'))
    Base.metadata.create_all(engine)
    yield
    engine.dispose()
    with admin.connect() as conn:
        conn.execute(drop)
    admin.dispose()


@pytest.fixture(autouse=True)
def _clean_state():
    tables = ", ".join(t.name for t in Base.metadata.sorted_tables)
    with engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
    auth._failures.clear()
    gmail._pending_flows.clear()
    gmail._return_to.clear()
    campaigns._running.clear()
    campaigns._cancel_requested.clear()
    campaigns._wake_requested.clear()
    yield


@pytest.fixture
def db():
    with SessionLocal() as session:
        yield session


@pytest.fixture
def started(monkeypatch):
    """Campaign ids passed to campaigns.start(); no sending thread is started."""
    ids: list[int] = []
    monkeypatch.setattr(campaigns, "start", ids.append)
    return ids


@pytest.fixture
def client(started, monkeypatch):
    # Startup would launch the background sweeper; tests call campaigns.sweep() directly instead.
    import app.main as main

    monkeypatch.setattr(main, "start_sweeper", lambda: None)
    with TestClient(app) as c:
        yield c


@pytest.fixture
def settings(monkeypatch):
    """Change a setting for one test: settings(auth_required=True)."""
    from app.config import settings as s

    def change(**values):
        for k, v in values.items():
            monkeypatch.setattr(s, k, v)
        return s

    return change
