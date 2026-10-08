"""Booking links. Google Calendar and Gmail are faked: nothing reaches Google."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import select

from app import bookings, gmail, meetings
from app.models import BookingLink, ConversationMessage, Meeting
from tests import factories as f
from tests.unit.test_meetings import LINK, FakeCalendar, _Call, google  # noqa: F401 (google is a fixture)
from tests.unit.test_gmail import http_error

TORONTO = ZoneInfo("America/Toronto")
# A Monday morning in Toronto; with 24 hours' notice the first open day is Tuesday.
NOW = datetime(2030, 10, 7, 8, tzinfo=TORONTO).astimezone(timezone.utc)


def hours(**kw):
    """Booking settings without the database (open_slots only reads attributes)."""
    values = {**bookings.DEFAULTS, "enabled": True, "host_name": "Umer", **kw}
    return SimpleNamespace(**values)


def at(day: int, hour: int, minute: int = 0) -> datetime:
    """October `day`, 2030 at hour:minute in Toronto, as UTC."""
    return datetime(2030, 10, day, hour, minute, tzinfo=TORONTO).astimezone(timezone.utc)


class CalendarWithEvents(FakeCalendar):
    """Adds events().list, returning `items` split over pages of `page` events."""

    def __init__(self, items=(), page=250, list_error=None):
        super().__init__()
        self.items, self.page, self.list_error = list(items), page, list_error
        self.listed = []

    def list(self, **kw):
        def run():
            if self.list_error:
                raise self.list_error
            self.listed.append(kw)
            start = int(kw.get("pageToken") or 0)
            res = {"items": self.items[start : start + self.page]}
            if start + self.page < len(self.items):
                res["nextPageToken"] = str(start + self.page)
            return res
        return _Call(run)


@pytest.fixture
def booking(db, google, monkeypatch):
    """Booking turned on (Mon-Fri 9-5 Toronto, 24h notice, 14 days), a person with a link, and
    the clock at NOW."""
    s = bookings.get_settings(db)
    s.enabled, s.host_name = True, "Umer"
    db.commit()
    google.calendar = CalendarWithEvents()
    monkeypatch.setattr(meetings, "calendar_service", lambda creds: google.calendar)
    monkeypatch.setattr(bookings, "now", lambda: NOW)
    monkeypatch.setattr(meetings, "now", lambda: NOW)
    person = f.contact(db, email="douglas@harvey.ai", full_name="Douglas Quan")
    link = bookings.link_for(db, person)
    db.commit()
    return SimpleNamespace(google=google, settings=s, person=person, link=link)


class TestOpenSlots:
    def test_half_hours_inside_booking_hours_on_booking_days_after_the_notice(self):
        slots = bookings.open_slots(hours(), [], NOW)
        assert slots[0] == at(8, 9)  # Monday is inside the 24 hours' notice
        assert slots[:3] == [at(8, 9), at(8, 9, 30), at(8, 10)]
        tuesday = [s for s in slots if s.astimezone(TORONTO).day == 8]
        assert len(tuesday) == 16 and tuesday[-1] == at(8, 16, 30)  # the last call ends at 5
        assert {s.astimezone(TORONTO).weekday() for s in slots} == {0, 1, 2, 3, 4}
        assert max(slots) < NOW + timedelta(days=15)

    def test_notice_counts_from_now(self):
        assert bookings.open_slots(hours(notice_hours=0), [], NOW)[0] == at(7, 9)
        assert bookings.open_slots(hours(notice_hours=2), [], NOW)[0] == at(7, 10)

    def test_busy_times_are_left_out(self):
        busy = [(at(8, 9, 15), at(8, 10)), (at(8, 11), at(8, 11, 30))]
        tuesday = [s for s in bookings.open_slots(hours(), busy, NOW) if s.astimezone(TORONTO).day == 8]
        assert at(8, 9) not in tuesday and at(8, 9, 30) not in tuesday  # each overlaps 9:15-10
        assert at(8, 10) in tuesday and at(8, 10, 30) in tuesday  # touching the edge is fine
        assert at(8, 11) not in tuesday and at(8, 11, 30) in tuesday

    def test_other_days_hours_and_time_zones(self):
        slots = bookings.open_slots(hours(weekdays=[5], day_start=10 * 60, day_end=11 * 60, time_zone="Europe/London"), [], NOW)
        london = ZoneInfo("Europe/London")
        assert slots == [
            datetime(2030, 10, d, h, m, tzinfo=london).astimezone(timezone.utc)
            for d in (12, 19) for h, m in ((10, 0), (10, 30))
        ]

    def test_times_that_dont_exist_when_clocks_jump_forward_are_skipped(self):
        # Toronto skips 2:00-3:00 on March 9, 2031 (a Sunday).
        march = datetime(2031, 3, 8, 12, tzinfo=TORONTO).astimezone(timezone.utc)
        slots = bookings.open_slots(hours(weekdays=[6], day_start=60, day_end=4 * 60, notice_hours=0, days_ahead=1), [], march)
        local = [s.astimezone(TORONTO).strftime("%H:%M") for s in slots]
        assert local == ["01:00", "01:30", "03:00", "03:30"]


class TestBusyTimes:
    def test_reads_every_page_of_the_calendar_and_keeps_what_blocks_time(self, db, booking):
        tz = "-04:00"
        booking.google.calendar = CalendarWithEvents(page=2, items=[
            {"start": {"dateTime": f"2030-10-08T09:00:00{tz}"}, "end": {"dateTime": f"2030-10-08T10:00:00{tz}"}},
            {"status": "cancelled", "start": {"dateTime": f"2030-10-08T11:00:00{tz}"}, "end": {"dateTime": f"2030-10-08T12:00:00{tz}"}},
            {"transparency": "transparent", "start": {"date": "2030-10-09"}, "end": {"date": "2030-10-10"}},
            {"attendees": [{"self": True, "responseStatus": "declined"}],
             "start": {"dateTime": f"2030-10-08T13:00:00{tz}"}, "end": {"dateTime": f"2030-10-08T14:00:00{tz}"}},
            {"start": {"date": "2030-10-10"}, "end": {"date": "2030-10-11"}},  # an all-day busy day
            {"start": {}, "end": {}},  # malformed: ignored
        ])
        f.contact(db, email="x@y.com")
        db.add(Meeting(contact_id=booking.person.id, title="t", starts_at=at(8, 15), ends_at=at(8, 15, 30), time_zone="UTC",
                       meet_url=LINK, calendar_event_id="e", calendar_invite=True))
        db.commit()
        busy = bookings.busy_times(db, booking.settings, NOW, NOW + timedelta(days=5))
        assert busy == [
            (at(8, 9), at(8, 10)),
            (datetime(2030, 10, 10, tzinfo=TORONTO), datetime(2030, 10, 11, tzinfo=TORONTO)),
            (at(8, 15), at(8, 15, 30)),
        ]
        listed = booking.google.calendar.listed
        assert [c["pageToken"] for c in listed] == [None, "2", "4"]
        assert listed[0]["calendarId"] == "primary" and listed[0]["singleEvents"] is True

    def test_needs_the_calendar_permission(self, db, booking):
        booking.google.account.scopes = gmail.SEND_SCOPE
        db.commit()
        with pytest.raises(bookings.BookingError) as e:
            bookings.busy_times(db, booking.settings, NOW, NOW)
        assert e.value.status == 503

    def test_any_calendar_trouble_looks_the_same_to_the_visitor(self, db, booking):
        booking.google.calendar = CalendarWithEvents(list_error=http_error(500, "Backend Error"))
        with pytest.raises(bookings.BookingError, match="isn't available right now") as e:
            bookings.busy_times(db, booking.settings, NOW, NOW)
        assert e.value.status == 503


class TestLinks:
    def test_unguessable_and_reused_while_unused_and_fresh(self, db, booking, monkeypatch):
        link = booking.link
        assert len(link.token) == 32
        assert link.expires_at == NOW + bookings.LINK_TTL
        assert bookings.link_for(db, booking.person).id == link.id
        assert bookings.url(link.token) == f"http://localhost:3000/book/{link.token}"
        # Close to expiring: a fresh one instead.
        monkeypatch.setattr(bookings, "now", lambda: NOW + bookings.LINK_TTL - timedelta(days=1))
        assert bookings.link_for(db, booking.person).id != link.id

    def test_a_booked_link_isnt_handed_out_again(self, db, booking):
        booking.link.booked_at = NOW
        db.commit()
        assert bookings.link_for(db, booking.person).id != booking.link.id

    def test_first_name(self):
        assert bookings.first_name(SimpleNamespace(first_name="Jo", full_name="Jo Bo")) == "Jo"
        assert bookings.first_name(SimpleNamespace(first_name=None, full_name="Douglas Quan")) == "Douglas"
        assert bookings.first_name(SimpleNamespace(first_name=None, full_name=None)) == "there"


class TestPage:
    def test_shows_your_name_their_name_and_the_open_times(self, db, booking):
        page = bookings.page(db, booking.link.token)
        assert (page["host_name"], page["first_name"], page["minutes"], page["time_zone"]) == ("Umer", "Douglas", 30, "America/Toronto")
        assert page["slots"][0] == at(8, 9) and page["booked"] is None

    @pytest.mark.parametrize("token", ["nope", "expired"])
    def test_unknown_and_expired_links_get_the_same_answer(self, db, booking, token):
        if token == "expired":
            booking.link.expires_at = NOW - timedelta(seconds=1)
            db.commit()
            token = booking.link.token
        with pytest.raises(bookings.BookingError, match="doesn't work anymore") as e:
            bookings.page(db, token)
        assert e.value.status == 404

    def test_turned_off(self, db, booking):
        booking.settings.enabled = False
        db.commit()
        with pytest.raises(bookings.BookingError) as e:
            bookings.page(db, booking.link.token)
        assert e.value.status == 503

    def test_after_booking_it_shows_the_booking_even_once_expired(self, db, booking):
        bookings.book(db, booking.link.token, at(8, 10))
        booking.link.expires_at = NOW - timedelta(days=1)
        db.commit()
        page = bookings.page(db, booking.link.token)
        assert page["booked"] == {"starts_at": at(8, 10), "ends_at": at(8, 10, 30)}
        assert page["slots"] == []

    def test_a_deleted_meeting_still_shows_as_booked(self, db, booking):
        bookings.book(db, booking.link.token, at(8, 10))
        db.delete(db.get(Meeting, booking.link.meeting_id))
        db.commit()
        db.refresh(booking.link)
        assert bookings.page(db, booking.link.token)["booked"] == {"starts_at": None, "ends_at": None}


class TestBook:
    def test_creates_the_meet_call_and_marks_the_link_used(self, db, booking):
        booked = bookings.book(db, booking.link.token, at(8, 10).astimezone(TORONTO))
        assert booked == {"starts_at": at(8, 10), "ends_at": at(8, 10, 30)}
        (event,) = booking.google.calendar.inserted
        assert event["body"]["summary"] == "Coffee chat: Umer and Douglas"
        assert event["body"]["attendees"] == [{"email": "douglas@harvey.ai"}] and event["sendUpdates"] == "all"
        (email,) = booking.google.sent
        assert email["to"] == "douglas@harvey.ai"
        assert "We're set for Tuesday, October 8 at 10:00 AM EDT" in email["body"]
        assert LINK in email["body"] and email["body"].endswith("Talk soon,\nUmer")
        db.refresh(booking.link)
        assert booking.link.booked_at == NOW and booking.link.meeting.starts_at == at(8, 10)

    def test_only_once(self, db, booking):
        bookings.book(db, booking.link.token, at(8, 10))
        with pytest.raises(bookings.BookingError, match="already booked") as e:
            bookings.book(db, booking.link.token, at(8, 11))
        assert e.value.status == 409

    def test_only_open_times(self, db, booking):
        for taken in (at(8, 8), at(7, 10), at(8, 10, 15)):  # before hours, inside the notice, off the half hour
            with pytest.raises(bookings.BookingError, match="isn't free anymore"):
                bookings.book(db, booking.link.token, taken)
        assert booking.google.calendar.inserted == []

    def test_a_time_someone_else_just_took(self, db, booking):
        other = bookings.link_for(db, f.contact(db, email="sam@x.com", first_name="Sam"))
        db.commit()
        bookings.book(db, other.token, at(8, 10))
        with pytest.raises(bookings.BookingError, match="isn't free anymore"):
            bookings.book(db, booking.link.token, at(8, 10))

    def test_needs_a_time_zone(self, db, booking):
        with pytest.raises(bookings.BookingError) as e:
            bookings.book(db, booking.link.token, datetime(2030, 10, 8, 10))
        assert e.value.status == 422

    def test_turned_off(self, db, booking):
        booking.settings.enabled = False
        db.commit()
        with pytest.raises(bookings.BookingError) as e:
            bookings.book(db, booking.link.token, at(8, 10))
        assert e.value.status == 503

    def test_trouble_creating_the_call_isnt_shown_to_the_visitor(self, db, booking):
        booking.google.send_error = RuntimeError("boom")
        with pytest.raises(bookings.BookingError, match="couldn't be booked") as e:
            bookings.book(db, booking.link.token, at(8, 10))
        assert e.value.status == 503 and "boom" not in str(e.value)
        db.refresh(booking.link)
        assert booking.link.booked_at is None


def test_the_confirmation_says_when_in_your_time_zone():
    text = bookings.confirmation("Jo", "Umer", at(8, 14, 30), "America/Toronto")
    assert text.startswith("Hi Jo,\n\nThanks for booking a time! We're set for Tuesday, October 8 at 2:30 PM EDT.")
    assert meetings.LINK in text


class TestRateLimit:
    def test_too_many_views_from_one_visitor(self, monkeypatch):
        t = [1000.0]
        monkeypatch.setattr(bookings.clock, "monotonic", lambda: t[0])
        for _ in range(bookings.RATE_LIMIT):
            bookings.check_rate("1.2.3.4")
        with pytest.raises(bookings.BookingError) as e:
            bookings.check_rate("1.2.3.4")
        assert e.value.status == 429
        bookings.check_rate("5.6.7.8")  # others aren't affected
        t[0] += bookings.RATE_WINDOW
        bookings.check_rate("1.2.3.4")  # and it wears off


class TestSendLink:
    MESSAGE = "Hi Douglas, grab any time that works: {{booking_link}}"

    def test_replies_in_the_conversation_with_their_link(self, db, booking):
        db.add(ConversationMessage(
            contact_id=booking.person.id, gmail_message_id="m1", gmail_thread_id="t1", rfc_message_id="<m1@x>", from_me=False,
            from_addr="douglas@harvey.ai", to_addrs="", subject="Quick question", body="", sent_at=NOW - timedelta(days=1),
        ))
        db.commit()
        link = bookings.send_link(db, booking.person, self.MESSAGE)
        assert link.id == booking.link.id and link.emailed_at == NOW
        (email,) = booking.google.sent
        assert email["body"] == f"Hi Douglas, grab any time that works: {bookings.url(link.token)}"
        assert (email["subject"], email["thread_id"], email["in_reply_to"]) == ("Re: Quick question", "t1", "<m1@x>")
        mine = db.scalars(select(ConversationMessage).where(ConversationMessage.from_me.is_(True))).one()
        assert mine.body == email["body"] and mine.gmail_message_id == "sent1"

    def test_adds_the_link_when_the_message_forgets_it(self, db, booking):
        bookings.send_link(db, booking.person, "Pick a time below.\n")
        (email,) = booking.google.sent
        assert email["body"] == f"Pick a time below.\n\n{bookings.url(booking.link.token)}"
        assert email["subject"] == "Finding a time to chat"

    def test_counts_toward_the_daily_limit(self, db, booking, monkeypatch):
        from app import sending

        monkeypatch.setattr(sending, "now", lambda: NOW)
        before = sending.quota(db).sent_last_24h
        bookings.send_link(db, booking.person, self.MESSAGE)
        assert sending.quota(db).sent_last_24h == before + 1

    def test_needs_booking_turned_on(self, db, booking):
        booking.settings.enabled = False
        db.commit()
        with pytest.raises(bookings.BookingError, match="Turn on booking links first"):
            bookings.send_link(db, booking.person, self.MESSAGE)

    def test_needs_gmail(self, db, booking, monkeypatch):
        db.delete(booking.google.account)
        db.commit()
        with pytest.raises(bookings.BookingError, match="Connect Gmail first"):
            bookings.send_link(db, booking.person, self.MESSAGE)

    def test_an_unusable_login(self, db, booking, monkeypatch):
        def broken(db):
            raise gmail.GmailNotConnected("Reconnect Gmail.")

        monkeypatch.setattr(gmail, "load_credentials", broken)
        with pytest.raises(bookings.BookingError, match="Reconnect Gmail") as e:
            bookings.send_link(db, booking.person, self.MESSAGE)
        assert e.value.status == 409

    @pytest.mark.parametrize(
        "error, status", [(gmail.RefreshError("invalid_grant"), 403), (RuntimeError("boom"), 502)]
    )
    def test_a_failed_send_records_nothing(self, db, booking, error, status):
        booking.google.send_error = error
        with pytest.raises(bookings.BookingError) as e:
            bookings.send_link(db, booking.person, self.MESSAGE)
        assert e.value.status == status
        assert db.scalars(select(BookingLink).where(BookingLink.emailed_at.is_not(None))).all() == []
        assert db.scalars(select(ConversationMessage)).all() == []


def test_settings_start_off_with_sensible_hours(db):
    s = bookings.get_settings(db)
    assert (s.enabled, s.time_zone, s.weekdays, s.day_start, s.day_end, s.notice_hours, s.days_ahead) == (
        False, "America/Toronto", [0, 1, 2, 3, 4], 540, 1020, 24, 14,
    )
    assert bookings.get_settings(db) is s


def test_valid_time_zone():
    assert bookings.valid_time_zone("America/Toronto")
    assert not bookings.valid_time_zone("Mars/Olympus")
    assert not bookings.valid_time_zone("../etc")


def test_now_is_utc():
    assert bookings.now().tzinfo is timezone.utc
