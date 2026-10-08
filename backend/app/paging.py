"""One page of a long list at a time: ?limit=&offset=, answered with the items, the total and
where the next page starts."""

from fastapi import Query

DEFAULT_LIMIT = 30
MAX_LIMIT = 100


class PageParams:
    def __init__(self, limit: int = Query(DEFAULT_LIMIT, ge=1, le=MAX_LIMIT), offset: int = Query(0, ge=0)):
        self.limit, self.offset = limit, offset


def next_offset(params: PageParams, shown: int, total: int) -> int | None:
    """Where the next page starts, or None when this was the last one."""
    end = params.offset + shown
    return end if shown and end < total else None
