"""Templates, attachments, the Gmail connection and stats. Google is never contacted:
gmail.start_auth and gmail.finish_auth are swapped out."""

from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app import gmail
from app.models import Attachment, EmailStatus, GmailAccount
from app.routers import misc
from tests import factories as f


class TestTemplates:
    def test_create_and_list_most_recently_updated_first(self, client):
        a = client.post("/api/templates", json={"name": "A", "subject": "s", "body": "b", "variables": ["role"]})
        assert a.status_code == 201
        client.post("/api/templates", json={"name": "B", "subject": "s", "body": "b"})
        client.put(f"/api/templates/{a.json()['id']}", json={"name": "A", "subject": "s2", "body": "b"})
        listed = client.get("/api/templates").json()
        assert [(t["name"], t["subject"]) for t in listed] == [("A", "s2"), ("B", "s")]
        assert listed[0]["variables"] == []
        assert listed[1]["variables"] == []

    def test_variables_are_saved(self, client):
        t = client.post("/api/templates", json={"name": "A", "subject": "s", "body": "b", "variables": ["role"]}).json()
        assert t["variables"] == ["role"]

    def test_duplicate_name(self, client, db):
        f.template(db, name="Intro")
        r = client.post("/api/templates", json={"name": "Intro", "subject": "s", "body": "b"})
        assert r.status_code == 409
        assert r.json()["detail"] == 'A template named "Intro" already exists.'

    def test_update(self, client, db):
        t = f.template(db, name="Intro")
        body = client.put(f"/api/templates/{t.id}", json={"name": "Intro v2", "subject": "S", "body": "B", "variables": ["x"]}).json()
        assert (body["name"], body["subject"], body["body"], body["variables"]) == ("Intro v2", "S", "B", ["x"])

    def test_update_to_a_taken_name(self, client, db):
        f.template(db, name="Taken")
        t = f.template(db, name="Intro")
        r = client.put(f"/api/templates/{t.id}", json={"name": "Taken", "subject": "s", "body": "b"})
        assert r.status_code == 409

    def test_update_missing(self, client):
        assert client.put("/api/templates/999", json={"name": "x", "subject": "s", "body": "b"}).status_code == 404

    def test_delete(self, client, db):
        t = f.template(db)
        assert client.delete(f"/api/templates/{t.id}").status_code == 204
        assert client.get("/api/templates").json() == []
        assert client.delete(f"/api/templates/{t.id}").status_code == 404


class TestAttachments:
    def test_upload(self, client, db):
        r = client.post("/api/attachments", files={"file": ("resume.pdf", b"%PDF-1.4 data", "application/pdf")})
        assert r.status_code == 201
        body = r.json()
        assert (body["filename"], body["content_type"], body["size_bytes"]) == ("resume.pdf", "application/pdf", 13)
        assert db.scalars(select(Attachment)).one().data == b"%PDF-1.4 data"

    @pytest.mark.parametrize(
        "filename, expected",
        [("resume.pdf", "application/pdf"), ("mystery", "application/octet-stream")],
    )
    def test_generic_type_is_guessed_from_the_filename(self, client, filename, expected):
        r = client.post("/api/attachments", files={"file": (filename, b"x", "application/octet-stream")})
        assert r.json()["content_type"] == expected

    def test_too_big(self, client, monkeypatch):
        monkeypatch.setattr(misc, "MAX_ATTACHMENT_BYTES", 4)
        r = client.post("/api/attachments", files={"file": ("big.bin", b"12345", "application/pdf")})
        assert r.status_code == 413

    def test_read_in_pieces_and_stopped_early(self, client, db, monkeypatch):
        from starlette.datastructures import UploadFile

        reads = []
        real = UploadFile.read

        async def counting(self, size=-1):
            reads.append(size)
            return await real(self, size)

        monkeypatch.setattr(UploadFile, "read", counting)
        monkeypatch.setattr(misc, "MAX_ATTACHMENT_BYTES", 1024 * 1024)
        r = client.post("/api/attachments", files={"file": ("big.bin", b"x" * (3 * 1024 * 1024), "application/pdf")})
        assert r.status_code == 413
        assert reads == [1024 * 1024, 1024 * 1024]  # never the whole file at once
        assert db.scalars(select(Attachment)).all() == []

    def test_a_file_bigger_than_one_piece_is_kept_whole(self, client, db):
        data = bytes(range(256)) * 5000  # ~1.2 MB
        r = client.post("/api/attachments", files={"file": ("doc.pdf", data, "application/pdf")})
        assert r.json()["size_bytes"] == len(data)
        assert db.get(Attachment, r.json()["id"]).data == data


class TestGmail:
    def test_status(self, client, db):
        assert client.get("/api/gmail/status").json() == {
            "connected": False, "email": None, "credentials_file_present": False, "can_read": False, "can_meet": False,
        }
        acct = GmailAccount(email="me@gmail.com", token_json="{}")
        db.add(acct)
        db.commit()
        status = client.get("/api/gmail/status").json()
        assert (status["email"], status["can_read"], status["can_meet"]) == ("me@gmail.com", False, False)
        acct.scopes = f"{gmail.SEND_SCOPE} {gmail.READ_SCOPE} {gmail.CALENDAR_SCOPE}"
        db.commit()
        status = client.get("/api/gmail/status").json()
        assert (status["can_read"], status["can_meet"]) == (True, True)

    def test_connect_without_credentials_file(self, client):
        r = client.get("/api/gmail/connect", follow_redirects=False)
        assert r.status_code == 400
        assert "credentials.json is missing" in r.json()["detail"]

    def test_connect_redirects_to_google(self, client, settings, tmp_path, monkeypatch):
        secrets = tmp_path / "credentials.json"
        secrets.write_text("{}")
        settings(google_client_secrets=secrets)
        seen = []
        monkeypatch.setattr(gmail, "start_auth", lambda next: seen.append(next) or "https://accounts.google.com/consent")
        r = client.get("/api/gmail/connect", follow_redirects=False)
        assert r.status_code == 307
        assert r.headers["location"] == "https://accounts.google.com/consent"
        client.get("/api/gmail/connect?next=/conversations", follow_redirects=False)
        assert seen == ["/compose", "/conversations"]

    def test_callback_returns_to_the_page_that_asked(self, client, monkeypatch):
        gmail._return_to["s2"] = "/conversations"
        monkeypatch.setattr(gmail, "finish_auth", lambda db, state, url: None)
        r = client.get("/api/gmail/callback?state=s2&code=c", follow_redirects=False)
        assert r.headers["location"] == "http://localhost:3000/conversations?gmail=connected"

    def test_callback_success(self, client, monkeypatch):
        seen = {}
        monkeypatch.setattr(gmail, "finish_auth", lambda db, state, url: seen.update(state=state, url=url))
        r = client.get("/api/gmail/callback?state=s1&code=c", follow_redirects=False)
        assert r.headers["location"] == "http://localhost:3000/compose?gmail=connected"
        assert seen["state"] == "s1"
        # Built from the public address, not the backend's internal one behind the forwarding.
        assert seen["url"] == "http://localhost:8000/api/gmail/callback?state=s1&code=c"

    def test_callback_when_the_user_declined(self, client):
        r = client.get("/api/gmail/callback?error=access_denied", follow_redirects=False)
        assert r.headers["location"] == "http://localhost:3000/compose?gmail_error=access_denied"

    def test_callback_missing_send_permission(self, client, monkeypatch):
        def finish(db, state, url):
            raise gmail.MissingSendPermission()

        monkeypatch.setattr(gmail, "finish_auth", finish)
        r = client.get("/api/gmail/callback?state=s", follow_redirects=False)
        assert r.headers["location"] == "http://localhost:3000/compose?gmail_error=missing_send_permission"

    def test_callback_other_failure(self, client):
        r = client.get("/api/gmail/callback?state=unknown", follow_redirects=False)
        assert r.headers["location"] == "http://localhost:3000/compose?gmail_error=ValueError"

    def test_disconnect(self, client, db):
        db.add(GmailAccount(email="me@gmail.com", token_json="{}"))
        db.commit()
        assert client.delete("/api/gmail").status_code == 204
        assert client.get("/api/gmail/status").json()["connected"] is False


def test_stats(client, db):
    assert client.get("/api/stats").json() == {
        "sent_total": 0, "sent_last_7_days": 0, "companies": 0, "contacts": 0, "failed_total": 0,
    }
    f.company(db)
    f.contact(db)
    f.sent_email(db, "a@x.com")
    f.sent_email(db, "b@x.com", datetime.now(timezone.utc) - timedelta(days=30))
    f.campaign(db, [("c@x.com", EmailStatus.FAILED), ("d@x.com", EmailStatus.PENDING)])
    assert client.get("/api/stats").json() == {
        "sent_total": 2, "sent_last_7_days": 1, "companies": 1, "contacts": 1, "failed_total": 1,
    }
