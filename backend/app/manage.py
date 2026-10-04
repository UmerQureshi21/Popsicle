"""Manage who can use Popsicle. Accounts are never created from the website.

    python -m app.manage create-user you@example.com [--name "Your Name"]   # asks for a password
    python -m app.manage invite friend@example.com      # they choose a password via Sign up
    python -m app.manage set-password you@example.com
    python -m app.manage list-users
    python -m app.manage delete-user someone@example.com

Run from the backend/ folder with the virtualenv: .venv/bin/python -m app.manage ...
"""

import argparse
import getpass
import sys

from sqlalchemy import select

from .auth import hash_password
from .db import SessionLocal, engine
from .models import Base, User
from .routers.auth import MIN_PASSWORD_LENGTH


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


def main() -> None:
    p = argparse.ArgumentParser(prog="python -m app.manage", description="Manage Popsicle accounts.")
    sub = p.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("create-user", help="add an account with a password")
    c.add_argument("email")
    c.add_argument("--name")
    i = sub.add_parser("invite", help="allow an email to choose its own password via Sign up")
    i.add_argument("email")
    i.add_argument("--name")
    sp = sub.add_parser("set-password", help="change an account's password")
    sp.add_argument("email")
    sub.add_parser("list-users", help="show everyone who can log in")
    d = sub.add_parser("delete-user", help="remove an account (logs them out everywhere)")
    d.add_argument("email")
    args = p.parse_args()

    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        if args.cmd == "list-users":
            users = db.scalars(select(User).order_by(User.created_at)).all()
            if not users:
                print("No accounts yet. Add one with: python -m app.manage create-user you@example.com")
            for u in users:
                status = "active" if u.password_hash else "invited (no password yet)"
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
            pw_hash = hash_password(ask_password()) if args.cmd == "create-user" else None
            db.add(User(email=email, name=args.name, password_hash=pw_hash))
            db.commit()
            print(f"Created {email}." if pw_hash else f"Invited {email}. They can now choose a password via Sign up.")
        elif args.cmd == "set-password":
            if not user:
                sys.exit(f"No account for {email}.")
            user.password_hash = hash_password(ask_password())
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
