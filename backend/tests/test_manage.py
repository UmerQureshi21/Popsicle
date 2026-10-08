"""The account command line (python -m app.manage), with sys.argv and getpass faked."""

import sys
from datetime import datetime, timezone

import pytest
from sqlalchemy import select

from app import manage
from app.auth import verify_password
from app.models import User
from tests import factories as f


@pytest.fixture
def run(monkeypatch, capsys):
    """run("create-user", "a@x.com", passwords=["pw", "pw"]) -> printed output."""

    def go(*args, passwords=()):
        answers = iter(passwords)
        monkeypatch.setattr(manage.getpass, "getpass", lambda prompt: next(answers))
        monkeypatch.setattr(sys, "argv", ["manage", *args])
        manage.main()
        return capsys.readouterr().out

    return go


def users(db):
    db.expire_all()
    return {u.email: u for u in db.scalars(select(User))}


def test_create_user(run, db):
    out = run("create-user", " Me@Example.com ", "--name", "Me", passwords=["long password", "long password"])
    assert out == "Created me@example.com.\n"
    me = users(db)["me@example.com"]
    assert me.name == "Me"
    assert verify_password("long password", me.password_hash)


def test_password_is_asked_again_until_it_is_long_enough_and_matches(run, db):
    out = run("create-user", "me@example.com", passwords=["short", "long password", "different", "long password", "long password"])
    assert "Use at least 8 characters." in out
    assert "Those didn't match." in out
    assert verify_password("long password", users(db)["me@example.com"].password_hash)


def test_invite(run, db):
    out = run("invite", "friend@example.com")
    assert "Invited friend@example.com" in out
    assert users(db)["friend@example.com"].password_hash is None


def test_existing_account_cannot_be_created_again(run, db):
    f.user(db, email="me@example.com")
    with pytest.raises(SystemExit, match="already has an account"):
        run("invite", "me@example.com")


def test_not_an_email(run):
    with pytest.raises(SystemExit, match="doesn't look like an email"):
        run("create-user", "nope")


def test_set_password(run, db):
    f.user(db, email="me@example.com")
    assert run("set-password", "me@example.com", passwords=["new password", "new password"]) == "Password updated for me@example.com.\n"
    assert verify_password("new password", users(db)["me@example.com"].password_hash)


def test_delete_user(run, db):
    f.user(db, email="me@example.com")
    assert run("delete-user", "me@example.com") == "Deleted me@example.com.\n"
    assert users(db) == {}


@pytest.mark.parametrize("cmd", ["set-password", "delete-user"])
def test_unknown_account(run, cmd):
    with pytest.raises(SystemExit, match="No account for"):
        run(cmd, "who@example.com")


def test_list_users(run, db):
    assert "No accounts yet" in run("list-users")
    f.user(db, email="me@example.com")
    f.user(db, email="friend@example.com", password=None)
    me = users(db)["me@example.com"]
    me.last_login_at = datetime(2026, 10, 1, 12, tzinfo=timezone.utc)
    db.commit()
    assert run("list-users").splitlines() == [
        "me@example.com  [active, last login 2026-10-01]",
        "friend@example.com  [invited (no password yet)]",
    ]


class TestAllowedEmails:
    def test_cannot_create_or_invite_someone_not_on_the_list(self, run, db, settings):
        settings(allowed_emails="owner@example.com")
        for cmd in ("create-user", "invite"):
            with pytest.raises(SystemExit, match="isn't in ALLOWED_EMAILS"):
                run(cmd, "friend@example.com", passwords=["long password", "long password"])
        assert users(db) == {}
        run("create-user", "Owner@Example.com", passwords=["long password", "long password"])
        assert list(users(db)) == ["owner@example.com"]

    def test_list_users_flags_accounts_that_cant_log_in(self, run, db, settings):
        f.user(db, email="me@example.com")
        settings(allowed_emails="owner@example.com")
        assert run("list-users").splitlines() == ["me@example.com  [blocked: not in ALLOWED_EMAILS]"]


class TestOwnerPassword:
    """A long random password kept in a git-ignored file that only you can read."""

    def test_new_password_is_long_random_private_and_never_printed(self, run, tmp_path, monkeypatch):
        path = tmp_path / ".owner-password"
        monkeypatch.setattr(manage, "PASSWORD_FILE", path)
        out = run("new-password")
        pw = path.read_text().strip()
        assert len(pw) == 64
        assert pw not in out
        assert path.stat().st_mode & 0o777 == 0o600
        with pytest.raises(SystemExit, match="already exists"):
            run("new-password")
        assert path.read_text().strip() == pw  # never replaced

    def test_create_user_and_set_password_from_the_file(self, run, db, tmp_path):
        path = tmp_path / ".owner-password"
        path.write_text("a" * 64 + "\n")
        run("create-user", "me@example.com", "--password-file", str(path))
        assert verify_password("a" * 64, users(db)["me@example.com"].password_hash)
        path.write_text("b" * 64)
        run("set-password", "me@example.com", "--password-file", str(path))
        assert verify_password("b" * 64, users(db)["me@example.com"].password_hash)

    def test_a_missing_or_short_file_is_refused(self, run, db, tmp_path):
        with pytest.raises(SystemExit, match="Couldn't read"):
            run("create-user", "me@example.com", "--password-file", str(tmp_path / "nope"))
        short = tmp_path / "short"
        short.write_text("abc")
        with pytest.raises(SystemExit, match="shorter than 8"):
            run("create-user", "me@example.com", "--password-file", str(short))
        assert users(db) == {}

    def test_the_file_is_git_ignored(self):
        from app.config import BACKEND_DIR

        assert manage.PASSWORD_FILE == BACKEND_DIR / ".owner-password"
        assert ".owner-password" in (BACKEND_DIR.parent / ".gitignore").read_text().splitlines()
