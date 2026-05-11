"""Indeed Job Posting adapter — DOCUMENTED STUB.

Indeed publishing for SMBs is XML-feed based: tenant posts a feed URL
to their Indeed Employer account, and Indeed pulls it on their cadence
(typically every few hours). That makes a true "publish now" semantic
impossible for the free path — we'd need Indeed Apply integration
(partner program) for instant publishing.

This stub captures both flows:
- publish() generates an XML entry that would be appended to the
  tenant's feed (we'd serve a per-tenant /indeed-feed.xml route).
- The "Sponsored Job" REST API requires partner access and budget
  config; the TODO points at the right endpoint when ready.
"""
from __future__ import annotations

import logging
from typing import Any

from .base import JobBoardAdapter, JobPostDraft, JobPostResult

logger = logging.getLogger("hireops.job_boards.indeed")


class IndeedBoardAdapter(JobBoardAdapter):
    provider = "indeed"

    async def test_connection(self) -> bool:
        # XML-feed mode has no API to ping; partner mode would GET
        # https://employers.indeed.com/api/v1/account/me
        raise NotImplementedError("Indeed adapter pending feed / partner setup")

    async def publish(self, draft: JobPostDraft) -> JobPostResult:
        # TODO: append entry to tenant's feed; require Indeed-side
        # 'Source URL' to be set to https://{our-domain}/feeds/{slug}.xml
        # Partner-mode equivalent:
        # POST https://employers.indeed.com/api/v1/jobs body Indeed
        # 'Sponsored Job' payload.
        raise NotImplementedError("Indeed adapter pending feed / partner setup")

    async def unpublish(self, external_id: str) -> bool:
        # Remove from feed XML; partner-mode equivalent:
        # DELETE https://employers.indeed.com/api/v1/jobs/{id}
        raise NotImplementedError("Indeed adapter pending feed / partner setup")
