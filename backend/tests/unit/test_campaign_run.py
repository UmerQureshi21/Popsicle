"""Sending a campaign. `_run` is called directly (no thread) with gmail.load_credentials,
gmail.gmail_service and gmail.send swapped out, so no real email is ever sent."""

import pytest
from sqlalchemy import update

from app import campaigns, gmail
from app.db import SessionLocal
from app.models import Campaign, CampaignStatus, Email, EmailStatus
from tests import factories as f
from tests.unit.test_gmail import http_error

P, S = EmailStatus.PENDING, EmailStatus.SKIPPED


@pytest.fixture
def outbox(monkeypatch):
    """Messages 'sent' as (to, subject, body, attachment filenames). Set outbox.on_send to
    a function(to) to make a send raise or to change things mid-batch."""

    class Outbox(list):
        on_send = None

    box = Outbox()
    monkeypatch.setattr(gmail, "load_credentials", lambda db: "creds")
    monkeypatch.setattr(gmail, "gmail_service", lambda creds: "service")

    def send(service, to, subject, body, attachments):
        assert service == "service"
        if box.on_send:
            box.on_send(to)
        box.append((to, subject, body, [a.filename for a in attachments]))
        return {"id": f"msg-{len(box)}", "threadId": f"thread-{len(box)}"}

    monkeypatch.setattr(gmail, "send", send)
    # No real sleeping between sends (the account-wide minimum gap applies even with delay 0);
    # tests that care about waits replace _wait themselves.
    monkeypatch.setattr(campaigns, "_wait", lambda cid, seconds: True)
    return box


def reload(campaign_id: int) -> tuple[Campaign, list[Email]]:
    with SessionLocal() as db:
        c = db.get(Campaign, campaign_id)
        return c, list(c.emails)


def test_sends_every_pending_email_and_completes(db, outbox):
    pdf = f.attachment(db)
    c = f.campaign(db, [("a@x.com", P), ("b@x.com", S), ("c@x.com", P)], attachments=[pdf])
    campaigns._running.add(c.id)

    campaigns._run(c.id)

    assert [m[0] for m in outbox] == ["a@x.com", "c@x.com"]
    assert outbox[0][3] == ["resume.pdf"]
    campaign, emails = reload(c.id)
    assert campaign.status == CampaignStatus.COMPLETED
    assert campaign.started_at and campaign.finished_at and campaign.error is None
    assert [(e.status, e.gmail_message_id, e.gmail_thread_id) for e in emails] == [
        (EmailStatus.SENT, "msg-1", "thread-1"),
        (EmailStatus.SKIPPED, None, None),
        (EmailStatus.SENT, "msg-2", "thread-2"),
    ]
    assert all(e.sent_at for e in emails if e.status == EmailStatus.SENT)
    assert c.id not in campaigns._running


def test_one_failed_address_does_not_stop_the_batch(db, outbox):
    c = f.campaign(db, [("bad@x.com", P), ("good@x.com", P)])

    def on_send(to):
        if to == "bad@x.com":
            raise ValueError("Invalid To header")

    outbox.on_send = on_send
    campaigns._run(c.id)

    campaign, (bad, good) = reload(c.id)
    assert campaign.status == CampaignStatus.COMPLETED
    assert (bad.status, bad.error) == (EmailStatus.FAILED, "Invalid To header")
    assert good.status == EmailStatus.SENT


def test_gmail_auth_error_pauses_the_campaign(db, outbox):
    c = f.campaign(db, [("a@x.com", P), ("b@x.com", P)])

    def on_send(to):
        raise http_error(401, "Invalid credentials")

    outbox.on_send = on_send
    campaigns._run(c.id)

    campaign, emails = reload(c.id)
    assert campaign.status == CampaignStatus.INTERRUPTED
    assert "Reconnect Gmail" in campaign.error
    assert [e.status for e in emails] == [P, P]


def test_gmail_not_connected(db, monkeypatch):
    def not_connected(db):
        raise gmail.GmailNotConnected("Gmail is not connected.")

    monkeypatch.setattr(gmail, "load_credentials", not_connected)
    c = f.campaign(db)
    campaigns._run(c.id)

    campaign, (e,) = reload(c.id)
    assert (campaign.status, campaign.error) == (CampaignStatus.INTERRUPTED, "Gmail is not connected.")
    assert e.status == P


def test_cancel_partway_stops_sending(db, outbox):
    c = f.campaign(db, [("a@x.com", P), ("b@x.com", P), ("c@x.com", P)])

    def on_send(to):
        with SessionLocal() as other:
            campaigns.request_cancel(other, other.get(Campaign, c.id))

    outbox.on_send = on_send
    campaigns._run(c.id)

    campaign, emails = reload(c.id)
    assert len(outbox) == 1
    assert campaign.status == CampaignStatus.CANCELLED and campaign.finished_at
    assert [e.status for e in emails] == [EmailStatus.SENT, EmailStatus.CANCELLED, EmailStatus.CANCELLED]
    assert c.id not in campaigns._cancel_requested


def test_emails_no_longer_pending_are_not_sent(db, outbox):
    c = f.campaign(db, [("a@x.com", P), ("b@x.com", P)])
    second = c.emails[1].id

    def on_send(to):
        with SessionLocal() as other:
            other.execute(update(Email).where(Email.id == second).values(status=EmailStatus.CANCELLED))
            other.commit()

    outbox.on_send = on_send
    campaigns._run(c.id)

    assert [m[0] for m in outbox] == ["a@x.com"]
    campaign, _ = reload(c.id)
    assert campaign.status == CampaignStatus.COMPLETED


def test_waits_a_randomised_delay_between_sends(db, outbox, monkeypatch):
    waits = []
    monkeypatch.setattr(campaigns.random, "uniform", lambda lo, hi: (lo, hi))
    monkeypatch.setattr(campaigns, "_wait", lambda cid, seconds: waits.append(seconds) or True)
    c = f.campaign(db, [("a@x.com", P), ("b@x.com", P), ("c@x.com", P)], delay_seconds=30)

    campaigns._run(c.id)

    assert waits == [(15, 45), (15, 45)]  # between sends, not after the last one
    assert len(outbox) == 3


def test_a_cancelled_wait_stops_the_batch(db, outbox, monkeypatch):
    monkeypatch.setattr(campaigns, "_wait", lambda cid, seconds: False)
    c = f.campaign(db, [("a@x.com", P), ("b@x.com", P)], delay_seconds=10)
    campaigns._run(c.id)
    assert len(outbox) == 1


def test_missing_campaign_does_nothing(outbox):
    campaigns._running.add(999)
    campaigns._run(999)
    assert outbox == [] and 999 not in campaigns._running


def test_unexpected_crash_marks_it_interrupted(db, monkeypatch):
    def boom(creds):
        raise RuntimeError("discovery failed")

    monkeypatch.setattr(gmail, "load_credentials", lambda db: "creds")
    monkeypatch.setattr(gmail, "gmail_service", boom)
    c = f.campaign(db)
    campaigns._running.add(c.id)

    campaigns._run(c.id)

    campaign, _ = reload(c.id)
    assert campaign.status == CampaignStatus.INTERRUPTED
    assert campaign.error == "Unexpected error while sending; see server logs."
    assert c.id not in campaigns._running


def test_crash_after_cancel_keeps_the_cancelled_status(db, monkeypatch):
    def boom(creds):
        with SessionLocal() as other:
            other.get(Campaign, c.id).status = CampaignStatus.CANCELLED
            other.commit()
        raise RuntimeError("boom")

    monkeypatch.setattr(gmail, "load_credentials", lambda db: "creds")
    monkeypatch.setattr(gmail, "gmail_service", boom)
    c = f.campaign(db)
    campaigns._run(c.id)
    assert reload(c.id)[0].status == CampaignStatus.CANCELLED


class TestWait:
    def test_no_wait(self):
        assert campaigns._wait(1, 0) is True

    def test_short_wait(self):
        assert campaigns._wait(1, 0.01) is True

    def test_already_cancelled(self):
        campaigns._cancel_requested.add(1)
        assert campaigns._wait(1, 10) is False

    def test_cancelled_while_waiting(self, monkeypatch):
        monkeypatch.setattr(campaigns.time, "sleep", lambda s: campaigns._cancel_requested.add(1))
        assert campaigns._wait(1, 10) is False


class TestStart:
    def test_starts_one_thread_per_campaign(self, monkeypatch):
        threads = []

        class Thread:
            def __init__(self, target, args, daemon, name):
                threads.append((target, args, daemon, name))

            def start(self):
                pass

        monkeypatch.setattr(campaigns.threading, "Thread", Thread)
        campaigns._cancel_requested.add(7)
        campaigns.start(7)
        campaigns.start(7)  # already running: ignored

        assert threads == [(campaigns._run, (7,), True, "campaign-7")]
        assert campaigns.is_running(7)
        assert 7 not in campaigns._cancel_requested


def test_mark_interrupted_on_startup(db):
    queued = f.campaign(db, status=CampaignStatus.QUEUED)
    sending = f.campaign(db, status=CampaignStatus.SENDING)
    done = f.campaign(db, status=CampaignStatus.COMPLETED)

    campaigns.mark_interrupted_on_startup()

    assert reload(queued.id)[0].status == CampaignStatus.INTERRUPTED
    assert reload(sending.id)[0].error == "Server restarted while sending. Resume to continue."
    assert reload(done.id)[0].status == CampaignStatus.COMPLETED


# ---- Daily limit and pacing -----------------------------------------------------------


def _limit(db, daily_limit, min_delay_seconds=0.0):
    from app import sending

    s = sending.get_settings(db)
    s.daily_limit, s.min_delay_seconds = daily_limit, min_delay_seconds
    db.commit()


def test_waits_at_the_daily_limit_then_carries_on(db, outbox, monkeypatch):
    from datetime import timedelta

    _limit(db, 1)
    f.sent_email(db, "earlier@x.com")  # the one allowed send is used up
    c = f.campaign(db, [("a@x.com", P), ("b@x.com", P)])
    seen = []

    def fake_wait(cid, seconds):
        # Record the status while waiting, then let time pass: everything sent so far ages out.
        with SessionLocal() as s:
            camp = s.get(Campaign, cid)
            seen.append((camp.status, camp.error, round(seconds)))
            s.execute(update(Email).where(Email.status == EmailStatus.SENT).values(sent_at=campaigns.now() - timedelta(days=2)))
            s.commit()
        return True

    monkeypatch.setattr(campaigns, "_wait", fake_wait)
    campaigns._run(c.id)

    assert [m[0] for m in outbox] == ["a@x.com", "b@x.com"]
    assert seen[0][0] == CampaignStatus.WAITING
    assert "daily limit of 1" in seen[0][1]
    assert 86_000 < seen[0][2] <= 86_400  # about a day: until the earlier send ages out
    campaign, emails = reload(c.id)
    assert campaign.status == CampaignStatus.COMPLETED and campaign.error is None
    assert all(e.status == EmailStatus.SENT for e in emails)


def test_cancelled_while_waiting_for_the_limit(db, outbox, monkeypatch):
    _limit(db, 1)
    f.sent_email(db, "earlier@x.com")
    c = f.campaign(db, [("a@x.com", P)])

    def cancel_while_waiting(cid, seconds):
        with SessionLocal() as s:
            campaigns.request_cancel(s, s.get(Campaign, cid))
        return False

    monkeypatch.setattr(campaigns, "_wait", cancel_while_waiting)
    campaigns._run(c.id)

    assert outbox == []
    campaign, (email,) = reload(c.id)
    assert campaign.status == CampaignStatus.CANCELLED
    assert email.status == EmailStatus.CANCELLED


def test_minimum_gap_applies_even_without_a_batch_delay(db, outbox, monkeypatch):
    _limit(db, 40, min_delay_seconds=20)
    waits = []
    monkeypatch.setattr(campaigns.random, "uniform", lambda lo, hi: (lo, hi))
    monkeypatch.setattr(campaigns, "_wait", lambda cid, seconds: waits.append(seconds) or True)
    c = f.campaign(db, [("a@x.com", P), ("b@x.com", P)], delay_seconds=0)

    campaigns._run(c.id)

    assert waits == [(10, 30)]  # 20s gap, randomised ±50%
    assert len(outbox) == 2


def test_no_gap_when_both_are_zero(db, outbox, monkeypatch):
    _limit(db, 40, min_delay_seconds=0)
    waits = []
    monkeypatch.setattr(campaigns, "_wait", lambda cid, seconds: waits.append(seconds) or True)
    c = f.campaign(db, [("a@x.com", P), ("b@x.com", P)], delay_seconds=0)
    campaigns._run(c.id)
    assert waits == [] and len(outbox) == 2


def test_waiting_batches_pick_up_again_after_a_restart(db, started):
    waiting = f.campaign(db, status=CampaignStatus.WAITING)
    f.campaign(db, status=CampaignStatus.COMPLETED)
    campaigns.resume_on_startup()
    assert started == [waiting.id]


# ---- Scheduled sending ------------------------------------------------------------------


def test_waits_until_the_scheduled_time_then_sends(db, outbox, monkeypatch):
    from datetime import timedelta

    when = campaigns.now() + timedelta(hours=10)
    c = f.campaign(db, [("a@x.com", P)], status=CampaignStatus.SCHEDULED, scheduled_for=when)
    seen = []

    def fake_wait(cid, seconds):
        with SessionLocal() as s:
            seen.append((s.get(Campaign, cid).status, round(seconds / 3600)))
            # Time passes: pretend it's now the scheduled time.
            s.execute(update(Campaign).where(Campaign.id == cid).values(scheduled_for=campaigns.now()))
            s.commit()
        return True

    monkeypatch.setattr(campaigns, "_wait", fake_wait)
    campaigns._run(c.id)

    assert seen == [(CampaignStatus.SCHEDULED, 10)]
    assert [m[0] for m in outbox] == ["a@x.com"]
    campaign, _ = reload(c.id)
    assert campaign.status == CampaignStatus.COMPLETED


def test_cancelled_while_scheduled(db, outbox, monkeypatch):
    from datetime import timedelta

    c = f.campaign(db, [("a@x.com", P)], status=CampaignStatus.SCHEDULED, scheduled_for=campaigns.now() + timedelta(days=1))

    def cancel(cid, seconds):
        with SessionLocal() as s:
            campaigns.request_cancel(s, s.get(Campaign, cid))
        return False

    monkeypatch.setattr(campaigns, "_wait", cancel)
    campaigns._run(c.id)

    assert outbox == []
    campaign, (email,) = reload(c.id)
    assert (campaign.status, email.status) == (CampaignStatus.CANCELLED, EmailStatus.CANCELLED)


def test_a_schedule_already_in_the_past_sends_straight_away(db, outbox, monkeypatch):
    from datetime import timedelta

    waits = []
    monkeypatch.setattr(campaigns, "_wait", lambda cid, s: waits.append(s) or True)
    c = f.campaign(db, [("a@x.com", P)], status=CampaignStatus.SCHEDULED, scheduled_for=campaigns.now() - timedelta(minutes=5))
    campaigns._run(c.id)
    assert waits == [] and len(outbox) == 1


def test_scheduled_batches_pick_up_again_after_a_restart(db, started):
    scheduled = f.campaign(db, status=CampaignStatus.SCHEDULED)
    campaigns.resume_on_startup()
    assert started == [scheduled.id]


class TestWake:
    def test_wake_ends_the_wait_early(self):
        campaigns._wake_requested.add(1)
        assert campaigns._wait(1, 10) is True
        assert 1 not in campaigns._wake_requested

    def test_send_now_on_a_running_batch_sets_the_wake_flag(self, db):
        c = f.campaign(db, status=CampaignStatus.SCHEDULED)
        campaigns._running.add(c.id)
        campaigns.send_now(db, c)
        assert c.id in campaigns._wake_requested


class TestCompanyStatus:
    def test_first_send_marks_the_company_emailed(self, db, outbox):
        stripe = f.company(db, name="Stripe")
        c = f.campaign(db, [("a@x.com", P)], company=stripe)
        campaigns._run(c.id)
        db.refresh(stripe)
        assert stripe.status == "emailed"

    def test_a_status_you_set_is_kept(self, db, outbox):
        stripe = f.company(db, name="Stripe", status="replied")
        c = f.campaign(db, [("a@x.com", P)], company=stripe)
        campaigns._run(c.id)
        db.refresh(stripe)
        assert stripe.status == "replied"

    def test_nothing_sent_leaves_it_not_started(self, db, outbox):
        stripe = f.company(db, name="Stripe")
        c = f.campaign(db, [("bad@x.com", P)], company=stripe)

        def fail(to):
            raise ValueError("Invalid To header")

        outbox.on_send = fail
        campaigns._run(c.id)
        db.refresh(stripe)
        assert stripe.status == "not_started"
