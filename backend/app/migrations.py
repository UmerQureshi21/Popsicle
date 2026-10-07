"""Columns added after a table first existed. `create_all` creates missing tables but never
changes existing ones, so missing columns are added here at startup. Existing data is never
touched, and a column that's already there is left alone (no table lock taken).
"""

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

# (table, column, SQL type and default)
COLUMNS = [
    ("campaigns", "scheduled_for", "TIMESTAMPTZ"),  # scheduled sending
    ("companies", "status", "VARCHAR(20) NOT NULL DEFAULT 'not_started'"),  # target company list
    ("gmail_accounts", "scopes", "TEXT"),  # which Google permissions were granted
    ("gmail_accounts", "synced_at", "TIMESTAMPTZ"),  # last conversation sync
    ("campaigns", "worker_id", "VARCHAR(64)"),  # which server process is sending it
    ("campaigns", "lease_until", "TIMESTAMPTZ"),  # ...and until when
    ("emails", "attempted_at", "TIMESTAMPTZ"),  # handed to Gmail, not yet confirmed
    ("gmail_accounts", "sync_started_at", "TIMESTAMPTZ"),  # a conversation sync in progress
    ("gmail_accounts", "sync_result", "JSONB"),  # how the last one went
]

# Run once, right after a column is added, to give existing rows a sensible value.
BACKFILL = {
    # Companies already emailed before statuses existed start as "emailed".
    "companies.status": """
        UPDATE companies SET status = 'emailed'
        WHERE id IN (
            SELECT ct.company_id FROM contacts ct JOIN emails e ON e.contact_id = ct.id
            WHERE e.status = 'sent' AND ct.company_id IS NOT NULL
        )
    """,
}


def run(engine: Engine) -> list[str]:
    """Add any missing columns; returns the ones added, as "table.column"."""
    inspector = inspect(engine)
    existing = {t: {c["name"] for c in inspector.get_columns(t)} for t in {t for t, _, _ in COLUMNS}}
    added = []
    with engine.begin() as conn:
        for table, column, sql_type in COLUMNS:
            if column not in existing[table]:
                conn.execute(text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {column} {sql_type}"))
                added.append(f"{table}.{column}")
                if f"{table}.{column}" in BACKFILL:
                    conn.execute(text(BACKFILL[f"{table}.{column}"]))
    return added
