"""Talent search + job-board integrations.

Exposes two surfaces:
  - Provider catalog + per-tenant BYO account CRUD (mirrors /inbox/accounts).
  - `POST /jobs/{id}/search-talent` — runs the talent_search agent against
    a Job and returns ranked candidates from the configured provider
    (Apollo platform-managed by default, BYO override per tenant later).
"""
from __future__ import annotations

import json
import logging
from dataclasses import asdict
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from agents.talent_search import JobSummary, search_talent
from auth.dependencies import CurrentSession, current_session
from database import get_db
from models import Job
from services import job_board_service

logger = logging.getLogger("hireops.talent")

router = APIRouter(prefix="/api/v1/talent", tags=["talent"])
jobs_router = APIRouter(prefix="/api/v1/jobs", tags=["talent"])


# ─── Provider catalog ─────────────────────────────────────────────────────


@router.get("/providers")
async def list_providers(_: CurrentSession = Depends(current_session)):
    """Public catalog of supported job-board providers — used by the gallery."""
    return {"providers": job_board_service.get_catalog()}


# ─── Per-tenant BYO accounts ──────────────────────────────────────────────


@router.get("/accounts")
async def list_accounts(
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    accounts = job_board_service.list_for_tenant(db, session.tenant.id)
    return {"accounts": [job_board_service.to_response(a) for a in accounts]}


class AccountCreateRequest(BaseModel):
    provider: str = Field(..., description="apollo|linkedin|indeed|jobstreet")
    auth_method: str = Field(..., description="api_key|oauth")
    account_label: str = ""
    secret: str = Field(..., min_length=1, description="API key or OAuth refresh token")
    capabilities: Optional[List[str]] = None
    external_user_id: str = ""


@router.post("/accounts", status_code=201)
async def create_account(
    req: AccountCreateRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Add a BYO job-board credential. Apollo can be added too (BYO override —
    the tenant's own Apollo API key takes precedence over the platform key for
    that tenant's searches), though the platform key is what every tenant gets
    by default."""
    try:
        account = job_board_service.create_account(
            db,
            tenant_id=session.tenant.id,
            provider=req.provider.lower().strip(),
            auth_method=req.auth_method,
            account_label=req.account_label,
            secret=req.secret,
            capabilities=req.capabilities or [],
            external_user_id=req.external_user_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"account": job_board_service.to_response(account)}


@router.delete("/accounts/{account_id}")
async def delete_account(
    account_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    ok = job_board_service.delete_account(db, session.tenant.id, account_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Account not found")
    return {"ok": True}


# ─── Talent search (mounted on /jobs/{id}/search-talent) ─────────────────


class SearchRequest(BaseModel):
    limit: int = Field(default=20, ge=1, le=50)
    # Future: provider override, location override, additional skill filters


@jobs_router.post("/{job_id}/search-talent")
async def search_talent_for_job(
    job_id: str,
    req: SearchRequest = SearchRequest(),
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Run talent search for a Job. Returns ranked candidates from Apollo
    (or the tenant's BYO connected provider once those adapters land)."""
    job = (
        db.query(Job)
        .filter(Job.tenant_id == session.tenant.id, Job.job_id == job_id)
        .first()
    )
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    try:
        skills = json.loads(job.skills) if job.skills else []
    except json.JSONDecodeError:
        skills = []

    summary = JobSummary(
        title=job.title,
        seniority=job.seniority or "",
        location=job.location or "",
        skills=skills,
        description=job.description or "",
    )

    matches = await search_talent(summary, limit=req.limit)
    return {
        "job_id": job.job_id,
        "query": {
            "title": summary.title,
            "seniority": summary.seniority,
            "location": summary.location,
            "skills": summary.skills,
        },
        "matches": [asdict(m) for m in matches],
        "provider": matches[0].provider if matches else None,
    }
