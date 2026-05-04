"""
Super-admin endpoints. Only accessible to users with is_superadmin=True.

Used by the Symprio team for support: list tenants, view usage, suspend/
reactivate, edit plan/quotas, soft-delete, "login as" (impersonate), and
audit log review.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from database import get_db
from models import (
    Tenant, User, Job, Candidate, Application, InterviewLink, LlmUsage, AuditLog,
)
from auth.security import issue_jwt, COOKIE_NAME, JWT_TTL_DAYS
from auth.dependencies import require_superadmin, CurrentSession
from auth.audit import record_audit

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])


# ── Response models ───────────────────────────────────────────────────────


class TenantSummary(BaseModel):
    id: int
    slug: str
    name: str
    plan: str
    suspended: bool
    deleted_at: Optional[datetime]
    owner_email: Optional[str]
    member_count: int
    job_count: int
    candidate_count: int
    application_count: int
    interview_count: int
    created_at: datetime
    last_activity_at: Optional[datetime]


class TenantListResponse(BaseModel):
    tenants: list[TenantSummary]
    total: int


class TenantMemberItem(BaseModel):
    id: int
    email: str
    name: str
    role: str
    email_verified: bool
    last_login_at: Optional[datetime]


class LlmSpendDay(BaseModel):
    date: str
    total_usd: float
    calls: int


class TenantDetailResponse(TenantSummary):
    """Tenant summary + drill-down arrays for the detail page."""
    max_jobs_override: Optional[int]
    max_candidates_override: Optional[int]
    max_interviews_per_month_override: Optional[int]
    stripe_customer_id: Optional[str]
    stripe_subscription_id: Optional[str]
    subscription_status: Optional[str]
    current_period_end: Optional[datetime]
    members: list[TenantMemberItem]
    llm_spend_30d: list[LlmSpendDay]
    llm_spend_total_30d_usd: float


class TenantPatchRequest(BaseModel):
    name: Optional[str] = Field(default=None, max_length=120)
    plan: Optional[str] = Field(default=None)
    max_jobs: Optional[int] = Field(default=None, ge=-1)
    max_candidates: Optional[int] = Field(default=None, ge=-1)
    max_interviews_per_month: Optional[int] = Field(default=None, ge=-1)


class SuspendRequest(BaseModel):
    suspended: bool


class AuditLogItem(BaseModel):
    id: int
    actor_email: str
    action_type: str
    target_tenant_id: Optional[int]
    target_tenant_name: Optional[str]
    target_user_id: Optional[int]
    target_user_email: Optional[str]
    payload: dict
    ip_address: Optional[str]
    created_at: datetime


class AuditLogResponse(BaseModel):
    entries: list[AuditLogItem]
    total: int


# ── Helpers ───────────────────────────────────────────────────────────────


def _tenant_summary(t: Tenant, db: Session) -> dict:
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

    last_app = db.query(func.max(Application.updated_at)).filter(Application.tenant_id == t.id).scalar()
    last_user = db.query(func.max(User.last_login_at)).filter(User.tenant_id == t.id).scalar()
    last = max(d for d in (last_app, last_user) if d is not None) if (last_app or last_user) else None

    return dict(
        id=t.id,
        slug=t.slug,
        name=t.name,
        plan=t.plan,
        suspended=bool(t.suspended),
        deleted_at=t.deleted_at,
        owner_email=owner.email if owner else None,
        member_count=member_count,
        job_count=job_count,
        candidate_count=candidate_count,
        application_count=application_count,
        interview_count=interview_count,
        created_at=t.created_at,
        last_activity_at=last,
    )


def _llm_spend_series(db: Session, tenant_id: int, days: int = 30) -> tuple[list[dict], float]:
    """Daily LLM spend series for the last N days (inclusive of today)."""
    cutoff = (datetime.utcnow() - timedelta(days=days)).replace(hour=0, minute=0, second=0, microsecond=0)
    rows = (
        db.query(
            func.date(LlmUsage.created_at).label("d"),
            func.sum(LlmUsage.cost_usd).label("total"),
            func.count(LlmUsage.id).label("calls"),
        )
        .filter(LlmUsage.tenant_id == tenant_id, LlmUsage.created_at >= cutoff)
        .group_by(func.date(LlmUsage.created_at))
        .order_by(func.date(LlmUsage.created_at))
        .all()
    )
    series: list[dict] = []
    total = 0.0
    by_date = {str(r.d): (float(r.total or 0.0), int(r.calls or 0)) for r in rows}
    for i in range(days):
        day = (datetime.utcnow() - timedelta(days=days - 1 - i)).date()
        usd, calls = by_date.get(str(day), (0.0, 0))
        series.append({"date": str(day), "total_usd": round(usd, 4), "calls": calls})
        total += usd
    return series, round(total, 4)


# ── Tenant list with search + filter ──────────────────────────────────────


@router.get("/tenants", response_model=TenantListResponse)
def list_tenants(
    search: Optional[str] = None,
    plan: Optional[str] = None,
    status: Optional[str] = None,  # active / suspended / deleted
    db: Session = Depends(get_db),
    _: CurrentSession = Depends(require_superadmin),
):
    query = db.query(Tenant)

    if search:
        ilike = f"%{search.lower()}%"
        # Search across slug, name, and owner email
        owner_tenant_ids = (
            db.query(User.tenant_id).filter(User.email.ilike(ilike)).all()
        )
        owner_ids = [r[0] for r in owner_tenant_ids]
        query = query.filter(
            or_(
                func.lower(Tenant.slug).like(ilike),
                func.lower(Tenant.name).like(ilike),
                Tenant.id.in_(owner_ids) if owner_ids else False,
            )
        )

    if plan:
        query = query.filter(Tenant.plan == plan)

    if status == "suspended":
        query = query.filter(Tenant.suspended == True, Tenant.deleted_at.is_(None))  # noqa: E712
    elif status == "deleted":
        query = query.filter(Tenant.deleted_at.is_not(None))
    elif status == "active":
        query = query.filter(Tenant.suspended == False, Tenant.deleted_at.is_(None))  # noqa: E712

    tenants = query.order_by(Tenant.created_at.desc()).all()
    return TenantListResponse(
        tenants=[TenantSummary(**_tenant_summary(t, db)) for t in tenants],
        total=len(tenants),
    )


# ── Tenant detail (drill-down) ────────────────────────────────────────────


@router.get("/tenants/{tenant_id}", response_model=TenantDetailResponse)
def get_tenant(
    tenant_id: int,
    db: Session = Depends(get_db),
    _: CurrentSession = Depends(require_superadmin),
):
    t = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tenant not found")

    members = (
        db.query(User)
        .filter(User.tenant_id == t.id)
        .order_by(User.created_at.asc())
        .all()
    )
    member_items = [
        TenantMemberItem(
            id=u.id,
            email=u.email,
            name=u.name or "",
            role=u.role,
            email_verified=u.email_verified_at is not None,
            last_login_at=u.last_login_at,
        )
        for u in members
    ]

    spend_series, spend_total = _llm_spend_series(db, t.id, days=30)

    summary = _tenant_summary(t, db)
    return TenantDetailResponse(
        **summary,
        max_jobs_override=t.max_jobs,
        max_candidates_override=t.max_candidates,
        max_interviews_per_month_override=t.max_interviews_per_month,
        stripe_customer_id=t.stripe_customer_id,
        stripe_subscription_id=t.stripe_subscription_id,
        subscription_status=t.subscription_status,
        current_period_end=t.current_period_end,
        members=member_items,
        llm_spend_30d=[LlmSpendDay(**d) for d in spend_series],
        llm_spend_total_30d_usd=spend_total,
    )


# ── Tenant edit ───────────────────────────────────────────────────────────


@router.patch("/tenants/{tenant_id}")
def patch_tenant(
    req: TenantPatchRequest,
    request: Request,
    tenant_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_superadmin),
):
    t = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tenant not found")
    if t.deleted_at is not None:
        raise HTTPException(status_code=400, detail="Cannot edit a deleted tenant — restore first")

    before = {
        "name": t.name,
        "plan": t.plan,
        "max_jobs": t.max_jobs,
        "max_candidates": t.max_candidates,
        "max_interviews_per_month": t.max_interviews_per_month,
    }

    if req.plan is not None:
        if req.plan not in ("free", "starter", "pro"):
            raise HTTPException(status_code=400, detail="Invalid plan")
        t.plan = req.plan
    if req.name is not None and req.name.strip():
        t.name = req.name.strip()
    if req.max_jobs is not None:
        t.max_jobs = req.max_jobs if req.max_jobs >= 0 else None  # negative = clear override
    if req.max_candidates is not None:
        t.max_candidates = req.max_candidates if req.max_candidates >= 0 else None
    if req.max_interviews_per_month is not None:
        t.max_interviews_per_month = req.max_interviews_per_month if req.max_interviews_per_month >= 0 else None

    t.updated_at = datetime.utcnow()
    db.commit()

    after = {
        "name": t.name,
        "plan": t.plan,
        "max_jobs": t.max_jobs,
        "max_candidates": t.max_candidates,
        "max_interviews_per_month": t.max_interviews_per_month,
    }
    record_audit(
        db, actor=session.user, action="tenant.edit", target_tenant_id=t.id,
        request=request, payload={"before": before, "after": after},
    )
    return {"ok": True}


# ── Suspend / reactivate ──────────────────────────────────────────────────


@router.post("/tenants/{tenant_id}/suspend")
def suspend_tenant(
    req: SuspendRequest,
    request: Request,
    tenant_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_superadmin),
):
    t = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tenant not found")

    before = bool(t.suspended)
    t.suspended = req.suspended
    t.updated_at = datetime.utcnow()
    db.commit()

    action = "tenant.suspend" if req.suspended else "tenant.unsuspend"
    record_audit(
        db, actor=session.user, action=action, target_tenant_id=t.id,
        request=request, payload={"before": {"suspended": before}, "after": {"suspended": bool(t.suspended)}},
    )
    return {"ok": True, "suspended": t.suspended}


# ── Soft-delete + restore ─────────────────────────────────────────────────


@router.delete("/tenants/{tenant_id}")
def delete_tenant(
    request: Request,
    tenant_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_superadmin),
):
    """Soft-delete: marks the tenant. Hard-delete (purge rows) handled by a
    periodic job ~30 days later. The tenant can be restored before then."""
    t = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tenant not found")
    if t.deleted_at is not None:
        return {"ok": True, "already_deleted": True, "deleted_at": t.deleted_at.isoformat()}

    t.deleted_at = datetime.utcnow()
    t.updated_at = datetime.utcnow()
    db.commit()

    record_audit(
        db, actor=session.user, action="tenant.delete", target_tenant_id=t.id,
        request=request, payload={"deleted_at": t.deleted_at.isoformat()},
    )
    return {"ok": True, "deleted_at": t.deleted_at.isoformat()}


@router.post("/tenants/{tenant_id}/restore")
def restore_tenant(
    request: Request,
    tenant_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_superadmin),
):
    t = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tenant not found")
    if t.deleted_at is None:
        return {"ok": True, "already_active": True}

    t.deleted_at = None
    t.updated_at = datetime.utcnow()
    db.commit()

    record_audit(
        db, actor=session.user, action="tenant.restore", target_tenant_id=t.id,
        request=request, payload={},
    )
    return {"ok": True}


# ── Impersonate (with audit) ──────────────────────────────────────────────


@router.post("/tenants/{tenant_id}/impersonate")
def impersonate_tenant(
    request: Request,
    tenant_id: int,
    response: Response,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_superadmin),
):
    """Issue a session cookie for the tenant's owner. The superadmin's own
    session is overwritten — they'll need to re-login as themselves afterwards.
    """
    t = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tenant not found")
    if t.deleted_at is not None:
        raise HTTPException(status_code=400, detail="Cannot impersonate a deleted tenant")
    owner = (
        db.query(User)
        .filter(User.tenant_id == tenant_id, User.role == "owner")
        .order_by(User.id)
        .first()
    )
    if not owner:
        raise HTTPException(status_code=400, detail="Tenant has no owner user")

    secure = os.getenv("COOKIE_SECURE", "false").lower() == "true"
    token = issue_jwt(owner.id, t.id, ttl_days=1)
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=24 * 60 * 60,
        httponly=True,
        samesite="lax",
        secure=secure,
        path="/",
    )

    record_audit(
        db, actor=session.user, action="tenant.impersonate",
        target_tenant_id=t.id, target_user_id=owner.id, request=request,
        payload={"impersonated_email": owner.email},
    )
    return {
        "ok": True,
        "impersonating": {
            "tenant_id": t.id,
            "tenant_name": t.name,
            "user_email": owner.email,
        },
    }


# ── Audit log ─────────────────────────────────────────────────────────────


@router.get("/audit-log", response_model=AuditLogResponse)
def list_audit_log(
    action: Optional[str] = None,
    tenant_id: Optional[int] = None,
    actor_email: Optional[str] = None,
    page: int = 1,
    per_page: int = 50,
    db: Session = Depends(get_db),
    _: CurrentSession = Depends(require_superadmin),
):
    query = db.query(AuditLog)
    if action:
        query = query.filter(AuditLog.action_type == action)
    if tenant_id:
        query = query.filter(AuditLog.target_tenant_id == tenant_id)
    if actor_email:
        actor_ids = db.query(User.id).filter(
            User.email.ilike(f"%{actor_email.lower()}%"),
        ).all()
        query = query.filter(AuditLog.super_admin_user_id.in_([r[0] for r in actor_ids]))

    total = query.count()
    rows = (
        query.order_by(AuditLog.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )

    # Look up actor + targets in one go
    actor_ids = {r.super_admin_user_id for r in rows}
    target_user_ids = {r.target_user_id for r in rows if r.target_user_id}
    target_tenant_ids = {r.target_tenant_id for r in rows if r.target_tenant_id}

    actor_map = {
        u.id: u.email
        for u in db.query(User).filter(User.id.in_(actor_ids)).all()
    } if actor_ids else {}
    target_user_map = {
        u.id: u.email
        for u in db.query(User).filter(User.id.in_(target_user_ids)).all()
    } if target_user_ids else {}
    target_tenant_map = {
        t.id: t.name
        for t in db.query(Tenant).filter(Tenant.id.in_(target_tenant_ids)).all()
    } if target_tenant_ids else {}

    entries = [
        AuditLogItem(
            id=r.id,
            actor_email=actor_map.get(r.super_admin_user_id, "?"),
            action_type=r.action_type,
            target_tenant_id=r.target_tenant_id,
            target_tenant_name=target_tenant_map.get(r.target_tenant_id) if r.target_tenant_id else None,
            target_user_id=r.target_user_id,
            target_user_email=target_user_map.get(r.target_user_id) if r.target_user_id else None,
            payload=json.loads(r.payload) if r.payload else {},
            ip_address=r.ip_address,
            created_at=r.created_at,
        )
        for r in rows
    ]

    return AuditLogResponse(entries=entries, total=total)
