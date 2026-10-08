"""Preview, create, list, cancel, resume and delete campaigns. Sending itself is in
tests/unit/test_campaign_run.py; here campaigns.start() is replaced (the `started` fixture)."""

from datetime import datetime, timezone

from fastapi.testclient import TestClient
from sqlalchemy import select

from app import campaigns
from app.main import app
from app.models import Campaign, CampaignStatus, Company, Contact, EmailStatus
from tests import factories as f

P = EmailStatus.PENDING


def draft(**kw) -> dict:
    return {
        "company": "Stripe",
        "subject": "Hi {{first_name}}",
        "body": "Hello {{first_name}} at {{company}}",
        "variables": ["full_name", "email"],
        "rows": [{"full_name": "Jane Doe", "email": "Jane@Stripe.com"}],
        **kw,
    }


class TestPreview:
    def test_ready_row_is_rendered(self, client):
        r = client.post("/api/campaigns/preview", json=draft())
        assert r.status_code == 200
        body = r.json()
        assert (body["ready"], body["already_sent"], body["invalid"]) == (1, 0, 0)
        item = body["items"][0]
        assert item["to_email"] == "jane@stripe.com"
        assert item["subject"] == "Hi Jane"
        assert item["body"] == "Hello Jane at Stripe"
        assert item["status"] == "ready" and item["issues"] == []

    def test_invalid_rows_list_their_issues(self, client):
        rows = [
            {"full_name": "No Email", "email": ""},
            {"full_name": "Bad", "email": "not-an-email"},
            {"full_name": "Jane", "email": "jane@stripe.com"},
            {"full_name": "Jane again", "email": "JANE@stripe.com"},
            {"full_name": "", "email": "nameless@stripe.com"},
        ]
        items = client.post("/api/campaigns/preview", json=draft(rows=rows)).json()["items"]
        assert [i["status"] for i in items] == ["invalid", "invalid", "ready", "invalid", "invalid"]
        assert items[0]["issues"] == ["missing email"]
        assert items[1]["issues"] == ['"not-an-email" is not a valid email']
        assert items[3]["issues"] == ["duplicate of an earlier row"]
        assert items[4]["issues"] == ["no value for first_name"]

    def test_already_emailed_people(self, client, db):
        when = datetime(2026, 3, 1, 12, tzinfo=timezone.utc)
        f.sent_email(db, "jane@stripe.com", when)
        item = client.post("/api/campaigns/preview", json=draft()).json()["items"][0]
        assert item["status"] == "already_sent"
        assert item["last_sent_at"].startswith("2026-03-01")

        again = client.post("/api/campaigns/preview", json=draft(skip_already_sent=False)).json()
        assert again["items"][0]["status"] == "ready"

    def test_variables_must_include_email(self, client):
        r = client.post("/api/campaigns/preview", json=draft(variables=["full_name", " "]))
        assert r.status_code == 422
        assert 'must be "email"' in r.json()["detail"][0]["msg"]

    def test_delay_is_limited(self, client):
        assert client.post("/api/campaigns/preview", json=draft(delay_seconds=601)).status_code == 422


class TestCreate:
    def test_creates_the_campaign_contacts_and_company_and_starts_sending(self, client, db, started):
        pdf = f.attachment(db)
        t = f.template(db)
        rows = [
            {"full_name": "Jane Doe", "email": "jane@stripe.com", "role": "Engineer", "linkedin": "linkedin.com/in/jane"},
            {"full_name": "Sam Lee", "email": "sam@stripe.com"},
        ]
        r = client.post(
            "/api/campaigns",
            json=draft(rows=rows, variables=["full_name", "email", "role"], attachment_ids=[pdf.id], template_id=t.id, delay_seconds=5),
        )
        assert r.status_code == 201
        c = r.json()
        assert started == [c["id"]]
        assert c["name"] == "Stripe" and c["company_name"] == "Stripe"
        assert c["status"] == "queued" and c["delay_seconds"] == 5
        assert c["counts"] == {"total": 2, "pending": 2, "sent": 0, "failed": 0, "skipped": 0, "cancelled": 0}
        assert [a["filename"] for a in c["attachments"]] == ["resume.pdf"]
        assert c["emails"][0]["variables"] == {"full_name": "Jane Doe", "email": "jane@stripe.com", "role": "Engineer"}
        assert c["subject_template"] == "Hi {{first_name}}"

        jane = db.scalars(select(Contact).where(Contact.email == "jane@stripe.com")).one()
        assert (jane.full_name, jane.first_name, jane.last_name, jane.title, jane.linkedin_url) == (
            "Jane Doe", "Jane", "Doe", "Engineer", "https://linkedin.com/in/jane",
        )
        assert jane.company.name == "Stripe"
        assert db.get(Campaign, c["id"]).template_id == t.id

    def test_reuses_an_existing_company_and_contact(self, client, db):
        company = f.company(db, name="stripe")
        f.contact(db, email="jane@stripe.com", title="Manager", full_name="Jane Doe")
        c = client.post("/api/campaigns", json=draft(company="Stripe", name="Round 2")).json()
        assert c["name"] == "Round 2"
        assert c["company_id"] == company.id
        assert len(db.scalars(select(Company)).all()) == 1
        jane = db.scalars(select(Contact)).one()
        assert jane.title == "Manager"  # not blanked out
        assert jane.company_id == company.id

    def test_without_a_company(self, client, db):
        c = client.post(
            "/api/campaigns", json=draft(company="  ", body="Hello", rows=[{"full_name": "Jane", "email": "j@x.com"}])
        ).json()
        assert c["name"] == "Untitled batch" and c["company_id"] is None
        assert db.scalars(select(Contact)).one().company_id is None

    def test_already_emailed_people_are_skipped(self, client, db):
        f.sent_email(db, "jane@stripe.com", datetime(2026, 3, 1, 12, tzinfo=timezone.utc))
        rows = [{"full_name": "Jane", "email": "jane@stripe.com"}, {"full_name": "Sam", "email": "sam@stripe.com"}]
        emails = client.post("/api/campaigns", json=draft(rows=rows)).json()["emails"]
        assert [(e["status"], e["error"]) for e in emails] == [
            ("skipped", "already emailed on Mar 01, 2026"),
            ("pending", None),
        ]

    def test_invalid_rows_are_rejected(self, client, started):
        r = client.post("/api/campaigns", json=draft(rows=[{"full_name": "Jane", "email": "nope"}]))
        assert r.status_code == 422
        assert r.json()["detail"] == 'Fix these rows first: row 1: "nope" is not a valid email'
        assert started == []

    def test_nothing_to_send(self, client, db):
        f.sent_email(db, "jane@stripe.com")
        r = client.post("/api/campaigns", json=draft())
        assert r.status_code == 422
        assert r.json()["detail"] == "Everyone in this list has already been emailed."


class TestListAndGet:
    def test_newest_first_with_counts_and_company_filter(self, client, db):
        stripe = f.company(db, name="Stripe")
        old = f.campaign(db, [("a@x.com", EmailStatus.SENT), ("b@x.com", EmailStatus.FAILED)], company=stripe, name="Old")
        new = f.campaign(db, [], name="New")
        old.created_at = datetime(2020, 1, 1, tzinfo=timezone.utc)
        db.commit()

        listed = client.get("/api/campaigns").json()
        assert [c["name"] for c in listed] == ["New", "Old"]
        assert listed[1]["counts"] == {"total": 2, "pending": 0, "sent": 1, "failed": 1, "skipped": 0, "cancelled": 0}
        assert listed[1]["company_name"] == "Stripe"
        assert listed[0]["counts"]["total"] == 0

        assert [c["id"] for c in client.get(f"/api/campaigns?company_id={stripe.id}").json()] == [old.id]
        assert new.id

    def test_get_one(self, client, db):
        c = f.campaign(db)
        detail = client.get(f"/api/campaigns/{c.id}").json()
        assert detail["emails"][0]["to_email"] == "jane@stripe.com"
        assert client.get("/api/campaigns/999").status_code == 404


class TestCancel:
    def test_cancels_pending_emails(self, client, db):
        c = f.campaign(db, [("a@x.com", EmailStatus.SENT), ("b@x.com", P)], status=CampaignStatus.SENDING)
        body = client.post(f"/api/campaigns/{c.id}/cancel").json()
        assert body["status"] == "cancelled" and body["finished_at"]
        assert [e["status"] for e in body["emails"]] == ["sent", "cancelled"]
        assert c.id in campaigns._cancel_requested

    def test_finished_campaign_is_left_alone(self, client, db):
        c = f.campaign(db, [("a@x.com", EmailStatus.SENT)], status=CampaignStatus.COMPLETED)
        assert client.post(f"/api/campaigns/{c.id}/cancel").json()["status"] == "completed"

    def test_missing(self, client):
        assert client.post("/api/campaigns/999/cancel").status_code == 404


class TestResume:
    def test_resumes_an_interrupted_campaign(self, client, db, started):
        c = f.campaign(db, [("a@x.com", EmailStatus.FAILED), ("b@x.com", P)], status=CampaignStatus.INTERRUPTED)
        body = client.post(f"/api/campaigns/{c.id}/resume").json()
        assert body["status"] == "queued" and body["finished_at"] is None
        assert [e["status"] for e in body["emails"]] == ["failed", "pending"]
        assert started == [c.id]

    def test_retry_failed(self, client, db):
        c = f.campaign(db, [("a@x.com", EmailStatus.FAILED)], status=CampaignStatus.COMPLETED)
        body = client.post(f"/api/campaigns/{c.id}/resume?retry_failed=true").json()
        assert [(e["status"], e["error"]) for e in body["emails"]] == [("pending", None)]

    def test_resuming_a_cancelled_campaign_picks_the_cancelled_emails_back_up(self, client, db):
        c = f.campaign(db, [("a@x.com", EmailStatus.SENT), ("b@x.com", EmailStatus.CANCELLED)], status=CampaignStatus.CANCELLED)
        body = client.post(f"/api/campaigns/{c.id}/resume").json()
        assert [e["status"] for e in body["emails"]] == ["sent", "pending"]

    def test_already_sending(self, client, db):
        c = f.campaign(db, status=CampaignStatus.SENDING)
        campaigns._running.add(c.id)
        assert client.post(f"/api/campaigns/{c.id}/resume").status_code == 409

    def test_missing(self, client):
        assert client.post("/api/campaigns/999/resume").status_code == 404


class TestDelete:
    def test_deletes(self, client, db):
        c = f.campaign(db)
        assert client.delete(f"/api/campaigns/{c.id}").status_code == 204
        assert client.get(f"/api/campaigns/{c.id}").status_code == 404

    def test_running_campaign_must_be_cancelled_first(self, client, db):
        c = f.campaign(db)
        campaigns._running.add(c.id)
        assert client.delete(f"/api/campaigns/{c.id}").status_code == 409

    def test_missing(self, client):
        assert client.delete("/api/campaigns/999").status_code == 404


def test_startup_marks_unfinished_campaigns_interrupted(db, started, monkeypatch):
    import app.main as main

    # Not the real sweeper: it would outlive the test and wake after the test database is gone.
    monkeypatch.setattr(main, "start_sweeper", lambda: None)
    c = f.campaign(db, status=CampaignStatus.SENDING)
    with TestClient(app) as client:
        assert client.get(f"/api/campaigns/{c.id}").json()["status"] == "interrupted"
