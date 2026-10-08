"""Scheduling a batch for later, and starting it early."""

from datetime import datetime, timedelta, timezone

from app import campaigns
from app.models import Campaign, CampaignStatus, EmailStatus
from tests import factories as f


def draft(**kw):
    return {
        "subject": "Hi", "body": "Hello {{first_name}}", "variables": ["full_name", "email"],
        "rows": [{"full_name": "Jane Doe", "email": "jane@stripe.com"}], "company": "Stripe", **kw,
    }


def in_hours(h):
    return (datetime.now(timezone.utc) + timedelta(hours=h)).isoformat()


def test_creates_a_scheduled_batch(client, db, started):
    when = in_hours(10)
    c = client.post("/api/campaigns", json=draft(scheduled_for=when)).json()
    assert c["status"] == "scheduled"
    assert datetime.fromisoformat(c["scheduled_for"]) == datetime.fromisoformat(when)
    assert started == [c["id"]]  # its sender starts and sleeps until then
    assert client.get("/api/campaigns").json()["items"][0]["scheduled_for"] is not None


def test_sending_now_has_no_schedule(client):
    c = client.post("/api/campaigns", json=draft()).json()
    assert (c["status"], c["scheduled_for"]) == ("queued", None)


def test_schedule_must_be_in_the_future_and_within_60_days(client):
    for when, message in [
        (in_hours(-1), "Pick a time in the future."),
        (in_hours(24 * 61), "Schedules can be at most 60 days ahead."),
        ("2030-01-01T09:00:00", "The scheduled time needs a timezone."),
    ]:
        r = client.post("/api/campaigns", json=draft(scheduled_for=when))
        assert (r.status_code, r.json()["detail"]) == (422, message)


def test_a_scheduled_batch_can_be_cancelled(client, db):
    c = f.campaign(db, [("a@x.com", EmailStatus.PENDING)], status=CampaignStatus.SCHEDULED)
    r = client.post(f"/api/campaigns/{c.id}/cancel").json()
    assert (r["status"], r["counts"]["cancelled"]) == ("cancelled", 1)


def test_send_now_starts_a_scheduled_batch_that_isnt_running(client, db, started):
    c = f.campaign(db, status=CampaignStatus.SCHEDULED, scheduled_for=datetime.now(timezone.utc) + timedelta(days=1))
    r = client.post(f"/api/campaigns/{c.id}/send-now")
    assert r.status_code == 200
    assert started == [c.id]
    db.refresh(c)
    assert c.scheduled_for <= datetime.now(timezone.utc)


def test_send_now_wakes_a_sleeping_sender(client, db, started):
    c = f.campaign(db, status=CampaignStatus.SCHEDULED, scheduled_for=datetime.now(timezone.utc) + timedelta(days=1))
    campaigns._running.add(c.id)
    client.post(f"/api/campaigns/{c.id}/send-now")
    assert c.id in campaigns._wake_requested
    assert started == []


def test_send_now_only_for_scheduled_batches(client, db):
    c = f.campaign(db, status=CampaignStatus.COMPLETED)
    assert client.post(f"/api/campaigns/{c.id}/send-now").status_code == 409
    assert client.post("/api/campaigns/999/send-now").status_code == 404
