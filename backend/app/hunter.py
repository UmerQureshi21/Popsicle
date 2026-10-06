"""Hunter.io client: find people (and their emails) at a company.

Responses are cached in Postgres so repeating a search doesn't spend credits again;
the free plan only has 50 credits a month.
"""

import json
import re
from datetime import datetime, timedelta, timezone

import requests
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import settings
from .models import HunterLookup

BASE_URL = "https://api.hunter.io/v2"
TIMEOUT_SECONDS = 30
CACHE_TTL = timedelta(days=30)

# Hunter's documented status codes, reworded for the UI.
ERROR_MESSAGES = {
    401: "Hunter rejected the API key. Check HUNTER_API_KEY in backend/.env.",
    403: "Hunter's rate limit was hit. Wait a moment and try again.",
    429: "You've used all your Hunter credits for this month.",
}


class HunterError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def configured() -> bool:
    return bool(settings.hunter_api_key)


def _request(path: str, params: dict, body: dict | None = None) -> dict:
    """GET with query params, or POST when there's a JSON body (Hunter's location filter needs one)."""
    if not configured():
        raise HunterError(400, "Hunter isn't set up. Add HUNTER_API_KEY to backend/.env and restart the backend.")
    try:
        r = requests.request(
            "POST" if body else "GET",
            BASE_URL + path,
            params={k: v for k, v in params.items() if v not in (None, "")},
            json=body,
            headers={"X-API-KEY": settings.hunter_api_key},
            timeout=TIMEOUT_SECONDS,
        )
    except requests.RequestException as e:
        raise HunterError(502, f"Couldn't reach Hunter: {e}") from e
    if r.ok:
        return r.json()
    try:
        details = r.json()["errors"][0]["details"]
    except Exception:
        details = r.text[:200]
    raise HunterError(r.status_code, ERROR_MESSAGES.get(r.status_code, details or f"Hunter error {r.status_code}"))


def _cached(db: Session, kind: str, params: dict, fetch, refresh: bool) -> tuple[dict, bool]:
    """Returns (response, served_from_cache)."""
    key = kind + ":" + json.dumps(params, sort_keys=True)
    hit = db.scalars(select(HunterLookup).where(HunterLookup.cache_key == key)).first()
    if hit and not refresh and hit.created_at > datetime.now(timezone.utc) - CACHE_TTL:
        return hit.response, True
    response = fetch()
    if hit:
        hit.response = response
        hit.created_at = datetime.now(timezone.utc)
    else:
        db.add(HunterLookup(kind=kind, cache_key=key, response=response))
    db.commit()
    return response, False


def clean_domain(query: str) -> str | None:
    """'https://www.stripe.com/jobs' -> 'stripe.com'. None if it doesn't look like a domain."""
    q = query.strip().lower()
    q = re.sub(r"^[a-z]+://", "", q).split("/")[0]
    q = re.sub(r"^www\.", "", q)
    return q if re.fullmatch(r"[a-z0-9-]+(\.[a-z0-9-]+)+", q) else None


def domain_search(
    db: Session,
    query: str,
    *,
    limit: int = 10,
    offset: int = 0,
    department: str | None = None,
    seniority: str | None = None,
    job_titles: str | None = None,
    location: list[dict] | None = None,
    refresh: bool = False,
) -> tuple[dict, bool]:
    """People at a company, by domain ('stripe.com') or company name ('Stripe').

    `location` limits results to where each person is based, e.g.
    [{"city": "Toronto", "country": "CA"}, {"city": "Mississauga", "country": "CA"}].
    """
    domain = clean_domain(query)
    params = {
        "domain" if domain else "company": domain or query.strip(),
        "limit": limit,
        "offset": offset,
        "type": "personal",  # skip generic inboxes like jobs@ and info@
        "department": department,
        "seniority": seniority,
        "job_titles": job_titles,
    }
    params = {k: v for k, v in params.items() if v not in (None, "")}
    body = {"location": {"include": location}} if location else None
    cache_params = {**params, **(body or {})}
    return _cached(db, "domain_search", cache_params, lambda: _request("/domain-search", params, body), refresh)


def email_finder(
    db: Session,
    company: str | None,
    *,
    full_name: str | None = None,
    linkedin_handle: str | None = None,
    refresh: bool = False,
) -> tuple[dict, bool]:
    """One person's email from their name and company or domain, or from just their LinkedIn handle
    (Hunter works out the person and their company from the profile)."""
    params: dict = {}
    if company and company.strip():
        domain = clean_domain(company)
        params["domain" if domain else "company"] = domain or company.strip()
    if linkedin_handle:
        params["linkedin_handle"] = linkedin_handle
    if full_name:
        params["full_name"] = full_name.strip()
    return _cached(db, "email_finder", params, lambda: _request("/email-finder", params), refresh)


def company_suggestions(query: str, limit: int = 6) -> list[dict]:
    """Companies matching a name as you type, with domain, logo and how many emails Hunter has. Free."""
    data = _request("/domains-suggestion", {"query": query.strip(), "limit": limit}).get("data") or []
    return [d for d in data if d.get("domain")]


def email_count(query: str) -> dict:
    """How many people Hunter knows at a company, by department and seniority. Free."""
    domain = clean_domain(query)
    params = {"domain" if domain else "company": domain or query.strip(), "type": "personal"}
    return _request("/email-count", params).get("data") or {}


def account() -> dict:
    """Credits used / available this month. Never cached."""
    return _request("/account", {})["data"]


def linkedin_handle(url_or_handle: str) -> str | None:
    """'https://www.linkedin.com/in/jane-doe-123/' -> 'jane-doe-123'."""
    s = url_or_handle.strip()
    m = re.search(r"linkedin\.com/in/([^/?#]+)", s)
    if m:
        return m.group(1)
    return s if re.fullmatch(r"[A-Za-z0-9-_%]+", s) else None
