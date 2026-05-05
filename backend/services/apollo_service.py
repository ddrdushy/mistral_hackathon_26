"""Apollo.io people-search adapter (platform-managed).

Apollo is the default talent-search provider for every tenant — funded by
HireOps via a single APOLLO_API_KEY env var. Unlike LinkedIn / Indeed /
JobStreet, Apollo has a clean self-serve API and a free tier, which makes it
the right "always-available" search backend.

This module exposes one normalized function — `search_people()` — that
returns rows in a provider-agnostic shape so the talent-search agent and
frontend never need to know which board produced the match. BYO providers
(LinkedIn Recruiter, Indeed, SEEK) implement the same shape.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

import httpx

logger = logging.getLogger("hireops.apollo")

APOLLO_BASE = "https://api.apollo.io/api/v1"
APOLLO_TIMEOUT = 20.0  # seconds


def _api_key() -> str:
    return os.environ.get("APOLLO_API_KEY", "").strip()


def is_configured() -> bool:
    return bool(_api_key())


# ─── Mock fallback (used when APOLLO_API_KEY is unset) ────────────────────


def _mock_people(query: Dict[str, Any], limit: int) -> List[Dict[str, Any]]:
    """Returns plausible-looking candidates so the demo works without a key.

    Loud-tagged with `provider: 'apollo_mock'` so the UI can show the warning
    badge — never let a mock go out unnoticed.
    """
    titles = query.get("title_keywords") or ["Software Engineer"]
    location = query.get("location") or "Singapore"
    seniority = query.get("seniority") or "Senior"
    skills = query.get("skills") or ["Python", "AWS"]

    base = [
        ("Priya Patel", "priya.patel@example.com", "ACME Tech", 8, "github.com/priyapatel"),
        ("Marcus Chen", "marcus.chen@example.com", "Vector Labs", 6, "github.com/marcusc"),
        ("Sara Wong", "sara.wong@example.com", "Cloudward", 5, "linkedin.com/in/sarawong"),
        ("Daniel Tan", "daniel.tan@example.com", "Northstar Inc", 9, "linkedin.com/in/danieltan"),
        ("Aisha Rahman", "aisha.rahman@example.com", "Quantum Forge", 7, "github.com/aishar"),
        ("Liam O'Connor", "liam.oconnor@example.com", "Helix Robotics", 4, "linkedin.com/in/liamoc"),
    ]
    out = []
    for name, email, company, years, link in base[:limit]:
        out.append({
            "provider": "apollo_mock",
            "external_id": f"mock_{name.lower().replace(' ', '_')}",
            "name": name,
            "email": email,
            "title": f"{seniority} {titles[0]}",
            "company": company,
            "location": location,
            "years_experience": years,
            "skills": skills[:3],
            "profile_url": f"https://{link}",
            "linkedin_url": f"https://{link}" if "linkedin" in link else None,
            "raw": None,
        })
    return out


# ─── Real Apollo call ─────────────────────────────────────────────────────


def search_people(
    *,
    title_keywords: Optional[List[str]] = None,
    location: Optional[str] = None,
    seniority: Optional[str] = None,
    skills: Optional[List[str]] = None,
    company_keywords: Optional[List[str]] = None,
    limit: int = 20,
) -> List[Dict[str, Any]]:
    """Search Apollo's people database. Returns a normalized candidate list.

    Apollo's `/mixed_people/search` endpoint accepts a forgiving free-form
    payload — most fields are optional. We map our internal query shape to
    Apollo's parameter names and bail to a labelled mock if no key is set.
    """
    query = {
        "title_keywords": title_keywords or [],
        "location": location,
        "seniority": seniority,
        "skills": skills or [],
        "company_keywords": company_keywords or [],
    }

    if not is_configured():
        logger.warning("APOLLO_API_KEY not set — returning mock candidates.")
        return _mock_people(query, limit)

    payload: Dict[str, Any] = {
        "page": 1,
        "per_page": min(max(limit, 1), 100),
    }
    if title_keywords:
        payload["person_titles"] = title_keywords
    if location:
        payload["person_locations"] = [location]
    if seniority:
        # Apollo's seniority enum: owner, founder, c_suite, partner, vp,
        # head, director, manager, senior, entry, intern. We coerce.
        payload["person_seniorities"] = [seniority.lower()]
    if skills:
        payload["q_keywords"] = " ".join(skills)
    if company_keywords:
        payload["organization_industry_tag_ids"] = company_keywords

    headers = {
        "Cache-Control": "no-cache",
        "Content-Type": "application/json",
        "X-Api-Key": _api_key(),
    }

    try:
        with httpx.Client(timeout=APOLLO_TIMEOUT) as client:
            r = client.post(
                f"{APOLLO_BASE}/mixed_people/search",
                json=payload,
                headers=headers,
            )
        r.raise_for_status()
        body = r.json()
    except httpx.HTTPError as e:
        logger.error("Apollo API error (%s) — falling back to mock", e)
        return _mock_people(query, limit)

    people = body.get("people") or []
    out: List[Dict[str, Any]] = []
    for p in people[:limit]:
        org = p.get("organization") or {}
        out.append({
            "provider": "apollo",
            "external_id": p.get("id"),
            "name": p.get("name") or f"{p.get('first_name','')} {p.get('last_name','')}".strip(),
            "email": p.get("email"),
            "title": p.get("title"),
            "company": org.get("name"),
            "location": ", ".join(filter(None, [
                p.get("city"), p.get("state"), p.get("country"),
            ])) or None,
            "years_experience": _years_from_history(p),
            "skills": [],  # Apollo skills require a person-detail call; left empty for cost
            "profile_url": p.get("linkedin_url") or p.get("github_url") or p.get("twitter_url"),
            "linkedin_url": p.get("linkedin_url"),
            "raw": p,
        })
    return out


def _years_from_history(person: Dict[str, Any]) -> Optional[int]:
    """Approximate years of experience from employment_history if present."""
    history = person.get("employment_history") or []
    if not history:
        return None
    # Each item has start_date / end_date as YYYY-MM-DD strings
    earliest = None
    for h in history:
        start = h.get("start_date")
        if not start:
            continue
        try:
            year = int(start.split("-")[0])
        except Exception:
            continue
        earliest = year if earliest is None else min(earliest, year)
    if earliest is None:
        return None
    from datetime import datetime
    return max(0, datetime.utcnow().year - earliest)
