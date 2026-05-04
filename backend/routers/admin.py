"""
Super-admin endpoints. Only accessible to users with is_superadmin=True.

Used by the Symprio team for support: list tenants, view usage, suspend/
reactivate, and "login as" (impersonate) a tenant owner for debugging.
"""
from __future__ import annotations

import os
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
from models import (
    Tenant, User, Job, Candidate, Application, InterviewLink,
)
from auth.security import issue_jwt, COOKIE_NAME, JWT_TTL_DAYS
from auth.dependencies import require_superadmin, CurrentSession

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


class TenantSummary(BaseModel):
    id: int
    slug: str
    name: str
    plan: str
    suspended: bool
    owner_email: str | None
    member_count: int
    job_count: int
    candidate_count: int
    application_count: int
    interview_count: int
    created_at: datetime
    last_activity_at: datetime | None


class TenantListResponse(BaseModel):
    tenants: list[TenantSummary]
    total: int


def _tenant_summary(t: Tenant, db: Session) -> TenantSummary:
    owner = (
        db.query(User)
        .filter(User.tenant_id == t.id, User.role == "owner")
        .order_by(User.id)
        .first()
    )
    member_count = db.query(User).filter(User.tenant_id == t.id).count()
    job_count = db.query(Job).filter(Job.tenant_id == t.id).count()
    candidate_count = db.query(Candidate).filter(Candidate.tenant_id == t.id).count()
    application_count = db.query(Application).filter(Application.tenant_id == t.id).count()
    interview_count = db.query(InterviewLink).filter(InterviewLink.tenant_id == t.id).count()

    # Last activity = most recent updated_at across applications + users
    last_app = (
        db.query(func.max(Application.updated_at))
        .filter(Application.tenant_id == t.id)
        .scalar()
    )
    last_user = (
        db.query(func.max(User.last_login_at))
        .filter(User.tenant_id == t.id)
        .scalar()
    )
    last = max(d for d in (last_app, last_user) if d is not None) if (last_app or last_user) else None

    return TenantSummary(
        id=t.id,
        slug=t.slug,
        name=t.name,
        plan=t.plan,
        suspended=bool(t.suspended),
        owner_email=owner.email if owner else None,
        member_count=member_count,
        job_count=job_count,
        candidate_count=candidate_count,
        application_count=application_count,
        interview_count=interview_count,
        created_at=t.created_at,
        last_activity_at=last,
    )


@router.get("/tenants", response_model=TenantListResponse)
def list_tenants(
    db: Session = Depends(get_db),
    _: CurrentSession = Depends(require_superadmin),
):
    tenants = db.query(Tenant).order_by(Tenant.created_at.desc()).all()
    return TenantListResponse(
        tenants=[_tenant_summary(t, db) for t in tenants],
        total=len(tenants),
    )


@router.get("/tenants/{tenant_id}", response_model=TenantSummary)
def get_tenant(
    tenant_id: int,
    db: Session = Depends(get_db),
    _: CurrentSession = Depends(require_superadmin),
):
    t = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return _tenant_summary(t, db)


class SuspendRequest(BaseModel):
    suspended: bool


@router.post("/tenants/{tenant_id}/suspend")
def suspend_tenant(
    tenant_id: int,
    req: SuspendRequest,
    db: Session = Depends(get_db),
    _: CurrentSession = Depends(require_superadmin),
):
    t = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tenant not found")
    t.suspended = req.suspended
    t.updated_at = datetime.utcnow()
    db.commit()
    return {"ok": True, "suspended": t.suspended}


@router.post("/tenants/{tenant_id}/impersonate")
def impersonate_tenant(
    tenant_id: int,
    response: Response,
    db: Session = Depends(get_db),
    _: CurrentSession = Depends(require_superadmin),
):
    """Issue a session cookie for the tenant's owner. The superadmin's own
    session is overwritten — they'll need to re-login as themselves afterwards.
    """
    t = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tenant not found")
    owner = (
        db.query(User)
        .filter(User.tenant_id == tenant_id, User.role == "owner")
        .order_by(User.id)
        .first()
    )
    if not owner:
        raise HTTPException(status_code=400, detail="Tenant has no owner user")

    secure = os.getenv("COOKIE_SECURE", "false").lower() == "true"
    token = issue_jwt(owner.id, t.id, ttl_days=1)  # short-lived impersonation token
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=24 * 60 * 60,
        httponly=True,
        samesite="lax",
        secure=secure,
        path="/",
    )
    return {
        "ok": True,
        "impersonating": {
            "tenant_id": t.id,
            "tenant_name": t.name,
            "user_email": owner.email,
        },
    }
