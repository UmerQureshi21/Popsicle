"""The Docker setup for self-hosting: the same rules as Railway's (test_deploy_files.py), plus the
ones that keep a self-hosted copy safe."""

import json
import re

from app.config import BACKEND_DIR

ROOT = BACKEND_DIR.parent


def lines(path) -> list[str]:
    """A file's lines, without blank lines and comments."""
    return [line.strip() for line in path.read_text().splitlines() if line.strip() and not line.lstrip().startswith("#")]


def instructions(dockerfile) -> list[str]:
    """A Dockerfile's instructions, one per item, with continued lines joined and comments dropped."""
    text = dockerfile.read_text().replace("\\\n", " ")
    return [line.strip() for line in text.splitlines() if line.strip() and not line.lstrip().startswith("#")]


def only(items: list[str], prefix: str) -> list[str]:
    return [i for i in items if i.startswith(prefix)]


BACKEND = instructions(BACKEND_DIR / "Dockerfile")
FRONTEND = instructions(ROOT / "frontend" / "Dockerfile")


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
    ignore = lines(BACKEND_DIR / ".dockerignore")
    assert ignore[0] == "*"
    assert only(ignore, "!") == ["!requirements.txt", "!app/"]
    assert only(BACKEND, "COPY ") == ["COPY requirements.txt .", "COPY app ./app"]


def test_frontend_node_matches_ci():
    [node] = re.findall(r"node-version: (\d+)", (ROOT / ".github" / "workflows" / "test.yml").read_text())
    assert {i.split()[1] for i in only(FRONTEND, "FROM ")} == {f"node:{node}-slim"}


def test_frontend_forwards_api_to_the_backend_service():
    # Next.js fixes the /api forwarding at build time, so the compose network's address is built in.
    assert "ARG BACKEND_ORIGIN=http://backend:8000" in FRONTEND
    assert any("NEXT_OUTPUT=standalone" in i for i in only(FRONTEND, "ENV "))
    assert only(FRONTEND, "CMD ") == ['CMD ["node", "server.js"]']


def test_frontend_image_holds_no_secrets():
    # PROXY_SECRET is read when the server runs (src/proxy.ts). Built into the image, anyone with a
    # copy of the image could read it.
    assert not [i for i in FRONTEND if "PROXY_SECRET" in i]
    ignore = lines(ROOT / "frontend" / ".dockerignore")
    assert ignore[0] == "*"
    assert not [line for line in only(ignore, "!") if ".env" in line]
