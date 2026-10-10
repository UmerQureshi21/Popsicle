"""The Docker setup for self-hosting: the same rules as Railway's (test_deploy_files.py), plus the
ones that keep a self-hosted copy safe."""

import json
import re

import yaml

from app.config import BACKEND_DIR

ROOT = BACKEND_DIR.parent
SERVICES = yaml.safe_load((ROOT / "compose.yaml").read_text())["services"]


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


def test_only_the_website_and_caddy_can_be_reached():
    # The API and the database stay on the compose network. The website is published on this
    # machine only, for your own reverse proxy, and the optional Caddy is the one public door.
    assert "ports" not in SERVICES["db"]
    assert "ports" not in SERVICES["backend"]
    assert [p.startswith("127.0.0.1:") for p in SERVICES["frontend"]["ports"]] == [True]
    assert SERVICES["caddy"]["profiles"] == ["caddy"]


def test_one_always_on_backend():
    # The same rule as Railway's: sending runs in background threads of one process.
    assert not {"deploy", "scale"} & SERVICES["backend"].keys()
    assert {s["restart"] for s in SERVICES.values()} == {"unless-stopped"}


def test_one_public_address_for_everything():
    env = SERVICES["backend"]["environment"]
    assert env["FRONTEND_URL"].startswith("${POPSICLE_URL:?")  # compose stops if it's missing
    assert env["BACKEND_URL"] == "${POPSICLE_URL}"  # Google returns to the site, which forwards /api
    assert SERVICES["caddy"]["environment"]["POPSICLE_URL"] == "${POPSICLE_URL}"
    assert lines(ROOT / "Caddyfile")[0] == "{$POPSICLE_URL} {"
    assert SERVICES["frontend"]["build"]["args"] == {"BACKEND_ORIGIN": "http://backend:8000"}


def test_website_and_api_share_the_proxy_secret():
    assert SERVICES["backend"]["environment"]["PROXY_SECRET"].startswith("${PROXY_SECRET:?")
    assert SERVICES["frontend"]["environment"]["PROXY_SECRET"] == "${PROXY_SECRET}"


def test_caddy_passes_on_the_real_visitor_address():
    # Wrong passwords are limited per visitor by X-Real-IP (src/proxy.ts), and Caddy passes on
    # whatever a visitor sent in that header unless it's set from the connection here.
    assert "header_up X-Real-IP {remote_host}" in lines(ROOT / "Caddyfile")


def test_env_example_lists_every_setting():
    used = set(re.findall(r"\$\{(\w+)", (ROOT / "compose.yaml").read_text()))
    listed = set(re.findall(r"^(?:# )?(\w+)=", (ROOT / ".env.example").read_text(), flags=re.MULTILINE))
    assert listed == used | {"COMPOSE_PROFILES"}  # read by compose itself: turns on the bundled Caddy
    assert ".env" in lines(ROOT / ".gitignore")  # the filled-in copy is never committed
