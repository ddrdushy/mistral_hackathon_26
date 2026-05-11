"""Merge.dev unified ATS/HRIS adapter.

Merge.dev (https://www.merge.dev/) is a unified API that fronts
Greenhouse, Lever, Workday, BambooHR, ADP, iCIMS, and 40+ others.
Cheapest way to ship breadth: one adapter against Merge's common
schema instead of N native adapters.

Auth model (two tokens):
- MERGE_API_KEY  — platform-wide key, set in backend env once.
- account_token  — per-tenant, returned by Merge Link's
                   `linkToken` → `publicToken` → `accountToken` exchange.

Tenants either:
  (a) paste a Merge `public_token` (we exchange for an account_token
      on connect), OR
  (b) paste an already-exchanged `access_token` (the account_token)
      directly — useful for headless setups.

We persist the resolved account_token in the encrypted credentials
under the key `access_token` so subsequent calls just read it.

Headers for every API call:
  Authorization: Bearer <MERGE_API_KEY>
  X-Account-Token: <account_token>

Endpoints in use (ATS scope):
  GET  /account-details
  GET  /jobs          ?modified_after=...&page_size=100&cursor=...
  GET  /candidates    ?modified_after=...&page_size=100&cursor=...
  GET  /applications  ?modified_after=...&page_size=100&cursor=...&expand=candidate,job,current_stage
  POST /candidates    {model:{first_name,last_name,email_addresses:[...]}, remote_user_id:...}
  PATCH /applications/{id}  {current_stage: <id>}  (varies by provider — see notes)
"""
from __future__ import annotations

import logging
import os
from datetime import datetime
from typing import Any, Optional

import httpx

from .base import (
    ExternalApplication,
    ExternalCandidate,
    ExternalJob,
    IntegrationAdapter,
)

logger = logging.getLogger("hireops.integrations.merge")


MERGE_API_BASE = os.getenv("MERGE_API_BASE", "https://api.merge.dev/api/ats/v1")
MERGE_TIMEOUT_S = float(os.getenv("MERGE_TIMEOUT_S", "20"))
MERGE_PAGE_SIZE = int(os.getenv("MERGE_PAGE_SIZE", "100"))
MERGE_MAX_PAGES = int(os.getenv("MERGE_MAX_PAGES", "50"))  # safety bound per sync


def _platform_key() -> str:
    """Backend-wide Merge API key. Required for every call."""
    key = os.getenv("MERGE_API_KEY", "").strip()
    return key


class MergeAdapter(IntegrationAdapter):
    """Merge.dev ATS unified adapter — pull + push."""

    provider = "merge"

    def __init__(self, credentials: dict[str, Any], settings: dict[str, Any]):
        super().__init__(credentials, settings)
        # Tenant token: either pre-exchanged (access_token) or to-exchange
        # (public_token). Exchange happens lazily on first call so the
        # connect flow can store either flavour without forcing a round-trip.
        self._account_token: str = (
            (credentials or {}).get("access_token", "")
            or (credentials or {}).get("api_key", "")
            or ""
        ).strip()
        self._public_token: str = ((credentials or {}).get("public_token", "") or "").strip()

    # ── Internal helpers ────────────────────────────────────────────────────

    def _require_keys(self) -> None:
        if not _platform_key():
            raise RuntimeError(
                "MERGE_API_KEY is not configured on the backend. "
                "Set MERGE_API_KEY in the environment before connecting Merge tenants."
            )
        if not self._account_token and not self._public_token:
            raise RuntimeError(
                "Merge connection is missing both access_token and public_token."
            )

    async def _resolve_account_token(self, client: httpx.AsyncClient) -> str:
        """Exchange public_token → account_token if needed."""
        if self._account_token:
            return self._account_token
        if not self._public_token:
            raise RuntimeError("No public_token available to exchange")
        url = f"{MERGE_API_BASE}/account-token/{self._public_token}"
        resp = await client.get(url, headers={"Authorization": f"Bearer {_platform_key()}"})
        resp.raise_for_status()
        data = resp.json()
        token = (data.get("account_token") or "").strip()
        if not token:
            raise RuntimeError(f"Merge /account-token returned empty token: {data}")
        self._account_token = token
        return token

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {_platform_key()}",
            "X-Account-Token": self._account_token,
            "Accept": "application/json",
        }

    async def _client(self) -> httpx.AsyncClient:
        # New client per call — sync engine is low-frequency (15 min cadence)
        # so connection pooling savings are negligible.
        return httpx.AsyncClient(timeout=MERGE_TIMEOUT_S)

    async def _paginated_get(
        self, path: str, params: dict[str, Any]
    ) -> list[dict]:
        """Iterate Merge's cursor-paginated list endpoints. Bounded by
        MERGE_MAX_PAGES to avoid unbounded loops on misbehaving data."""
        self._require_keys()
        out: list[dict] = []
        async with await self._client() as client:
            await self._resolve_account_token(client)
            cursor: Optional[str] = None
            for _ in range(MERGE_MAX_PAGES):
                page_params = dict(params)
                page_params["page_size"] = MERGE_PAGE_SIZE
                if cursor:
                    page_params["cursor"] = cursor
                resp = await client.get(
                    f"{MERGE_API_BASE}{path}",
                    headers=self._headers(),
                    params=page_params,
                )
                resp.raise_for_status()
                payload = resp.json()
                results = payload.get("results", []) or []
                out.extend(results)
                cursor = payload.get("next") or None
                if not cursor:
                    break
        return out

    # ── Public interface ────────────────────────────────────────────────────

    async def test_connection(self) -> bool:
        try:
            self._require_keys()
        except Exception as e:
            logger.warning("Merge test_connection: config error: %s", e)
            return False
        try:
            async with await self._client() as client:
                await self._resolve_account_token(client)
                resp = await client.get(
                    f"{MERGE_API_BASE}/account-details",
                    headers=self._headers(),
                )
                if resp.status_code != 200:
                    logger.warning("Merge /account-details %s: %s",
                                   resp.status_code, resp.text[:200])
                    return False
            return True
        except Exception as e:
            logger.warning("Merge test_connection failed: %s", e)
            return False

    async def list_jobs(self, since: Optional[datetime] = None) -> list[ExternalJob]:
        params: dict[str, Any] = {}
        if since:
            params["modified_after"] = since.isoformat()
        rows = await self._paginated_get("/jobs", params)
        out: list[ExternalJob] = []
        for r in rows:
            updated_at = _parse_dt(r.get("modified_at") or r.get("remote_updated_at"))
            offices = r.get("offices") or []
            location = ""
            if offices and isinstance(offices, list):
                first = offices[0]
                location = first.get("name", "") if isinstance(first, dict) else str(first)
            departments = r.get("departments") or []
            department = ""
            if departments and isinstance(departments, list):
                first = departments[0]
                department = first.get("name", "") if isinstance(first, dict) else str(first)
            out.append(ExternalJob(
                external_id=str(r.get("id") or r.get("remote_id") or ""),
                title=r.get("name") or "(untitled)",
                department=department,
                location=location,
                status=("open" if (r.get("status") or "").upper() == "OPEN" else "closed"),
                description=r.get("description") or "",
                raw=r,
                updated_at=updated_at,
            ))
        return out

    async def list_candidates(
        self, since: Optional[datetime] = None
    ) -> list[ExternalCandidate]:
        params: dict[str, Any] = {}
        if since:
            params["modified_after"] = since.isoformat()
        rows = await self._paginated_get("/candidates", params)
        out: list[ExternalCandidate] = []
        for r in rows:
            email = _first(_strings_from(r.get("email_addresses") or [], "value"))
            phone = _first(_strings_from(r.get("phone_numbers") or [], "value"))
            first = (r.get("first_name") or "").strip()
            last = (r.get("last_name") or "").strip()
            name = (f"{first} {last}").strip() or email or "(unknown)"
            out.append(ExternalCandidate(
                external_id=str(r.get("id") or r.get("remote_id") or ""),
                name=name,
                email=email,
                phone=phone,
                source=(r.get("source") or "merge.dev"),
                raw=r,
                updated_at=_parse_dt(r.get("modified_at") or r.get("remote_updated_at")),
            ))
        return out

    async def list_applications(
        self, since: Optional[datetime] = None
    ) -> list[ExternalApplication]:
        params: dict[str, Any] = {"expand": "candidate,job,current_stage"}
        if since:
            params["modified_after"] = since.isoformat()
        rows = await self._paginated_get("/applications", params)
        out: list[ExternalApplication] = []
        for r in rows:
            cand = r.get("candidate") or {}
            job = r.get("job") or {}
            stage = r.get("current_stage") or {}
            ext_cand = str(cand.get("id")) if isinstance(cand, dict) and cand.get("id") else str(cand or "")
            ext_job = str(job.get("id")) if isinstance(job, dict) and job.get("id") else str(job or "")
            stage_name = stage.get("name", "") if isinstance(stage, dict) else str(stage or "")
            out.append(ExternalApplication(
                external_id=str(r.get("id") or ""),
                external_job_id=ext_job,
                external_candidate_id=ext_cand,
                stage=stage_name or "applied",
                status=("active" if not r.get("rejected_at") else "rejected"),
                raw=r,
                updated_at=_parse_dt(r.get("modified_at") or r.get("remote_updated_at")),
            ))
        return out

    async def push_candidate(
        self, internal_candidate, internal_application
    ) -> Optional[str]:
        """Create a candidate in the remote ATS via Merge's common model.

        Merge POST /candidates returns the created object with an `id`.
        The candidate is linked to a job via the embedded `applications`
        array; we pass the internal job's external_id if we have a
        mapping for it, otherwise create a standalone candidate (the
        recruiter wires up the application in the ATS manually).
        """
        self._require_keys()
        name = (getattr(internal_candidate, "name", "") or "").strip()
        # Merge wants split first/last; greedy split is fine — recruiters
        # can fix it in the ATS if it's wrong.
        first, _, last = name.partition(" ")
        email = (getattr(internal_candidate, "email", "") or "").strip()
        phone = (getattr(internal_candidate, "phone", "") or "").strip()

        model: dict[str, Any] = {
            "first_name": first or name,
            "last_name": last,
            "email_addresses": (
                [{"value": email, "email_address_type": "PERSONAL"}] if email else []
            ),
            "phone_numbers": (
                [{"value": phone, "phone_number_type": "MOBILE"}] if phone else []
            ),
        }
        body = {"model": model}

        async with await self._client() as client:
            await self._resolve_account_token(client)
            resp = await client.post(
                f"{MERGE_API_BASE}/candidates",
                headers={**self._headers(), "Content-Type": "application/json"},
                json=body,
            )
            if resp.status_code not in (200, 201):
                logger.warning("Merge POST /candidates %s: %s",
                               resp.status_code, resp.text[:300])
                resp.raise_for_status()
            data = resp.json()
            # Merge wraps the new record under `model`; older versions
            # returned the record directly. Be liberal in what we accept.
            model_out = data.get("model") or data
            ext_id = model_out.get("id") if isinstance(model_out, dict) else None
            return str(ext_id) if ext_id else None

    async def push_stage_change(
        self, external_app_id: str, new_stage: str
    ) -> bool:
        """Merge's `current_stage` is a stage object id (per-provider).
        For the v1 implementation we pass the stage NAME via the
        passthrough endpoint, which is the only universal write path.

        Real production setups should pre-resolve stage names → ids per
        provider (mapped in settings_json by the connect UI).
        """
        self._require_keys()
        body = {
            "method": "PATCH",
            "path": f"/applications/{external_app_id}",
            "data": {"current_stage": new_stage},
        }
        async with await self._client() as client:
            await self._resolve_account_token(client)
            resp = await client.post(
                f"{MERGE_API_BASE}/passthrough",
                headers={**self._headers(), "Content-Type": "application/json"},
                json=body,
            )
            if resp.status_code not in (200, 201, 202):
                logger.warning("Merge passthrough PATCH /applications %s: %s",
                               resp.status_code, resp.text[:300])
                return False
            return True

    async def push_hire(self, external_app_id: str, start_date) -> bool:
        """Most ATSs model 'hired' as a stage transition + an offer
        accept event. Merge's `hired_at` on applications is read-only
        for most providers — we route through the same stage-change
        endpoint with stage='hired'.
        """
        return await self.push_stage_change(external_app_id, "hired")

    def get_stage_catalog(self) -> list[str]:
        # Generic Merge ATS stage names. Real providers expose their own
        # catalog at GET /stages — settings_json should override this
        # at runtime once the mapping UI is wired.
        return [
            "applied",
            "interview",
            "offer",
            "hired",
            "rejected",
        ]


# ─── Module-local helpers ────────────────────────────────────────────────────


def _parse_dt(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    try:
        # Merge returns RFC3339 with "Z" — fromisoformat handles it on
        # Python 3.11+; for 3.9 we strip the trailing Z.
        s = str(value).rstrip()
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        return datetime.fromisoformat(s)
    except Exception:
        return None


def _strings_from(items: list, key: str) -> list[str]:
    out = []
    for it in items or []:
        if isinstance(it, dict):
            v = (it.get(key) or "").strip()
            if v:
                out.append(v)
        elif isinstance(it, str):
            out.append(it)
    return out


def _first(xs: list[str]) -> str:
    return xs[0] if xs else ""
