"""Mock HRIS adapter — Feature 9.

In-memory provider that satisfies the full IntegrationAdapter interface
without external API access. Used to:
  - prove the sync engine end-to-end in dev / CI
  - let tenants demo the integration UI before real adapters ship
  - act as a reference implementation for the real Merge / Greenhouse /
    Lever adapters

The "external store" is a per-credentials dict keyed by a deterministic
prefix so multiple mock connections don't bleed into each other.
"""
from __future__ import annotations

import hashlib
import logging
from datetime import datetime
from typing import Any, Optional

from .base import (
    ExternalApplication,
    ExternalCandidate,
    ExternalJob,
    IntegrationAdapter,
)

logger = logging.getLogger("hireops.integrations.mock")


# Module-level store so all instances with the same key share state —
# pulls become deterministic across calls.
_STORE: dict[str, dict] = {}


def _store_key(credentials: dict) -> str:
    raw = (credentials or {}).get("seed") or "default"
    h = hashlib.md5(raw.encode("utf-8")).hexdigest()[:8]
    return f"mock_{h}"


def _ensure_store(key: str) -> dict:
    if key not in _STORE:
        _STORE[key] = {
            "jobs": {
                "JOB-EXT-001": ExternalJob(
                    external_id="JOB-EXT-001",
                    title="Senior Backend Engineer",
                    department="Engineering",
                    location="Remote",
                    status="open",
                    description="Demo job pulled from the mock provider.",
                    updated_at=datetime.utcnow(),
                ),
                "JOB-EXT-002": ExternalJob(
                    external_id="JOB-EXT-002",
                    title="Product Designer",
                    department="Design",
                    location="NYC",
                    status="open",
                    description="Another demo job.",
                    updated_at=datetime.utcnow(),
                ),
            },
            "candidates": {
                "CAND-EXT-001": ExternalCandidate(
                    external_id="CAND-EXT-001",
                    name="Alex Demo",
                    email="alex.demo@example.com",
                    phone="+15555550100",
                    source="mock_provider",
                    updated_at=datetime.utcnow(),
                ),
                "CAND-EXT-002": ExternalCandidate(
                    external_id="CAND-EXT-002",
                    name="Jordan Demo",
                    email="jordan.demo@example.com",
                    source="mock_provider",
                    updated_at=datetime.utcnow(),
                ),
            },
            "applications": {
                "APP-EXT-001": ExternalApplication(
                    external_id="APP-EXT-001",
                    external_job_id="JOB-EXT-001",
                    external_candidate_id="CAND-EXT-001",
                    stage="phone_screen",
                    status="active",
                    updated_at=datetime.utcnow(),
                ),
            },
            "pushed": [],  # log every push for inspection in the UI
        }
    return _STORE[key]


class MockAdapter(IntegrationAdapter):
    """Reference implementation. Every method works locally."""

    provider = "mock"

    def __init__(self, credentials: dict[str, Any], settings: dict[str, Any]):
        super().__init__(credentials, settings)
        self._key = _store_key(credentials)
        self._store = _ensure_store(self._key)

    async def test_connection(self) -> bool:
        # Real adapters would ping the provider's /me endpoint here.
        return True

    async def list_jobs(self, since: Optional[datetime] = None) -> list[ExternalJob]:
        rows = list(self._store["jobs"].values())
        if since:
            rows = [j for j in rows if j.updated_at and j.updated_at >= since]
        return rows

    async def list_candidates(self, since: Optional[datetime] = None) -> list[ExternalCandidate]:
        rows = list(self._store["candidates"].values())
        if since:
            rows = [c for c in rows if c.updated_at and c.updated_at >= since]
        return rows

    async def list_applications(self, since: Optional[datetime] = None) -> list[ExternalApplication]:
        rows = list(self._store["applications"].values())
        if since:
            rows = [a for a in rows if a.updated_at and a.updated_at >= since]
        return rows

    async def push_candidate(self, internal_candidate, internal_application) -> Optional[str]:
        ext_id = f"CAND-EXT-{abs(hash((self._key, internal_candidate.id))) % 100000:05d}"
        self._store["candidates"][ext_id] = ExternalCandidate(
            external_id=ext_id,
            name=getattr(internal_candidate, "name", "") or "",
            email=getattr(internal_candidate, "email", "") or "",
            phone=getattr(internal_candidate, "phone", "") or "",
            source="hireops",
            updated_at=datetime.utcnow(),
        )
        self._store["pushed"].append({
            "type": "candidate",
            "external_id": ext_id,
            "at": datetime.utcnow().isoformat(),
        })
        return ext_id

    async def push_stage_change(self, external_app_id: str, new_stage: str) -> bool:
        app = self._store["applications"].get(external_app_id)
        if app:
            app.stage = new_stage
            app.updated_at = datetime.utcnow()
        self._store["pushed"].append({
            "type": "stage_change",
            "external_id": external_app_id,
            "new_stage": new_stage,
            "at": datetime.utcnow().isoformat(),
        })
        return True

    async def push_hire(self, external_app_id: str, start_date) -> bool:
        app = self._store["applications"].get(external_app_id)
        if app:
            app.stage = "hired"
            app.status = "hired"
            app.updated_at = datetime.utcnow()
        self._store["pushed"].append({
            "type": "hire",
            "external_id": external_app_id,
            "start_date": str(start_date),
            "at": datetime.utcnow().isoformat(),
        })
        return True

    def get_stage_catalog(self) -> list[str]:
        return [
            "applied",
            "phone_screen",
            "tech_screen",
            "onsite",
            "offer",
            "hired",
            "rejected",
        ]
