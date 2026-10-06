"""Columns added after a table first existed. `create_all` creates missing tables but never
changes existing ones, so missing columns are added here at startup. Existing data is never
touched, and a column that's already there is left alone (no table lock taken).
"""

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine

# (table, column, SQL type and default)
COLUMNS = [
    ("campaigns", "scheduled_for", "TIMESTAMPTZ"),  # scheduled sending
]


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
    return added
