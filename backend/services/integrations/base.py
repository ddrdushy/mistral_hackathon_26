"""Adapter interface + DTOs used by every integration provider."""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional


@dataclass
class ExternalJob:
    external_id: str
    title: str
    department: str = ""
    location: str = ""
    status: str = "open"
    description: str = ""
    raw: dict = field(default_factory=dict)
    updated_at: Optional[datetime] = None


@dataclass
class ExternalCandidate:
    external_id: str
    name: str
    email: str = ""
    phone: str = ""
    resume_text: str = ""
    source: str = ""
    raw: dict = field(default_factory=dict)
    updated_at: Optional[datetime] = None


@dataclass
class ExternalApplication:
    external_id: str
    external_job_id: str
    external_candidate_id: str
    stage: str = ""
    status: str = "active"
    raw: dict = field(default_factory=dict)
    updated_at: Optional[datetime] = None


class IntegrationAdapter(ABC):
    """All HRIS/ATS adapters implement this interface. The sync engine
    is provider-agnostic; per-provider details (auth, pagination, field
    shape) stay inside the adapter."""

    provider: str  # subclasses set this; matches ExternalIntegration.provider

    def __init__(self, credentials: dict[str, Any], settings: dict[str, Any]):
        self.credentials = credentials or {}
        self.settings = settings or {}

    # ── Health ──────────────────────────────────────────────────────────────

    @abstractmethod
    async def test_connection(self) -> bool:
        """Return True if the credentials work."""

    # ── Pull (external → HireOps) ──────────────────────────────────────────

    @abstractmethod
    async def list_jobs(self, since: Optional[datetime] = None) -> list[ExternalJob]: ...

    @abstractmethod
    async def list_candidates(self, since: Optional[datetime] = None) -> list[ExternalCandidate]: ...

    @abstractmethod
    async def list_applications(self, since: Optional[datetime] = None) -> list[ExternalApplication]: ...

    # ── Push (HireOps → external) ──────────────────────────────────────────

    @abstractmethod
    async def push_candidate(self, internal_candidate, internal_application) -> Optional[str]:
        """Create or update the candidate in the external system. Returns
        the external id (so the engine can save it in ExternalIdMapping)."""

    @abstractmethod
    async def push_stage_change(self, external_app_id: str, new_stage: str) -> bool: ...

    @abstractmethod
    async def push_hire(self, external_app_id: str, start_date) -> bool: ...

    # ── Mapping metadata ────────────────────────────────────────────────────

    @abstractmethod
    def get_stage_catalog(self) -> list[str]:
        """The provider's stage names — used by the mapping UI."""
