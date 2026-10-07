from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException, Response
from sqlalchemy import select
from starlette.requests import Request

from app import auth
from app.models import AuthSession
from tests import factories as f


def request_with(cookie: str | None = None, path: str = "/api/stats") -> Request:
    headers = [(b"cookie", f"{auth.COOKIE_NAME}={cookie}".encode())] if cookie else []
    return Request({"type": "http", "method": "GET", "path": path, "headers": headers})


class TestPasswords:
    def test_round_trip(self):
        stored = auth.hash_password("hunter22")
        assert stored.startswith("scrypt$16384$8$1$")
        assert auth.verify_password("hunter22", stored)
        assert not auth.verify_password("hunter23", stored)

    def test_same_password_gets_a_different_salt(self):
        assert auth.hash_password("pw") != auth.hash_password("pw")

    def test_no_stored_hash_is_rejected(self):
        assert not auth.verify_password("anything", None)
        assert not auth.verify_password("anything", "")

    @pytest.mark.parametrize("stored", ["garbage", "scrypt$x$8$1$c2FsdA==$aGFzaA==", "a$b$c$d$e$f$g"])
    def test_malformed_hash_is_rejected(self, stored):
        assert not auth.verify_password("pw", stored)


def locked(email: str, ip: str) -> bool:
    try:
        auth.check_not_locked(email, ip)
    except HTTPException as e:
        assert e.status_code == 429
        return True
    return False


class TestLockout:
    def test_a_visitor_is_locked_after_max_failures(self):
        for _ in range(auth.MAX_FAILURES - 1):
            auth.record_failure("a@x.com", "1.1.1.1")
        assert not locked("a@x.com", "1.1.1.1")
        auth.record_failure("a@x.com", "1.1.1.1")
        assert locked("a@x.com", "1.1.1.1")
        assert locked("b@x.com", "1.1.1.1")  # the same visitor trying another account

    def test_someone_else_guessing_doesnt_lock_you_out(self):
        for _ in range(auth.MAX_FAILURES):
            auth.record_failure("me@x.com", "6.6.6.6")
        assert locked("me@x.com", "6.6.6.6")
        assert not locked("me@x.com", "1.1.1.1")  # you, from your own connection

    def test_an_account_is_locked_after_guesses_from_many_places(self):
        for n in range(auth.MAX_FAILURES_PER_ACCOUNT):
            auth.record_failure("me@x.com", f"10.0.0.{n}")
        assert locked("me@x.com", "1.1.1.1")
        assert not locked("other@x.com", "1.1.1.1")

    def test_old_failures_expire(self, monkeypatch):
        clock = [1000.0]
        monkeypatch.setattr(auth.time, "monotonic", lambda: clock[0])
        for _ in range(auth.MAX_FAILURES):
            auth.record_failure("a@x.com", "1.1.1.1")
        clock[0] += auth.LOCKOUT_SECONDS + 1
        assert not locked("a@x.com", "1.1.1.1")
        assert auth._failures["ip:1.1.1.1"] == []

    def test_clear_failures(self):
        for _ in range(auth.MAX_FAILURES):
            auth.record_failure("a@x.com", "1.1.1.1")
        auth.clear_failures("a@x.com", "1.1.1.1")
        assert not locked("a@x.com", "1.1.1.1")
        auth.clear_failures("never-failed@x.com", "2.2.2.2")


class TestClientIp:
    def request(self, headers=None, client=("9.9.9.9", 1)):
        from starlette.requests import Request

        scope = {"type": "http", "headers": [(k.encode(), v.encode()) for k, v in (headers or {}).items()], "client": client}
        return Request(scope)

    def test_first_forwarded_address(self):
        assert auth.client_ip(self.request({"x-forwarded-for": "1.2.3.4, 76.76.21.21"})) == "1.2.3.4"

    def test_direct_connection(self):
        assert auth.client_ip(self.request()) == "9.9.9.9"
        assert auth.client_ip(self.request({"x-forwarded-for": " "})) == "9.9.9.9"

    def test_unknown(self):
        assert auth.client_ip(self.request(client=None)) == "unknown"


class TestSessions:
    def test_start_session_sets_cookie_and_stores_only_a_hash(self, db):
        user = f.user(db)
        response = Response()
        auth.start_session(db, user, response)

        cookie = response.headers["set-cookie"]
        token = cookie.split(";")[0].split("=", 1)[1]
        assert "HttpOnly" in cookie and "Path=/" in cookie and "samesite=lax" in cookie.lower()
        stored = db.scalars(select(AuthSession)).one()
        assert stored.token_hash == auth._token_hash(token) != token
        assert user.last_login_at is not None
        assert auth.current_user(request_with(token), db).id == user.id

    def test_current_user_without_cookie_or_with_unknown_token(self, db):
        assert auth.current_user(request_with(), db) is None
        assert auth.current_user(request_with("nope"), db) is None

    def test_expired_session_is_ignored(self, db):
        user = f.user(db)
        db.add(AuthSession(user_id=user.id, token_hash=auth._token_hash("t"), expires_at=datetime.now(timezone.utc) - timedelta(seconds=1)))
        db.commit()
        assert auth.current_user(request_with("t"), db) is None

    def test_end_session_deletes_it_and_clears_cookie(self, db):
        user = f.user(db)
        db.add(AuthSession(user_id=user.id, token_hash=auth._token_hash("t"), expires_at=datetime.now(timezone.utc) + timedelta(days=1)))
        db.commit()
        response = Response()
        auth.end_session(db, request_with("t"), response)
        assert db.scalars(select(AuthSession)).all() == []
        assert f'{auth.COOKIE_NAME}=""' in response.headers["set-cookie"]

    def test_end_session_with_unknown_or_missing_cookie(self, db):
        for req in (request_with("unknown"), request_with()):
            response = Response()
            auth.end_session(db, req, response)
            assert "set-cookie" in response.headers


class TestRequireUser:
    def test_lets_everyone_through_when_auth_is_off(self, settings):
        settings(auth_required=False)
        assert auth.require_user(request_with(), None) is None

    def test_requires_a_user_when_auth_is_on(self, settings, db):
        settings(auth_required=True)
        with pytest.raises(HTTPException) as e:
            auth.require_user(request_with(), None)
        assert e.value.status_code == 401
        user = f.user(db)
        assert auth.require_user(request_with(), user) is user

    def test_public_paths_need_no_session(self, settings):
        settings(auth_required=True)
        assert auth.require_user(request_with(path="/api/gmail/callback"), None) is None
