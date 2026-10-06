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


class TestLockout:
    def test_locks_after_max_failures(self):
        for _ in range(auth.MAX_FAILURES - 1):
            auth.record_failure("a@x.com")
        auth.check_not_locked("a@x.com")  # still allowed
        auth.record_failure("a@x.com")
        with pytest.raises(HTTPException) as e:
            auth.check_not_locked("a@x.com")
        assert e.value.status_code == 429
        auth.check_not_locked("b@x.com")  # other emails unaffected

    def test_old_failures_expire(self, monkeypatch):
        clock = [1000.0]
        monkeypatch.setattr(auth.time, "monotonic", lambda: clock[0])
        for _ in range(auth.MAX_FAILURES):
            auth.record_failure("a@x.com")
        clock[0] += auth.LOCKOUT_SECONDS + 1
        auth.check_not_locked("a@x.com")
        assert auth._failures["a@x.com"] == []

    def test_clear_failures(self):
        for _ in range(auth.MAX_FAILURES):
            auth.record_failure("a@x.com")
        auth.clear_failures("a@x.com")
        auth.check_not_locked("a@x.com")
        auth.clear_failures("never-failed@x.com")


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
