"""Outside data can't become code in the app, extra email recipients, or a different Gmail search;
and other websites can't make changes on your behalf."""

import pytest

from app.models import Contact
from tests import factories as f

DRAFT = {
    "company": "Stripe", "subject": "Hi {{first_name}}", "body": "Hello", "variables": ["full_name", "email", "linkedin"],
    "rows": [], "attachment_ids": [], "skip_already_sent": False, "delay_seconds": 30,
}


class TestLinks:
    def test_a_company_link_must_be_a_web_address(self, client, db):
        r = client.post("/api/companies", json={"name": "Evil", "linkedin_url": "javascript:alert(document.cookie)"})
        assert r.status_code == 422
        ok = client.post("/api/companies", json={"name": "Stripe", "linkedin_url": "linkedin.com/company/stripe"}).json()
        assert ok["linkedin_url"] == "https://linkedin.com/company/stripe"
        assert client.patch(f"/api/companies/{ok['id']}", json={"linkedin_url": "data:text/html,x"}).status_code == 422

    def test_a_contact_link_must_be_a_web_address(self, client, db):
        c = f.contact(db)
        assert client.patch(f"/api/contacts/{c.id}", json={"linkedin_url": "javascript:alert(1)"}).status_code == 422
        assert client.patch(f"/api/contacts/{c.id}", json={"linkedin_url": ""}).json()["linkedin_url"] is None

    def test_a_bad_link_in_a_recipient_table_isnt_stored(self, client, db, started):
        draft = {**DRAFT, "rows": [{"full_name": "Jane Doe", "email": "jane@stripe.com", "linkedin": "javascript:alert(1)"}]}
        assert client.post("/api/campaigns", json=draft).status_code == 201
        assert db.query(Contact).one().linkedin_url is None


class TestEmailHeaders:
    def preview(self, client, rows, subject="Hi {{first_name}}"):
        return client.post("/api/campaigns/preview", json={**DRAFT, "subject": subject, "rows": rows}).json()["items"]

    def test_an_address_that_would_reach_extra_people_is_invalid(self, client):
        (item,) = self.preview(client, [{"full_name": "A", "email": "a,victim@x.com", "linkedin": ""}])
        assert item["status"] == "invalid"
        assert "is not a valid email" in item["issues"][0]

    def test_a_line_break_in_the_subject_is_caught_before_sending(self, client):
        rows = [{"full_name": "Jane\nBcc: x@y.com", "email": "jane@stripe.com", "linkedin": ""}]
        (item,) = self.preview(client, rows, subject="Hi {{full_name}}")
        assert item["status"] == "invalid"
        assert any("line break" in i for i in item["issues"])

    def test_a_meeting_title_is_one_line(self, client, db):
        c = f.contact(db)
        body = {"title": "Coffee\nBcc: x@y.com", "starts_at": "2030-10-07T09:00:00-04:00", "duration_minutes": 30,
                "time_zone": "America/Toronto", "message": "{{meet_link}}"}
        r = client.post(f"/api/conversations/{c.id}/meeting", json=body)
        assert r.status_code == 422 and "line break" in str(r.json())


class TestOtherWebsites:
    def test_changes_from_another_website_are_refused(self, client):
        r = client.post("/api/companies", json={"name": "Stripe"}, headers={"origin": "https://evil.example"})
        assert (r.status_code, r.json()["detail"]) == (403, "Requests from other websites aren't allowed.")
        assert client.delete("/api/companies/1", headers={"origin": "https://evil.example"}).status_code == 403

    @pytest.mark.parametrize("headers", [{"origin": "http://localhost:3000"}, {"origin": "http://localhost:3000/"}, {}])
    def test_changes_from_popsicle_itself_are_allowed(self, client, headers):
        assert client.post("/api/companies", json={"name": "Stripe"}, headers=headers).status_code == 201

    def test_reading_is_unaffected(self, client):
        assert client.get("/api/companies", headers={"origin": "https://evil.example"}).status_code == 200


def test_the_gmail_error_is_encoded_in_the_redirect(client):
    r = client.get("/api/gmail/callback?error=x%26gmail%3Dconnected", follow_redirects=False)
    assert r.headers["location"] == "http://localhost:3000/compose?gmail_error=x%26gmail%3Dconnected"


def test_odd_addresses_are_left_out_of_gmail_searches():
    from app.conversations import _query

    q = _query(["jane@stripe.com", "x@y.com)OR(label:inbox"])
    assert q == 'from:("jane@stripe.com") OR to:("jane@stripe.com") OR cc:("jane@stripe.com")'
