"""The daily limit settings and how the review screen reports them."""

from app import sending
from app.models import CampaignStatus, EmailStatus
from tests import factories as f


def draft(rows):
    return {"subject": "Hi", "body": "Hello {{first_name}}", "variables": ["full_name", "email"], "rows": rows, "company": "Stripe"}


ROWS = [{"full_name": f"P{i} X", "email": f"p{i}@stripe.com"} for i in range(3)]


def test_quota_starts_with_safe_defaults(client):
    q = client.get("/api/sending/quota").json()
    assert (q["daily_limit"], q["min_delay_seconds"], q["sent_last_24h"], q["remaining"]) == (40, 20.0, 0, 40)


def test_changing_the_limit(client, db):
    f.sent_email(db, "a@x.com")
    q = client.put("/api/sending/settings", json={"daily_limit": 10, "min_delay_seconds": 45}).json()
    assert (q["daily_limit"], q["min_delay_seconds"], q["sent_last_24h"], q["remaining"]) == (10, 45.0, 1, 9)
    assert client.get("/api/sending/quota").json()["daily_limit"] == 10


def test_limit_values_are_checked(client):
    for bad in ({"daily_limit": 0, "min_delay_seconds": 20}, {"daily_limit": 501, "min_delay_seconds": 20}, {"daily_limit": 40, "min_delay_seconds": -1}):
        assert client.put("/api/sending/settings", json=bad).status_code == 422


def test_preview_says_how_many_send_now_and_later(client, db):
    s = sending.get_settings(db)
    s.daily_limit = 2
    db.commit()
    f.sent_email(db, "earlier@x.com")  # 1 of 2 used

    p = client.post("/api/campaigns/preview", json=draft(ROWS)).json()
    assert (p["ready"], p["sends_now"], p["sends_later"]) == (3, 1, 2)
    assert (p["quota"]["daily_limit"], p["quota"]["remaining"]) == (2, 1)


def test_preview_with_plenty_of_room(client):
    p = client.post("/api/campaigns/preview", json=draft(ROWS)).json()
    assert (p["sends_now"], p["sends_later"]) == (3, 0)


def test_a_waiting_batch_can_be_cancelled(client, db):
    c = f.campaign(db, [("a@x.com", EmailStatus.PENDING)], status=CampaignStatus.WAITING)
    r = client.post(f"/api/campaigns/{c.id}/cancel").json()
    assert r["status"] == "cancelled"
    assert r["counts"]["cancelled"] == 1
