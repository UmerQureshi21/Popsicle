"""Encrypting the Gmail login stored in the database."""

import json

import pytest
from cryptography.fernet import Fernet
from sqlalchemy import select

from app import gmail, secrets_box
from app.models import GmailAccount

KEY = Fernet.generate_key().decode()


@pytest.fixture
def key(settings):
    return settings(token_encryption_key=KEY)


def test_without_a_key_stays_as_is_locally(settings):
    settings(token_encryption_key=None)
    assert secrets_box.seal('{"token": "t"}') == '{"token": "t"}'
    assert secrets_box.unseal('{"token": "t"}') == '{"token": "t"}'


def test_sealed_with_a_key_and_readable_back(key):
    sealed = secrets_box.seal('{"token": "t"}')
    assert sealed.startswith("fernet:") and "token" not in sealed
    assert secrets_box.is_sealed(sealed)
    assert secrets_box.unseal(sealed) == '{"token": "t"}'


def test_sealed_but_the_key_is_gone(key, settings):
    sealed = secrets_box.seal("x")
    settings(token_encryption_key=None)
    with pytest.raises(secrets_box.CantDecrypt, match="TOKEN_ENCRYPTION_KEY isn't set"):
        secrets_box.unseal(sealed)


def test_sealed_with_a_different_key(key, settings):
    sealed = secrets_box.seal("x")
    settings(token_encryption_key=Fernet.generate_key().decode())
    with pytest.raises(secrets_box.CantDecrypt, match="can't be decrypted"):
        secrets_box.unseal(sealed)


class FakeCredentials:
    valid, refresh_token = True, "r"

    def to_json(self):
        return '{"token": "t"}'


@pytest.fixture
def creds(monkeypatch):
    seen = []

    def build(info, scopes):
        seen.append(info)
        return FakeCredentials()

    monkeypatch.setattr(gmail.Credentials, "from_authorized_user_info", staticmethod(build))
    return seen


class TestGmailLogin:
    def test_an_older_unencrypted_login_is_encrypted_on_first_use(self, db, key, creds):
        db.add(GmailAccount(email="me@gmail.com", token_json='{"token": "old"}'))
        db.commit()
        gmail.load_credentials(db)
        assert creds == [{"token": "old"}]
        stored = db.scalars(select(GmailAccount)).one().token_json
        assert stored.startswith("fernet:")
        assert json.loads(secrets_box.unseal(stored)) == {"token": "old"}

    def test_an_encrypted_login_is_read(self, db, key, creds):
        db.add(GmailAccount(email="me@gmail.com", token_json=secrets_box.seal('{"token": "t"}')))
        db.commit()
        gmail.load_credentials(db)
        assert creds == [{"token": "t"}]

    def test_an_unreadable_login_asks_to_reconnect(self, db, key, settings, creds):
        db.add(GmailAccount(email="me@gmail.com", token_json=secrets_box.seal('{"token": "t"}')))
        db.commit()
        settings(token_encryption_key=Fernet.generate_key().decode())
        with pytest.raises(gmail.GmailNotConnected, match="Reconnect Gmail"):
            gmail.load_credentials(db)

    def test_connecting_stores_it_encrypted(self, db, key, monkeypatch):
        from tests.unit.test_gmail import FakeFlow

        monkeypatch.setattr(gmail, "build", lambda *a, **kw: type("B", (), {
            "userinfo": lambda self: type("U", (), {"get": lambda self: type("E", (), {"execute": lambda self: {"email": "me@gmail.com"}})()})()
        })())
        gmail._pending_flows["s"] = FakeFlow({"scope": gmail.SEND_SCOPE})
        gmail.finish_auth(db, "s", "http://cb")
        stored = db.scalars(select(GmailAccount)).one().token_json
        assert stored.startswith("fernet:") and secrets_box.unseal(stored) == '{"token": "abc"}'
