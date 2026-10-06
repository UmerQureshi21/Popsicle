"""Verifying addresses from the review screen, and skipping ones that don't exist."""

from datetime import timedelta

from app import hunter, verification
from app.models import EmailStatus, EmailVerification
from tests import factories as f


def draft(rows):
    return {"subject": "Hi", "body": "Hello {{first_name}}", "variables": ["full_name", "email"], "rows": rows, "company": "Stripe"}


ROWS = [{"full_name": "Jane Doe", "email": "jane@stripe.com"}, {"full_name": "Gone Person", "email": "gone@stripe.com"}]


def verdict(db, email, status, days_ago=0):
    db.add(EmailVerification(email=email, status=status, score=50, checked_at=verification.now() - timedelta(days=days_ago)))
    db.commit()


def test_verify_endpoint(client, db, monkeypatch):
    verdict(db, "known@x.com", "accept_all")
    answers = {"new@x.com": {"status": "valid", "score": 96}, "slow@x.com": None}
    monkeypatch.setattr(hunter, "verify_email", lambda a: answers[a])

    body = client.post("/api/people-search/verify", json={"emails": ["known@x.com", "new@x.com", "slow@x.com"]}).json()
    got = {r["email"]: (r["status"], r["score"], r["cached"]) for r in body["results"]}
    assert got == {"known@x.com": ("accept_all", 50, True), "new@x.com": ("valid", 96, False), "slow@x.com": ("pending", None, False)}


def test_verify_needs_at_least_one_address(client):
    assert client.post("/api/people-search/verify", json={"emails": []}).status_code == 422


def test_hunter_errors_come_through(client, monkeypatch):
    def out_of_checks(address):
        raise hunter.HunterError(429, "You've used all your Hunter credits for this month.")

    monkeypatch.setattr(hunter, "verify_email", out_of_checks)
    r = client.post("/api/people-search/verify", json={"emails": ["a@x.com"]})
    assert (r.status_code, r.json()["detail"]) == (429, "You've used all your Hunter credits for this month.")


def test_preview_shows_verdicts_and_marks_addresses_that_dont_exist(client, db):
    verdict(db, "jane@stripe.com", "valid")
    verdict(db, "gone@stripe.com", "invalid")
    p = client.post("/api/campaigns/preview", json=draft(ROWS)).json()

    jane, gone = p["items"]
    assert (jane["status"], jane["verification"]["status"]) == ("ready", "valid")
    assert (gone["status"], gone["verification"]["status"]) == ("undeliverable", "invalid")
    assert (p["ready"], p["undeliverable"], p["sends_now"]) == (1, 1, 1)


def test_old_verdicts_are_ignored(client, db):
    verdict(db, "gone@stripe.com", "invalid", days_ago=40)
    gone = client.post("/api/campaigns/preview", json=draft(ROWS)).json()["items"][1]
    assert (gone["status"], gone["verification"]) == ("ready", None)


def test_sending_skips_addresses_that_dont_exist(client, db):
    verdict(db, "gone@stripe.com", "invalid")
    c = client.post("/api/campaigns", json=draft(ROWS)).json()
    by_email = {e["to_email"]: e for e in c["emails"]}
    assert by_email["jane@stripe.com"]["status"] == EmailStatus.PENDING
    assert by_email["gone@stripe.com"]["status"] == EmailStatus.SKIPPED
    assert by_email["gone@stripe.com"]["error"].startswith("Hunter says this address doesn't exist (checked ")


def test_already_emailed_wins_over_undeliverable(client, db):
    f.sent_email(db, "gone@stripe.com")
    verdict(db, "gone@stripe.com", "invalid")
    gone = client.post("/api/campaigns/preview", json=draft(ROWS)).json()["items"][1]
    assert gone["status"] == "already_sent"


def test_nothing_left_to_send(client, db):
    f.sent_email(db, "jane@stripe.com")
    verdict(db, "gone@stripe.com", "invalid")
    r = client.post("/api/campaigns", json=draft(ROWS))
    assert r.status_code == 422
    assert r.json()["detail"] == "No one left to email: everyone here was already emailed or has an address that doesn't exist."
