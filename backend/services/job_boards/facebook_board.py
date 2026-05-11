"""Facebook (Meta) job-board adapter — Page-post path.

Tenant-OAuth model: the OAuth callback stored a list of Pages the user
admins, each with its own page-level access_token. On publish() we
POST to `/{page-id}/feed` using the **page** token (NOT the user
token — Page posts need the Page's own credentials).

We deliberately keep the post text similar to LinkedIn's shape so a
job posted to both feeds reads consistently.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Optional

import httpx

from .base import JobBoardAdapter, JobPostDraft, JobPostResult

logger = logging.getLogger("hireops.job_boards.facebook")


_API_BASE = "https://graph.facebook.com/v18.0"


class FacebookBoardAdapter(JobBoardAdapter):
    provider = "facebook"

    def _selected_page(self) -> Optional[dict]:
        """Find the page the tenant chose (or the first available)."""
        page_id = (self.settings.get("page_id") or "").strip()
        pages = self.credentials.get("pages") or []
        if not isinstance(pages, list):
            return None
        if page_id:
            for p in pages:
                if isinstance(p, dict) and str(p.get("id")) == page_id:
                    return p
        return pages[0] if pages and isinstance(pages[0], dict) else None

    async def test_connection(self) -> bool:
        page = self._selected_page()
        if not page or not page.get("access_token"):
            return False
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{_API_BASE}/{page['id']}",
                params={"access_token": page["access_token"], "fields": "id,name"},
            )
            return resp.status_code == 200

    async def publish(self, draft: JobPostDraft) -> JobPostResult:
        page = self._selected_page()
        if not page or not page.get("access_token"):
            return JobPostResult(
                ok=False,
                error="Facebook not connected — re-link an admined Page.",
            )

        apply_url = (self.settings.get("apply_url") or "").strip()
        lines = [
            f"📢 We're hiring: {draft.title}",
            f"📍 {draft.location}" if draft.location else "",
            f"🏢 {draft.department}" if draft.department else "",
            "",
            (draft.description or "")[:1500],
        ]
        message = "\n".join([line for line in lines if line is not None])

        form: dict[str, Any] = {
            "access_token": page["access_token"],
            "message": message,
        }
        if apply_url:
            form["link"] = apply_url

        async with httpx.AsyncClient(timeout=20) as client:
            resp = await client.post(f"{_API_BASE}/{page['id']}/feed", data=form)
            if resp.status_code not in (200, 201):
                logger.warning(
                    "facebook POST /%s/feed %s: %s",
                    page["id"], resp.status_code, resp.text[:300],
                )
                return JobPostResult(
                    ok=False,
                    error=f"Facebook HTTP {resp.status_code}: {resp.text[:200]}",
                )
            body = resp.json() or {}
            post_id = body.get("id", "")
            # Facebook post ids are "<page-id>_<post-id>" — the public
            # URL pattern is /<page-id>/posts/<post-id>
            url = ""
            if "_" in post_id:
                _, real_id = post_id.split("_", 1)
                url = f"https://www.facebook.com/{page['id']}/posts/{real_id}"
            return JobPostResult(ok=True, external_id=post_id, external_url=url, raw=body)

    async def unpublish(self, external_id: str) -> bool:
        page = self._selected_page()
        if not page or not page.get("access_token") or not external_id:
            return False
        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.delete(
                f"{_API_BASE}/{external_id}",
                params={"access_token": page["access_token"]},
            )
            return resp.status_code in (200, 204, 404)
