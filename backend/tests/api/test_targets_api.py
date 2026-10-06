"""The target company list: statuses, pasting a list, and filling in domains. Hunter's free
company suggestions are faked by swapping hunter.company_suggestions."""

import pytest

from app import hunter
from tests import factories as f

KNOWN = {
    "meta": [{"name": "Meta", "domain": "meta.com"}, {"name": "Metabase", "domain": "metabase.com"}],
    "meta.com": [{"name": "Meta", "domain": "meta.com"}],
    "harvey": [{"name": "Harvey AI", "domain": "harvey.ai"}],  # no exact name match
    "shopify": [{"name": "Shopify", "domain": "shopify.com"}],
}


@pytest.fixture
def suggestions(monkeypatch, settings):
    """Every query Hunter was asked about, in order."""
    settings(hunter_api_key="test-key")
    asked = []

    def fake(query, limit=6):
        asked.append(query)
        if query == "boom":
            raise hunter.HunterError(502, "Couldn't reach Hunter")
        return KNOWN.get(query.lower(), [])

    monkeypatch.setattr(hunter, "company_suggestions", fake)
    return asked


class TestStatus:
    def test_new_companies_start_not_started(self, client):
        assert client.post("/api/companies", json={"name": "Stripe"}).json()["status"] == "not_started"

    def test_change_status(self, client, db):
        c = f.company(db)
        r = client.patch(f"/api/companies/{c.id}", json={"status": "replied"})
        assert r.json()["status"] == "replied"
        assert client.get("/api/companies").json()[0]["status"] == "replied"

    def test_unknown_status_is_rejected(self, client, db):
        c = f.company(db)
        assert client.patch(f"/api/companies/{c.id}", json={"status": "ghosted"}).status_code == 422


class TestBulkAdd:
    def test_names_and_domains_get_filled_in_from_hunter(self, client, suggestions):
        r = client.post("/api/companies/bulk", json={"lines": ["Meta", " shopify ", "https://www.stripe.com/jobs", "Harvey", ""]})
        assert r.status_code == 201
        body = r.json()
        assert [(c["name"], c["domain"], c["status"]) for c in body["added"]] == [
            ("Meta", "meta.com", "not_started"),
            ("shopify", "shopify.com", "not_started"),
            ("Stripe", "stripe.com", "not_started"),  # a domain Hunter doesn't know: named after it
            ("Harvey", None, "not_started"),  # no exact match, so no guessed domain
        ]
        assert body["skipped"] == []
        assert suggestions == ["Meta", "shopify", "https://www.stripe.com/jobs", "Harvey"]

    def test_a_domain_gets_hunters_name(self, client, suggestions):
        assert client.post("/api/companies/bulk", json={"lines": ["meta.com"]}).json()["added"][0]["name"] == "Meta"

    def test_skips_companies_already_listed_or_repeated(self, client, db, suggestions):
        f.company(db, name="Stripe")
        f.company(db, name="Facebook", domain="meta.com")
        body = client.post("/api/companies/bulk", json={"lines": ["stripe", "Meta", "Shopify", "SHOPIFY"]}).json()
        assert [c["name"] for c in body["added"]] == ["Shopify"]
        assert body["skipped"] == ["stripe", "Meta", "SHOPIFY"]

    def test_works_without_hunter(self, client, settings, suggestions):
        settings(hunter_api_key=None)
        body = client.post("/api/companies/bulk", json={"lines": ["Meta", "acme.io"]}).json()
        assert [(c["name"], c["domain"]) for c in body["added"]] == [("Meta", None), ("Acme", "acme.io")]
        assert suggestions == []

    def test_hunter_errors_just_leave_the_domain_empty(self, client, suggestions):
        body = client.post("/api/companies/bulk", json={"lines": ["boom"]}).json()
        assert [(c["name"], c["domain"]) for c in body["added"]] == [("boom", None)]

    def test_at_most_100_at_once(self, client):
        assert client.post("/api/companies/bulk", json={"lines": ["x"] * 101}).status_code == 422


class TestFillDomains:
    def test_fills_what_hunter_knows(self, client, db, suggestions):
        f.company(db, name="Meta")
        f.company(db, name="Harvey")
        f.company(db, name="Stripe", domain="stripe.com")
        assert client.post("/api/companies/fill-domains").json() == {"filled": 1, "missing": 1}
        assert {c["name"]: c["domain"] for c in client.get("/api/companies").json()} == {
            "Meta": "meta.com", "Harvey": None, "Stripe": "stripe.com",
        }
        assert suggestions == ["Meta", "Harvey"]

    def test_never_gives_two_companies_the_same_domain(self, client, db, suggestions):
        f.company(db, name="Facebook", domain="meta.com")
        f.company(db, name="Meta")
        assert client.post("/api/companies/fill-domains").json() == {"filled": 0, "missing": 1}

    def test_looks_up_at_most_a_batch_at_a_time(self, client, db, suggestions, monkeypatch):
        from app import targets

        monkeypatch.setattr(targets, "FILL_LIMIT", 1)
        f.company(db, name="Meta")
        f.company(db, name="Shopify")
        assert client.post("/api/companies/fill-domains").json() == {"filled": 1, "missing": 1}
        assert suggestions == ["Meta"]

    def test_needs_hunter(self, client, settings):
        settings(hunter_api_key=None)
        r = client.post("/api/companies/fill-domains")
        assert r.status_code == 400
        assert "HUNTER_API_KEY" in r.json()["detail"]
