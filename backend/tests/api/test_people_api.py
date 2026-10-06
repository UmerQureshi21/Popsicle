from datetime import datetime, timezone

from app.models import CampaignStatus, Contact, Email, EmailStatus
from tests import factories as f


class TestCompanies:
    def test_list_with_counts_most_recently_emailed_first(self, client, db):
        stripe = f.company(db, name="Stripe")
        acme = f.company(db, name="Acme")
        f.company(db, name="Zed")
        jane = f.contact(db, email="jane@stripe.com", company=stripe)
        f.contact(db, email="sam@stripe.com", company=stripe)
        ann = f.contact(db, email="ann@acme.com", company=acme)
        f.sent_email(db, "jane@stripe.com", datetime(2026, 1, 1, 12, tzinfo=timezone.utc), contact=jane)
        f.sent_email(db, "jane@stripe.com", datetime(2026, 2, 1, 12, tzinfo=timezone.utc), contact=jane)
        f.sent_email(db, "ann@acme.com", datetime(2026, 3, 1, 12, tzinfo=timezone.utc), contact=ann)

        rows = client.get("/api/companies").json()
        assert [(r["name"], r["contact_count"], r["emailed_count"]) for r in rows] == [
            ("Acme", 1, 1),
            ("Stripe", 2, 1),
            ("Zed", 0, 0),
        ]
        assert rows[1]["last_sent_at"].startswith("2026-02-01")
        assert rows[2]["last_sent_at"] is None

    def test_create(self, client):
        r = client.post("/api/companies", json={"name": "Stripe", "domain": "stripe.com"})
        assert r.status_code == 201
        assert r.json()["domain"] == "stripe.com" and r.json()["contact_count"] == 0

    def test_names_are_unique_ignoring_case(self, client, db):
        f.company(db, name="Stripe")
        r = client.post("/api/companies", json={"name": "STRIPE"})
        assert r.status_code == 409
        assert r.json()["detail"] == 'A company named "STRIPE" already exists.'

    def test_update(self, client, db):
        c = f.company(db, name="Stripe", notes="keep")
        body = client.patch(f"/api/companies/{c.id}", json={"domain": "stripe.com"}).json()
        assert (body["name"], body["domain"], body["notes"]) == ("Stripe", "stripe.com", "keep")

    def test_update_to_a_taken_name(self, client, db):
        f.company(db, name="Acme")
        c = f.company(db, name="Stripe")
        assert client.patch(f"/api/companies/{c.id}", json={"name": "acme"}).status_code == 409

    def test_update_missing(self, client):
        assert client.patch("/api/companies/999", json={}).status_code == 404

    def test_delete_keeps_contacts(self, client, db):
        company_id = f.company(db).id
        contact_id = f.contact(db, company_id=company_id).id
        assert client.delete(f"/api/companies/{company_id}").status_code == 204
        db.expire_all()
        assert db.get(Contact, contact_id).company_id is None
        assert client.delete(f"/api/companies/{company_id}").status_code == 404


class TestContacts:
    def test_list_with_sent_counts_and_latest_status(self, client, db):
        stripe = f.company(db, name="Stripe")
        jane = f.contact(db, email="jane@stripe.com", full_name="Jane Doe", company=stripe)
        f.contact(db, email="sam@acme.com", full_name="Sam Lee", title="Engineer")
        f.sent_email(db, "jane@stripe.com", datetime(2026, 1, 1, 12, tzinfo=timezone.utc), contact=jane)
        failed = f.campaign(db, [], status=CampaignStatus.COMPLETED)
        db.add(Email(campaign=failed, contact=jane, to_email="jane@stripe.com", subject="s", body="b", status=EmailStatus.FAILED))
        db.commit()

        rows = client.get("/api/contacts").json()
        assert [(r["email"], r["company_name"], r["sent_count"], r["last_status"]) for r in rows] == [
            ("jane@stripe.com", "Stripe", 1, "failed"),
            ("sam@acme.com", None, 0, None),
        ]

    def test_search_and_company_filter(self, client, db):
        stripe = f.company(db, name="Stripe")
        f.contact(db, email="jane@stripe.com", full_name="Jane Doe", company=stripe)
        f.contact(db, email="sam@acme.com", full_name="Sam Lee", title="Engineer")

        def emails(query):
            return [r["email"] for r in client.get(f"/api/contacts?{query}").json()]

        assert emails("q=JANE") == ["jane@stripe.com"]
        assert emails("q=engin") == ["sam@acme.com"]
        assert emails("q=acme.com") == ["sam@acme.com"]
        assert emails(f"company_id={stripe.id}") == ["jane@stripe.com"]
        assert emails("q=nobody") == []

    def test_update(self, client, db):
        company = f.company(db)
        c = f.contact(db, full_name="Jane")
        body = client.patch(f"/api/contacts/{c.id}", json={"title": "CTO", "company_id": company.id}).json()
        assert (body["full_name"], body["title"], body["company_name"]) == ("Jane", "CTO", "Stripe")
        assert client.patch("/api/contacts/999", json={}).status_code == 404

    def test_delete(self, client, db):
        c = f.contact(db)
        assert client.delete(f"/api/contacts/{c.id}").status_code == 204
        assert client.get("/api/contacts").json() == []
        assert client.delete(f"/api/contacts/{c.id}").status_code == 404
