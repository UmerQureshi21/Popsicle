"""Find people and Look up. Hunter is faked by swapping hunter._request (the `hunter_api`
fixture), so nothing here spends credits."""

from datetime import datetime, timezone

import pytest

from app import hunter
from app.models import Company
from tests import factories as f


@pytest.fixture
def hunter_api(monkeypatch):
    """Map Hunter paths to canned responses (a dict, or a HunterError to raise).
    Each call is recorded in hunter_api.calls as (path, params, body)."""

    class Api(dict):
        calls: list = []

    api = Api()
    api.calls = []

    def fake(path, params, body=None):
        api.calls.append((path, params, body))
        res = api[path]
        if isinstance(res, Exception):
            raise res
        return res

    monkeypatch.setattr(hunter, "_request", fake)
    return api


class TestStatus:
    def test_not_configured(self, client, settings):
        settings(hunter_api_key=None)
        assert client.get("/api/people-search/status").json()["configured"] is False

    def test_credits(self, client, hunter_api):
        hunter_api["/account"] = {
            "data": {
                "plan_name": "Free",
                "reset_date": "2026-11-02",
                "requests": {"credits": {"used": 3.0, "available": 50.0, "remaining": 47.0}},
            }
        }
        assert client.get("/api/people-search/status").json() == {
            "configured": True, "plan_name": "Free", "credits_used": 3, "credits_total": 50,
            "credits_remaining": 47, "reset_date": "2026-11-02", "error": None,
        }

    def test_remaining_is_worked_out_when_missing(self, client, hunter_api):
        hunter_api["/account"] = {"data": {"requests": {"credits": {"used": 10, "available": 50}}}}
        assert client.get("/api/people-search/status").json()["credits_remaining"] == 40

    def test_no_credit_info(self, client, hunter_api):
        hunter_api["/account"] = {"data": {}}
        body = client.get("/api/people-search/status").json()
        assert (body["credits_used"], body["credits_total"], body["credits_remaining"]) == (None, None, None)

    def test_hunter_error_is_reported_not_raised(self, client, hunter_api):
        hunter_api["/account"] = hunter.HunterError(401, "Hunter rejected the API key.")
        r = client.get("/api/people-search/status")
        assert r.status_code == 200
        assert r.json()["error"] == "Hunter rejected the API key."


class TestSuggest:
    def test_short_queries_are_not_sent(self, client, hunter_api):
        assert client.get("/api/people-search/suggest?q=s").json() == []
        assert client.get("/api/people-search/suggest").json() == []
        assert hunter_api.calls == []

    def test_suggestions(self, client, hunter_api):
        hunter_api["/domains-suggestion"] = {
            "data": [{"name": "Stripe", "domain": "stripe.com", "logo": "https://logos.hunter.io/stripe.com", "email_count": 900}]
        }
        assert client.get("/api/people-search/suggest?q=stri").json() == [
            {"name": "Stripe", "domain": "stripe.com", "logo": "https://logos.hunter.io/stripe.com", "email_count": 900}
        ]

    @pytest.mark.parametrize("hunter_status, status", [(429, 429), (0, 502), (700, 502)])
    def test_hunter_errors_become_http_errors(self, client, hunter_api, hunter_status, status):
        hunter_api["/domains-suggestion"] = hunter.HunterError(hunter_status, "nope")
        r = client.get("/api/people-search/suggest?q=stripe")
        assert (r.status_code, r.json()["detail"]) == (status, "nope")


class TestCount:
    def test_count(self, client, hunter_api):
        hunter_api["/email-count"] = {
            "data": {"personal_emails": 120, "total": 150, "department": {"it": 50, "sales": 0}, "seniority": {"senior": 7, "junior": None}}
        }
        assert client.get("/api/people-search/count?query=stripe.com").json() == {
            "total": 120, "by_department": {"it": 50}, "by_seniority": {"senior": 7},
        }

    def test_falls_back_to_total_then_zero(self, client, hunter_api):
        hunter_api["/email-count"] = {"data": {"total": 5}}
        assert client.get("/api/people-search/count?query=x").json()["total"] == 5
        hunter_api["/email-count"] = {"data": {}}
        assert client.get("/api/people-search/count?query=y").json() == {"total": 0, "by_department": {}, "by_seniority": {}}


SEARCH_RESULT = {
    "data": {
        "domain": "stripe.com",
        "organization": "Stripe",
        "pattern": "{first}",
        "emails": [
            {
                "value": "Jane@Stripe.com", "first_name": "Jane", "last_name": "Doe", "position": "Engineer",
                "department": "it", "seniority": "senior", "confidence": 97,
                "verification": {"status": "valid"}, "linkedin": "https://linkedin.com/in/jane",
            },
            {"value": "sam@stripe.com", "first_name": "Sam", "confidence": None},
            {"value": None, "first_name": "No email"},
        ],
    },
    "meta": {"results": 42, "offset": 0, "limit": 10},
}


class TestSearchCompany:
    def test_people_with_already_emailed_dates(self, client, db, hunter_api):
        hunter_api["/domain-search"] = SEARCH_RESULT
        f.sent_email(db, "jane@stripe.com", datetime(2026, 3, 1, 12, tzinfo=timezone.utc))

        body = client.post(
            "/api/people-search/company",
            json={"query": "stripe.com", "job_titles": "engineer", "location": [{"city": "Toronto", "country": "CA"}]},
        ).json()

        assert (body["domain"], body["organization"], body["pattern"], body["total"], body["cached"]) == (
            "stripe.com", "Stripe", "{first}", 42, False,
        )
        jane, sam = body["people"]
        assert jane == {
            "email": "jane@stripe.com", "first_name": "Jane", "last_name": "Doe", "full_name": "Jane Doe",
            "position": "Engineer", "department": "it", "seniority": "senior", "confidence": 97,
            "verification_status": "valid", "linkedin_url": "https://linkedin.com/in/jane",
            "already_emailed_at": jane["already_emailed_at"],
        }
        assert jane["already_emailed_at"].startswith("2026-03-01")
        assert (sam["full_name"], sam["already_emailed_at"], sam["verification_status"]) == ("Sam", None, None)
        _, params, location = hunter_api.calls[0]
        assert params["job_titles"] == "engineer"
        assert location == {"location": {"include": [{"city": "Toronto", "country": "CA"}]}}

    def test_repeat_search_is_cached(self, client, hunter_api):
        hunter_api["/domain-search"] = SEARCH_RESULT
        client.post("/api/people-search/company", json={"query": "stripe.com"})
        assert client.post("/api/people-search/company", json={"query": "stripe.com"}).json()["cached"] is True
        assert len(hunter_api.calls) == 1

    def test_saves_the_domain_on_a_known_company(self, client, db, hunter_api):
        hunter_api["/domain-search"] = SEARCH_RESULT
        company = f.company(db, name="stripe")
        known = f.company(db, name="Acme", domain="acme.com")
        client.post("/api/people-search/company", json={"query": "Stripe"})
        db.expire_all()
        assert db.get(Company, company.id).domain == "stripe.com"
        assert db.get(Company, known.id).domain == "acme.com"

    def test_nothing_found(self, client, hunter_api):
        hunter_api["/domain-search"] = {"data": {"emails": []}}
        body = client.post("/api/people-search/company", json={"query": "tiny.io", "limit": 5, "offset": 5}).json()
        assert (body["people"], body["total"], body["offset"], body["limit"]) == ([], 0, 5, 5)

    def test_empty_query_is_rejected(self, client):
        assert client.post("/api/people-search/company", json={"query": ""}).status_code == 422


class TestFindPerson:
    def find(self, client, **body):
        return client.post("/api/people-search/person", json=body)

    def test_by_name_and_domain(self, client, hunter_api):
        hunter_api["/email-finder"] = {
            "data": {"email": "jane@harvey.ai", "first_name": "Jane", "last_name": "Doe", "score": 91, "domain": "harvey.ai", "company": "Harvey"}
        }
        body = self.find(client, full_name="Jane Doe", company="harvey.ai").json()
        assert body["person"]["email"] == "jane@harvey.ai"
        assert body["person"]["confidence"] == 91
        assert (body["domain"], body["company"], body["cached"]) == ("harvey.ai", "Harvey", False)

    def test_by_linkedin_alone(self, client, db, hunter_api):
        hunter_api["/email-finder"] = {"data": {"email": "jane@harvey.ai", "linkedin_url": "https://linkedin.com/in/jane-doe"}}
        f.sent_email(db, "jane@harvey.ai")
        body = self.find(client, linkedin_url="https://www.linkedin.com/in/jane-doe/").json()
        assert hunter_api.calls[0][1] == {"linkedin_handle": "jane-doe"}
        assert body["person"]["already_emailed_at"]
        assert body["person"]["linkedin_url"] == "https://linkedin.com/in/jane-doe"

    def test_the_typed_name_fills_in_when_hunter_has_none(self, client, hunter_api):
        hunter_api["/email-finder"] = {"data": {"email": "jane@harvey.ai"}}
        assert self.find(client, full_name=" Jane Doe ", company="Harvey").json()["person"]["full_name"] == "Jane Doe"

    def test_not_found(self, client, hunter_api):
        hunter_api["/email-finder"] = {"data": {"email": None}}
        body = self.find(client, full_name="Jane Doe", company="https://harvey.ai/").json()
        assert body["person"] is None
        assert body["domain"] == "harvey.ai"

    def test_not_found_by_linkedin(self, client, hunter_api):
        hunter_api["/email-finder"] = {}
        body = self.find(client, linkedin_url="linkedin.com/in/jane").json()
        assert (body["person"], body["domain"]) == (None, None)

    @pytest.mark.parametrize(
        "body, message",
        [
            ({"linkedin_url": "https://linkedin.com/company/x"}, "doesn't look like a LinkedIn profile"),
            ({"company": "harvey.ai"}, "Give a full name"),
            ({"full_name": "  ", "company": "harvey.ai"}, "Give a full name"),
            ({"full_name": "Jane Doe"}, "Add their company"),
            ({"full_name": "Jane Doe", "company": " ", "linkedin_url": " "}, "Add their company"),
        ],
    )
    def test_needs_a_linkedin_url_or_a_name_and_company(self, client, hunter_api, body, message):
        r = self.find(client, **body)
        assert r.status_code == 422
        assert message in r.json()["detail"]
        assert hunter_api.calls == []
