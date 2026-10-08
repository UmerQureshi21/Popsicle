"""Booking hours (logged in), the public booking page, sending a link from the Inbox, and
{{booking_link}} in a batch. Google is faked: nothing reaches it."""

import pytest
from sqlalchemy import select

from app import bookings
from app.models import BookingLink, Campaign, ConversationMessage
from tests import factories as f
from tests.api.test_campaigns_api import draft
from tests.unit.test_bookings import NOW, at, booking  # noqa: F401 (booking is a fixture)
from tests.unit.test_meetings import google  # noqa: F401 (a fixture)

HOURS = {
    "enabled": True, "host_name": "  Umer  ", "time_zone": "America/Toronto", "weekdays": [4, 0, 0, 2],
    "day_start": 600, "day_end": 960, "notice_hours": 12, "days_ahead": 21,
}


class TestSettings:
    def test_off_until_set_up(self, client):
        s = client.get("/api/booking/settings").json()
        assert (s["enabled"], s["host_name"], s["weekdays"], s["can_check_calendar"]) == (False, "", [0, 1, 2, 3, 4], False)

    def test_saved(self, client, google):
        s = client.put("/api/booking/settings", json=HOURS).json()
        assert s == {**HOURS, "host_name": "Umer", "weekdays": [0, 2, 4], "can_check_calendar": True}
        assert client.get("/api/booking/settings").json() == s

    @pytest.mark.parametrize(
        "change, message",
        [
            ({"time_zone": "Mars/Olympus"}, "Unknown time zone"),
            ({"day_start": 615}, "on the hour or half hour"),
            ({"day_start": 960, "day_end": 960}, "at least 30 minutes"),
            ({"weekdays": [7]}, "0 (Monday) to 6 (Sunday)"),
            ({"weekdays": []}, "at least one day"),
            ({"host_name": " "}, "Add your name"),
            ({"host_name": "Umer\nQ"}, "line break"),
            ({"days_ahead": 0}, "greater than or equal to 1"),
        ],
    )
    def test_refuses_settings_that_dont_make_sense(self, client, change, message):
        r = client.put("/api/booking/settings", json={**HOURS, **change})
        assert r.status_code == 422
        assert message in r.text

    def test_turned_off_it_needs_no_name_or_days(self, client):
        r = client.put("/api/booking/settings", json={**HOURS, "enabled": False, "host_name": "", "weekdays": []})
        assert r.status_code == 200

    def test_needs_a_login_when_login_is_required(self, client, settings):
        settings(auth_required=True)
        assert client.get("/api/booking/settings").status_code == 401


class TestPublicPage:
    def test_open_without_logging_in(self, client, settings, booking):
        settings(auth_required=True)
        page = client.get(f"/api/book/{booking.link.token}").json()
        assert (page["host_name"], page["first_name"], page["minutes"]) == ("Umer", "Douglas", 30)
        assert page["slots"][0].startswith("2030-10-08T13:00:00")  # 9:00 Toronto
        r = client.post(f"/api/book/{booking.link.token}", json={"starts_at": at(8, 10).isoformat()})
        assert r.status_code == 200
        assert r.json()["starts_at"].startswith("2030-10-08T14:00:00")
        assert client.get(f"/api/book/{booking.link.token}").json()["booked"]["starts_at"].startswith("2030-10-08T14:00")

    def test_nothing_else_opens_up(self, client, settings, booking):
        settings(auth_required=True)
        assert client.get("/api/conversations").status_code == 401
        assert client.get("/api/book").status_code in (401, 404, 405)

    def test_errors_come_back_plainly(self, client, booking):
        r = client.get("/api/book/not-a-real-token")
        assert r.status_code == 404 and "doesn't work anymore" in r.json()["detail"]
        r = client.post(f"/api/book/{booking.link.token}", json={"starts_at": at(8, 8).isoformat()})
        assert r.status_code == 409 and "isn't free anymore" in r.json()["detail"]

    def test_rate_limited_per_visitor(self, client, booking, monkeypatch):
        monkeypatch.setattr(bookings, "RATE_LIMIT", 2)
        for _ in range(2):
            assert client.get(f"/api/book/{booking.link.token}").status_code == 200
        assert client.get(f"/api/book/{booking.link.token}").status_code == 429
        assert client.post(f"/api/book/{booking.link.token}", json={"starts_at": at(8, 10).isoformat()}).status_code == 429


class TestSendFromInbox:
    def test_sends_their_link(self, client, booking):
        r = client.post(f"/api/conversations/{booking.person.id}/booking-link", json={"message": "Pick a time: {{booking_link}}"})
        assert r.status_code == 201
        assert r.json()["url"] == bookings.url(booking.link.token)
        (email,) = booking.google.sent
        assert email["body"] == f"Pick a time: {r.json()['url']}"

    def test_unknown_person(self, client):
        assert client.post("/api/conversations/999/booking-link", json={"message": "x"}).status_code == 404

    def test_booking_turned_off(self, client, db, booking):
        booking.settings.enabled = False
        db.commit()
        r = client.post(f"/api/conversations/{booking.person.id}/booking-link", json={"message": "x"})
        assert r.status_code == 409 and "Turn on booking links first" in r.json()["detail"]


class TestInABatch:
    BODY = "Hi {{first_name}}, book a time: {{booking_link}}"

    def test_the_preview_shows_where_the_link_goes(self, client):
        item = client.post("/api/campaigns/preview", json=draft(body=self.BODY)).json()["items"][0]
        assert item["status"] == "ready"
        assert item["body"] == "Hi Jane, book a time: http://localhost:3000/book/…"

    def test_each_person_gets_their_own_link(self, client, db, booking):
        rows = [{"full_name": "Jane Doe", "email": "jane@stripe.com"}, {"full_name": "Sam Lee", "email": "sam@stripe.com"}]
        r = client.post("/api/campaigns", json=draft(body=self.BODY, rows=rows))
        assert r.status_code == 201, r.text
        emails = db.scalars(select(Campaign)).one().emails
        links = {link.contact.email: link for link in db.scalars(select(BookingLink))}
        assert set(links) == {"jane@stripe.com", "sam@stripe.com", "douglas@harvey.ai"}
        for e in emails:
            assert e.body == f"Hi {e.contact.first_name or e.contact.full_name.split()[0]}, book a time: {bookings.url(links[e.to_email].token)}"
        assert links["jane@stripe.com"].token != links["sam@stripe.com"].token

    def test_people_skipped_get_no_link(self, client, db, booking):
        f.sent_email(db, "sam@stripe.com")
        rows = [{"full_name": "Jane Doe", "email": "jane@stripe.com"}, {"full_name": "Sam Lee", "email": "sam@stripe.com"}]
        assert client.post("/api/campaigns", json=draft(body=self.BODY, rows=rows)).status_code == 201
        assert {link.contact.email for link in db.scalars(select(BookingLink))} == {"jane@stripe.com", "douglas@harvey.ai"}

    def test_needs_booking_turned_on(self, client, db):
        r = client.post("/api/campaigns", json=draft(body=self.BODY))
        assert r.status_code == 422 or r.status_code == 400
        assert "Turn on booking links first" in r.text
        assert db.scalars(select(Campaign)).all() == []
        assert db.scalars(select(ConversationMessage)).all() == []
