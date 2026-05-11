"""MyFutureJobs (Malaysia) adapter — DOCUMENTED STUB.

MyFutureJobs is Malaysia's national government-run job portal
(operated by PERKESO / SOCSO). For Malaysian employers it's the
#1 distribution channel after Maukerja / JobStreet.

Their public-facing employer portal is at https://www.myfuturejobs.gov.my/
and the published bulk-posting docs reference an XML feed (similar
to Indeed) for high-volume employers, plus an SSO-based manual
posting flow.

Auth path the partner agreement opens:
- Employer obtains an API key from PERKESO Employer Service Centre
  (ESC) after agreement.
- POST https://api.myfuturejobs.gov.my/api/v1/job_posts
  (endpoint shape per docs available to approved partners)

Fields the portal cares about that other boards don't:
- `job_type` (full-time / part-time / contract / internship)
- `state` (Selangor / KL / Penang / Johor / etc — enum)
- `salary_min`, `salary_max` (MYR)
- `industry` (mapped to MOHR taxonomy)

Set tenant-specific defaults in JobBoardConnection.settings_json:
  { "company_id": "...", "default_state": "Selangor",
    "default_industry": "Information Technology" }
"""
from __future__ import annotations

import logging
from typing import Any

from .base import JobBoardAdapter, JobPostDraft, JobPostResult

logger = logging.getLogger("hireops.job_boards.myfuturejobs")


class MyFutureJobsBoardAdapter(JobBoardAdapter):
    provider = "myfuturejobs"

    async def test_connection(self) -> bool:
        # TODO: GET /employer/profile with bearer token
        raise NotImplementedError("MyFutureJobs adapter pending partner agreement with PERKESO ESC")

    async def publish(self, draft: JobPostDraft) -> JobPostResult:
        # TODO: POST /job_posts with Malaysian-specific fields from
        # self.settings (state, industry) plus the universal job draft.
        raise NotImplementedError("MyFutureJobs adapter pending partner agreement")

    async def unpublish(self, external_id: str) -> bool:
        # TODO: PATCH /job_posts/{id} status=closed
        raise NotImplementedError("MyFutureJobs adapter pending partner agreement")
