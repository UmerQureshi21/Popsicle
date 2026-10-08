"""Manage who can use Popsicle. Accounts are never created from the website.

    python -m app.manage new-password                   # a long random password, saved to backend/.owner-password
    python -m app.manage create-user you@example.com [--name "Your Name"] [--password-file .owner-password]
    python -m app.manage invite friend@example.com      # they choose a password via Sign up
    python -m app.manage set-password you@example.com [--password-file .owner-password]
    python -m app.manage list-users
    python -m app.manage delete-user someone@example.com

Run from the backend/ folder with the virtualenv: .venv/bin/python -m app.manage ...
"""

import argparse
import getpass
import os
import secrets
import sys
from pathlib import Path

from sqlalchemy import select

from .auth import hash_password, is_allowed
from .config import BACKEND_DIR
from .db import SessionLocal, engine
from .models import Base, User
from .routers.auth import MIN_PASSWORD_LENGTH


# Git ignores this file: the password only ever lives on your machine (and in your password manager).
PASSWORD_FILE = BACKEND_DIR / ".owner-password"


def new_password() -> None:
    """Save a long random password to a file only you can read. Never printed, never replaced."""
    path = PASSWORD_FILE
    if path.exists():
        sys.exit(f"{path} already exists. Delete it first if you really want a new password.")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as out:
        out.write(secrets.token_urlsafe(48) + "\n")  # 64 characters
    print(f"Saved a new 64-character password to {path} (git ignores it).")
    print("Use it with: python -m app.manage create-user you@example.com --password-file .owner-password")


def read_password(path: str) -> str:
    try:
        pw = Path(path).read_text().strip()
    except OSError as e:
        sys.exit(f"Couldn't read {path}: {e.strerror}.")
    if len(pw) < MIN_PASSWORD_LENGTH:
        sys.exit(f"The password in {path} is shorter than {MIN_PASSWORD_LENGTH} characters.")
    return pw


def ask_password() -> str:
    while True:
        pw = getpass.getpass("Password: ")
        if len(pw) < MIN_PASSWORD_LENGTH:
            print(f"Use at least {MIN_PASSWORD_LENGTH} characters.")
            continue
        if getpass.getpass("Password again: ") != pw:
            print("Those didn't match. Try again.")
            continue
        return pw


def password_for(args) -> str:
    return read_password(args.password_file) if args.password_file else ask_password()


def main() -> None:
    p = argparse.ArgumentParser(prog="python -m app.manage", description="Manage Popsicle accounts.")
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("create-user", help="add an account with a password")
    c.add_argument("email")
    c.add_argument("--name")
    c.add_argument("--password-file", help="read the password from this file instead of asking")
    i = sub.add_parser("invite", help="allow an email to choose its own password via Sign up")
    i.add_argument("email")
    i.add_argument("--name")
    sp = sub.add_parser("set-password", help="change an account's password")
    sp.add_argument("email")
    sp.add_argument("--password-file", help="read the password from this file instead of asking")
    sub.add_parser("new-password", help="save a long random password to backend/.owner-password")
    sub.add_parser("list-users", help="show everyone who can log in")
    d = sub.add_parser("delete-user", help="remove an account (logs them out everywhere)")
    d.add_argument("email")
    args = p.parse_args()
    if args.cmd == "new-password":
        return new_password()

    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        if args.cmd == "list-users":
            users = db.scalars(select(User).order_by(User.created_at)).all()
            if not users:
                print("No accounts yet. Add one with: python -m app.manage create-user you@example.com")
            for u in users:
                status = "active" if u.password_hash else "invited (no password yet)"
                if not is_allowed(u.email):
                    status = "blocked: not in ALLOWED_EMAILS"
                last = f", last login {u.last_login_at:%Y-%m-%d}" if u.last_login_at else ""
                print(f"{u.email}  [{status}{last}]")
            return

        email = args.email.strip().lower()
        if "@" not in email:
            sys.exit(f"'{args.email}' doesn't look like an email address.")
        user = db.scalars(select(User).where(User.email == email)).first()

        if args.cmd in ("create-user", "invite"):
            if user:
                sys.exit(f"{email} already has an account. Use set-password to change its password.")
            if not is_allowed(email):
                sys.exit(f"{email} isn't in ALLOWED_EMAILS, so it couldn't log in. Add it there first.")
            pw_hash = hash_password(password_for(args)) if args.cmd == "create-user" else None
            db.add(User(email=email, name=args.name, password_hash=pw_hash))
            db.commit()
            print(f"Created {email}." if pw_hash else f"Invited {email}. They can now choose a password via Sign up.")
        elif args.cmd == "set-password":
            if not user:
                sys.exit(f"No account for {email}.")
            user.password_hash = hash_password(password_for(args))
            db.commit()
            print(f"Password updated for {email}.")
        elif args.cmd == "delete-user":
            if not user:
                sys.exit(f"No account for {email}.")
            db.delete(user)
            db.commit()
            print(f"Deleted {email}.")


if __name__ == "__main__":
    main()
