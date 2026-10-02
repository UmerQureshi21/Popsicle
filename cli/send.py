#!/usr/bin/env python3
"""Send templated cold emails to a list of contacts via the Gmail API.

Usage:
    python send.py contacts.csv                      # preview only (dry run)
    python send.py contacts.csv --send               # actually send
    python send.py contacts.csv --var company=Stripe --attach resume.pdf --send
"""

import argparse
import base64
import csv
import mimetypes
import random
import string
import sys
import time
from datetime import datetime
from email.message import EmailMessage
from pathlib import Path

ROOT = Path(__file__).parent
CREDENTIALS_FILE = ROOT / "credentials.json"
TOKEN_FILE = ROOT / "token.json"
SENT_LOG = ROOT / "sent_log.csv"
SCOPES = ["https://www.googleapis.com/auth/gmail.send"]


def load_template(path):
    """Template format: first line is 'Subject: ...', then a blank line, then the body."""
    text = Path(path).read_text().strip("\n")
    first, _, body = text.partition("\n")
    if not first.lower().startswith("subject:"):
        sys.exit(f"{path}: first line must start with 'Subject:'")
    return first.split(":", 1)[1].strip(), body.strip("\n") + "\n"


def load_contacts(path, extra_vars):
    with open(path, newline="", encoding="utf-8-sig") as f:
        rows = [{k.strip().lower(): (v or "").strip() for k, v in row.items() if k} for row in csv.DictReader(f)]
    contacts = []
    for i, row in enumerate(rows, start=2):  # row 1 is the header
        if not any(row.values()):
            continue
        if not row.get("email"):
            sys.exit(f"{path} line {i}: missing email")
        name = row.get("full_name") or row.get("name") or ""
        parts = name.split()
        row.setdefault("full_name", name)
        if not row.get("first_name"):
            row["first_name"] = parts[0] if parts else ""
        if not row.get("last_name"):
            row["last_name"] = parts[-1] if len(parts) > 1 else ""
        # Command-line --var values fill in anything the CSV row leaves blank.
        for k, v in extra_vars.items():
            if not row.get(k):
                row[k] = v
        contacts.append(row)
    return contacts


def template_fields(*templates):
    return {name for t in templates for _, name, _, _ in string.Formatter().parse(t) if name}


def check_fields(contacts, subject, body):
    """Fail before sending anything if a placeholder has no value for some contact."""
    problems = []
    for c in contacts:
        missing = [f for f in sorted(template_fields(subject, body)) if not c.get(f)]
        if missing:
            problems.append(f"  {c['email']}: no value for {', '.join(missing)}")
    if problems:
        sys.exit("Template placeholders missing values:\n" + "\n".join(problems))


def already_sent():
    if not SENT_LOG.exists():
        return set()
    with open(SENT_LOG, newline="") as f:
        return {row["email"].lower() for row in csv.DictReader(f)}


def log_sent(email, subject):
    new = not SENT_LOG.exists()
    with open(SENT_LOG, "a", newline="") as f:
        w = csv.writer(f)
        if new:
            w.writerow(["timestamp", "email", "subject"])
        w.writerow([datetime.now().isoformat(timespec="seconds"), email, subject])


def build_message(to, subject, body, sender, attachments):
    msg = EmailMessage()
    msg["To"] = to
    msg["Subject"] = subject
    if sender:
        msg["From"] = sender
    msg.set_content(body)
    for path in attachments:
        ctype, _ = mimetypes.guess_type(path)
        maintype, subtype = (ctype or "application/octet-stream").split("/", 1)
        msg.add_attachment(Path(path).read_bytes(), maintype=maintype, subtype=subtype, filename=Path(path).name)
    return {"raw": base64.urlsafe_b64encode(msg.as_bytes()).decode()}


def gmail_service():
    from google.auth.transport.requests import Request
    from google.oauth2.credentials import Credentials
    from google_auth_oauthlib.flow import InstalledAppFlow
    from googleapiclient.discovery import build

    creds = None
    if TOKEN_FILE.exists():
        creds = Credentials.from_authorized_user_file(str(TOKEN_FILE), SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not CREDENTIALS_FILE.exists():
                sys.exit("credentials.json not found. See README.md for Gmail API setup.")
            creds = InstalledAppFlow.from_client_secrets_file(str(CREDENTIALS_FILE), SCOPES).run_local_server(port=0)
        TOKEN_FILE.write_text(creds.to_json())
    return build("gmail", "v1", credentials=creds)


def main():
    p = argparse.ArgumentParser(description="Send templated cold emails via Gmail.")
    p.add_argument("contacts", help="CSV with an 'email' column plus full_name and any other variables")
    p.add_argument("-t", "--template", default="template.txt", help="template file (default: template.txt)")
    p.add_argument("--var", action="append", default=[], metavar="KEY=VALUE",
                   help="variable shared by every contact, e.g. --var company=Stripe (repeatable)")
    p.add_argument("--attach", action="append", default=[], metavar="FILE", help="attach a file (repeatable)")
    p.add_argument("--from", dest="sender", help='optional From header, e.g. "Umer Qureshi <you@gmail.com>"')
    p.add_argument("--delay", type=float, default=30, help="average seconds between sends (default: 30)")
    p.add_argument("--send", action="store_true", help="actually send (otherwise just preview)")
    p.add_argument("--resend", action="store_true", help="ignore sent_log.csv and email people again")
    args = p.parse_args()

    extra_vars = {}
    for kv in args.var:
        if "=" not in kv:
            sys.exit(f"--var must look like key=value, got: {kv}")
        k, v = kv.split("=", 1)
        extra_vars[k.strip().lower()] = v.strip()
    for path in args.attach:
        if not Path(path).is_file():
            sys.exit(f"Attachment not found: {path}")

    subject_t, body_t = load_template(args.template)
    contacts = load_contacts(args.contacts, extra_vars)
    check_fields(contacts, subject_t, body_t)

    if not args.resend:
        sent = already_sent()
        skipped = [c["email"] for c in contacts if c["email"].lower() in sent]
        contacts = [c for c in contacts if c["email"].lower() not in sent]
        if skipped:
            print(f"Skipping {len(skipped)} already emailed: {', '.join(skipped)}\n")

    if not contacts:
        print("Nothing to send.")
        return

    emails = [(c["email"], subject_t.format_map(c), body_t.format_map(c)) for c in contacts]

    if not args.send:
        for to, subject, body in emails:
            print(f"To: {to}\nSubject: {subject}\n\n{body}\n{'-' * 60}")
        attach_note = f" with {len(args.attach)} attachment(s)" if args.attach else ""
        print(f"DRY RUN: {len(emails)} email(s) previewed{attach_note}. Add --send to send them.")
        return

    print(f"About to send {len(emails)} email(s):")
    for to, _, _ in emails:
        print(f"  {to}")
    if input("Type 'yes' to send: ").strip().lower() != "yes":
        print("Cancelled.")
        return

    service = gmail_service()
    failures = 0
    for i, (to, subject, body) in enumerate(emails):
        try:
            message = build_message(to, subject, body, args.sender, args.attach)
            service.users().messages().send(userId="me", body=message).execute()
            log_sent(to, subject)
            print(f"[{i + 1}/{len(emails)}] Sent to {to}")
        except Exception as e:
            failures += 1
            print(f"[{i + 1}/{len(emails)}] FAILED {to}: {e}")
        if i < len(emails) - 1 and args.delay > 0:
            # Randomized spacing so sends don't look machine-generated.
            time.sleep(random.uniform(args.delay * 0.5, args.delay * 1.5))

    print(f"\nDone. {len(emails) - failures} sent, {failures} failed.")


if __name__ == "__main__":
    main()
