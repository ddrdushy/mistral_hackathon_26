"""Google Calendar integration — per-recruiter OAuth tokens + free/busy
+ slot suggester so HR can pick interview times that won't clash with
their existing meetings.

Operationally, the platform needs a Google Cloud OAuth client with the
Calendar API enabled. We re-use the same client credentials env vars as
the Gmail integration so a single Google Cloud project covers both:

  GOOGLE_OAUTH_CLIENT_ID       (preferred)
  GOOGLE_OAUTH_CLIENT_SECRET
  GMAIL_CLIENT_ID  / GMAIL_CLIENT_SECRET   (fallback — legacy)

The redirect URI to register in Google Cloud:
  https://<your-domain>/api/v1/calendar/google/callback
"""
from __future__ import annotations

import hmac
import hashlib
import logging
import os
import secrets
import urllib.parse
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx

logger = logging.getLogger("hireops.calendar")

# Read-only scope is enough for free/busy + event listing. We deliberately
# don't request write so a recruiter understands consenting won't let us
# move their meetings around. Bumping to .events later is a re-consent.
SCOPES = "https://www.googleapis.com/auth/calendar.readonly"

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_FREEBUSY_URL = "https://www.googleapis.com/calendar/v3/freeBusy"
GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo"


# ── Config helpers ────────────────────────────────────────────────────────


def _client_id() -> str:
    return (
        os.getenv("GOOGLE_OAUTH_CLIENT_ID")
        or os.getenv("GMAIL_CLIENT_ID")
        or ""
    ).strip()


def _client_secret() -> str:
    return (
        os.getenv("GOOGLE_OAUTH_CLIENT_SECRET")
        or os.getenv("GMAIL_CLIENT_SECRET")
        or ""
    ).strip()


def _redirect_uri() -> str:
    base = os.getenv("BACKEND_PUBLIC_URL", "").rstrip("/")
    if not base:
        # Derive from FRONTEND_URL by swapping the hostname pattern.
        # Most deployments expose the backend behind the same host via
        # nginx, so the same domain works.
        base = os.getenv("FRONTEND_URL", "").rstrip("/")
    return f"{base}/api/v1/calendar/google/callback"


def is_configured() -> bool:
    return bool(_client_id() and _client_secret())


def configuration_hint() -> str:
    return (
        "Google Calendar integration is not configured on this server. "
        "Set GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET in the "
        "backend .env and add the redirect URI to your Google Cloud project."
    )


# ── OAuth flow ────────────────────────────────────────────────────────────


def build_authorize_url(state: str) -> str:
    params = {
        "client_id": _client_id(),
        "redirect_uri": _redirect_uri(),
        "response_type": "code",
        "scope": SCOPES,
        "access_type": "offline",   # so we get a refresh_token
        "prompt": "consent",        # force refresh_token on re-connect
        "state": state,
        "include_granted_scopes": "true",
    }
    return f"{GOOGLE_AUTH_URL}?{urllib.parse.urlencode(params)}"


def exchange_code(code: str) -> dict:
    """POST the auth code back to Google → returns the token bundle."""
    with httpx.Client(timeout=20) as client:
        r = client.post(
            GOOGLE_TOKEN_URL,
            data={
                "code": code,
                "client_id": _client_id(),
                "client_secret": _client_secret(),
                "redirect_uri": _redirect_uri(),
                "grant_type": "authorization_code",
            },
        )
    r.raise_for_status()
    return r.json()


def refresh_access_token(refresh_token: str) -> dict:
    with httpx.Client(timeout=20) as client:
        r = client.post(
            GOOGLE_TOKEN_URL,
            data={
                "refresh_token": refresh_token,
                "client_id": _client_id(),
                "client_secret": _client_secret(),
                "grant_type": "refresh_token",
            },
        )
    r.raise_for_status()
    return r.json()


def fetch_userinfo(access_token: str) -> dict:
    with httpx.Client(timeout=20) as client:
        r = client.get(
            GOOGLE_USERINFO_URL,
            headers={"Authorization": f"Bearer {access_token}"},
        )
    r.raise_for_status()
    return r.json()


# ── Free/busy ─────────────────────────────────────────────────────────────


def free_busy(access_token: str, time_min: datetime, time_max: datetime) -> list[dict]:
    """Return [{start, end}] busy intervals for the connected user's
    primary calendar, in UTC ISO strings."""
    payload = {
        "timeMin": _iso(time_min),
        "timeMax": _iso(time_max),
        "items": [{"id": "primary"}],
    }
    with httpx.Client(timeout=20) as client:
        r = client.post(
            GOOGLE_FREEBUSY_URL,
            headers={"Authorization": f"Bearer {access_token}"},
            json=payload,
        )
    r.raise_for_status()
    data = r.json()
    cals = data.get("calendars") or {}
    busy = (cals.get("primary") or {}).get("busy") or []
    return [{"start": b["start"], "end": b["end"]} for b in busy]


def _iso(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


# ── Slot suggester ────────────────────────────────────────────────────────


def suggest_slots(
    busy: list[dict],
    *,
    duration_minutes: int = 30,
    days_ahead: int = 5,
    start_hour: int = 9,
    end_hour: int = 17,
    buffer_minutes: int = 15,
    now: Optional[datetime] = None,
) -> list[dict]:
    """Walk the next `days_ahead` weekdays in 30-min steps, skip
    intervals that overlap any `busy` block (with `buffer_minutes`
    padding on both sides), return up to 8 candidate slots.

    `busy` items are dicts with ISO 'start'/'end' strings as returned
    by `free_busy()`.
    """
    if now is None:
        now = datetime.now(timezone.utc)

    # Parse busy windows into datetime tuples once.
    busy_intervals: list[tuple[datetime, datetime]] = []
    for b in busy or []:
        try:
            s = _parse_iso(b["start"])
            e = _parse_iso(b["end"])
        except Exception:
            continue
        busy_intervals.append((
            s - timedelta(minutes=buffer_minutes),
            e + timedelta(minutes=buffer_minutes),
        ))

    out: list[dict] = []
    duration = timedelta(minutes=duration_minutes)
    step = timedelta(minutes=30)
    day = now.replace(minute=0, second=0, microsecond=0)
    day_cursor = day + timedelta(hours=1)  # start probing from the next full hour

    for _ in range(days_ahead * 48):
        if len(out) >= 8:
            break
        # Skip weekends.
        if day_cursor.weekday() >= 5:
            day_cursor = day_cursor.replace(hour=start_hour, minute=0) + timedelta(days=1)
            continue
        # Enforce business hours.
        if day_cursor.hour < start_hour:
            day_cursor = day_cursor.replace(hour=start_hour, minute=0)
            continue
        if day_cursor.hour >= end_hour:
            # Jump to start_hour next day
            day_cursor = (day_cursor + timedelta(days=1)).replace(hour=start_hour, minute=0)
            continue

        slot_start = day_cursor
        slot_end = slot_start + duration
        # Make sure the slot ends within business hours too.
        if slot_end.hour > end_hour or (slot_end.hour == end_hour and slot_end.minute > 0):
            day_cursor = (day_cursor + timedelta(days=1)).replace(hour=start_hour, minute=0)
            continue

        clashes = any(
            slot_start < bend and slot_end > bstart
            for (bstart, bend) in busy_intervals
        )
        if not clashes:
            out.append({
                "start": _iso(slot_start),
                "end": _iso(slot_end),
                "day_of_week": slot_start.strftime("%A"),
                "label": slot_start.strftime("%a %b %d, %I:%M %p UTC"),
            })

        day_cursor += step

    return out


def _parse_iso(s: str) -> datetime:
    """Parse Google's RFC 3339 timestamps. `2025-05-12T08:00:00Z` style."""
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    return datetime.fromisoformat(s)
