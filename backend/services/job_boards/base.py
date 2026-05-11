"""Base classes + DTOs for job-board adapters."""
from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Optional


@dataclass
class JobPostDraft:
    """Provider-neutral job representation used by every adapter.

    Adapters translate this into their provider's payload shape — LinkedIn
    Talent Hub, Indeed XML feed, FB Marketplace, MyFutureJobs REST, etc.
    """
    internal_job_id: int
    job_id: str  # JOB-YYYY-NNN (visible reference)
    title: str
    description: str
    department: str
    location: str
    seniority: str
    skills: list[str]
    responsibilities: list[str]
    qualifications: list[str]
    # Tenant-side overrides set in JobBoardConnection.settings_json
    settings: dict[str, Any] = field(default_factory=dict)


@dataclass
class JobPostResult:
    ok: bool
    # Provider-assigned id, used to refer to the posting on subsequent
    # operations (unpublish, fetch_status).
    external_id: str = ""
    # Public URL where the live ad can be viewed.
    external_url: str = ""
    # Free-text human-readable error on failure.
    error: str = ""
    # Optional raw payload — adapters can return their full provider
    # response for debugging / per-board status surface.
    raw: dict = field(default_factory=dict)


class JobBoardAdapter(ABC):
    """One adapter per provider. Stateless across calls — instance
    receives decrypted credentials + tenant settings at construction.
    """

    # Override in subclasses
    provider: str = ""

    def __init__(self, credentials: dict[str, Any], settings: dict[str, Any]):
        self.credentials = credentials or {}
        self.settings = settings or {}

    @abstractmethod
    async def test_connection(self) -> bool:
        """Cheap auth check (e.g. GET /me). Return True if credentials
        look valid. Adapters may raise for actionable errors."""

    @abstractmethod
    async def publish(self, draft: JobPostDraft) -> JobPostResult:
        """Push a new job ad to the provider. Returns external_id +
        external_url on success."""

    @abstractmethod
    async def unpublish(self, external_id: str) -> bool:
        """Take the posting down. Return True if removed (or already gone)."""

    async def fetch_status(self, external_id: str) -> dict:
        """Optional: return current provider-side status (views,
        applications, expired). Default is a no-op for providers
        without that visibility."""
        return {"supported": False}
