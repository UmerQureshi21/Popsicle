"""Google Meet invites. Google Calendar and sending are faked: nothing reaches Google."""

from datetime import datetime, timedelta, timezone

import httplib2
import pytest
from sqlalchemy import select

from app import gmail, meetings
from app.models import ConversationMessage, GmailAccount, Meeting
from tests import factories as f
from tests.unit.test_gmail import http_error

ME = "me@gmail.com"
LINK = "https://meet.google.com/abc-defg-hij"
START = datetime(2030, 10, 7, 13, tzinfo=timezone.utc)


class _Call:
    def __init__(self, fn):
        self.fn = fn

    def execute(self):
        return self.fn()


class FakeCalendar:
    """events().insert/get/delete. `pending` = how many times Google answers without a link yet."""

    def __init__(self, pending: int = 0, error: Exception | None = None):
        self.pending, self.error = pending, error
        self.inserted, self.deleted, self.gets = [], [], 0
        self.delete_error: Exception | None = None

    def events(self):
        return self

    def _event(self):
        if self.pending:
            return {"id": "ev1", "htmlLink": "https://calendar.google.com/event?eid=1"}
        return {"id": "ev1", "htmlLink": "https://calendar.google.com/event?eid=1", "hangoutLink": LINK}

    def insert(self, calendarId, body, conferenceDataVersion, sendUpdates):
        def run():
            if self.error:
                raise self.error
            self.inserted.append(dict(calendarId=calendarId, body=body, conferenceDataVersion=conferenceDataVersion, sendUpdates=sendUpdates))
            return self._event()
        return _Call(run)

    def get(self, calendarId, eventId):
        def run():
            self.gets += 1
            self.pending = max(0, self.pending - 1)
            return self._event()
        return _Call(run)

    def delete(self, calendarId, eventId, sendUpdates):
        def run():
            self.deleted.append((eventId, sendUpdates))
            if self.delete_error:
                raise self.delete_error
        return _Call(run)


@pytest.fixture
def google(db, monkeypatch):
    """A connected account with every permission, a fake calendar and a fake outbox."""
    acct = GmailAccount(email=ME, token_json="{}", scopes=f"{gmail.SEND_SCOPE} {gmail.READ_SCOPE} {gmail.CALENDAR_SCOPE}")
    db.add(acct)
    db.commit()

    class Google:
        account = acct
        calendar = FakeCalendar()
        sent: list = []
        send_error: Exception | None = None

    g = Google()
    g.sent = []
    monkeypatch.setattr(gmail, "load_credentials", lambda db: "creds")
    monkeypatch.setattr(gmail, "gmail_service", lambda creds: "gmail-service")
    monkeypatch.setattr(meetings, "calendar_service", lambda creds: g.calendar)
    monkeypatch.setattr(meetings, "POLL_SECONDS", 0)

    def send(service, to, subject, body, attachments, *, thread_id=None, in_reply_to=None):
        if g.send_error:
            raise g.send_error
        g.sent.append(dict(to=to, subject=subject, body=body, thread_id=thread_id, in_reply_to=in_reply_to))
        return {"id": "sent1", "threadId": thread_id or "new-thread"}

    monkeypatch.setattr(gmail, "send", send)
    return g


def schedule(db, contact, **kw):
    args = dict(title="Coffee chat", start=START, minutes=30, time_zone="America/Toronto",
                message="Hi Douglas, here's the link: {{meet_link}}", invite=True)
    return meetings.schedule(db, contact, **{**args, **kw})


def douglas(db):
    return f.contact(db, email="douglas@harvey.ai", full_name="Douglas Quan")


class TestMeetLink:
    def test_from_hangout_link_or_entry_points(self):
        assert meetings.meet_link({"hangoutLink": LINK}) == LINK
        assert meetings.meet_link({"conferenceData": {"entryPoints": [
            {"entryPointType": "phone", "uri": "tel:+1"}, {"entryPointType": "video", "uri": LINK},
        ]}}) == LINK
        assert meetings.meet_link({}) is None


def test_reply_subject():
    assert meetings.reply_subject("Quick question", "Coffee") == "Re: Quick question"
    assert meetings.reply_subject("RE: Quick question", "Coffee") == "RE: Quick question"
    assert meetings.reply_subject(None, "Coffee") == "Coffee"


class TestSchedule:
    def test_creates_the_event_and_replies_in_the_conversation(self, db, google):
        d = douglas(db)
        older = datetime(2026, 10, 1, tzinfo=timezone.utc)
        for mid, when in [("m1", older), ("m2", older + timedelta(days=1))]:
            db.add(ConversationMessage(
                contact_id=d.id, gmail_message_id=mid, gmail_thread_id="t1", rfc_message_id=f"<{mid}@x>", from_me=mid == "m1",
                from_addr=ME, to_addrs="", subject="Quick question", body="", sent_at=when,
            ))
        db.commit()

        meeting = schedule(db, d)

        (event,) = google.calendar.inserted
        assert event["calendarId"] == "primary" and event["conferenceDataVersion"] == 1 and event["sendUpdates"] == "all"
        body = event["body"]
        assert body["summary"] == "Coffee chat"
        assert body["start"] == {"dateTime": "2030-10-07T13:00:00+00:00", "timeZone": "America/Toronto"}
        assert body["end"] == {"dateTime": "2030-10-07T13:30:00+00:00", "timeZone": "America/Toronto"}
        assert body["attendees"] == [{"email": "douglas@harvey.ai"}]
        assert body["conferenceData"]["createRequest"]["conferenceSolutionKey"] == {"type": "hangoutsMeet"}

        assert google.sent == [dict(to="douglas@harvey.ai", subject="Re: Quick question",
                                    body=f"Hi Douglas, here's the link: {LINK}", thread_id="t1", in_reply_to="<m2@x>")]
        assert (meeting.meet_url, meeting.calendar_event_id, meeting.gmail_message_id, meeting.calendar_invite) == (LINK, "ev1", "sent1", True)
        assert meeting.ends_at - meeting.starts_at == timedelta(minutes=30)
        mine = db.scalars(select(ConversationMessage).where(ConversationMessage.gmail_message_id == "sent1")).one()
        assert (mine.from_me, mine.gmail_thread_id, mine.body) == (True, "t1", f"Hi Douglas, here's the link: {LINK}")

    def test_without_a_calendar_invite(self, db, google):
        schedule(db, douglas(db), invite=False)
        assert google.calendar.inserted[0]["sendUpdates"] == "none"
        assert google.calendar.inserted[0]["body"]["attendees"] == []

    def test_link_added_at_the_end_when_the_message_has_no_placeholder(self, db, google):
        schedule(db, douglas(db), message="See you then!  ")
        assert google.sent[0]["body"] == f"See you then!\n\n{LINK}"

    def test_replies_to_the_last_batch_email_before_any_sync(self, db, google):
        d = douglas(db)
        e = f.sent_email(db, d.email, datetime(2026, 10, 1, tzinfo=timezone.utc), contact=d)
        e.gmail_thread_id = "t9"
        db.commit()
        schedule(db, d)
        assert (google.sent[0]["thread_id"], google.sent[0]["in_reply_to"], google.sent[0]["subject"]) == ("t9", None, f"Re: {e.subject}")

    def test_a_new_email_when_there_is_no_conversation(self, db, google):
        schedule(db, douglas(db))
        assert (google.sent[0]["thread_id"], google.sent[0]["subject"]) == (None, "Coffee chat")
        assert db.scalars(select(ConversationMessage)).one().gmail_thread_id == "new-thread"

    def test_waits_for_google_to_finish_the_link(self, db, google):
        google.calendar.pending = 2
        assert schedule(db, douglas(db)).meet_url == LINK
        assert google.calendar.gets == 2

    def test_no_link_after_waiting(self, db, google):
        google.calendar.pending = 10
        with pytest.raises(meetings.MeetingError, match="didn't create a Meet link") as e:
            schedule(db, douglas(db))
        assert e.value.status == 502
        assert google.calendar.deleted == [("ev1", "all")]
        assert db.scalars(select(Meeting)).all() == []

    def test_email_failure_removes_the_event(self, db, google):
        google.send_error = RuntimeError("Invalid To header")
        google.calendar.delete_error = RuntimeError("already gone")  # still reports the real problem
        with pytest.raises(meetings.MeetingError, match="email didn't send") as e:
            schedule(db, douglas(db), invite=False)
        assert e.value.status == 502
        assert google.calendar.deleted == [("ev1", "none")]
        assert db.scalars(select(Meeting)).all() == []

    @pytest.mark.parametrize(
        "error, status, text",
        [
            (http_error(403, "Google Calendar API has not been used in project 123 before or it is disabled."), 400, "Turn on the Google Calendar API"),
            (http_error(403, "Request had insufficient authentication scopes."), 403, "Reconnect Gmail"),
            (http_error(500, "Backend Error"), 502, "Google Calendar error"),
        ],
    )
    def test_calendar_errors(self, db, google, error, status, text):
        google.calendar.error = error
        with pytest.raises(meetings.MeetingError, match=text) as e:
            schedule(db, douglas(db))
        assert e.value.status == status
        assert google.sent == []

    def test_needs_gmail(self, db):
        with pytest.raises(meetings.MeetingError, match="Connect Gmail first") as e:
            schedule(db, douglas(db))
        assert e.value.status == 409

    def test_needs_calendar_permission(self, db, google):
        google.account.scopes = f"{gmail.SEND_SCOPE} {gmail.READ_SCOPE}"
        db.commit()
        with pytest.raises(meetings.MeetingError, match="manage your calendar") as e:
            schedule(db, douglas(db))
        assert e.value.status == 403

    def test_no_internet(self, db, google, monkeypatch):
        def offline(db):
            raise gmail.GmailUnreachable(gmail.UNREACHABLE)

        monkeypatch.setattr(gmail, "load_credentials", offline)
        with pytest.raises(meetings.MeetingError, match="internet connection") as e:
            schedule(db, douglas(db))
        assert e.value.status == 503

    def test_no_internet_when_creating_the_event(self, db, google):
        google.calendar.error = httplib2.ServerNotFoundError("Unable to find the server at www.googleapis.com")
        with pytest.raises(meetings.MeetingError, match="internet connection") as e:
            schedule(db, douglas(db))
        assert e.value.status == 503
        assert google.sent == []

    def test_other_errors_creating_the_event_are_not_hidden(self, db, google):
        google.calendar.error = RuntimeError("boom")
        with pytest.raises(RuntimeError, match="boom"):
            schedule(db, douglas(db))

    def test_expired_login(self, db, google, monkeypatch):
        def expired(db):
            raise gmail.GmailNotConnected("Gmail login expired. Reconnect Gmail.")

        monkeypatch.setattr(gmail, "load_credentials", expired)
        with pytest.raises(meetings.MeetingError, match="expired") as e:
            schedule(db, douglas(db))
        assert e.value.status == 409


def test_calendar_service(monkeypatch):
    monkeypatch.setattr(meetings, "build", lambda *a, **kw: (a, kw))
    assert meetings.calendar_service("creds") == (("calendar", "v3"), {"credentials": "creds", "cache_discovery": False})
