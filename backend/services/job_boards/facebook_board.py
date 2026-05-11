"""Facebook Jobs adapter — DOCUMENTED STUB.

Facebook deprecated their dedicated Jobs API in 2022; the path forward
is to publish via Marketplace > Jobs as a regular Page post with the
Job extension via the Marketing API:
- Auth: Facebook Page access_token with `pages_manage_posts` scope.
- Post endpoint: POST https://graph.facebook.com/v18.0/{page-id}/feed
- Job posts use `link` + `message` + `tags` for the location pin.

True structured-jobs publishing on FB now requires Facebook Marketplace
Jobs which is limited to certain regions and via partner integrations.
This stub keeps the auth + page-id shape ready for either path.
"""
from __future__ import annotations

import logging
from typing import Any

from .base import JobBoardAdapter, JobPostDraft, JobPostResult

logger = logging.getLogger("hireops.job_boards.facebook")


class FacebookBoardAdapter(JobBoardAdapter):
    provider = "facebook"
    _API_BASE = "https://graph.facebook.com/v18.0"

    async def test_connection(self) -> bool:
        # TODO: GET /{page-id}?fields=id,name
        raise NotImplementedError("Facebook adapter not yet implemented")

    async def publish(self, draft: JobPostDraft) -> JobPostResult:
        # TODO: POST /{page-id}/feed body:
        # {
        #   "message": f"{draft.title} — {draft.location}\n\n{draft.description}",
        #   "link": "<our public apply link>",
        # }
        raise NotImplementedError("Facebook adapter not yet implemented")

    async def unpublish(self, external_id: str) -> bool:
        # TODO: DELETE /{post-id}
        raise NotImplementedError("Facebook adapter not yet implemented")
