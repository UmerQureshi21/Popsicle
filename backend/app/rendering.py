"""Fill {{placeholders}} in a template from one recipient's variable values."""

import re

PLACEHOLDER = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def placeholders(*texts: str) -> list[str]:
    """Placeholder names in order of first appearance."""
    seen: dict[str, None] = {}
    for t in texts:
        for m in PLACEHOLDER.finditer(t):
            seen.setdefault(m.group(1).lower())
    return list(seen)


def enrich(values: dict[str, str], company: str | None) -> dict[str, str]:
    """Normalise keys and add derived values: first/last name from full_name, and company."""
    out = {k.strip().lower(): (v or "").strip() for k, v in values.items()}
    full = out.get("full_name") or out.get("name") or ""
    parts = full.split()
    if parts and not out.get("first_name"):
        out["first_name"] = parts[0]
    if len(parts) > 1 and not out.get("last_name"):
        out["last_name"] = parts[-1]
    if not out.get("full_name") and out.get("first_name"):
        out["full_name"] = " ".join(p for p in (out.get("first_name"), out.get("last_name")) if p)
    if company and not out.get("company"):
        out["company"] = company.strip()
    if "email" in out:
        out["email"] = out["email"].lower()
    return out


def render(template: str, values: dict[str, str]) -> tuple[str, list[str]]:
    """Returns (rendered text, placeholder names that had no value)."""
    missing: list[str] = []

    def sub(m: re.Match) -> str:
        key = m.group(1).lower()
        val = values.get(key, "")
        if not val:
            missing.append(key)
            return m.group(0)
        return val

    return PLACEHOLDER.sub(sub, template), missing
