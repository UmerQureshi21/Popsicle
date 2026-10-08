"""Railway's settings for the backend (backend/railway.json)."""

import json

from app.config import BACKEND_DIR

RAILWAY = json.loads((BACKEND_DIR / "railway.json").read_text())["deploy"]


def test_starts_the_app_on_railways_port():
    assert RAILWAY["startCommand"].startswith("uvicorn app.main:app ")
    assert "--port $PORT" in RAILWAY["startCommand"]
    assert "--host 0.0.0.0" in RAILWAY["startCommand"]


def test_one_always_on_server():
    # Sending and the scheduled-batch sweeper run in background threads of one process.
    assert RAILWAY["numReplicas"] == 1
    assert "--workers" not in RAILWAY["startCommand"]
    assert RAILWAY["sleepApplication"] is False


def test_health_check_is_the_open_endpoint():
    assert RAILWAY["healthcheckPath"] == "/api/health"


def test_python_matches_ci():
    assert (BACKEND_DIR / ".python-version").read_text().strip() == "3.14"
