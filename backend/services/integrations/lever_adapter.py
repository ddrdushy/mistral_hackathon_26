"""Lever adapter — DOCUMENTED STUB.

Lever uses OAuth (https://hire.lever.co/developer/oauth). Auth flow
requires BACKEND_PUBLIC_URL set so Lever can redirect back to us.

Endpoints (https://hire.lever.co/developer/documentation):
- /opportunities — Lever's term for an application
- /postings — jobs
- /users — recruiters

Rate limit: ~10 requests/second. Adapter must respect.
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

logger = logging.getLogger("hireops.integrations.lever")


class LeverAdapter(IntegrationAdapter):
    """STUB. Will be filled in by a follow-up turn."""

    provider = "lever"
    _API_BASE = "https://api.lever.co/v1"

    async def test_connection(self) -> bool:
        # TODO: GET /users/me with the OAuth access_token
        raise NotImplementedError("Lever adapter not yet implemented")

    async def list_jobs(self, since: Optional[datetime] = None) -> list[ExternalJob]:
        # TODO: GET /postings?updated_at_start={since}. Paginate via offset.
        raise NotImplementedError("Lever adapter not yet implemented")

    async def list_candidates(self, since: Optional[datetime] = None) -> list[ExternalCandidate]:
        # TODO: GET /opportunities returns candidate-centric records;
        # Lever doesn't have a separate candidates endpoint.
        raise NotImplementedError("Lever adapter not yet implemented")

    async def list_applications(self, since: Optional[datetime] = None) -> list[ExternalApplication]:
        # TODO: Same /opportunities endpoint, filter to active opportunities.
        raise NotImplementedError("Lever adapter not yet implemented")

    async def push_candidate(self, internal_candidate, internal_application) -> Optional[str]:
        # TODO: POST /opportunities body { name, email, postings: [...] }
        raise NotImplementedError("Lever adapter not yet implemented")

    async def push_stage_change(self, external_app_id: str, new_stage: str) -> bool:
        # TODO: POST /opportunities/{id}/stage body { stage: stage_id }
        raise NotImplementedError("Lever adapter not yet implemented")

    async def push_hire(self, external_app_id: str, start_date) -> bool:
        raise NotImplementedError("Lever adapter not yet implemented")

    def get_stage_catalog(self) -> list[str]:
        return ["lead", "applicant", "phone-screen", "onsite", "offer", "hired", "rejected"]
