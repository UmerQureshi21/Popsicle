"""Getting people at a company you haven't emailed yet. Hunter is faked: a company with a
known number of people, served a page at a time, so no credits are spent."""

import pytest
from sqlalchemy import select

from app import hunter
from app.models import SeenPerson
from app.routers import people_search
from tests import factories as f


@pytest.fixture
def stripe(monkeypatch):
    """Stripe has `stripe.size` people (p0@stripe.com, p1@...), in that order. Records each page asked for."""

    class Company:
        size = 30
        pages: list[tuple[int, int]] = []
        bodies: list = []
        error: Exception | None = None

    c = Company()
    c.pages, c.bodies = [], []

    def fake(path, params, body=None):
        assert path == "/domain-search"
        if c.error:
            raise c.error
        offset, limit = params["offset"], params["limit"]
        c.pages.append((offset, limit))
        c.bodies.append((params, body))
        emails = [{"value": f"p{i}@stripe.com", "first_name": f"P{i}"} for i in range(offset, min(offset + limit, c.size))]
        return {"data": {"domain": "stripe.com", "organization": "Stripe", "pattern": "{first}", "emails": emails},
                "meta": {"results": c.size, "offset": offset, "limit": limit}}

    monkeypatch.setattr(hunter, "_request", fake)
    return c


def ask(client, **body):
    r = client.post("/api/people-search/company/new", json={"query": "stripe.com", **body})
    assert r.status_code == 200, r.text
    return r.json()


def emails(res):
    return [p["email"] for p in res["people"]]


def emailed(db, *numbers):
    for n in numbers:
        f.sent_email(db, f"p{n}@stripe.com")


class TestNewPeople:
    def test_skips_people_already_emailed(self, client, db, stripe):
        emailed(db, *range(10))  # the first 10 were emailed last week
        res = ask(client, want=10)
        assert emails(res) == [f"p{i}@stripe.com" for i in range(10, 20)]
        assert (res["pages_checked"], res["pages_paid"], res["reached_end"], res["total"]) == (2, 2, False, 30)
        assert all(p["already_emailed_at"] is None for p in res["people"])
        assert (res["domain"], res["organization"]) == ("stripe.com", "Stripe")

    def test_pages_already_fetched_are_free(self, client, db, stripe):
        emailed(db, *range(10))
        ask(client, want=10)
        again = ask(client, want=10)
        assert again["pages_paid"] == 0  # both pages were saved the first time
        assert stripe.pages == [(0, 10), (10, 10)]  # Hunter was only asked once per page

    def test_hide_people_already_seen(self, client, db, stripe):
        emailed(db, *range(10))
        ask(client, want=10)  # shown p10–p19
        res = ask(client, want=10, hide_seen=True)
        assert emails(res) == [f"p{i}@stripe.com" for i in range(20, 30)]
        assert res["reached_end"] is True
        # Without the option, people seen but not emailed come back.
        assert emails(ask(client, want=10))[0] == "p10@stripe.com"

    def test_fewer_left_than_asked_for(self, client, db, stripe):
        stripe.size = 12
        emailed(db, *range(10))
        res = ask(client, want=10)
        assert emails(res) == ["p10@stripe.com", "p11@stripe.com"]
        assert res["reached_end"] is True

    def test_everyone_already_emailed(self, client, db, stripe):
        stripe.size = 5
        emailed(db, *range(5))
        res = ask(client, want=10)
        assert res["people"] == [] and res["reached_end"] is True

    def test_nobody_at_all(self, client, stripe):
        stripe.size = 0
        res = ask(client, want=10)
        assert (res["people"], res["reached_end"], res["pages_checked"]) == ([], True, 1)

    def test_stops_after_a_few_pages_per_click(self, client, db, stripe, monkeypatch):
        monkeypatch.setattr(people_search, "NEW_MAX_PAGES", 2)
        stripe.size = 500
        emailed(db, *range(20))
        res = ask(client, want=10)
        assert res["people"] == [] and res["reached_end"] is False and res["pages_checked"] == 2

    def test_stops_as_soon_as_it_has_enough(self, client, db, stripe):
        res = ask(client, want=3)
        assert emails(res) == ["p0@stripe.com", "p1@stripe.com", "p2@stripe.com"]
        assert res["pages_checked"] == 1

    def test_someone_listed_twice_counts_once(self, client, db, stripe, monkeypatch):
        real = hunter._request

        def shifted(path, params, body=None):
            res = real(path, params, body)
            if params["offset"] == 10:  # Hunter's order moved: p9 shows up again on page 2
                res["data"]["emails"].insert(0, {"value": "p9@stripe.com"})
            return res

        monkeypatch.setattr(hunter, "_request", shifted)
        res = ask(client, want=12)
        assert emails(res).count("p9@stripe.com") == 1 and len(res["people"]) == 12

    def test_uses_the_search_filters(self, client, stripe):
        ask(client, want=5, job_titles="software engineer", location=[{"city": "Toronto", "country": "CA"}])
        params, body = stripe.bodies[0]
        assert params["job_titles"] == "software engineer"
        assert body == {"location": {"include": [{"city": "Toronto", "country": "CA"}]}}

    def test_hunter_errors_are_passed_on(self, client, stripe):
        stripe.error = hunter.HunterError(429, "You've used all your Hunter credits for this month.")
        r = client.post("/api/people-search/company/new", json={"query": "stripe.com"})
        assert (r.status_code, r.json()["detail"]) == (429, "You've used all your Hunter credits for this month.")

    @pytest.mark.parametrize("want", [0, 26])
    def test_how_many(self, client, want):
        assert client.post("/api/people-search/company/new", json={"query": "stripe.com", "want": want}).status_code == 422


def test_a_regular_search_remembers_who_was_shown(client, db, stripe):
    client.post("/api/people-search/company", json={"query": "stripe.com", "limit": 3})
    assert sorted(db.scalars(select(SeenPerson.email))) == ["p0@stripe.com", "p1@stripe.com", "p2@stripe.com"]
    # Showing them again doesn't trip over the ones already noted.
    client.post("/api/people-search/company", json={"query": "stripe.com", "limit": 3, "refresh": True})
    assert len(db.scalars(select(SeenPerson.email)).all()) == 3
