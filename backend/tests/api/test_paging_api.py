"""Long lists come a page at a time: Companies, Contacts, Inbox and Sent. Search, filters and
counts are worked out in the database, so they cover every row, not just the loaded page."""

import pytest

from app.models import CompanyStatus
from app.paging import PageParams, next_offset
from tests import factories as f
from tests.api.test_conversations_api import at, emailed, reply


def test_next_offset():
    page = PageParams(limit=2, offset=4)
    assert next_offset(page, 2, 10) == 6
    assert next_offset(page, 2, 6) is None  # that was the last page
    assert next_offset(page, 0, 4) is None  # past the end


@pytest.mark.parametrize("query", ["limit=0", "limit=101", "offset=-1"])
def test_page_size_is_bounded(client, query):
    for path in ("/api/companies", "/api/contacts", "/api/conversations", "/api/campaigns"):
        assert client.get(f"{path}?{query}").status_code == 422, path


def pages(client, path: str, limit: int) -> list[list[dict]]:
    """Every page of `path`, following next_offset."""
    out, offset = [], 0
    sep = "&" if "?" in path else "?"
    while offset is not None:
        body = client.get(f"{path}{sep}limit={limit}&offset={offset}").json()
        out.append(body["items"])
        offset = body["next_offset"]
    return out


class TestCompanies:
    @pytest.fixture
    def companies(self, db):
        statuses = [CompanyStatus.NOT_STARTED] * 3 + [CompanyStatus.EMAILED] * 2 + [CompanyStatus.REPLIED]
        return [
            f.company(db, name=f"Co {i}", domain=None if i % 2 else f"co{i}.com", status=s) for i, s in enumerate(statuses)
        ]

    def test_pages_cover_everyone_once(self, client, companies):
        got = pages(client, "/api/companies", 4)
        assert [len(p) for p in got] == [4, 2]
        assert sorted(c["name"] for p in got for c in p) == sorted(c.name for c in companies)

    def test_counts_cover_everyone_whatever_the_filter(self, client, companies):
        body = client.get("/api/companies?status=emailed&limit=1").json()
        assert [c["status"] for c in body["items"]] == ["emailed"]
        assert (body["total"], body["next_offset"], body["all"], body["missing_domains"]) == (2, 1, 6, 3)
        assert body["counts"] == {"not_started": 3, "emailed": 2, "replied": 1, "not_interested": 0}

    def test_search_by_name_or_domain(self, client, companies):
        body = client.get("/api/companies?q=co2.COM").json()
        assert [c["name"] for c in body["items"]] == ["Co 2"]
        assert (body["total"], body["all"], body["missing_domains"]) == (1, 1, 0)
        assert client.get("/api/companies?q=co 3").json()["items"][0]["name"] == "Co 3"
        assert client.get("/api/companies?q=%20%20").json()["total"] == 6  # blank search: everyone

    def test_names_for_suggestions(self, client, companies):
        assert client.get("/api/companies/names").json()[:2] == [{"id": companies[0].id, "name": "Co 0"}, {"id": companies[1].id, "name": "Co 1"}]


class TestContacts:
    def test_pages_and_total_with_filters(self, client, db):
        stripe = f.company(db, name="Stripe")
        for i in range(5):
            f.contact(db, email=f"p{i}@stripe.com", full_name=f"Person {i}", company=stripe if i < 3 else None)
        got = pages(client, "/api/contacts", 2)
        assert [len(p) for p in got] == [2, 2, 1]
        body = client.get(f"/api/contacts?company_id={stripe.id}&limit=2").json()
        assert (len(body["items"]), body["total"], body["next_offset"]) == (2, 3, 2)
        assert client.get("/api/contacts?q=person 4").json()["total"] == 1
        assert client.get("/api/contacts?q=%20").json()["total"] == 5


class TestConversations:
    @pytest.fixture
    def people(self, db):
        harvey = f.company(db, name="Harvey")
        douglas, _ = emailed(db, "douglas@harvey.ai", "Douglas Quan", at(1), company=harvey)
        jane, _ = emailed(db, "jane@stripe.com", "Jane Doe", at(2))
        sam, _ = emailed(db, "sam@acme.com", "Sam Lee", at(3))
        f.contact(db, email="never@x.com", full_name="Never Emailed")
        reply(db, douglas, "m1", "Happy to chat!", at(4))  # newest activity: comes first
        reply(db, jane, "m2", "following up", at(5), from_me=True)  # my own follow-up: not a reply
        return douglas, jane, sam

    def test_newest_activity_first_a_page_at_a_time(self, client, people):
        got = pages(client, "/api/conversations", 2)
        assert [[r["full_name"] for r in p] for p in got] == [["Jane Doe", "Douglas Quan"], ["Sam Lee"]]
        body = client.get("/api/conversations?limit=2").json()
        assert body["counts"] == {"all": 3, "replied": 1, "waiting": 2}
        assert (body["total"], body["next_offset"]) == (3, 2)

    def test_filters_and_search_cover_everyone(self, client, people):
        replied = client.get("/api/conversations?filter=replied").json()
        assert [r["full_name"] for r in replied["items"]] == ["Douglas Quan"]
        assert replied["total"] == 1 and replied["counts"]["all"] == 3
        waiting = client.get("/api/conversations?filter=waiting").json()
        assert [r["full_name"] for r in waiting["items"]] == ["Jane Doe", "Sam Lee"]
        assert [r["full_name"] for r in client.get("/api/conversations?q=harvey").json()["items"]] == ["Douglas Quan"]
        assert [r["full_name"] for r in client.get("/api/conversations?q=SAM@").json()["items"]] == ["Sam Lee"]
        assert client.get("/api/conversations?q=never").json()["total"] == 0  # never emailed: not in the Inbox
        assert client.get("/api/conversations?filter=nope").status_code == 422


class TestCampaigns:
    def test_newest_first_a_page_at_a_time(self, client, db):
        made = [f.campaign(db, name=f"Batch {i}") for i in range(3)]
        got = pages(client, "/api/campaigns", 2)
        assert [[c["name"] for c in p] for p in got] == [["Batch 2", "Batch 1"], ["Batch 0"]]
        assert client.get("/api/campaigns").json()["total"] == len(made)
