"""Adding columns that came after a table first existed, without touching data."""

from sqlalchemy import inspect, text

from app import migrations
from app.db import engine


def columns(table):
    return {c["name"] for c in inspect(engine).get_columns(table)}


def test_adds_a_missing_column_and_keeps_existing_rows(db):
    from tests import factories as f

    c = f.campaign(db)
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE campaigns DROP COLUMN scheduled_for"))
    assert "scheduled_for" not in columns("campaigns")

    assert migrations.run(engine) == ["campaigns.scheduled_for"]
    assert "scheduled_for" in columns("campaigns")
    with engine.connect() as conn:
        assert conn.execute(text("SELECT name FROM campaigns WHERE id = :id"), {"id": c.id}).scalar() == "Test batch"


def test_does_nothing_when_columns_already_exist():
    assert migrations.run(engine) == []
    assert migrations.run(engine) == []
