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


def test_company_status_starts_as_emailed_for_companies_already_emailed(db):
    from datetime import datetime, timezone

    from tests import factories as f

    stripe = f.company(db, name="Stripe")
    acme = f.company(db, name="Acme")
    f.contact(db, email="ann@acme.com", company=acme)  # a contact, but never emailed
    jane = f.contact(db, email="jane@stripe.com", company=stripe)
    f.sent_email(db, "jane@stripe.com", datetime(2026, 1, 1, tzinfo=timezone.utc), contact=jane)
    with engine.begin() as conn:
        conn.execute(text("ALTER TABLE companies DROP COLUMN status"))

    assert migrations.run(engine) == ["companies.status"]
    with engine.connect() as conn:
        rows = dict(conn.execute(text("SELECT name, status FROM companies")).all())
    assert rows == {"Stripe": "emailed", "Acme": "not_started"}
