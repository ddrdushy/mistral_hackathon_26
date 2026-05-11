"""Greenhouse Harvest API adapter — DOCUMENTED STUB.

Greenhouse Harvest API (https://developers.greenhouse.io/harvest.html)
exposes the deepest set of fields (scorecards, custom fields, custom
job stages) that Merge's unified abstraction doesn't surface. Connect
natively when those depth-sensitive use cases come up.

Auth: HTTP Basic with `api_key:` (note trailing colon — empty password).
Rate limit: 50 requests per 10 seconds. Adapter MUST sleep or 429.

Webhooks (manual setup by customer):
- Greenhouse "Web Hooks" UI → URL: https://<your-backend>/api/v1/integrations/hris/webhook/greenhouse
- Subscribe to: candidate.created, candidate.updated, application.updated, scorecard.created
- Provide signing secret via X-Greenhouse-Signature header verification
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

logger = logging.getLogger("hireops.integrations.greenhouse")


class GreenhouseAdapter(IntegrationAdapter):
    """STUB. Will be filled in by a follow-up turn."""

    provider = "greenhouse"
    _API_BASE = "https://harvest.greenhouse.io/v1"

    async def test_connection(self) -> bool:
        # TODO: GET /users with the credentials. 401 means bad key.
        raise NotImplementedError("Greenhouse adapter not yet implemented")

    async def list_jobs(self, since: Optional[datetime] = None) -> list[ExternalJob]:
        # TODO: GET /jobs?per_page=500&updated_after={since}. Paginate.
        raise NotImplementedError("Greenhouse adapter not yet implemented")

    async def list_candidates(self, since: Optional[datetime] = None) -> list[ExternalCandidate]:
        # TODO: GET /candidates?per_page=500&updated_after={since}
        raise NotImplementedError("Greenhouse adapter not yet implemented")

    async def list_applications(self, since: Optional[datetime] = None) -> list[ExternalApplication]:
        # TODO: GET /applications?per_page=500&updated_after={since}
        raise NotImplementedError("Greenhouse adapter not yet implemented")

    async def push_candidate(self, internal_candidate, internal_application) -> Optional[str]:
        # TODO: POST /candidates with name+email+resumes. The response's
        # `id` is the external id we store in ExternalIdMapping.
        raise NotImplementedError("Greenhouse adapter not yet implemented")

    async def push_stage_change(self, external_app_id: str, new_stage: str) -> bool:
        # TODO: POST /applications/{id}/move_to_next_stage_or move_to_specific_stage
        raise NotImplementedError("Greenhouse adapter not yet implemented")

    async def push_hire(self, external_app_id: str, start_date) -> bool:
        # TODO: POST /applications/{id}/hire body { offer_attributes: ... }
        raise NotImplementedError("Greenhouse adapter not yet implemented")

    def get_stage_catalog(self) -> list[str]:
        # In production: cache /job_stages once per session, expose as list.
        return [
            "Application Review",
            "Phone Interview",
            "Take Home",
            "On-Site",
            "Offer",
            "Hired",
            "Rejected",
        ]
