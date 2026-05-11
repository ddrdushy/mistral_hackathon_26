"""Merge.dev unified ATS/HRIS adapter — DOCUMENTED STUB.

Merge.dev (https://www.merge.dev/) is a unified API that fronts
Greenhouse, Lever, Workday, BambooHR, ADP, iCIMS, and 40+ others.
Cheapest way to ship breadth: implement one adapter against Merge's
common schema instead of N separate native adapters.

This file is a stub — fill in the network calls when ready. The
TODOs below map to specific Merge endpoints; nothing else in the
codebase needs to change when this is wired up.

Pricing note (spec): Merge.dev starts ~$650/mo. Tenants on the Pro
plan typically expect this; bake into pricing.

Auth flow:
- Merge Link returns a `public_token` to the frontend
- Backend exchanges it for an `account_token` via
  POST https://api.merge.dev/api/ats/v1/account-token/{public_token}
- Store the account_token in encrypted_credentials

Headers for every API call:
  Authorization: Bearer <MERGE_API_KEY>            ← platform key
  X-Account-Token: <account_token>                 ← per-tenant
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Optional

from .base import (
    ExternalApplication,
    ExternalCandidate,
    ExternalJob,
    IntegrationAdapter,
)

logger = logging.getLogger("hireops.integrations.merge")


class MergeAdapter(IntegrationAdapter):
    """STUB. Will be filled in by a follow-up turn."""

    provider = "merge"
    _API_BASE = "https://api.merge.dev/api/ats/v1"

    async def test_connection(self) -> bool:
        # TODO: GET /account-details
        raise NotImplementedError("Merge adapter not yet implemented")

    async def list_jobs(self, since: Optional[datetime] = None) -> list[ExternalJob]:
        # TODO: GET /jobs?modified_after={since}&page_size=100&expand=...
        raise NotImplementedError("Merge adapter not yet implemented")

    async def list_candidates(self, since: Optional[datetime] = None) -> list[ExternalCandidate]:
        # TODO: GET /candidates?modified_after={since}
        raise NotImplementedError("Merge adapter not yet implemented")

    async def list_applications(self, since: Optional[datetime] = None) -> list[ExternalApplication]:
        # TODO: GET /applications?modified_after={since}
        raise NotImplementedError("Merge adapter not yet implemented")

    async def push_candidate(self, internal_candidate, internal_application) -> Optional[str]:
        # TODO: POST /candidates with the candidate+application payload
        raise NotImplementedError("Merge adapter not yet implemented")

    async def push_stage_change(self, external_app_id: str, new_stage: str) -> bool:
        # TODO: PATCH /applications/{id} body { current_stage: ... }
        raise NotImplementedError("Merge adapter not yet implemented")

    async def push_hire(self, external_app_id: str, start_date) -> bool:
        raise NotImplementedError("Merge adapter not yet implemented")

    def get_stage_catalog(self) -> list[str]:
        # In production: cache /scorecards or /stages once per session.
        return ["applied", "interview", "offer", "hired", "rejected"]
