"""Saving and reusing Hunter's verdicts on whether addresses exist. Hunter is swapped out."""

from datetime import timedelta

import pytest

from app import hunter, verification
from app.models import EmailVerification


@pytest.fixture
def verdicts(monkeypatch):
    """Replace hunter.verify_email with canned answers by address; records who was checked."""

    class Fake(dict):
        checked: list = []

    fake = Fake()
    fake.checked = []

    def verify_email(address):
        fake.checked.append(address)
        return fake.get(address, {"status": "valid", "score": 95})

    monkeypatch.setattr(hunter, "verify_email", verify_email)
    return fake


def saved(db, email, status="valid", age=timedelta(0)):
    v = EmailVerification(email=email, status=status, score=90, checked_at=verification.now() - age)
    db.add(v)
    db.commit()
    return v


def test_fresh_only_returns_recent_verdicts(db):
    saved(db, "recent@x.com", age=timedelta(days=29))
    saved(db, "stale@x.com", age=timedelta(days=31))
    assert set(verification.fresh(db, ["Recent@X.com ", "stale@x.com", "", "never@x.com"])) == {"recent@x.com"}
    assert verification.fresh(db, ["", "  "]) == {}


def test_checks_new_addresses_and_saves_the_result(db, verdicts):
    verdicts["gone@x.com"] = {"status": "invalid", "score": 0}
    results = verification.verify(db, ["Gone@X.com", "ok@x.com", "gone@x.com"])

    assert verdicts.checked == ["gone@x.com", "ok@x.com"]  # normalised and de-duplicated
    assert [(a, v.status, cached) for a, v, cached in results] == [("gone@x.com", "invalid", False), ("ok@x.com", "valid", False)]
    assert db.get(EmailVerification, "gone@x.com").status == "invalid"


def test_saved_verdicts_are_reused_for_free(db, verdicts):
    saved(db, "known@x.com", status="accept_all")
    [(address, v, cached)] = verification.verify(db, ["known@x.com"])
    assert (address, v.status, cached) == ("known@x.com", "accept_all", True)
    assert verdicts.checked == []


def test_refresh_checks_again_and_updates(db, verdicts):
    saved(db, "known@x.com", status="unknown")
    verdicts["known@x.com"] = {"status": "valid", "score": 99}
    [(_, v, cached)] = verification.verify(db, ["known@x.com"], refresh=True)
    assert (v.status, v.score, cached) == ("valid", 99, False)
    assert db.get(EmailVerification, "known@x.com").status == "valid"


def test_still_checking_is_reported_and_not_saved(db, monkeypatch):
    monkeypatch.setattr(hunter, "verify_email", lambda address: None)
    assert verification.verify(db, ["slow@x.com"]) == [("slow@x.com", None, False)]
    assert db.get(EmailVerification, "slow@x.com") is None


def test_missing_status_counts_as_unknown(db, verdicts):
    verdicts["odd@x.com"] = {}
    [(_, v, _)] = verification.verify(db, ["odd@x.com"])
    assert v.status == "unknown"


def test_checks_several_at_once(db, monkeypatch):
    import threading

    together = threading.Barrier(3, timeout=5)  # only passes if 3 checks run at the same time

    def verify_email(address):
        together.wait()
        return {"status": "valid", "score": 90}

    monkeypatch.setattr(hunter, "verify_email", verify_email)
    results = verification.verify(db, ["a@x.com", "b@x.com", "c@x.com"])
    assert [(a, v.status) for a, v, _ in results] == [("a@x.com", "valid"), ("b@x.com", "valid"), ("c@x.com", "valid")]


def test_an_error_still_saves_the_verdicts_that_came_back(db, monkeypatch):
    def verify_email(address):
        if address == "b@x.com":
            raise hunter.HunterError(429, "Out of verifications")
        return {"status": "valid", "score": 90}

    monkeypatch.setattr(hunter, "verify_email", verify_email)
    with pytest.raises(hunter.HunterError):
        verification.verify(db, ["a@x.com", "b@x.com"])
    assert set(verification.fresh(db, ["a@x.com", "b@x.com"])) == {"a@x.com"}
