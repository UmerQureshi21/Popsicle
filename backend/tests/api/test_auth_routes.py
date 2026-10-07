from sqlalchemy import select

from app import auth
from app.models import AuthSession, User
from tests import factories as f


def login(client, email="me@example.com", password="correct horse"):
    return client.post("/api/auth/login", json={"email": email, "password": password})


class TestMe:
    def test_anonymous(self, client):
        assert client.get("/api/auth/me").json() == {"user": None, "auth_required": False}

    def test_logged_in(self, client, db, settings):
        settings(auth_required=True)
        f.user(db, name="Me")
        login(client)
        assert client.get("/api/auth/me").json() == {"user": {"email": "me@example.com", "name": "Me"}, "auth_required": True}


class TestLogin:
    def test_success_sets_the_session_cookie(self, client, db):
        f.user(db)
        r = login(client, email="  ME@Example.com ")
        assert r.status_code == 200
        assert r.json() == {"email": "me@example.com", "name": None}
        assert client.cookies.get(auth.COOKIE_NAME)
        assert db.scalars(select(AuthSession)).one()

    def test_wrong_password_and_unknown_email_get_the_same_answer(self, client, db):
        f.user(db)
        wrong = login(client, password="nope")
        unknown = login(client, email="who@example.com")
        assert wrong.status_code == unknown.status_code == 401
        assert wrong.json() == unknown.json()

    def test_invited_user_without_password_cannot_log_in(self, client, db):
        f.user(db, password=None)
        assert login(client, password="").status_code == 401

    def test_locked_after_too_many_failures(self, client, db):
        f.user(db)
        for _ in range(auth.MAX_FAILURES):
            assert login(client, password="nope").status_code == 401
        assert login(client).status_code == 429  # even with the right password

    def test_locked_out_visitors_dont_lock_out_the_owner(self, client, db):
        f.user(db)
        for _ in range(auth.MAX_FAILURES):
            client.post("/api/auth/login", json={"email": "me@example.com", "password": "nope"}, headers={"x-forwarded-for": "6.6.6.6"})
        assert login(client).status_code == 200  # the owner, from elsewhere

    def test_success_clears_earlier_failures(self, client, db):
        f.user(db)
        login(client, password="nope")
        login(client)
        assert "email:me@example.com" not in auth._failures


class TestSignup:
    def signup(self, client, email="friend@example.com", password="long enough"):
        return client.post("/api/auth/signup", json={"email": email, "password": password})

    def test_invited_email_chooses_a_password(self, client, db):
        f.user(db, email="friend@example.com", password=None)
        r = self.signup(client, email="Friend@Example.com")
        assert r.status_code == 200
        assert client.cookies.get(auth.COOKIE_NAME)
        assert auth.verify_password("long enough", db.scalars(select(User)).one().password_hash)

    def test_not_invited(self, client):
        r = self.signup(client)
        assert r.status_code == 403
        assert "invite-only" in r.json()["detail"]
        assert len(auth._failures["email:friend@example.com"]) == 1

    def test_already_has_a_password(self, client, db):
        f.user(db, email="friend@example.com")
        assert self.signup(client).status_code == 409

    def test_password_too_short(self, client, db):
        f.user(db, email="friend@example.com", password=None)
        assert self.signup(client, password="short").status_code == 422

    def test_locked(self, client):
        for _ in range(auth.MAX_FAILURES):
            self.signup(client)
        assert self.signup(client).status_code == 429


def test_logout_ends_the_session(client, db, settings):
    settings(auth_required=True)
    f.user(db)
    login(client)
    assert client.post("/api/auth/logout").status_code == 204
    assert db.scalars(select(AuthSession)).all() == []
    assert client.get("/api/auth/me").json()["user"] is None


class TestAuthRequired:
    def test_everything_is_open_locally(self, client):
        assert client.get("/api/stats").status_code == 200

    def test_api_needs_a_session(self, client, db, settings):
        settings(auth_required=True)
        for path in ("/api/stats", "/api/campaigns", "/api/companies", "/api/templates", "/api/people-search/status"):
            assert client.get(path).status_code == 401, path
        f.user(db)
        login(client)
        assert client.get("/api/stats").status_code == 200

    def test_open_paths(self, client, settings):
        settings(auth_required=True)
        assert client.get("/api/health").json() == {"ok": True}
        assert client.get("/api/auth/me").status_code == 200
        r = client.get("/api/gmail/callback?error=access_denied", follow_redirects=False)
        assert r.status_code == 307
