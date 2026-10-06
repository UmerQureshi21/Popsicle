"""The old command-line sender. Files live in a temp folder and Gmail is faked."""

import base64
import email
import sys
from types import SimpleNamespace

import pytest

import send


@pytest.fixture(autouse=True)
def files(tmp_path, monkeypatch):
    """Point the sent log, token and credentials files into a temp folder."""
    monkeypatch.setattr(send, "SENT_LOG", tmp_path / "sent_log.csv")
    monkeypatch.setattr(send, "TOKEN_FILE", tmp_path / "token.json")
    monkeypatch.setattr(send, "CREDENTIALS_FILE", tmp_path / "credentials.json")
    monkeypatch.setattr(send.time, "sleep", lambda s: None)
    return tmp_path


def write(path, text):
    path.write_text(text)
    return str(path)


class TestLoadTemplate:
    def test_subject_and_body(self, files):
        path = write(files / "t.txt", "\nSubject:  Hi {first_name} \n\nHello\n\nBye\n\n")
        assert send.load_template(path) == ("Hi {first_name}", "Hello\n\nBye\n")

    def test_needs_a_subject_line(self, files):
        with pytest.raises(SystemExit, match="must start with 'Subject:'"):
            send.load_template(write(files / "t.txt", "Hello"))


class TestLoadContacts:
    def test_names_are_split_and_vars_fill_blanks(self, files):
        path = write(
            files / "c.csv",
            "﻿Full_Name , Email,company\nJane Q Doe,jane@x.com,\nCher,cher@x.com,Acme\n,,\n",
        )
        jane, cher = send.load_contacts(path, {"company": "Stripe"})
        assert (jane["first_name"], jane["last_name"], jane["company"]) == ("Jane", "Doe", "Stripe")
        assert (cher["first_name"], cher["last_name"], cher["company"]) == ("Cher", "", "Acme")

    def test_name_column_and_given_first_last(self, files):
        path = write(files / "c.csv", "name,first_name,last_name,email\nJane Doe,Janie,D,j@x.com\n,,,k@x.com\n")
        jane, nameless = send.load_contacts(path, {})
        assert (jane["full_name"], jane["first_name"], jane["last_name"]) == ("Jane Doe", "Janie", "D")
        assert (nameless["first_name"], nameless["last_name"]) == ("", "")

    def test_missing_email(self, files):
        with pytest.raises(SystemExit, match="line 3: missing email"):
            send.load_contacts(write(files / "c.csv", "full_name,email\nJane,j@x.com\nSam,\n"), {})


def test_template_fields():
    assert send.template_fields("Hi {first_name}", "{company} {first_name} {{literal}}") == {"first_name", "company"}


def test_check_fields(files):
    send.check_fields([{"email": "a@x.com", "first_name": "A"}], "Hi {first_name}", "")
    with pytest.raises(SystemExit, match="b@x.com: no value for company, first_name"):
        send.check_fields([{"email": "b@x.com"}], "Hi {first_name}", "{company}")


def test_sent_log_round_trip(files):
    assert send.already_sent() == set()
    send.log_sent("Jane@X.com", "Hi")
    send.log_sent("sam@x.com", "Hi")
    assert send.already_sent() == {"jane@x.com", "sam@x.com"}
    assert (files / "sent_log.csv").read_text().startswith("timestamp,email,subject\n")


def test_build_message(files):
    pdf = files / "resume.pdf"
    pdf.write_bytes(b"%PDF")
    unknown = files / "blob.zzz"
    unknown.write_bytes(b"\x00")
    raw = send.build_message("j@x.com", "Hi", "Body", "Me <me@gmail.com>", [str(pdf), str(unknown)])["raw"]
    msg = email.message_from_bytes(base64.urlsafe_b64decode(raw))
    assert (msg["To"], msg["Subject"], msg["From"]) == ("j@x.com", "Hi", "Me <me@gmail.com>")
    files_ = {p.get_filename(): p.get_content_type() for p in msg.walk() if p.get_filename()}
    assert files_ == {"resume.pdf": "application/pdf", "blob.zzz": "application/octet-stream"}
    assert "From" not in email.message_from_bytes(base64.urlsafe_b64decode(send.build_message("a@x.com", "s", "b", None, [])["raw"]))


class FakeService:
    def __init__(self, fail_for=()):
        self.sent, self.fail_for = [], set(fail_for)

    def users(self):
        return self

    def messages(self):
        return self

    def send(self, userId, body):
        msg = email.message_from_bytes(base64.urlsafe_b64decode(body["raw"]))
        if msg["To"] in self.fail_for:
            raise RuntimeError("bounced")
        self.sent.append((msg["To"], msg["Subject"]))
        return SimpleNamespace(execute=lambda: {"id": "1"})


class TestMain:
    @pytest.fixture
    def setup(self, files, monkeypatch):
        write(files / "template.txt", "Subject: Hi {first_name} at {company}\n\nHello {first_name}")
        write(files / "c.csv", "full_name,email\nJane Doe,jane@x.com\nSam Lee,sam@x.com\n")
        monkeypatch.chdir(files)
        service = FakeService()
        monkeypatch.setattr(send, "gmail_service", lambda: service)

        def run(*args, answer="yes"):
            monkeypatch.setattr(sys, "argv", ["send.py", "c.csv", "--var", "company=Stripe", *args])
            monkeypatch.setattr("builtins.input", lambda prompt: answer)
            send.main()

        run.service = service
        return run

    def test_dry_run_only_previews(self, setup, capsys):
        setup()
        out = capsys.readouterr().out
        assert "Subject: Hi Jane at Stripe" in out
        assert "DRY RUN: 2 email(s) previewed. Add --send" in out
        assert setup.service.sent == []

    def test_dry_run_mentions_attachments(self, setup, files, capsys):
        write(files / "cv.pdf", "x")
        setup("--attach", "cv.pdf")
        assert "with 1 attachment(s)" in capsys.readouterr().out

    def test_send_after_confirming(self, setup, capsys):
        setup("--send", "--delay", "1")
        assert setup.service.sent == [("jane@x.com", "Hi Jane at Stripe"), ("sam@x.com", "Hi Sam at Stripe")]
        assert "Done. 2 sent, 0 failed." in capsys.readouterr().out
        assert send.already_sent() == {"jane@x.com", "sam@x.com"}

    def test_a_failure_does_not_stop_the_rest(self, setup, capsys):
        setup.service.fail_for = {"jane@x.com"}
        setup("--send", "--delay", "0")
        out = capsys.readouterr().out
        assert "FAILED jane@x.com: bounced" in out
        assert "Done. 1 sent, 1 failed." in out

    def test_not_confirming_cancels(self, setup, capsys):
        setup("--send", answer="no")
        assert "Cancelled." in capsys.readouterr().out
        assert setup.service.sent == []

    def test_already_emailed_people_are_skipped_unless_resend(self, setup, capsys):
        send.log_sent("jane@x.com", "Hi")
        setup("--send")
        assert "Skipping 1 already emailed: jane@x.com" in capsys.readouterr().out
        assert [to for to, _ in setup.service.sent] == ["sam@x.com"]

        setup("--send", "--resend")
        assert [to for to, _ in setup.service.sent] == ["sam@x.com", "jane@x.com", "sam@x.com"]

    def test_nothing_to_send(self, setup, capsys):
        send.log_sent("jane@x.com", "Hi")
        send.log_sent("sam@x.com", "Hi")
        setup("--send")
        assert "Nothing to send." in capsys.readouterr().out

    def test_bad_var(self, setup):
        with pytest.raises(SystemExit, match="--var must look like key=value"):
            setup("--var", "oops")

    def test_missing_attachment(self, setup):
        with pytest.raises(SystemExit, match="Attachment not found: nope.pdf"):
            setup("--attach", "nope.pdf")


class TestGmailService:
    """gmail_service() with Google's credential classes and API client faked."""

    @pytest.fixture
    def google(self, monkeypatch):
        from google.oauth2 import credentials
        from google_auth_oauthlib import flow
        import googleapiclient.discovery as discovery

        state = SimpleNamespace(saved=None, flow_ran=False)

        class Creds:
            def __init__(self, valid=True, expired=False, refresh_token=None):
                self.valid, self.expired, self.refresh_token = valid, expired, refresh_token

            def refresh(self, request):
                self.valid = True

            def to_json(self):
                return '{"token": "new"}'

        def run_flow(path, scopes):
            state.flow_ran = True
            return SimpleNamespace(run_local_server=lambda port: Creds())

        state.Creds = Creds
        state.from_file = None
        monkeypatch.setattr(credentials.Credentials, "from_authorized_user_file", staticmethod(lambda path, scopes: state.from_file))
        monkeypatch.setattr(flow.InstalledAppFlow, "from_client_secrets_file", staticmethod(run_flow))
        monkeypatch.setattr(discovery, "build", lambda name, version, credentials: ("service", credentials))
        return state

    def test_saved_valid_token(self, google, files):
        (files / "token.json").write_text("{}")
        google.from_file = google.Creds()
        assert send.gmail_service() == ("service", google.from_file)
        assert not google.flow_ran

    def test_expired_token_is_refreshed_and_saved(self, google, files):
        (files / "token.json").write_text("{}")
        google.from_file = google.Creds(valid=False, expired=True, refresh_token="r")
        send.gmail_service()
        assert google.from_file.valid
        assert (files / "token.json").read_text() == '{"token": "new"}'

    def test_first_run_signs_in(self, google, files):
        (files / "credentials.json").write_text("{}")
        send.gmail_service()
        assert google.flow_ran
        assert (files / "token.json").exists()

    def test_first_run_without_credentials_file(self, google):
        with pytest.raises(SystemExit, match="credentials.json not found"):
            send.gmail_service()
