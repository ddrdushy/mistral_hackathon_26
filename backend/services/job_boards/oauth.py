"""Shared OAuth machinery for job-board adapters.

Each provider (LinkedIn, Facebook, …) follows the same pattern:
  1. Tenant clicks "Connect with X" in our UI.
  2. We sign a short-lived state JWT containing the tenant_id, user_id,
     provider, and a CSRF nonce, then redirect the browser to the
     provider's authorize URL with our redirect_uri + state.
  3. Provider redirects back to /api/v1/job-boards/{provider}/oauth/callback
     with ?code=... &state=...
  4. We verify the state JWT, exchange the code for an access_token,
     persist into JobBoardConnection.encrypted_credentials, and redirect
     the browser back to /settings/job-boards.

Platform credentials live in env vars per provider — these identify
OUR app to the provider. Per-tenant credentials (the access_token a
tenant just authorised) live encrypted in the DB.
"""
from __future__ import annotations

import logging
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional
from urllib.parse import urlencode

import jwt

from auth.security import _jwt_secret  # type: ignore[attr-defined]

logger = logging.getLogger("hireops.job_boards.oauth")

# State JWTs are very short-lived — the user goes to the provider and
# comes straight back. 15 minutes is generous.
STATE_TTL_MINUTES = 15
STATE_ALGORITHM = "HS256"


# ─── Platform-level config per provider ──────────────────────────────────────


def linkedin_app() -> tuple[str, str]:
    """Returns (client_id, client_secret) or empty strings if unconfigured."""
    return (
        os.getenv("LINKEDIN_APP_CLIENT_ID", "").strip(),
        os.getenv("LINKEDIN_APP_CLIENT_SECRET", "").strip(),
    )


def facebook_app() -> tuple[str, str]:
    return (
        os.getenv("FACEBOOK_APP_ID", "").strip(),
        os.getenv("FACEBOOK_APP_SECRET", "").strip(),
    )


def public_base_url() -> str:
    """Where the callback redirect URI must point. Trailing slash stripped."""
    return (os.getenv("BACKEND_PUBLIC_URL") or "https://hireops.symprio.com").rstrip("/")


def frontend_url() -> str:
    return (os.getenv("FRONTEND_URL") or "https://hireops.symprio.com").rstrip("/")


def redirect_uri(provider: str) -> str:
    """Provider-side redirect_uri. MUST match exactly what we registered
    in the provider's developer console."""
    return f"{public_base_url()}/api/v1/job-boards/{provider}/oauth/callback"


# ─── State token (CSRF + intent) ─────────────────────────────────────────────


def issue_state(*, tenant_id: int, user_id: int, provider: str) -> str:
    """Sign a JWT that survives the round-trip to the provider. The
    callback verifies it before doing anything stateful, so an attacker
    can't forge a callback with a different tenant_id / provider."""
    now = datetime.now(timezone.utc)
    payload = {
        "tid": tenant_id,
        "sub": str(user_id),
        "p": provider,
        "n": secrets.token_urlsafe(16),
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=STATE_TTL_MINUTES)).timestamp()),
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=STATE_ALGORITHM)


def verify_state(token: str, expected_provider: str) -> Optional[dict]:
    """Decode + reject if expired / wrong provider / wrong signature.
    Returns the payload (with tid + sub) on success, None on failure."""
    try:
        data = jwt.decode(token, _jwt_secret(), algorithms=[STATE_ALGORITHM])
    except jwt.PyJWTError as e:
        logger.warning("oauth state decode failed: %s", e)
        return None
    if data.get("p") != expected_provider:
        logger.warning("oauth state provider mismatch: %s vs %s", data.get("p"), expected_provider)
        return None
    return data


# ─── Authorize-URL builders ──────────────────────────────────────────────────


def linkedin_authorize_url(state: str) -> str:
    """Builds the LinkedIn OAuth 2.0 authorize URL.

    Scopes we ask for:
      - r_liteprofile — read the connecting user's name + photo (display only)
      - w_member_social — post on behalf of the member (fallback path)
      - w_organization_social — post on behalf of a Company Page (preferred)
      - r_organization_admin — list which Pages the member admins, so the
        UI can let them pick the right one before first publish
    """
    client_id, _ = linkedin_app()
    if not client_id:
        raise RuntimeError("LINKEDIN_APP_CLIENT_ID not configured")
    scopes = "r_liteprofile w_member_social w_organization_social r_organization_admin"
    qs = urlencode({
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri("linkedin"),
        "scope": scopes,
        "state": state,
    })
    return f"https://www.linkedin.com/oauth/v2/authorization?{qs}"


def facebook_authorize_url(state: str) -> str:
    """Builds the Facebook (Meta) OAuth authorize URL.

    Scopes:
      - pages_show_list — list the user's Pages
      - pages_manage_posts — create posts on those Pages
      - pages_read_engagement — read post metadata (required alongside
        manage_posts in current Meta policy)
    """
    client_id, _ = facebook_app()
    if not client_id:
        raise RuntimeError("FACEBOOK_APP_ID not configured")
    scopes = "pages_show_list,pages_manage_posts,pages_read_engagement"
    qs = urlencode({
        "client_id": client_id,
        "redirect_uri": redirect_uri("facebook"),
        "scope": scopes,
        "state": state,
        "response_type": "code",
    })
    return f"https://www.facebook.com/v18.0/dialog/oauth?{qs}"
