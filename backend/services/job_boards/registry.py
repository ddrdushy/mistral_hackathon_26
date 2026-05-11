"""Provider catalog + decrypt-and-build helper for job-board adapters."""
from __future__ import annotations

import json
import os
from typing import Type

from .base import JobBoardAdapter
from .facebook_board import FacebookBoardAdapter
from .indeed_board import IndeedBoardAdapter
from .linkedin_board import LinkedInBoardAdapter
from .mock_board import MockBoardAdapter
from .myfuturejobs_board import MyFutureJobsBoardAdapter


# id → class. Keep keys lowercase to match JobBoardConnection.provider.
_ADAPTER_CLASSES: dict[str, Type[JobBoardAdapter]] = {
    "mock": MockBoardAdapter,
    "linkedin": LinkedInBoardAdapter,
    "indeed": IndeedBoardAdapter,
    "facebook": FacebookBoardAdapter,
    "myfuturejobs": MyFutureJobsBoardAdapter,
}


def available_providers() -> list[dict]:
    """Provider catalog for the UI.

    auth_mode tells the frontend how to render the Connect button:
      - "oauth"  → render a single 'Connect with X' button that calls
                   GET /api/v1/job-boards/{provider}/oauth/start and
                   redirects the browser to the returned authorize URL.
      - "manual" → render a form with the listed auth_fields (used by
                   the Mock provider and providers without OAuth).
      - "feed"   → no creds needed; we serve a per-tenant XML feed at
                   a stable URL and tenant adds it on the provider side.
    """
    linkedin_app_set = bool(os.getenv("LINKEDIN_APP_CLIENT_ID", "").strip())
    facebook_app_set = bool(os.getenv("FACEBOOK_APP_ID", "").strip())
    return [
        {
            "id": "mock",
            "name": "Mock provider",
            "description": "In-memory test board. Always works; useful for demos and CI.",
            "enabled": True,
            "auth_mode": "manual",
            "auth_fields": ["seed"],
        },
        {
            "id": "linkedin",
            "name": "LinkedIn",
            "description": "Publish to your LinkedIn Company Page. Sign in with the account that admins the Page.",
            "enabled": linkedin_app_set,
            "auth_mode": "oauth",
            "auth_fields": [],
            "disabled_reason": (
                None
                if linkedin_app_set
                else "Platform admin must set LINKEDIN_APP_CLIENT_ID + LINKEDIN_APP_CLIENT_SECRET."
            ),
        },
        {
            "id": "facebook",
            "name": "Facebook Page",
            "description": "Publish as a post on your Facebook Page. Sign in with the account that admins the Page.",
            "enabled": facebook_app_set,
            "auth_mode": "oauth",
            "auth_fields": [],
            "disabled_reason": (
                None
                if facebook_app_set
                else "Platform admin must set FACEBOOK_APP_ID + FACEBOOK_APP_SECRET."
            ),
        },
        {
            "id": "indeed",
            "name": "Indeed",
            "description": "Indeed pulls jobs from a per-tenant XML feed every few hours. No password needed — just add our feed URL to your Indeed Employer dashboard.",
            "enabled": False,  # feed endpoint pending — flip when /feeds/{slug}/indeed.xml ships
            "auth_mode": "feed",
            "auth_fields": [],
            "disabled_reason": "Per-tenant XML feed endpoint pending.",
        },
        {
            "id": "myfuturejobs",
            "name": "MyFutureJobs (Malaysia)",
            "description": "Malaysia's national job portal (PERKESO / SOCSO). Requires partner agreement — no public OAuth.",
            "enabled": bool(os.getenv("MYFUTUREJOBS_PARTNER_KEY", "").strip()),
            "auth_mode": "manual",
            "auth_fields": ["api_key", "company_id"],
        },
    ]


def get_adapter_for_provider(provider: str, credentials: dict, settings: dict) -> JobBoardAdapter:
    cls = _ADAPTER_CLASSES.get(provider)
    if not cls:
        raise ValueError(f"Unknown job board provider: {provider}")
    return cls(credentials, settings)


def get_adapter(connection) -> JobBoardAdapter:
    """Resolve an adapter for a JobBoardConnection row. Decrypts the
    credentials blob on the way through."""
    from services.secrets_crypto import decrypt

    try:
        creds = json.loads(decrypt(connection.encrypted_credentials)) if connection.encrypted_credentials else {}
    except Exception:
        creds = {}
    try:
        settings = json.loads(connection.settings_json or "{}")
    except Exception:
        settings = {}
    return get_adapter_for_provider(connection.provider, creds, settings)
