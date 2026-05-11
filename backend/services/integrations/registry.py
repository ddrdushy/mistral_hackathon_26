"""Adapter registry — single lookup point for the sync engine and
router. Keep provider strings in sync with ExternalIntegration.provider.
"""
from __future__ import annotations

import json
import os
from typing import Type

from .base import IntegrationAdapter
from .mock_adapter import MockAdapter
from .merge_adapter import MergeAdapter
from .greenhouse_adapter import GreenhouseAdapter
from .lever_adapter import LeverAdapter

_ADAPTERS: dict[str, Type[IntegrationAdapter]] = {
    "mock": MockAdapter,
    "merge": MergeAdapter,
    "greenhouse": GreenhouseAdapter,
    "lever": LeverAdapter,
}


def available_providers() -> list[dict]:
    """Catalog returned by /integrations/hris/available. UI renders
    one card per entry; `enabled=False` providers are visible but the
    connect button is disabled with a 'coming soon' tooltip."""
    return [
        {
            "id": "mock",
            "name": "Mock provider",
            "description": "In-memory demo provider — exercises the full pipeline without external API access.",
            "enabled": True,
            "auth_method": "seed",  # caller passes a string seed
            "logo": None,
        },
        {
            "id": "merge",
            "name": "Merge.dev (unified ATS)",
            "description": "One connection, 40+ ATS/HRIS providers (Greenhouse, Lever, Workday, BambooHR, ADP, iCIMS, …).",
            # Enabled when the platform MERGE_API_KEY is configured.
            # Without it, tenants would just hit a 401 on every call.
            "enabled": bool(os.getenv("MERGE_API_KEY", "").strip()),
            "auth_method": "public_token",
            "logo": None,
        },
        {
            "id": "greenhouse",
            "name": "Greenhouse",
            "description": "Native — full scorecard + custom field access.",
            "enabled": False,
            "auth_method": "api_key",
            "logo": None,
        },
        {
            "id": "lever",
            "name": "Lever",
            "description": "Native — OAuth flow; opportunity-centric.",
            "enabled": False,
            "auth_method": "oauth",
            "logo": None,
        },
    ]


def get_adapter(integration) -> IntegrationAdapter:
    """Instantiate the right adapter for an ExternalIntegration row.

    `integration` may be the SQLAlchemy row OR a dict; both are
    supported so tests can pass dicts without hitting the DB.
    """
    if hasattr(integration, "provider"):
        provider = integration.provider
        raw_creds = getattr(integration, "encrypted_credentials", "") or "{}"
        raw_settings = getattr(integration, "settings_json", "") or "{}"
        # Decrypt creds at construction time
        from services.secrets_crypto import decrypt
        try:
            plaintext = decrypt(raw_creds) if raw_creds else "{}"
        except Exception:
            plaintext = "{}"
        try:
            credentials = json.loads(plaintext) if plaintext else {}
        except Exception:
            credentials = {}
        try:
            settings = json.loads(raw_settings) if raw_settings else {}
        except Exception:
            settings = {}
    else:
        provider = integration.get("provider", "")
        credentials = integration.get("credentials", {})
        settings = integration.get("settings", {})

    cls = _ADAPTERS.get(provider)
    if not cls:
        raise ValueError(f"Unknown integration provider: {provider}")
    return cls(credentials, settings)
