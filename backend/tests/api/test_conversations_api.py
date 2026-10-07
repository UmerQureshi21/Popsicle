"""The Conversations API. Gmail is faked with tests.fake_gmail."""

from datetime import datetime, timedelta, timezone

import httplib2
import pytest

from app import gmail
from app.models import ConversationMessage, GmailAccount
from tests import factories as f
from tests.fake_gmail import FakeGmail, message
from tests.unit.test_gmail import http_error

ME = "me@gmail.com"
ALL_SCOPES = f"{gmail.SEND_SCOPE} {gmail.READ_SCOPE} {gmail.CALENDAR_SCOPE}"


def at(day: int, hour: int = 12) -> datetime:
    return datetime(2026, 10, day, hour, tzinfo=timezone.utc)


@pytest.fixture
def account(db):
    acct = GmailAccount(email=ME, token_json="{}", scopes=ALL_SCOPES)
    db.add(acct)
    db.commit()
    return acct


@pytest.fixture
def fake_gmail(monkeypatch):
    service = FakeGmail()
    monkeypatch.setattr(gmail, "load_credentials", lambda db: "creds")
    monkeypatch.setattr(gmail, "gmail_service", lambda creds: service)
    return service


def emailed(db, address, name=None, when=at(1), company=None, **kw):
    contact = f.contact(db, email=address, full_name=name, company=company, **kw)
    e = f.sent_email(db, address, when, contact=contact)
    return contact, e


def reply(db, contact, mid, body, when, from_me=False, thread="t1"):
    db.add(ConversationMessage(
        contact_id=contact.id, gmail_message_id=mid, gmail_thread_id=thread, from_me=from_me,
        from_name=None if from_me else contact.full_name, from_addr=ME if from_me else contact.email,
        to_addrs=contact.email if from_me else ME, subject="Re: Quick question", snippet=body[:50], body=body, sent_at=when,
    ))
    db.commit()


class TestList:
    def test_everyone_emailed_newest_conversation_first(self, client, db):
        harvey = f.company(db, name="Harvey", domain="harvey.ai")
        douglas, _ = emailed(db, "douglas@harvey.ai", "Douglas Quan", at(1), company=harvey, title="Engineer")
        emailed(db, "jane@stripe.com", "Jane Doe", at(2))
        f.contact(db, email="never@x.com")
        reply(db, douglas, "m2", "Happy to chat!\n\nOn Wed, Umer wrote:\n> Hi", at(3))

        rows = client.get("/api/conversations").json()
        assert [(r["full_name"], r["replied"], r["message_count"], r["last_from_me"]) for r in rows] == [
            ("Douglas Quan", True, 2, False),
            ("Jane Doe", False, 1, True),
        ]
        assert rows[0]["last_snippet"] == "Happy to chat!"
        assert (rows[0]["company_name"], rows[0]["company_domain"], rows[0]["title"]) == ("Harvey", "harvey.ai", "Engineer")
        assert rows[0]["first_emailed_at"].startswith("2026-10-01")
        assert rows[1]["company_name"] is None

    def test_nothing_emailed(self, client):
        assert client.get("/api/conversations").json() == []


class TestDetail:
    def test_messages_in_order_without_duplicates(self, client, db, account):
        douglas, sent = emailed(db, "douglas@harvey.ai", "Douglas Quan", at(1))
        sent.gmail_message_id, sent.gmail_thread_id = "m1", "t1"
        db.commit()
        reply(db, douglas, "m1", "Hi Douglas (as synced)", at(1), from_me=True)
        reply(db, douglas, "m2", "Sounds good, Tuesday works.\n> quoted", at(2))

        body = client.get(f"/api/conversations/{douglas.id}").json()
        assert [(m["id"], m["from_me"], m["body"]) for m in body["messages"]] == [
            ("m1", True, "Hi Douglas (as synced)"),
            ("m2", False, "Sounds good, Tuesday works."),
        ]
        assert body["messages"][1]["from_name"] == "Douglas Quan"
        assert body["replied"] is True

    def test_sent_emails_show_before_any_sync(self, client, db, account):
        jane, sent = emailed(db, "jane@stripe.com", "Jane Doe")
        body = client.get(f"/api/conversations/{jane.id}").json()
        assert body["messages"] == [{
            "id": f"email-{sent.id}", "from_me": True, "from_name": None, "from_addr": ME, "to": "jane@stripe.com",
            "subject": sent.subject, "body": sent.body, "sent_at": body["messages"][0]["sent_at"], "gmail_thread_id": None,
        }]

    def test_without_gmail_my_address_is_just_me(self, client, db):
        jane, _ = emailed(db, "jane@stripe.com")
        assert client.get(f"/api/conversations/{jane.id}").json()["messages"][0]["from_addr"] == "me"

    def test_a_message_with_only_a_quote_falls_back_to_the_snippet(self, client, db):
        jane, _ = emailed(db, "jane@stripe.com")
        reply(db, jane, "m2", "> just a quote", at(2))
        assert client.get(f"/api/conversations/{jane.id}").json()["messages"][-1]["body"] == "> just a quote"

    def test_someone_not_emailed(self, client, db):
        c = f.contact(db, email="never@x.com")
        assert client.get(f"/api/conversations/{c.id}").status_code == 404


@pytest.fixture
def inline(monkeypatch):
    """Run the background half of a Gmail check right away, instead of on a thread."""
    from app.routers import conversations as routes

    jobs = []
    monkeypatch.setattr(routes, "in_background", lambda fn, *args: jobs.append(args) or fn(*args))
    return jobs


class TestSync:
    def test_runs_in_the_background_and_reports_when_done(self, client, db, account, fake_gmail, inline):
        emailed(db, "douglas@harvey.ai", "Douglas Quan")
        fake_gmail.add("t1", message("m1", ME, "douglas@harvey.ai", sent=True),
                       message("m2", "douglas@harvey.ai", ME, "Yes!", at=at(2)))
        r = client.post("/api/conversations/sync")
        assert r.status_code == 202
        assert inline == [(account.id,)]
        body = client.get("/api/conversations/sync").json()
        assert body["running"] is False
        assert (body["threads_checked"], body["threads_downloaded"], body["new_messages"], body["error"]) == (1, 1, 2, None)
        assert body["synced_at"] is not None
        assert client.get("/api/conversations").json()[0]["replied"] is True

    def test_answers_straight_away_while_it_runs(self, client, db, account, monkeypatch):
        from app.routers import conversations as routes

        started = []
        monkeypatch.setattr(routes, "in_background", lambda fn, *args: started.append(args))
        body = client.post("/api/conversations/sync").json()
        assert body["running"] is True and started == [(account.id,)]
        assert client.get("/api/conversations/sync").json()["running"] is True
        # Asking again joins the check already running instead of starting another.
        assert client.post("/api/conversations/sync").json()["running"] is True
        assert started == [(account.id,)]

    def test_status_without_gmail(self, client):
        assert client.get("/api/conversations/sync").json() == {
            "running": False, "threads_checked": 0, "threads_downloaded": 0, "new_messages": 0, "synced_at": None, "error": None,
        }

    def test_needs_gmail(self, client):
        r = client.post("/api/conversations/sync")
        assert (r.status_code, r.json()["detail"]) == (409, "Connect Gmail first.")

    def test_needs_permission_to_read(self, client, db, account):
        account.scopes = gmail.SEND_SCOPE
        db.commit()
        r = client.post("/api/conversations/sync")
        assert r.status_code == 403
        assert "Reconnect Gmail" in r.json()["detail"]

    def test_no_internet_is_not_an_expired_login(self, client, account, monkeypatch, inline):
        def offline(db):
            raise gmail.GmailUnreachable(gmail.UNREACHABLE)

        monkeypatch.setattr(gmail, "load_credentials", offline)
        client.post("/api/conversations/sync")
        assert client.get("/api/conversations/sync").json()["error"] == gmail.UNREACHABLE

    def test_expired_login(self, client, account, monkeypatch, inline):
        def expired(db):
            raise gmail.GmailNotConnected("Gmail login expired. Reconnect Gmail.")

        monkeypatch.setattr(gmail, "load_credentials", expired)
        client.post("/api/conversations/sync")
        assert client.get("/api/conversations/sync").json()["error"] == "Gmail login expired. Reconnect Gmail."

    @pytest.mark.parametrize(
        "error, message",
        [
            (http_error(403, "Request had insufficient authentication scopes."), "Reconnect Gmail"),
            (http_error(500, "Backend Error"), "Gmail error"),
            (RuntimeError("boom"), "failed unexpectedly"),
            (httplib2.ServerNotFoundError("Unable to find the server at gmail.googleapis.com"), "internet connection"),
        ],
    )
    def test_gmail_errors(self, client, db, account, fake_gmail, inline, error, message):
        emailed(db, "jane@stripe.com")
        fake_gmail.error = error
        client.post("/api/conversations/sync")
        status = client.get("/api/conversations/sync").json()
        assert message in status["error"] and status["running"] is False
        # Free to try again.
        fake_gmail.error = None
        client.post("/api/conversations/sync")
        assert client.get("/api/conversations/sync").json()["error"] is None

    def test_in_background_starts_a_thread(self, monkeypatch):
        from app.routers import conversations as routes

        made = []

        class Thread:
            def __init__(self, target, args, daemon, name):
                made.append((target, args, daemon, name))

            def start(self):
                made.append("started")

        monkeypatch.setattr(routes.threading, "Thread", Thread)
        routes.in_background(print, 1)
        assert made == [(print, (1,), True, "gmail-sync"), "started"]


class TestMeetings:
    BODY = {
        "title": "Coffee chat", "starts_at": "2030-10-07T09:00:00-04:00", "duration_minutes": 30,
        "time_zone": "America/Toronto", "message": "Here's the link: {{meet_link}}", "calendar_invite": True,
    }

    @pytest.fixture
    def scheduled(self, monkeypatch):
        """Replace meetings.schedule: records its arguments and stores a meeting like it would,
        or raises `scheduled.error`."""
        from app import meetings
        from app.models import Meeting

        class Calls(list):
            error: Exception | None = None

        calls = Calls()

        def schedule(db, contact, **kw):
            calls.append(kw)
            if calls.error:
                raise calls.error
            m = Meeting(contact_id=contact.id, title=kw["title"], starts_at=kw["start"],
                        ends_at=kw["start"] + timedelta(minutes=kw["minutes"]), time_zone=kw["time_zone"],
                        meet_url="https://meet.google.com/abc", calendar_event_id="ev1", calendar_url=None,
                        calendar_invite=kw["invite"], gmail_message_id="s1")
            db.add(m)
            db.commit()
            return m

        monkeypatch.setattr(meetings, "schedule", schedule)
        return calls

    def test_schedules_and_shows_up_in_the_conversation(self, client, db, scheduled):
        douglas, _ = emailed(db, "douglas@harvey.ai", "Douglas Quan")
        r = client.post(f"/api/conversations/{douglas.id}/meeting", json={**self.BODY, "title": "  Coffee chat "})
        assert r.status_code == 201
        assert r.json()["meet_url"] == "https://meet.google.com/abc"
        assert datetime.fromisoformat(r.json()["ends_at"]) == datetime(2030, 10, 7, 13, 30, tzinfo=timezone.utc)
        assert scheduled[0] == dict(title="Coffee chat", start=datetime(2030, 10, 7, 13, tzinfo=timezone.utc), minutes=30,
                                    time_zone="America/Toronto", message="Here's the link: {{meet_link}}", invite=True)

        detail = client.get(f"/api/conversations/{douglas.id}").json()
        assert [m["title"] for m in detail["meetings"]] == ["Coffee chat"]
        nine_toronto = datetime(2030, 10, 7, 13, tzinfo=timezone.utc)
        assert datetime.fromisoformat(detail["next_meeting_at"]) == nine_toronto
        assert datetime.fromisoformat(client.get("/api/conversations").json()[0]["next_meeting_at"]) == nine_toronto

    def test_past_meetings_are_listed_but_not_next(self, client, db, scheduled):
        from app.models import Meeting

        douglas, _ = emailed(db, "douglas@harvey.ai")
        db.add(Meeting(contact_id=douglas.id, title="Old", starts_at=at(1), ends_at=at(1, 13), time_zone="UTC",
                       meet_url="x", calendar_event_id="e", calendar_invite=False))
        db.commit()
        detail = client.get(f"/api/conversations/{douglas.id}").json()
        assert [m["title"] for m in detail["meetings"]] == ["Old"]
        assert detail["next_meeting_at"] is None

    def test_errors_from_google_are_passed_on(self, client, db, scheduled):
        from app.meetings import MeetingError

        douglas, _ = emailed(db, "douglas@harvey.ai")
        scheduled.error = MeetingError(400, "Turn on the Google Calendar API")
        r = client.post(f"/api/conversations/{douglas.id}/meeting", json=self.BODY)
        assert (r.status_code, r.json()["detail"]) == (400, "Turn on the Google Calendar API")

    def test_unknown_contact(self, client):
        assert client.post("/api/conversations/999/meeting", json=self.BODY).status_code == 404

    @pytest.mark.parametrize(
        "change, message",
        [
            ({"starts_at": "2020-01-01T09:00:00-05:00"}, "Pick a time in the future."),
            ({"starts_at": "2030-10-07T09:00:00"}, "needs a timezone"),
            ({"time_zone": "Mars/Olympus"}, "Unknown time zone"),
            ({"time_zone": "../../etc"}, "Unknown time zone"),
            ({"duration_minutes": 0}, "greater than or equal to 5"),
            ({"title": ""}, "at least 1 character"),
        ],
    )
    def test_bad_input(self, client, db, scheduled, change, message):
        douglas, _ = emailed(db, "douglas@harvey.ai")
        r = client.post(f"/api/conversations/{douglas.id}/meeting", json={**self.BODY, **change})
        assert r.status_code == 422
        assert message in str(r.json()["detail"])
        assert scheduled == []
