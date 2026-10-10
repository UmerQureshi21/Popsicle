"""The Docker setup for self-hosting: the same rules as Railway's (test_deploy_files.py), plus the
ones that keep a self-hosted copy safe."""

import json

from app.config import BACKEND_DIR

ROOT = BACKEND_DIR.parent


def instructions(dockerfile) -> list[str]:
    """A Dockerfile's instructions, one per item, with continued lines joined and comments dropped."""
    text = dockerfile.read_text().replace("\\\n", " ")
    return [line.strip() for line in text.splitlines() if line.strip() and not line.lstrip().startswith("#")]


def only(items: list[str], prefix: str) -> list[str]:
    return [i for i in items if i.startswith(prefix)]


BACKEND = instructions(BACKEND_DIR / "Dockerfile")


def test_backend_python_matches_ci():
    assert only(BACKEND, "FROM ") == [f"FROM python:{(BACKEND_DIR / '.python-version').read_text().strip()}-slim"]


def test_backend_runs_one_server_process():
    # Sending and the scheduled-batch sweeper run in background threads of one process.
    [cmd] = only(BACKEND, "CMD ")
    args = json.loads(cmd.removeprefix("CMD "))
    assert args[:2] == ["uvicorn", "app.main:app"]
    assert "--workers" not in args and "--reload" not in args
    assert args[args.index("--host") + 1] == "0.0.0.0"  # so the website's container can reach it


def test_backend_health_check_is_the_open_endpoint():
    [check] = only(BACKEND, "HEALTHCHECK ")
    assert "http://127.0.0.1:8000/api/health" in check


def test_backend_secrets_stay_out_of_the_image():
    # .env, credentials.json and .owner-password sit right next to the code on a developer's
    # machine. Only requirements.txt and app/ are sent to Docker, and only those are copied in.
    ignore = [line for line in (BACKEND_DIR / ".dockerignore").read_text().splitlines() if line and not line.startswith("#")]
    assert ignore[0] == "*"
    assert only(ignore, "!") == ["!requirements.txt", "!app/"]
    assert only(BACKEND, "COPY ") == ["COPY requirements.txt .", "COPY app ./app"]
