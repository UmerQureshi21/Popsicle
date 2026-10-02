#!/usr/bin/env bash
# Start Postgres (if needed), the FastAPI backend and the Next.js frontend. Ctrl-C stops the app servers.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PG_DIR="$HOME/Desktop/personal-projects/psqlConnections/cold-emailer-5442"
PG_PORT=5442

if ! pg_ctl -D "$PG_DIR/pgdata" status >/dev/null 2>&1; then
  echo "Starting Postgres on port $PG_PORT…"
  (cd "$PG_DIR" && pg_ctl -D ./pgdata -o "-p $PG_PORT" -l logfile start)
fi

trap 'kill 0' EXIT

(cd "$ROOT/backend" && .venv/bin/uvicorn app.main:app --port 8000 --reload) &
(cd "$ROOT/frontend" && npm run dev -- --port 3000) &

echo
echo "  App:      http://localhost:3000"
echo "  API docs: http://localhost:8000/docs"
echo
wait
