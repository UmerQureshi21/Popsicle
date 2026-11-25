"""About me, notes on someone, and their coffee chat sheet as a PDF."""

from app import coffee_chat as cc
from tests import factories as f


def test_about_me_is_saved(client):
    assert client.get("/api/profile").json() == {"about": ""}
    assert client.put("/api/profile", json={"about": "Who I am:\n- A student"}).json() == {"about": "Who I am:\n- A student"}
    assert client.get("/api/profile").json()["about"] == "Who I am:\n- A student"
    assert client.put("/api/profile", json={"about": "x" * 20_001}).status_code == 422


def test_notes_are_saved_on_the_contact(client, db):
    c = f.contact(db, email="maggy@cibc.com")
    r = client.patch(f"/api/contacts/{c.id}", json={"notes": "- Ask about payments"})
    assert r.json()["notes"] == "- Ask about payments"
    assert client.patch(f"/api/contacts/{c.id}", json={"notes": "x" * 20_001}).status_code == 422


def test_notes_come_with_their_conversation(client, db):
    from datetime import datetime, timezone

    c = f.contact(db, email="maggy@cibc.com", first_name="Maggy", notes="- Ask about payments")
    f.sent_email(db, "maggy@cibc.com", datetime(2026, 11, 1, tzinfo=timezone.utc), contact=c)
    detail = client.get(f"/api/conversations/{c.id}").json()
    assert (detail["notes"], detail["coffee_chat_file"]) == ("- Ask about payments", "Coffee_Chat_With_Maggy.pdf")


def test_the_sheet_opens_in_the_browser_or_downloads(client, db, monkeypatch):
    monkeypatch.setattr(cc, "COMPRESS", False)
    c = f.contact(db, email="maggy@cibc.com", first_name="Maggy", notes="- Ask about payments")
    r = client.get(f"/api/contacts/{c.id}/coffee-chat.pdf")
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
    assert r.headers["content-disposition"] == 'inline; filename="Coffee_Chat_With_Maggy.pdf"'
    assert r.headers["cache-control"] == "no-store"
    assert b"Ask about payments" in r.content
    r = client.get(f"/api/contacts/{c.id}/coffee-chat.pdf?download=1")
    assert r.headers["content-disposition"] == 'attachment; filename="Coffee_Chat_With_Maggy.pdf"'
    assert client.get("/api/contacts/999/coffee-chat.pdf").status_code == 404
