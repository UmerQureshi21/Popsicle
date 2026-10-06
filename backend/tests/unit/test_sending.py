"""The daily send limit: what counts toward it, and when there's room again."""

from datetime import timedelta

import pytest

from app import sending
from app.models import EmailStatus, SendingSettings
from tests import factories as f


def set_limit(db, daily_limit, min_delay_seconds=0.0):
    s = sending.get_settings(db)
    s.daily_limit, s.min_delay_seconds = daily_limit, min_delay_seconds
    db.commit()


def test_defaults_are_created_the_first_time(db):
    s = sending.get_settings(db)
    assert (s.id, s.daily_limit, s.min_delay_seconds) == (1, 40, 20.0)
    assert db.get(SendingSettings, 1) is s
    assert sending.get_settings(db) is s  # not created twice


def test_only_sent_emails_in_the_last_24_hours_count(db):
    now = sending.now()
    f.sent_email(db, "recent@x.com", when=now - timedelta(hours=1))
    f.sent_email(db, "old@x.com", when=now - timedelta(hours=25))
    f.campaign(db, [("failed@x.com", EmailStatus.FAILED), ("pending@x.com", EmailStatus.PENDING)])

    q = sending.quota(db)
    assert (q.daily_limit, q.sent_last_24h, q.remaining) == (40, 1, 39)
    assert abs((q.next_slot_at - now).total_seconds()) < 5  # room right now


def test_at_the_limit_the_next_slot_is_when_the_oldest_send_ages_out(db):
    set_limit(db, 2)
    now = sending.now()
    oldest = now - timedelta(hours=20)
    f.sent_email(db, "a@x.com", when=oldest)
    f.sent_email(db, "b@x.com", when=now - timedelta(hours=1))

    q = sending.quota(db)
    assert (q.sent_last_24h, q.remaining) == (2, 0)
    assert q.next_slot_at == oldest + timedelta(hours=24)


def test_after_lowering_the_limit_enough_sends_must_age_out(db):
    # 3 sends in the window but a limit of 1: room only once the 3rd-oldest... i.e. two of them age out.
    set_limit(db, 1)
    now = sending.now()
    times = [now - timedelta(hours=h) for h in (23, 10, 2)]
    for i, t in enumerate(times):
        f.sent_email(db, f"p{i}@x.com", when=t)

    q = sending.quota(db)
    assert q.remaining == 0
    assert q.next_slot_at == times[2] + timedelta(hours=24)


@pytest.mark.parametrize("limit,expected_remaining", [(5, 4), (1, 0)])
def test_remaining_never_goes_negative(db, limit, expected_remaining):
    set_limit(db, limit)
    f.sent_email(db, "a@x.com")
    assert sending.quota(db).remaining == expected_remaining


def test_when_waiting_emails_can_start(db):
    set_limit(db, 3)
    now = sending.now()
    first = now - timedelta(hours=5)
    f.sent_email(db, "a@x.com", when=first)

    q = sending.quota(db)  # 2 of 3 left
    assert q.oldest_sent_at == first
    assert q.later_from(2) == first + sending.WINDOW  # fill the limit now, then wait for the oldest to age out
    assert q.later_from(0) == q.next_slot_at


def test_later_from_with_nothing_sent_yet(db):
    set_limit(db, 2)
    q = sending.quota(db)
    assert q.oldest_sent_at is None
    assert abs((q.later_from(2) - (sending.now() + sending.WINDOW)).total_seconds()) < 5


def test_later_from_when_the_limit_is_already_used_up(db):
    set_limit(db, 1)
    f.sent_email(db, "a@x.com")
    q = sending.quota(db)
    assert q.later_from(0) == q.next_slot_at
