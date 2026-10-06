"""The Hunter client. `_request` itself is tested against faked HTTP (responses); everything
above it swaps out `_request`, so no test ever reaches Hunter or spends credits."""

from datetime import datetime, timedelta, timezone

import pytest
import requests
import responses
from sqlalchemy import select

from app import hunter
from app.models import HunterLookup


@pytest.fixture
def calls(monkeypatch):
    """Replace hunter._request: records (path, params, body) and returns {"data": {...}}."""
    made: list[tuple] = []

    def fake(path, params, body=None):
        made.append((path, params, body))
        return {"data": {"call": len(made)}}

    monkeypatch.setattr(hunter, "_request", fake)
    return made


class TestRequest:
    @responses.activate
    def test_get_with_key_and_without_empty_params(self):
        responses.get(hunter.BASE_URL + "/account", json={"data": {"ok": 1}})
        assert hunter._request("/account", {"a": "1", "b": None, "c": ""}) == {"data": {"ok": 1}}
        call = responses.calls[0].request
        assert call.method == "GET"
        assert call.url.endswith("/account?a=1")
        assert call.headers["X-API-KEY"] == "test-hunter-key"

    @responses.activate
    def test_post_when_there_is_a_body(self):
        responses.post(hunter.BASE_URL + "/domain-search", json={"data": {}})
        hunter._request("/domain-search", {"domain": "stripe.com"}, {"location": {"include": [{"country": "CA"}]}})
        call = responses.calls[0].request
        assert call.method == "POST"
        assert b'"country": "CA"' in call.body

    def test_not_configured(self, settings):
        settings(hunter_api_key=None)
        assert not hunter.configured()
        with pytest.raises(hunter.HunterError) as e:
            hunter._request("/account", {})
        assert e.value.status == 400

    @responses.activate
    @pytest.mark.parametrize("status", [401, 403, 429])
    def test_known_errors_get_friendly_messages(self, status):
        responses.get(hunter.BASE_URL + "/account", status=status, json={"errors": [{"details": "raw"}]})
        with pytest.raises(hunter.HunterError) as e:
            hunter._request("/account", {})
        assert e.value.status == status
        assert str(e.value) == hunter.ERROR_MESSAGES[status]

    @responses.activate
    def test_other_errors_use_hunters_details(self):
        responses.get(hunter.BASE_URL + "/account", status=400, json={"errors": [{"details": "Bad domain"}]})
        with pytest.raises(hunter.HunterError, match="Bad domain"):
            hunter._request("/account", {})

    @responses.activate
    def test_error_without_json_uses_body_text(self):
        responses.get(hunter.BASE_URL + "/account", status=500, body="Internal oops")
        with pytest.raises(hunter.HunterError, match="Internal oops") as e:
            hunter._request("/account", {})
        assert e.value.status == 500

    @responses.activate
    def test_error_with_empty_body(self):
        responses.get(hunter.BASE_URL + "/account", status=502, body="")
        with pytest.raises(hunter.HunterError, match="Hunter error 502"):
            hunter._request("/account", {})

    @responses.activate
    def test_network_failure(self):
        responses.get(hunter.BASE_URL + "/account", body=requests.ConnectionError("down"))
        with pytest.raises(hunter.HunterError, match="Couldn't reach Hunter") as e:
            hunter._request("/account", {})
        assert e.value.status == 502


class TestCache:
    def test_second_search_is_served_from_the_cache(self, db, calls):
        first = hunter.domain_search(db, "stripe.com")
        second = hunter.domain_search(db, "stripe.com")
        assert first == ({"data": {"call": 1}}, False)
        assert second == ({"data": {"call": 1}}, True)
        assert len(calls) == 1

    def test_refresh_fetches_again_and_updates_the_cache(self, db, calls):
        hunter.domain_search(db, "stripe.com")
        assert hunter.domain_search(db, "stripe.com", refresh=True) == ({"data": {"call": 2}}, False)
        assert db.scalars(select(HunterLookup)).one().response == {"data": {"call": 2}}

    def test_expired_entries_are_fetched_again(self, db, calls):
        hunter.domain_search(db, "stripe.com")
        hit = db.scalars(select(HunterLookup)).one()
        hit.created_at = datetime.now(timezone.utc) - hunter.CACHE_TTL - timedelta(minutes=1)
        db.commit()
        _, cached = hunter.domain_search(db, "stripe.com")
        assert not cached and len(calls) == 2

    def test_different_params_are_cached_separately(self, db, calls):
        hunter.domain_search(db, "stripe.com", limit=10)
        hunter.domain_search(db, "stripe.com", limit=25)
        assert len(calls) == 2


class TestDomainSearch:
    def test_by_domain_with_filters(self, db, calls):
        hunter.domain_search(
            db, "https://www.Stripe.com/jobs", limit=5, offset=10, department="it",
            seniority="senior", job_titles="engineer", location=[{"city": "Toronto", "country": "CA"}],
        )
        path, params, body = calls[0]
        assert path == "/domain-search"
        assert params == {
            "domain": "stripe.com", "limit": 5, "offset": 10, "type": "personal",
            "department": "it", "seniority": "senior", "job_titles": "engineer",
        }
        assert body == {"location": {"include": [{"city": "Toronto", "country": "CA"}]}}

    def test_by_company_name_without_filters(self, db, calls):
        hunter.domain_search(db, "  Stripe  ")
        _, params, body = calls[0]
        assert params == {"company": "Stripe", "limit": 10, "offset": 0, "type": "personal"}
        assert body is None


class TestEmailFinder:
    def test_by_name_and_domain(self, db, calls):
        hunter.email_finder(db, "harvey.ai", full_name=" Jane Doe ")
        assert calls[0][:2] == ("/email-finder", {"domain": "harvey.ai", "full_name": "Jane Doe"})

    def test_by_name_and_company(self, db, calls):
        hunter.email_finder(db, "Harvey", full_name="Jane Doe")
        assert calls[0][1] == {"company": "Harvey", "full_name": "Jane Doe"}

    def test_by_linkedin_only(self, db, calls):
        hunter.email_finder(db, None, linkedin_handle="jane-doe")
        hunter.email_finder(db, "  ", linkedin_handle="jane-doe-2")
        assert [c[1] for c in calls] == [{"linkedin_handle": "jane-doe"}, {"linkedin_handle": "jane-doe-2"}]


class TestFreeEndpoints:
    def test_company_suggestions_drop_entries_without_a_domain(self, monkeypatch):
        monkeypatch.setattr(
            hunter, "_request",
            lambda path, params: {"data": [{"name": "Stripe", "domain": "stripe.com"}, {"name": "No domain"}]},
        )
        assert hunter.company_suggestions(" str ") == [{"name": "Stripe", "domain": "stripe.com"}]

    def test_company_suggestions_with_no_data(self, monkeypatch):
        monkeypatch.setattr(hunter, "_request", lambda path, params: {"data": None})
        assert hunter.company_suggestions("x") == []

    def test_email_count(self, calls):
        assert hunter.email_count("stripe.com") == {"call": 1}
        assert hunter.email_count("Stripe") == {"call": 2}
        assert [c[1] for c in calls] == [
            {"domain": "stripe.com", "type": "personal"},
            {"company": "Stripe", "type": "personal"},
        ]

    def test_email_count_with_no_data(self, monkeypatch):
        monkeypatch.setattr(hunter, "_request", lambda path, params: {})
        assert hunter.email_count("x") == {}

    def test_account(self, calls):
        assert hunter.account() == {"call": 1}
        assert calls[0][0] == "/account"


@pytest.mark.parametrize(
    "query, domain",
    [
        ("stripe.com", "stripe.com"),
        ("https://www.Stripe.com/jobs?x=1", "stripe.com"),
        ("http://sub.example.co.uk", "sub.example.co.uk"),
        ("Stripe", None),
        ("stripe .com", None),
        ("", None),
    ],
)
def test_clean_domain(query, domain):
    assert hunter.clean_domain(query) == domain


@pytest.mark.parametrize(
    "value, handle",
    [
        ("https://www.linkedin.com/in/jane-doe-123/", "jane-doe-123"),
        ("linkedin.com/in/jane?trk=x", "jane"),
        ("  jane-doe_9%C3  ", "jane-doe_9%C3"),
        ("https://linkedin.com/company/stripe", None),
        ("not a handle", None),
    ],
)
def test_linkedin_handle(value, handle):
    assert hunter.linkedin_handle(value) == handle


class TestVerifyEmail:
    URL = hunter.BASE_URL + "/email-verifier"

    @responses.activate
    def test_returns_hunters_verdict(self):
        responses.get(self.URL, json={"data": {"status": "valid", "score": 97}})
        assert hunter.verify_email("jane@stripe.com") == {"status": "valid", "score": 97}
        assert responses.calls[0].request.url.endswith("email=jane%40stripe.com")

    @responses.activate
    def test_retries_while_hunter_is_still_checking(self, monkeypatch):
        sleeps = []
        monkeypatch.setattr(hunter.time, "sleep", sleeps.append)
        responses.get(self.URL, status=202, json={})
        responses.get(self.URL, json={"data": {"status": "accept_all", "score": 70}})
        assert hunter.verify_email("a@x.com") == {"status": "accept_all", "score": 70}
        assert sleeps == [hunter.VERIFY_RETRY_SECONDS]

    @responses.activate
    def test_gives_up_after_a_few_tries(self, monkeypatch):
        sleeps = []
        monkeypatch.setattr(hunter.time, "sleep", sleeps.append)
        for _ in range(hunter.VERIFY_ATTEMPTS):
            responses.get(self.URL, status=202, json={})
        assert hunter.verify_email("slow@x.com") is None
        assert len(responses.calls) == hunter.VERIFY_ATTEMPTS
        assert len(sleeps) == hunter.VERIFY_ATTEMPTS - 1  # no pointless sleep after the last try

    @responses.activate
    def test_empty_answer(self):
        responses.get(self.URL, json={})
        assert hunter.verify_email("a@x.com") == {}

    @responses.activate
    def test_out_of_verifications(self):
        responses.get(self.URL, status=429, json={"errors": [{"details": "quota"}]})
        with pytest.raises(hunter.HunterError) as e:
            hunter.verify_email("a@x.com")
        assert e.value.status == 429
