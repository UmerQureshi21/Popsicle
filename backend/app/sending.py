"""Protecting the Gmail account: a cap on emails per rolling 24 hours, and a minimum gap
between emails. Gmail flags accounts that suddenly send a lot, which pushes later emails
into spam, so batches that hit the cap wait and carry on later instead of failing.
"""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import Email, EmailStatus, SendingSettings

WINDOW = timedelta(hours=24)
DEFAULT_DAILY_LIMIT = 40
DEFAULT_MIN_DELAY_SECONDS = 20.0


def now() -> datetime:
    return datetime.now(timezone.utc)


def get_settings(db: Session) -> SendingSettings:
    """The single settings row, created with safe defaults the first time it's needed."""
    s = db.get(SendingSettings, 1)
    if s is None:
        s = SendingSettings(id=1, daily_limit=DEFAULT_DAILY_LIMIT, min_delay_seconds=DEFAULT_MIN_DELAY_SECONDS)
        db.add(s)
        db.commit()
    return s


@dataclass
class Quota:
    daily_limit: int
    min_delay_seconds: float
    sent_last_24h: int
    remaining: int
    # When the next email may go out: now if there's room, else when the oldest send in the
    # window ages out far enough to get back under the limit.
    next_slot_at: datetime
    oldest_sent_at: datetime | None  # the oldest send still counting toward the limit

    def later_from(self, sends_now: int) -> datetime:
        """When emails beyond the limit can start, if `sends_now` go out right away."""
        if self.remaining <= 0:
            return self.next_slot_at
        # Sending up to the limit fills the window; room returns when its oldest send ages out.
        return (self.oldest_sent_at or now()) + WINDOW if sends_now else self.next_slot_at


def quota(db: Session) -> Quota:
    s = get_settings(db)
    at = now()
    times = list(
        db.scalars(
            select(Email.sent_at)
            .where(Email.status == EmailStatus.SENT, Email.sent_at > at - WINDOW)
            .order_by(Email.sent_at)
        )
    )
    remaining = max(0, s.daily_limit - len(times))
    # With n sends in the window and a limit of L, the (n - L)th oldest must age out (0-based).
    next_slot = at if remaining > 0 else times[len(times) - s.daily_limit] + WINDOW
    return Quota(
        daily_limit=s.daily_limit,
        min_delay_seconds=s.min_delay_seconds,
        sent_last_24h=len(times),
        remaining=remaining,
        next_slot_at=next_slot,
        oldest_sent_at=times[0] if times else None,
    )
