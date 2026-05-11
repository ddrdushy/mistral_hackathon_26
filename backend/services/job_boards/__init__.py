"""Job-board adapters (LinkedIn, Indeed, Facebook Jobs, MyFutureJobs, …).

Distinct from `services/integrations/` (HRIS sync). Job boards are
OUTBOUND publishing — one job goes OUT to many destinations. HRIS is
bi-directional record sync.

Each adapter implements `JobBoardAdapter` (publish / unpublish /
fetch_status). The registry resolves a provider id to an adapter
class. A live "mock" adapter ships so demos work without any real
API keys.
"""
from __future__ import annotations

from .base import JobBoardAdapter, JobPostDraft, JobPostResult
from .registry import (
    available_providers,
    get_adapter,
    get_adapter_for_provider,
)

__all__ = [
    "JobBoardAdapter",
    "JobPostDraft",
    "JobPostResult",
    "available_providers",
    "get_adapter",
    "get_adapter_for_provider",
]
