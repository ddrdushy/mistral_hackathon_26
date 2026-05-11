"""LinkedIn Job Postings adapter — DOCUMENTED STUB.

LinkedIn Talent Solutions API ("Job Postings API") — requires a
partner agreement and an approved company on the Recruiter side.
- Auth: OAuth 2.0 → access_token tied to a company organization id.
- Post endpoint: POST https://api.linkedin.com/v2/simpleJobPostings
- Status endpoint: GET https://api.linkedin.com/v2/jobPostings/{id}
- Take down: DELETE https://api.linkedin.com/v2/jobPostings/{id}

For tenants without a partner agreement the public alternative is
"Share via LinkedIn" (manual share intent URL); we don't ship that
here because it's not really publishing.

Fill in the network calls behind the TODOs when LinkedIn approves
the partner application.
"""
from __future__ import annotations

import logging
from typing import Any

from .base import JobBoardAdapter, JobPostDraft, JobPostResult

logger = logging.getLogger("hireops.job_boards.linkedin")


class LinkedInBoardAdapter(JobBoardAdapter):
    provider = "linkedin"
    _API_BASE = "https://api.linkedin.com/v2"

    async def test_connection(self) -> bool:
        # TODO: GET /me — requires r_liteprofile or r_organization_admin
        raise NotImplementedError("LinkedIn adapter pending partner agreement")

    async def publish(self, draft: JobPostDraft) -> JobPostResult:
        # TODO: POST /simpleJobPostings body:
        # {
        #   "companyApplyUrl": "<our public apply link>",
        #   "title": draft.title,
        #   "description": {"text": draft.description},
        #   "location": draft.location,
        #   "industries": [...],
        #   "employmentStatus": "FULL_TIME",
        #   "externalJobPostingId": draft.job_id,
        #   ...
        # }
        raise NotImplementedError("LinkedIn adapter pending partner agreement")

    async def unpublish(self, external_id: str) -> bool:
        # TODO: DELETE /jobPostings/{id}
        raise NotImplementedError("LinkedIn adapter pending partner agreement")
