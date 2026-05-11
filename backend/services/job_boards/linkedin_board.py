"""LinkedIn job-board adapter — Company Page post path.

Tenant-OAuth model (no Talent Solutions partner agreement required):
- Tenant connects via `/job-boards/linkedin/oauth/start` → standard
  LinkedIn OAuth → user-token + list of admined organizations.
- They pick a Company Page (urn:li:organization:<id>) in
  `JobBoardConnection.settings_json.organization_urn`.
- On publish() we call `POST /v2/ugcPosts` with:
    author: <organization urn>
    lifecycleState: PUBLISHED
    specificContent: {
      "com.linkedin.ugc.ShareContent": {
        "shareCommentary": { "text": <job ad copy> },
        "shareMediaCategory": "ARTICLE",
        "media": [{ status, originalUrl: <apply link> }]
      }
    }
- Public URL is reconstructed from the returned `x-restli-id` header.

For TRUE structured job postings (the Jobs tab on a Company Page with
salary / apply form) LinkedIn still requires Talent Solutions partner
status. Company-Page-post is the closest non-partner path and works
for the vast majority of SMB tenants.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Optional

import httpx

from .base import JobBoardAdapter, JobPostDraft, JobPostResult

logger = logging.getLogger("hireops.job_boards.linkedin")


_API_BASE = "https://api.linkedin.com"


class LinkedInBoardAdapter(JobBoardAdapter):
    provider = "linkedin"

    @property
    def _access_token(self) -> str:
        return (self.credentials.get("access_token") or "").strip()

    @property
    def _organization_urn(self) -> str:
        # Either explicitly chosen by the tenant via settings, or the
        # first organization the OAuth callback discovered.
        urn = (self.settings.get("organization_urn") or "").strip()
        if urn:
            return urn
        pages = self.credentials.get("pages") or []
        if pages and isinstance(pages, list):
            first = pages[0]
            if isinstance(first, dict):
                return (first.get("urn") or "").strip()
        return ""

    async def test_connection(self) -> bool:
        if not self._access_token:
            return False
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{_API_BASE}/v2/me",
                headers={"Authorization": f"Bearer {self._access_token}"},
            )
            return resp.status_code == 200

    async def publish(self, draft: JobPostDraft) -> JobPostResult:
        if not self._access_token:
            return JobPostResult(ok=False, error="LinkedIn not connected — re-link the account.")
        author = self._organization_urn
        if not author:
            return JobPostResult(
                ok=False,
                error="No LinkedIn Company Page selected. Pick one in Settings → Job boards.",
            )

        # Apply URL — for now points at our public career page route;
        # plain LinkedIn share-post needs SOME URL to make the unfurl
        # useful. If the tenant ever ships a per-tenant career page,
        # this is where to wire that link in.
        apply_url = (self.settings.get("apply_url") or "").strip()
        body_lines = [
            f"📢 We're hiring: {draft.title}",
            f"📍 {draft.location}" if draft.location else "",
            f"🏢 {draft.department}" if draft.department else "",
            "",
            (draft.description or "")[:1800],  # LinkedIn share has ~3000 char limit
        ]
        share_text = "\n".join([line for line in body_lines if line is not None])

        post_body: dict[str, Any] = {
            "author": author,
            "lifecycleState": "PUBLISHED",
            "specificContent": {
                "com.linkedin.ugc.ShareContent": {
                    "shareCommentary": {"text": share_text},
                    "shareMediaCategory": "NONE",
                },
            },
            "visibility": {"com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC"},
        }
        if apply_url:
            post_body["specificContent"]["com.linkedin.ugc.ShareContent"].update({
                "shareMediaCategory": "ARTICLE",
                "media": [{
                    "status": "READY",
                    "originalUrl": apply_url,
                    "title": {"text": draft.title},
                }],
            })

        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(
                f"{_API_BASE}/v2/ugcPosts",
                headers={
                    "Authorization": f"Bearer {self._access_token}",
                    "Content-Type": "application/json",
                    "X-Restli-Protocol-Version": "2.0.0",
                },
                content=json.dumps(post_body),
            )
            if resp.status_code not in (200, 201):
                logger.warning("linkedin POST /v2/ugcPosts %s: %s", resp.status_code, resp.text[:300])
                return JobPostResult(ok=False, error=f"LinkedIn HTTP {resp.status_code}: {resp.text[:200]}")
            ext_id = resp.headers.get("x-restli-id") or (resp.json() or {}).get("id", "")
            url = ""
            if ext_id and ":activity:" in ext_id:
                activity_id = ext_id.split(":activity:")[-1]
                url = f"https://www.linkedin.com/feed/update/urn:li:activity:{activity_id}/"
            return JobPostResult(ok=True, external_id=ext_id, external_url=url, raw={"author": author})

    async def unpublish(self, external_id: str) -> bool:
        if not self._access_token or not external_id:
            return False
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.delete(
                f"{_API_BASE}/v2/ugcPosts/{external_id}",
                headers={
                    "Authorization": f"Bearer {self._access_token}",
                    "X-Restli-Protocol-Version": "2.0.0",
                },
            )
            # 204 = success; 404 = already gone
            return resp.status_code in (200, 204, 404)
