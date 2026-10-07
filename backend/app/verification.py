"""Checking that addresses exist before emailing them. Bounces hurt the Gmail account's
reputation, so addresses Hunter says don't exist are skipped instead of sent to.
"""

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import hunter
from .models import EmailVerification

FRESH_FOR = timedelta(days=30)
PARALLEL = 5  # addresses checked with Hunter at once, so a request finishes quickly
# Only a definite "doesn't exist" stops an email; "risky" verdicts (accept_all, unknown...) are shown, not blocked.
UNDELIVERABLE = {"invalid"}


def now() -> datetime:
    return datetime.now(timezone.utc)


def fresh(db: Session, emails: list[str]) -> dict[str, EmailVerification]:
    """Saved verdicts younger than 30 days, by address."""
    addresses = sorted({e.strip().lower() for e in emails if e and e.strip()})
    if not addresses:
        return {}
    rows = db.scalars(
        select(EmailVerification).where(
            EmailVerification.email.in_(addresses), EmailVerification.checked_at > now() - FRESH_FOR
        )
    )
    return {v.email: v for v in rows}


def verify(db: Session, emails: list[str], refresh: bool = False) -> list[tuple[str, EmailVerification | None, bool]]:
    """(address, verdict or None if Hunter was still checking, whether it came from the saved results).
    Each new verdict is saved straight away, so an error part-way through keeps what was done."""
    addresses = list(dict.fromkeys(e.strip().lower() for e in emails if e and e.strip()))
    known = {} if refresh else fresh(db, addresses)
    todo = [a for a in addresses if a not in known]

    # Ask Hunter about several at once (each can take a few seconds); save on this thread.
    answers: dict[str, dict | None] = {}
    errors: list[Exception] = []
    with ThreadPoolExecutor(max_workers=PARALLEL) as pool:
        futures = {a: pool.submit(hunter.verify_email, a) for a in todo}
        for address, future in futures.items():
            try:
                answers[address] = future.result()
            except Exception as e:
                errors.append(e)

    results: list[tuple[str, EmailVerification | None, bool]] = []
    for address in addresses:
        if address in known:
            results.append((address, known[address], True))
        elif address in answers:
            data = answers[address]
            if data is None:
                results.append((address, None, False))
                continue
            v = db.get(EmailVerification, address) or EmailVerification(email=address)
            v.status = data.get("status") or "unknown"
            v.score = data.get("score")
            v.checked_at = now()
            db.add(v)
            db.commit()
            results.append((address, v, False))
    if errors:
        raise errors[0]  # the verdicts that did come back are saved
    return results
