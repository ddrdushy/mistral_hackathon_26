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
    """Provider catalog for the UI. Real providers are gated by an
    env flag so they don't surface as 'Connect' buttons before the
    network code is filled in."""
    return [
        {
            "id": "mock",
            "name": "Mock provider",
            "description": "In-memory test board. Always works; useful for demos and CI.",
            "enabled": True,
            "auth_fields": ["seed"],
        },
        {
            "id": "linkedin",
            "name": "LinkedIn Jobs",
            "description": "Publish via the LinkedIn Talent Solutions Job Postings API. Requires a LinkedIn partner agreement.",
            "enabled": bool(os.getenv("LINKEDIN_PARTNER_KEY", "").strip()),
            "auth_fields": ["access_token", "organization_id"],
        },
        {
            "id": "indeed",
            "name": "Indeed",
            "description": "XML feed or Indeed Sponsored Jobs partner API. Pulls every few hours when feed-mode.",
            "enabled": bool(os.getenv("INDEED_PARTNER_KEY", "").strip()),
            "auth_fields": ["api_key", "employer_id"],
        },
        {
            "id": "facebook",
            "name": "Facebook Pages",
            "description": "Publishes the job as a Page post via Graph API. Requires page admin token.",
            "enabled": bool(os.getenv("FACEBOOK_APP_ID", "").strip()),
            "auth_fields": ["page_id", "page_access_token"],
        },
        {
            "id": "myfuturejobs",
            "name": "MyFutureJobs (Malaysia)",
            "description": "Malaysia's national job portal (PERKESO / SOCSO). Requires partner agreement.",
            "enabled": bool(os.getenv("MYFUTUREJOBS_PARTNER_KEY", "").strip()),
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
