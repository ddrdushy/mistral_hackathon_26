"""In-memory mock job board — fully working for demos / CI.

Publishing assigns an external_id and a fake public URL. The store is
process-local, so re-running publish on the same job returns a new id
each time (which matches what real providers do — they don't dedupe).
"""
from __future__ import annotations

import hashlib
import logging
from datetime import datetime
from typing import Any

from .base import JobBoardAdapter, JobPostDraft, JobPostResult

logger = logging.getLogger("hireops.job_boards.mock")

# Module-level "boards" indexed by tenant seed so multiple mock
# connections in the same backend don't bleed into each other.
_STORE: dict[str, dict[str, dict]] = {}


def _store_for(creds: dict[str, Any]) -> dict[str, dict]:
    seed = (creds or {}).get("seed") or "default"
    if seed not in _STORE:
        _STORE[seed] = {}
    return _STORE[seed]


class MockBoardAdapter(JobBoardAdapter):
    provider = "mock"

    async def test_connection(self) -> bool:
        return True

    async def publish(self, draft: JobPostDraft) -> JobPostResult:
        store = _store_for(self.credentials)
        # Stable id per (seed, internal_job_id) so re-publish updates in place.
        suffix = hashlib.md5(
            f"{draft.internal_job_id}-{draft.title}".encode("utf-8")
        ).hexdigest()[:10]
        ext_id = f"MOCK-{suffix}"
        store[ext_id] = {
            "title": draft.title,
            "location": draft.location,
            "department": draft.department,
            "posted_at": datetime.utcnow().isoformat(),
            "live": True,
        }
        url = f"https://example-board.mock/posting/{ext_id}"
        return JobPostResult(ok=True, external_id=ext_id, external_url=url, raw=store[ext_id])

    async def unpublish(self, external_id: str) -> bool:
        store = _store_for(self.credentials)
        if external_id in store:
            store[external_id]["live"] = False
        return True

    async def fetch_status(self, external_id: str) -> dict:
        store = _store_for(self.credentials)
        row = store.get(external_id)
        if not row:
            return {"supported": True, "found": False}
        return {
            "supported": True,
            "found": True,
            "live": row.get("live", False),
            "posted_at": row.get("posted_at"),
        }
