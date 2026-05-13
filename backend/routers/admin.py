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
from sqlalchemy import func, or_, case
from sqlalchemy.orm import Session

from fastapi.responses import StreamingResponse

from database import get_db
from models import (
    Tenant, User, Job, Candidate, Application, InterviewLink, LlmUsage, AuditLog,
    Email, Event, QaSession, EmailVerification, PasswordReset, TenantInvite,
    Testimonial, Setting, CandidateCvVersion,
)
from auth.security import issue_jwt, COOKIE_NAME, JWT_TTL_DAYS, hash_password, new_token
from auth.dependencies import require_superadmin, CurrentSession
from auth.audit import record_audit
from auth.email_service import send_password_reset_email
from services.secrets import (
    GLOBAL_SECRET_KEYS,
    list_secret_status,
    set_global_secret,
    clear_global_secret,
)

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


class ImpersonateRequest(BaseModel):
    # Required free-text justification, stored in the audit log so every
    # impersonation is attributable to a specific support / compliance task.
    reason: str = Field(min_length=10, max_length=500)


@router.post("/tenants/{tenant_id}/impersonate")
def impersonate_tenant(
    req: ImpersonateRequest,
    request: Request,
    tenant_id: int,
    response: Response,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_superadmin),
):
    """Issue a 1-hour session cookie for the tenant's owner.

    The superadmin's own session is overwritten — they'll need to re-login
    as themselves afterwards. Privacy hardening:
      - Caller must supply a reason ≥ 10 chars; stored in the audit log.
      - TTL is 1 hour (was 1 day) so a forgotten impersonation can't sit
        live for a working day.
      - Audit row severity is `critical` and the reason is part of the
        payload so it's surfaced to the audit-log UI even after the
        masking pass we apply for non-super-admin actions.
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
    # 1-hour TTL is plenty for a support session and limits blast radius
    # if the admin walks away from their desk.
    token = issue_jwt(owner.id, t.id, ttl_days=1 / 24)
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=60 * 60,
        httponly=True,
        samesite="lax",
        secure=secure,
        path="/",
    )

    record_audit(
        db, actor=session.user, action="tenant.impersonate",
        target_tenant_id=t.id, target_user_id=owner.id, request=request,
        payload={
            "impersonated_email": owner.email,
            "reason": req.reason.strip(),
            "ttl_minutes": 60,
        },
        severity="critical",
    )
    return {
        "ok": True,
        "impersonating": {
            "tenant_id": t.id,
            "tenant_name": t.name,
            "user_email": owner.email,
            "expires_in_minutes": 60,
        },
    }


# ── Platform analytics (Milestone 2) ─────────────────────────────────────


class GrowthDayPoint(BaseModel):
    date: str
    signups: int


class TopSpender(BaseModel):
    tenant_id: int
    tenant_name: str
    plan: str
    total_usd: float
    calls: int


class AgentBreakdown(BaseModel):
    agent_name: str
    total_usd: float
    calls: int


class PastDueTenant(BaseModel):
    tenant_id: int
    name: str
    plan: str
    owner_email: Optional[str]
    current_period_end: Optional[datetime]


class AnalyticsResponse(BaseModel):
    # Growth
    signups_per_day_30d: list[GrowthDayPoint]
    tenants_total: int
    tenants_active_28d: int
    tenants_paid: int
    free_to_paid_conversion_pct: float
    # Revenue
    mrr_usd: float
    plan_breakdown: dict[str, int]
    past_due: list[PastDueTenant]
    # Costs
    daily_llm_spend_30d: list[LlmSpendDay]
    llm_spend_total_30d_usd: float
    top_spenders_30d: list[TopSpender]
    per_agent_breakdown_30d: list[AgentBreakdown]


@router.get("/analytics", response_model=AnalyticsResponse)
def analytics(
    db: Session = Depends(get_db),
    _: CurrentSession = Depends(require_superadmin),
):
    """Platform-wide analytics for the super-admin team."""
    from billing.plans import PLANS

    now = datetime.utcnow()
    cutoff_30 = (now - timedelta(days=30)).replace(hour=0, minute=0, second=0, microsecond=0)
    cutoff_28 = now - timedelta(days=28)

    not_deleted = Tenant.deleted_at.is_(None)

    # ── Growth ──
    signup_rows = (
        db.query(func.date(User.created_at).label("d"), func.count(User.id).label("n"))
        .filter(User.created_at >= cutoff_30)
        .group_by(func.date(User.created_at))
        .all()
    )
    by_day = {str(r.d): int(r.n or 0) for r in signup_rows}
    signups_series: list[GrowthDayPoint] = []
    for i in range(30):
        day = (now - timedelta(days=29 - i)).date()
        signups_series.append(GrowthDayPoint(date=str(day), signups=by_day.get(str(day), 0)))

    tenants_total = db.query(Tenant).filter(not_deleted).count()
    tenants_paid = db.query(Tenant).filter(
        not_deleted,
        Tenant.plan.in_(["starter", "pro"]),
        or_(
            Tenant.subscription_status.is_(None),
            Tenant.subscription_status.in_(("active", "trialing", "past_due")),
        ),
    ).count()

    active_via_login = (
        db.query(User.tenant_id)
        .filter(User.last_login_at != None, User.last_login_at >= cutoff_28)  # noqa: E711
        .distinct().subquery()
    )
    active_via_app = (
        db.query(Application.tenant_id)
        .filter(Application.updated_at >= cutoff_28)
        .distinct().subquery()
    )
    tenants_active_28d = db.query(Tenant).filter(
        not_deleted,
        or_(Tenant.id.in_(db.query(active_via_login.c.tenant_id)),
            Tenant.id.in_(db.query(active_via_app.c.tenant_id))),
    ).count()

    conversion_pct = round((tenants_paid / tenants_total * 100) if tenants_total else 0.0, 1)

    # ── Revenue ──
    mrr = 0.0
    plan_counts: dict[str, int] = {"free": 0, "starter": 0, "pro": 0}
    for t in db.query(Tenant).filter(not_deleted).all():
        plan_counts[t.plan] = plan_counts.get(t.plan, 0) + 1
        plan_obj = PLANS.get(t.plan)
        if plan_obj and t.plan != "free":
            sub_status = (t.subscription_status or "").lower()
            if sub_status in ("active", "trialing", "past_due", ""):
                mrr += plan_obj.price_monthly_usd

    past_due_rows = (
        db.query(Tenant)
        .filter(not_deleted, Tenant.subscription_status == "past_due")
        .order_by(Tenant.current_period_end.desc().nulls_last())
        .limit(20)
        .all()
    )
    past_due: list[PastDueTenant] = []
    for t in past_due_rows:
        owner = (
            db.query(User)
            .filter(User.tenant_id == t.id, User.role == "owner")
            .order_by(User.id)
            .first()
        )
        past_due.append(PastDueTenant(
            tenant_id=t.id, name=t.name, plan=t.plan,
            owner_email=owner.email if owner else None,
            current_period_end=t.current_period_end,
        ))

    # ── Costs ──
    spend_rows = (
        db.query(
            func.date(LlmUsage.created_at).label("d"),
            func.sum(LlmUsage.cost_usd).label("total"),
            func.count(LlmUsage.id).label("calls"),
        )
        .filter(LlmUsage.created_at >= cutoff_30)
        .group_by(func.date(LlmUsage.created_at))
        .all()
    )
    spend_by_day = {str(r.d): (float(r.total or 0.0), int(r.calls or 0)) for r in spend_rows}
    daily_spend: list[LlmSpendDay] = []
    spend_total = 0.0
    for i in range(30):
        day = (now - timedelta(days=29 - i)).date()
        usd, calls = spend_by_day.get(str(day), (0.0, 0))
        daily_spend.append(LlmSpendDay(date=str(day), total_usd=round(usd, 4), calls=calls))
        spend_total += usd

    top_rows = (
        db.query(
            LlmUsage.tenant_id,
            func.sum(LlmUsage.cost_usd).label("total"),
            func.count(LlmUsage.id).label("calls"),
        )
        .filter(LlmUsage.created_at >= cutoff_30, LlmUsage.tenant_id.is_not(None))
        .group_by(LlmUsage.tenant_id)
        .order_by(func.sum(LlmUsage.cost_usd).desc())
        .limit(10)
        .all()
    )
    tenant_ids = [r.tenant_id for r in top_rows]
    tenant_map = {
        t.id: t
        for t in db.query(Tenant).filter(Tenant.id.in_(tenant_ids)).all()
    } if tenant_ids else {}
    top_spenders = [
        TopSpender(
            tenant_id=r.tenant_id,
            tenant_name=tenant_map[r.tenant_id].name if r.tenant_id in tenant_map else f"#{r.tenant_id}",
            plan=tenant_map[r.tenant_id].plan if r.tenant_id in tenant_map else "?",
            total_usd=round(float(r.total or 0.0), 4),
            calls=int(r.calls or 0),
        )
        for r in top_rows
    ]

    agent_rows = (
        db.query(
            LlmUsage.agent_name,
            func.sum(LlmUsage.cost_usd).label("total"),
            func.count(LlmUsage.id).label("calls"),
        )
        .filter(LlmUsage.created_at >= cutoff_30)
        .group_by(LlmUsage.agent_name)
        .order_by(func.sum(LlmUsage.cost_usd).desc())
        .all()
    )
    agent_breakdown = [
        AgentBreakdown(
            agent_name=r.agent_name,
            total_usd=round(float(r.total or 0.0), 4),
            calls=int(r.calls or 0),
        )
        for r in agent_rows
    ]

    return AnalyticsResponse(
        signups_per_day_30d=signups_series,
        tenants_total=tenants_total,
        tenants_active_28d=tenants_active_28d,
        tenants_paid=tenants_paid,
        free_to_paid_conversion_pct=conversion_pct,
        mrr_usd=round(mrr, 2),
        plan_breakdown=plan_counts,
        past_due=past_due,
        daily_llm_spend_30d=daily_spend,
        llm_spend_total_30d_usd=round(spend_total, 4),
        top_spenders_30d=top_spenders,
        per_agent_breakdown_30d=agent_breakdown,
    )


# ── LLM usage by tenant ───────────────────────────────────────────────────


class TenantLlmUsageRow(BaseModel):
    tenant_id: int
    tenant_name: str
    tenant_slug: str
    plan: str
    suspended: bool
    deleted: bool
    user_count: int
    calls: int
    input_tokens: int
    output_tokens: int
    total_tokens: int
    raw_cost_usd: float          # what the platform pays the provider
    billable_usd: float          # what the tenant would be charged (raw × plan markup)
    margin_usd: float            # billable - raw
    markup_multiplier: float     # this tenant's plan multiplier
    error_count: int
    last_call_at: Optional[str] = None


class TenantLlmUsageResponse(BaseModel):
    period_days: int
    tenants: list[TenantLlmUsageRow]
    totals: dict  # {"calls", "raw_cost_usd", "billable_usd", "margin_usd"}


@router.get("/llm-usage/by-tenant", response_model=TenantLlmUsageResponse)
def llm_usage_by_tenant(
    days: int = 30,
    db: Session = Depends(get_db),
    _: CurrentSession = Depends(require_superadmin),
):
    """Super-admin only: per-tenant LLM spend breakdown.

    Returns every tenant that has at least one LlmUsage row in the window,
    aggregated with calls / tokens / raw cost. For each tenant we also
    compute the marked-up billable cost using their current plan's
    markup multiplier — so the admin sees raw + billable + margin
    side by side. Sorted by raw_cost_usd desc.
    """
    days = max(1, min(int(days or 30), 365))
    cutoff = datetime.utcnow() - timedelta(days=days)

    rows = (
        db.query(
            LlmUsage.tenant_id,
            func.count(LlmUsage.id).label("calls"),
            func.coalesce(func.sum(LlmUsage.input_tokens), 0).label("in_tokens"),
            func.coalesce(func.sum(LlmUsage.output_tokens), 0).label("out_tokens"),
            func.coalesce(func.sum(LlmUsage.cost_usd), 0.0).label("cost"),
            func.sum(
                case((LlmUsage.status == "error", 1), else_=0)
            ).label("errors"),
            func.max(LlmUsage.created_at).label("last_at"),
        )
        .filter(LlmUsage.created_at >= cutoff)
        .group_by(LlmUsage.tenant_id)
        .all()
    )

    # Hydrate tenant metadata in one round-trip.
    tenant_ids = [r.tenant_id for r in rows if r.tenant_id is not None]
    tenant_map: dict[int, Tenant] = {
        t.id: t
        for t in db.query(Tenant).filter(Tenant.id.in_(tenant_ids)).all()
    } if tenant_ids else {}

    # Tenants whose ONLY users are super-admins are platform-admin home
    # tenants — filter them out so they don't show up as "real" tenant
    # spend. We compute this once via aggregation.
    admin_only_tenant_ids: set[int] = set()
    if tenant_ids:
        for tid, total_users, super_count in (
            db.query(
                User.tenant_id,
                func.count(User.id).label("total"),
                func.sum(case((User.is_superadmin.is_(True), 1), else_=0)).label("supers"),
            )
            .filter(User.tenant_id.in_(tenant_ids))
            .group_by(User.tenant_id)
            .all()
        ):
            if int(total_users or 0) > 0 and int(super_count or 0) == int(total_users):
                admin_only_tenant_ids.add(tid)
    # Per-tenant user counts (one query, grouped).
    user_counts: dict[int, int] = {}
    if tenant_ids:
        for tid, n in (
            db.query(User.tenant_id, func.count(User.id))
            .filter(User.tenant_id.in_(tenant_ids))
            .group_by(User.tenant_id)
            .all()
        ):
            user_counts[tid] = int(n or 0)

    from billing.plans import get_plan

    out: list[TenantLlmUsageRow] = []
    totals_raw = 0.0
    totals_bill = 0.0
    totals_calls = 0

    # Orphaned rows (tenant_id IS NULL — old data from the racing-worker
    # bug we fixed earlier). Surface them as a single synthetic "Untagged"
    # row so they don't disappear from the admin view.
    null_row = next((r for r in rows if r.tenant_id is None), None)
    real_rows = [r for r in rows if r.tenant_id is not None]
    for r in real_rows:
        if r.tenant_id in admin_only_tenant_ids:
            continue
        t = tenant_map.get(r.tenant_id)
        markup = 1.0
        if t and t.plan:
            try:
                markup = float(get_plan(t.plan).llm_markup_multiplier or 1.0)
            except Exception:
                markup = 1.0
        raw = round(float(r.cost or 0.0), 4)
        billable = round(raw * markup, 4)
        out.append(TenantLlmUsageRow(
            tenant_id=r.tenant_id,
            tenant_name=t.name if t else f"#{r.tenant_id}",
            tenant_slug=t.slug if t else "",
            plan=t.plan if t else "?",
            suspended=bool(t.suspended) if t else False,
            deleted=t.deleted_at is not None if t else False,
            user_count=user_counts.get(r.tenant_id, 0),
            calls=int(r.calls or 0),
            input_tokens=int(r.in_tokens or 0),
            output_tokens=int(r.out_tokens or 0),
            total_tokens=int((r.in_tokens or 0) + (r.out_tokens or 0)),
            raw_cost_usd=raw,
            billable_usd=billable,
            margin_usd=round(billable - raw, 4),
            markup_multiplier=markup,
            error_count=int(r.errors or 0),
            last_call_at=r.last_at.isoformat() if r.last_at else None,
        ))
        totals_raw += raw
        totals_bill += billable
        totals_calls += int(r.calls or 0)

    out.sort(key=lambda r: r.raw_cost_usd, reverse=True)

    if null_row:
        raw = round(float(null_row.cost or 0.0), 4)
        out.append(TenantLlmUsageRow(
            tenant_id=0,
            tenant_name="(orphan — no tenant)",
            tenant_slug="",
            plan="?",
            suspended=False,
            deleted=False,
            user_count=0,
            calls=int(null_row.calls or 0),
            input_tokens=int(null_row.in_tokens or 0),
            output_tokens=int(null_row.out_tokens or 0),
            total_tokens=int((null_row.in_tokens or 0) + (null_row.out_tokens or 0)),
            raw_cost_usd=raw,
            billable_usd=raw,
            margin_usd=0.0,
            markup_multiplier=1.0,
            error_count=int(null_row.errors or 0),
            last_call_at=null_row.last_at.isoformat() if null_row.last_at else None,
        ))
        totals_raw += raw
        totals_bill += raw
        totals_calls += int(null_row.calls or 0)

    return TenantLlmUsageResponse(
        period_days=days,
        tenants=out,
        totals={
            "calls": totals_calls,
            "raw_cost_usd": round(totals_raw, 4),
            "billable_usd": round(totals_bill, 4),
            "margin_usd": round(totals_bill - totals_raw, 4),
        },
    )


# ── Storage usage by tenant ───────────────────────────────────────────────


class TenantStorageRow(BaseModel):
    tenant_id: int
    tenant_name: str
    tenant_slug: str
    plan: str
    suspended: bool
    deleted: bool
    candidate_count: int
    resume_bytes: int             # candidates.resume_text
    attachment_bytes: int         # emails.attachments (base64-encoded blobs in JSON)
    cv_version_bytes: int         # candidate_cv_versions.resume_text snapshots
    total_bytes: int


class TenantStorageResponse(BaseModel):
    tenants: list[TenantStorageRow]
    totals: dict  # {"total_bytes", "resume_bytes", "attachment_bytes", "cv_version_bytes", "candidate_count"}


@router.get("/storage/by-tenant", response_model=TenantStorageResponse)
def storage_by_tenant(
    db: Session = Depends(get_db),
    _: CurrentSession = Depends(require_superadmin),
):
    """Super-admin only: per-tenant storage footprint.

    Sums byte length of the three large text columns that grow with
    real candidate data:
      • candidates.resume_text       (extracted CV text)
      • emails.attachments           (JSON of base64-encoded PDFs/DOCXs)
      • candidate_cv_versions.resume_text (historical CV snapshots)

    Excludes super-admin-only home tenants so the platform admin's own
    test data isn't reported as tenant storage.
    """
    # Aggregate per tenant_id in three small queries — beats per-row reads.
    resume_rows = (
        db.query(
            Candidate.tenant_id,
            func.count(Candidate.id).label("n"),
            func.coalesce(
                func.sum(func.octet_length(func.coalesce(Candidate.resume_text, ""))), 0
            ).label("bytes"),
        )
        .group_by(Candidate.tenant_id)
        .all()
    )
    attach_rows = (
        db.query(
            Email.tenant_id,
            func.coalesce(
                func.sum(func.octet_length(func.coalesce(Email.attachments, ""))), 0
            ).label("bytes"),
        )
        .group_by(Email.tenant_id)
        .all()
    )
    version_rows = (
        db.query(
            CandidateCvVersion.tenant_id,
            func.coalesce(
                func.sum(
                    func.octet_length(func.coalesce(CandidateCvVersion.resume_text, ""))
                ),
                0,
            ).label("bytes"),
        )
        .group_by(CandidateCvVersion.tenant_id)
        .all()
    )

    # Collect every tenant_id we saw across any of the three sources.
    tenant_ids: set[int] = set()
    resume_by_tid: dict[int, tuple[int, int]] = {}
    attach_by_tid: dict[int, int] = {}
    version_by_tid: dict[int, int] = {}
    for r in resume_rows:
        if r.tenant_id is None:
            continue
        tenant_ids.add(r.tenant_id)
        resume_by_tid[r.tenant_id] = (int(r.n or 0), int(r.bytes or 0))
    for r in attach_rows:
        if r.tenant_id is None:
            continue
        tenant_ids.add(r.tenant_id)
        attach_by_tid[r.tenant_id] = int(r.bytes or 0)
    for r in version_rows:
        if r.tenant_id is None:
            continue
        tenant_ids.add(r.tenant_id)
        version_by_tid[r.tenant_id] = int(r.bytes or 0)

    if not tenant_ids:
        return TenantStorageResponse(tenants=[], totals={
            "total_bytes": 0, "resume_bytes": 0, "attachment_bytes": 0,
            "cv_version_bytes": 0, "candidate_count": 0,
        })

    # Hydrate tenant metadata.
    tenant_map: dict[int, Tenant] = {
        t.id: t
        for t in db.query(Tenant).filter(Tenant.id.in_(tenant_ids)).all()
    }

    # Identify admin-only home tenants (super-admin's personal workspace).
    admin_only_tenant_ids: set[int] = set()
    for tid, total_users, super_count in (
        db.query(
            User.tenant_id,
            func.count(User.id).label("total"),
            func.sum(case((User.is_superadmin.is_(True), 1), else_=0)).label("supers"),
        )
        .filter(User.tenant_id.in_(tenant_ids))
        .group_by(User.tenant_id)
        .all()
    ):
        if int(total_users or 0) > 0 and int(super_count or 0) == int(total_users):
            admin_only_tenant_ids.add(tid)

    out: list[TenantStorageRow] = []
    tot_total = 0
    tot_resume = 0
    tot_attach = 0
    tot_version = 0
    tot_candidates = 0
    for tid in tenant_ids:
        if tid in admin_only_tenant_ids:
            continue
        t = tenant_map.get(tid)
        n_cand, resume_b = resume_by_tid.get(tid, (0, 0))
        attach_b = attach_by_tid.get(tid, 0)
        version_b = version_by_tid.get(tid, 0)
        total_b = resume_b + attach_b + version_b
        out.append(TenantStorageRow(
            tenant_id=tid,
            tenant_name=t.name if t else f"#{tid}",
            tenant_slug=t.slug if t else "",
            plan=t.plan if t else "?",
            suspended=bool(t.suspended) if t else False,
            deleted=t.deleted_at is not None if t else False,
            candidate_count=n_cand,
            resume_bytes=resume_b,
            attachment_bytes=attach_b,
            cv_version_bytes=version_b,
            total_bytes=total_b,
        ))
        tot_total += total_b
        tot_resume += resume_b
        tot_attach += attach_b
        tot_version += version_b
        tot_candidates += n_cand

    out.sort(key=lambda r: r.total_bytes, reverse=True)

    return TenantStorageResponse(
        tenants=out,
        totals={
            "total_bytes": tot_total,
            "resume_bytes": tot_resume,
            "attachment_bytes": tot_attach,
            "cv_version_bytes": tot_version,
            "candidate_count": tot_candidates,
        },
    )


# ── User management (Milestone 3) ─────────────────────────────────────────


class AdminUserItem(BaseModel):
    id: int
    email: str
    name: str
    role: str
    is_superadmin: bool
    email_verified: bool
    disabled: bool
    tenant_id: int
    tenant_name: str
    last_login_at: Optional[datetime]
    created_at: datetime


class AdminUserListResponse(BaseModel):
    users: list[AdminUserItem]
    total: int


def _user_to_item(u: User, t: Optional[Tenant]) -> AdminUserItem:
    return AdminUserItem(
        id=u.id,
        email=u.email,
        name=u.name or "",
        role=u.role,
        is_superadmin=bool(u.is_superadmin),
        email_verified=u.email_verified_at is not None,
        disabled=u.disabled_at is not None,
        tenant_id=u.tenant_id,
        tenant_name=t.name if t else "(deleted tenant)",
        last_login_at=u.last_login_at,
        created_at=u.created_at,
    )


@router.get("/users", response_model=AdminUserListResponse)
def list_users(
    search: Optional[str] = None,
    tenant_id: Optional[int] = None,
    role: Optional[str] = None,  # owner / member / superadmin
    include_superadmins: bool = False,
    page: int = 1,
    per_page: int = 50,
    db: Session = Depends(get_db),
    _: CurrentSession = Depends(require_superadmin),
):
    """Tenant users by default. Pass include_superadmins=true (or
    role=superadmin) to see platform admins — otherwise they're filtered
    out so the user list shows actual tenant recruiters only.
    """
    query = db.query(User)
    if search:
        ilike = f"%{search.lower()}%"
        query = query.filter(
            or_(
                func.lower(User.email).like(ilike),
                func.lower(User.name).like(ilike),
            )
        )
    if tenant_id:
        query = query.filter(User.tenant_id == tenant_id)
    if role == "superadmin":
        query = query.filter(User.is_superadmin.is_(True))
    elif role in ("owner", "member"):
        query = query.filter(User.role == role)
    elif not include_superadmins:
        # Default tenant-users-only view.
        query = query.filter(User.is_superadmin.is_(False))

    total = query.count()
    users = (
        query.order_by(User.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )

    tenant_ids = {u.tenant_id for u in users}
    tenant_map = {
        t.id: t
        for t in db.query(Tenant).filter(Tenant.id.in_(tenant_ids)).all()
    } if tenant_ids else {}

    return AdminUserListResponse(
        users=[_user_to_item(u, tenant_map.get(u.tenant_id)) for u in users],
        total=total,
    )


@router.get("/users/{user_id}", response_model=AdminUserItem)
def get_user(
    user_id: int,
    db: Session = Depends(get_db),
    _: CurrentSession = Depends(require_superadmin),
):
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    t = db.query(Tenant).filter(Tenant.id == u.tenant_id).first()
    return _user_to_item(u, t)


class UserDisableRequest(BaseModel):
    disabled: bool


@router.post("/users/{user_id}/disable")
def disable_user(
    request: Request,
    user_id: int,
    req: UserDisableRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_superadmin),
):
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    if u.id == session.user.id:
        raise HTTPException(status_code=400, detail="You can't disable yourself")
    before = u.disabled_at is not None
    u.disabled_at = datetime.utcnow() if req.disabled else None
    u.updated_at = datetime.utcnow()
    db.commit()
    record_audit(
        db, actor=session.user,
        action="user.disable" if req.disabled else "user.enable",
        target_user_id=u.id, target_tenant_id=u.tenant_id,
        request=request,
        payload={"before": {"disabled": before}, "after": {"disabled": not before if req.disabled != before else before}},
    )
    return {"ok": True, "disabled": u.disabled_at is not None}


@router.post("/users/{user_id}/reset-password")
def reset_user_password(
    request: Request,
    user_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_superadmin),
):
    """Generate a fresh password-reset token and email it to the user."""
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")

    token = new_token()
    db.add(PasswordReset(
        user_id=u.id,
        token=token,
        expires_at=datetime.utcnow() + timedelta(hours=1),
    ))
    db.commit()

    frontend = os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")
    send_password_reset_email(u.email, u.name or u.email, f"{frontend}/reset-password?token={token}")

    record_audit(
        db, actor=session.user, action="user.password_reset",
        target_user_id=u.id, target_tenant_id=u.tenant_id, request=request,
        payload={"sent_to": u.email},
    )
    return {"ok": True}


@router.post("/users/{user_id}/verify-email")
def verify_user_email(
    request: Request,
    user_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_superadmin),
):
    """Manually mark a user's email as verified (support tool)."""
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    if u.email_verified_at is not None:
        return {"ok": True, "already_verified": True}
    u.email_verified_at = datetime.utcnow()
    u.updated_at = datetime.utcnow()
    db.commit()
    record_audit(
        db, actor=session.user, action="user.verify_email",
        target_user_id=u.id, target_tenant_id=u.tenant_id, request=request,
        payload={"email": u.email},
    )
    return {"ok": True}


class SuperadminToggleRequest(BaseModel):
    grant: bool


@router.post("/users/{user_id}/superadmin")
def toggle_superadmin(
    request: Request,
    user_id: int,
    req: SuperadminToggleRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_superadmin),
):
    """Grant or revoke is_superadmin. Self-revoke is allowed but flagged."""
    u = db.query(User).filter(User.id == user_id).first()
    if not u:
        raise HTTPException(status_code=404, detail="User not found")
    before = bool(u.is_superadmin)
    u.is_superadmin = bool(req.grant)
    u.updated_at = datetime.utcnow()
    db.commit()
    record_audit(
        db, actor=session.user,
        action="superadmin.grant" if req.grant else "superadmin.revoke",
        target_user_id=u.id, target_tenant_id=u.tenant_id, request=request,
        payload={"before": {"is_superadmin": before}, "after": {"is_superadmin": bool(u.is_superadmin)},
                 "self_revoke": (u.id == session.user.id and not req.grant)},
    )
    return {"ok": True, "is_superadmin": bool(u.is_superadmin)}


# ── GDPR data export + hard-delete (Milestone 3) ──────────────────────────


def _serialize_dt(dt) -> Optional[str]:
    return dt.isoformat() if dt else None


@router.get("/tenants/{tenant_id}/export")
def export_tenant_data(
    request: Request,
    tenant_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_superadmin),
):
    """Tenant METADATA export — counts + plan + billing state only.

    Previously this dumped every candidate / email / CV / transcript /
    application row. That violates the principle that a platform
    super-admin shouldn't be able to read tenant-private recruiting data
    out-of-band. Tenants who need a full data-portability dump (GDPR
    article 20) should call `/billing/my-data-export` while logged in
    as the tenant owner — that path is gated by `require_owner`.

    What this endpoint returns now:
      - tenant slug / name / plan / billing dates
      - member list (id, email, role, last login) — already visible via
        /admin/tenants/{id}
      - per-table row counts so support can answer "how much data does
        this tenant have" without seeing the rows themselves
    """
    t = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tenant not found")

    def _count(model) -> int:
        return db.query(model).filter(model.tenant_id == t.id).count()

    bundle = {
        "exported_at": datetime.utcnow().isoformat(),
        "exported_by": session.user.email,
        "scope": "metadata_only",
        "tenant": {
            "id": t.id, "slug": t.slug, "name": t.name, "plan": t.plan,
            "subscription_status": t.subscription_status,
            "current_period_end": _serialize_dt(t.current_period_end),
            "stripe_customer_id": t.stripe_customer_id,
            "stripe_subscription_id": t.stripe_subscription_id,
            "created_at": _serialize_dt(t.created_at),
            "deleted_at": _serialize_dt(t.deleted_at),
            "suspended_at": _serialize_dt(t.suspended_at),
        },
        "members": [
            {
                "id": u.id,
                "email": u.email,
                "name": u.name,
                "role": u.role,
                "email_verified": u.email_verified_at is not None,
                "last_login_at": _serialize_dt(u.last_login_at),
                "created_at": _serialize_dt(u.created_at),
            }
            for u in db.query(User).filter(User.tenant_id == t.id).all()
        ],
        "row_counts": {
            "users": _count(User),
            "jobs": _count(Job),
            "emails": _count(Email),
            "candidates": _count(Candidate),
            "applications": _count(Application),
            "interview_links": _count(InterviewLink),
            "qa_sessions": _count(QaSession),
            "events": _count(Event),
            "llm_usage": _count(LlmUsage),
        },
    }

    record_audit(
        db, actor=session.user, action="tenant.metadata_export",
        target_tenant_id=t.id, request=request,
        payload={"row_counts": bundle["row_counts"]},
        severity="warning",
    )

    payload = json.dumps(bundle, indent=2, default=str)
    filename = f"hireops-tenant-{t.slug}-metadata-{datetime.utcnow().strftime('%Y%m%d')}.json"
    return StreamingResponse(
        iter([payload]),
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.delete("/tenants/{tenant_id}/hard-delete")
def hard_delete_tenant(
    request: Request,
    tenant_id: int,
    confirm: bool = False,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_superadmin),
):
    """Permanently delete a tenant + every row tagged with its tenant_id.

    Guard rails:
      • Tenant must be soft-deleted first (deleted_at set).
      • Tenant must have been soft-deleted at least 30 days ago, OR the
        caller passes ?confirm=true to skip the wait (for support cases).
      • Audit log is preserved (target_tenant_id stays set, name resolves
        to '(deleted tenant)' in future queries).
    """
    t = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tenant not found")
    if t.deleted_at is None:
        raise HTTPException(
            status_code=400,
            detail="Soft-delete the tenant first (sets the 30-day window).",
        )
    age_days = (datetime.utcnow() - t.deleted_at).days
    if age_days < 30 and not confirm:
        raise HTTPException(
            status_code=400,
            detail=f"Soft-deleted only {age_days} days ago. Wait until 30 days, or pass ?confirm=true.",
        )

    # Snapshot row counts before delete so the audit entry is informative
    counts = {
        "users": db.query(User).filter(User.tenant_id == t.id).count(),
        "jobs": db.query(Job).filter(Job.tenant_id == t.id).count(),
        "candidates": db.query(Candidate).filter(Candidate.tenant_id == t.id).count(),
        "applications": db.query(Application).filter(Application.tenant_id == t.id).count(),
        "events": db.query(Event).filter(Event.tenant_id == t.id).count(),
        "interview_links": db.query(InterviewLink).filter(InterviewLink.tenant_id == t.id).count(),
        "qa_sessions": db.query(QaSession).filter(QaSession.tenant_id == t.id).count(),
        "emails": db.query(Email).filter(Email.tenant_id == t.id).count(),
        "llm_usage": db.query(LlmUsage).filter(LlmUsage.tenant_id == t.id).count(),
        "tenant_invites": db.query(TenantInvite).filter(TenantInvite.tenant_id == t.id).count(),
    }

    # Order matters: rows with FKs back to the tenant must go first
    db.query(QaSession).filter(QaSession.tenant_id == t.id).delete(synchronize_session=False)
    db.query(Event).filter(Event.tenant_id == t.id).delete(synchronize_session=False)
    db.query(InterviewLink).filter(InterviewLink.tenant_id == t.id).delete(synchronize_session=False)
    db.query(Application).filter(Application.tenant_id == t.id).delete(synchronize_session=False)
    db.query(Candidate).filter(Candidate.tenant_id == t.id).delete(synchronize_session=False)
    db.query(Job).filter(Job.tenant_id == t.id).delete(synchronize_session=False)
    db.query(Email).filter(Email.tenant_id == t.id).delete(synchronize_session=False)
    db.query(LlmUsage).filter(LlmUsage.tenant_id == t.id).delete(synchronize_session=False)
    db.query(TenantInvite).filter(TenantInvite.tenant_id == t.id).delete(synchronize_session=False)
    # Email verification + password reset tokens reference user_id, so collect users first
    user_ids = [u.id for u in db.query(User).filter(User.tenant_id == t.id).all()]
    if user_ids:
        db.query(EmailVerification).filter(EmailVerification.user_id.in_(user_ids)).delete(synchronize_session=False)
        db.query(PasswordReset).filter(PasswordReset.user_id.in_(user_ids)).delete(synchronize_session=False)
    db.query(User).filter(User.tenant_id == t.id).delete(synchronize_session=False)
    db.delete(t)
    db.commit()

    record_audit(
        db, actor=session.user, action="tenant.hard_delete",
        target_tenant_id=tenant_id, request=request,
        payload={"row_counts": counts, "soft_deleted_age_days": age_days, "confirmed": confirm},
    )
    return {"ok": True, "deleted_rows": counts}


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

    # Privacy hardening: tenant-originated audit rows (e.g. fraud.detected,
    # offer.send, integration.connect) may have payloads that mention
    # candidate names, fraud evidence, or other tenant-private content.
    # Super-admins should see WHAT happened and WHEN — not the full
    # tenant-private payload. We strip values to just the key list for any
    # row whose actor isn't a super-admin; super-admin-originated actions
    # (tenant.suspend, plan changes, etc) keep their full payload because
    # those are platform-level audit events.
    super_admin_actor_ids = {
        r[0]
        for r in db.query(User.id).filter(User.id.in_(actor_ids), User.is_superadmin.is_(True)).all()
    } if actor_ids else set()

    def _safe_payload(row: AuditLog) -> dict:
        try:
            data = json.loads(row.payload) if row.payload else {}
        except Exception:
            return {}
        if row.super_admin_user_id in super_admin_actor_ids:
            return data  # platform action; show full payload
        if not isinstance(data, dict):
            return {"_redacted": True}
        # Tenant-originated row: surface only the top-level field names so
        # admins can still tell "the offer.send included a candidate_name"
        # without reading the actual value.
        return {
            "_redacted": True,
            "_keys": sorted(data.keys()),
        }

    entries = [
        AuditLogItem(
            id=r.id,
            actor_email=actor_map.get(r.super_admin_user_id, "?"),
            action_type=r.action_type,
            target_tenant_id=r.target_tenant_id,
            target_tenant_name=target_tenant_map.get(r.target_tenant_id) if r.target_tenant_id else None,
            target_user_id=r.target_user_id,
            target_user_email=target_user_map.get(r.target_user_id) if r.target_user_id else None,
            payload=_safe_payload(r),
            ip_address=r.ip_address,
            created_at=r.created_at,
        )
        for r in rows
    ]

    return AuditLogResponse(entries=entries, total=total)


# ── Platform secrets (Mistral / ElevenLabs) ───────────────────────────────
# Global keys shared by all tenants — the platform owner pays for usage and
# bills tenants via Stripe. Stored in the `settings` table with tenant_id IS
# NULL; mirrored into os.environ at startup and on every write.

class SecretStatusItem(BaseModel):
    key: str
    source: str  # "db" | "env" | "unset"
    has_value: bool
    masked_value: str
    updated_at: Optional[datetime] = None


class SecretStatusResponse(BaseModel):
    secrets: list[SecretStatusItem]
    keys: list[str]


class SecretUpdateRequest(BaseModel):
    value: str = Field(min_length=1, max_length=4096)


@router.get("/secrets", response_model=SecretStatusResponse)
async def list_platform_secrets(
    _: CurrentSession = Depends(require_superadmin),
):
    """List all platform-level secrets with masked values + source."""
    items = list_secret_status()
    return SecretStatusResponse(
        secrets=[SecretStatusItem(**i) for i in items],
        keys=list(GLOBAL_SECRET_KEYS),
    )


@router.put("/secrets/{key}")
async def update_platform_secret(
    key: str,
    req: SecretUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_superadmin),
):
    """Upsert a global secret. Takes effect immediately for new requests."""
    if key not in GLOBAL_SECRET_KEYS:
        raise HTTPException(status_code=404, detail=f"Unknown secret key: {key}")
    set_global_secret(key, req.value)
    record_audit(
        db,
        actor=session.user,
        action=f"platform_secret.update",
        request=request,
        payload={"key": key, "length": len(req.value)},
    )
    return {"status": "updated", "key": key}


@router.delete("/secrets/{key}")
async def clear_platform_secret(
    key: str,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_superadmin),
):
    """Remove the DB override; falls back to whatever the .env file had."""
    if key not in GLOBAL_SECRET_KEYS:
        raise HTTPException(status_code=404, detail=f"Unknown secret key: {key}")
    clear_global_secret(key)
    record_audit(
        db,
        actor=session.user,
        action=f"platform_secret.clear",
        request=request,
        payload={"key": key},
    )
    return {"status": "cleared", "key": key}


# ── Testimonial management (superadmin only) ──────────────────────────────

class TestimonialAdminItem(BaseModel):
    id: int
    quote: str
    author_name: str
    author_role: str
    avatar_url: str
    is_active: bool
    display_order: int
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class TestimonialListAdminResponse(BaseModel):
    testimonials: list[TestimonialAdminItem]


class TestimonialCreateRequest(BaseModel):
    quote: str = Field(min_length=1, max_length=2000)
    author_name: str = Field(min_length=1, max_length=120)
    author_role: str = Field(default="", max_length=120)
    avatar_url: str = Field(default="", max_length=500)
    is_active: bool = True
    display_order: int = 0


class TestimonialUpdateRequest(BaseModel):
    quote: Optional[str] = Field(default=None, min_length=1, max_length=2000)
    author_name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    author_role: Optional[str] = Field(default=None, max_length=120)
    avatar_url: Optional[str] = Field(default=None, max_length=500)
    is_active: Optional[bool] = None
    display_order: Optional[int] = None


@router.get("/testimonials", response_model=TestimonialListAdminResponse)
async def list_all_testimonials(
    db: Session = Depends(get_db),
    _: CurrentSession = Depends(require_superadmin),
):
    """All testimonials (active + inactive), ordered for the admin table."""
    rows = (
        db.query(Testimonial)
        .order_by(Testimonial.display_order.asc(), Testimonial.id.asc())
        .all()
    )
    return TestimonialListAdminResponse(
        testimonials=[TestimonialAdminItem.model_validate(r) for r in rows]
    )


@router.post("/testimonials", response_model=TestimonialAdminItem)
async def create_testimonial(
    req: TestimonialCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_superadmin),
):
    row = Testimonial(
        quote=req.quote,
        author_name=req.author_name,
        author_role=req.author_role,
        avatar_url=req.avatar_url,
        is_active=req.is_active,
        display_order=req.display_order,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    record_audit(
        db, actor=session.user, action="testimonial.create",
        request=request, payload={"id": row.id, "author": row.author_name},
    )
    return TestimonialAdminItem.model_validate(row)


@router.patch("/testimonials/{testimonial_id}", response_model=TestimonialAdminItem)
async def update_testimonial(
    testimonial_id: int,
    req: TestimonialUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_superadmin),
):
    row = db.query(Testimonial).filter(Testimonial.id == testimonial_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Testimonial not found")

    fields = req.model_dump(exclude_unset=True)
    for k, v in fields.items():
        setattr(row, k, v)
    db.commit()
    db.refresh(row)
    record_audit(
        db, actor=session.user, action="testimonial.update",
        request=request, payload={"id": row.id, "fields": list(fields.keys())},
    )
    return TestimonialAdminItem.model_validate(row)


@router.delete("/testimonials/{testimonial_id}")
async def delete_testimonial(
    testimonial_id: int,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_superadmin),
):
    row = db.query(Testimonial).filter(Testimonial.id == testimonial_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Testimonial not found")
    author = row.author_name
    db.delete(row)
    db.commit()
    record_audit(
        db, actor=session.user, action="testimonial.delete",
        request=request, payload={"id": testimonial_id, "author": author},
    )
    return {"status": "deleted", "id": testimonial_id}


# ── Per-tenant agent overrides ────────────────────────────────────────────


class TenantAgentOverridesResponse(BaseModel):
    tenant_id: int
    plan: str
    plan_default_agents: list[str]
    add: list[str]
    remove: list[str]
    effective_unlocked: list[str]
    effective_locked: list[str]


class TenantAgentOverridesUpdate(BaseModel):
    add: list[str] = []
    remove: list[str] = []


@router.get("/tenants/{tenant_id}/agent-overrides", response_model=TenantAgentOverridesResponse)
def get_tenant_agent_overrides(
    tenant_id: int,
    db: Session = Depends(get_db),
    _: CurrentSession = Depends(require_superadmin),
):
    from billing.plans import (
        ALL_AGENTS, ALL_KNOWN_AGENTS, get_plan,
        unlocked_agents_for, locked_agents_for, _tenant_overrides,
    )
    t = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tenant not found")
    plan = get_plan(t.plan)
    plan_defaults = (
        list(ALL_KNOWN_AGENTS) if ALL_AGENTS in plan.allowed_agents
        else sorted(plan.allowed_agents)
    )
    add, remove = _tenant_overrides(t)
    return TenantAgentOverridesResponse(
        tenant_id=t.id,
        plan=t.plan,
        plan_default_agents=plan_defaults,
        add=sorted(add),
        remove=sorted(remove),
        effective_unlocked=unlocked_agents_for(t),
        effective_locked=locked_agents_for(t),
    )


@router.put("/tenants/{tenant_id}/agent-overrides", response_model=TenantAgentOverridesResponse)
def put_tenant_agent_overrides(
    tenant_id: int,
    req: TenantAgentOverridesUpdate,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_superadmin),
):
    from billing.plans import ALL_KNOWN_AGENTS
    t = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Tenant not found")

    # Validate agent names against the catalogue. Silent dropping of
    # unknown names beats letting a typo permanently lock an agent.
    valid = set(ALL_KNOWN_AGENTS)
    add = sorted(set(req.add) & valid)
    remove = sorted(set(req.remove) & valid)
    # If the same agent appears in both lists, remove wins (more restrictive).
    add = [a for a in add if a not in remove]

    t.agent_overrides_json = json.dumps({"add": add, "remove": remove})
    db.commit()
    db.refresh(t)
    record_audit(
        db, actor=session.user, action="tenant.agent_overrides.update",
        target_tenant_id=tenant_id,
        payload={"add": add, "remove": remove},
        request=request,
    )

    return get_tenant_agent_overrides(tenant_id, db, session)


# ── Plan editor (price + limits + features + allowed agents) ──────────────


class PlanConfigResponse(BaseModel):
    name: str
    display_name: str
    price_monthly_usd: int
    stripe_price_id: str | None
    max_jobs: int
    max_candidates: int
    max_interviews_per_month: int
    daily_llm_budget_usd: float
    llm_markup_multiplier: float
    features: list[str]
    allowed_agents: list[str]
    has_override: bool


class PlanConfigUpdate(BaseModel):
    display_name: str | None = None
    price_monthly_usd: int | None = None
    stripe_price_id: str | None = None
    max_jobs: int | None = None
    max_candidates: int | None = None
    max_interviews_per_month: int | None = None
    daily_llm_budget_usd: float | None = None
    llm_markup_multiplier: float | None = None
    features: list[str] | None = None
    allowed_agents: list[str] | None = None  # use ["*"] to mean ALL


@router.get("/plan-configs", response_model=list[PlanConfigResponse])
def list_plan_configs(
    db: Session = Depends(get_db),
    _: CurrentSession = Depends(require_superadmin),
):
    from billing.plans import ALL_AGENTS, PLANS, get_plan, _load_plan_overrides
    overrides_map = _load_plan_overrides()
    out: list[PlanConfigResponse] = []
    for pname in PLANS.keys():
        p = get_plan(pname)
        out.append(PlanConfigResponse(
            name=p.name,
            display_name=p.display_name,
            price_monthly_usd=p.price_monthly_usd,
            stripe_price_id=p.stripe_price_id,
            max_jobs=p.max_jobs,
            max_candidates=p.max_candidates,
            max_interviews_per_month=p.max_interviews_per_month,
            daily_llm_budget_usd=p.daily_llm_budget_usd,
            llm_markup_multiplier=p.llm_markup_multiplier,
            features=list(p.features),
            allowed_agents=(
                ["*"] if ALL_AGENTS in p.allowed_agents else sorted(p.allowed_agents)
            ),
            has_override=pname in overrides_map and bool(overrides_map[pname]),
        ))
    return out


@router.put("/plan-configs/{plan_name}", response_model=PlanConfigResponse)
def update_plan_config(
    plan_name: str,
    req: PlanConfigUpdate,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_superadmin),
):
    from billing.plans import (
        ALL_AGENTS, ALL_KNOWN_AGENTS, PLANS, _load_plan_overrides,
        invalidate_plan_overrides_cache,
    )
    if plan_name not in PLANS:
        raise HTTPException(status_code=404, detail=f"Unknown plan '{plan_name}'")

    # Validate allowed_agents
    if req.allowed_agents is not None:
        if req.allowed_agents == ["*"]:
            pass  # sentinel for "all"
        else:
            valid = set(ALL_KNOWN_AGENTS)
            unknown = set(req.allowed_agents) - valid
            if unknown:
                raise HTTPException(
                    status_code=400,
                    detail=f"Unknown agent names: {sorted(unknown)}",
                )

    # Merge req with existing overrides — only the fields supplied are
    # changed. None values mean "fall back to the env-driven default".
    existing = _load_plan_overrides().get(plan_name, {})
    payload = dict(existing)
    for field_name in [
        "display_name", "price_monthly_usd", "stripe_price_id",
        "max_jobs", "max_candidates", "max_interviews_per_month",
        "daily_llm_budget_usd", "llm_markup_multiplier",
        "features", "allowed_agents",
    ]:
        val = getattr(req, field_name)
        if val is not None:
            payload[field_name] = val

    setting_key = f"plan_override.{plan_name}"
    row = db.query(Setting).filter(
        Setting.tenant_id.is_(None),
        Setting.key == setting_key,
    ).first()
    if row:
        row.value = json.dumps(payload)
    else:
        db.add(Setting(tenant_id=None, key=setting_key, value=json.dumps(payload)))
    db.commit()
    invalidate_plan_overrides_cache()

    record_audit(
        db, actor=session.user, action="plan_config.update",
        payload={"plan": plan_name, "changes": list(payload.keys())},
        request=request,
    )

    return [p for p in list_plan_configs(db, session) if p.name == plan_name][0]


@router.delete("/plan-configs/{plan_name}")
def delete_plan_config(
    plan_name: str,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_superadmin),
):
    """Drop the override row, restoring the env-driven defaults."""
    from billing.plans import PLANS, invalidate_plan_overrides_cache
    if plan_name not in PLANS:
        raise HTTPException(status_code=404, detail=f"Unknown plan '{plan_name}'")
    row = db.query(Setting).filter(
        Setting.tenant_id.is_(None),
        Setting.key == f"plan_override.{plan_name}",
    ).first()
    if row:
        db.delete(row)
        db.commit()
    invalidate_plan_overrides_cache()
    record_audit(
        db, actor=session.user, action="plan_config.reset",
        payload={"plan": plan_name},
        request=request,
    )
    return {"reset": True}


# ── Stripe configuration (sandbox + prod, with active-mode toggle) ────────


class StripeModeCredentials(BaseModel):
    secret_key: str
    publishable_key: str
    webhook_secret: str
    starter_price_id: str
    pro_price_id: str
    secret_key_set: bool
    publishable_key_set: bool
    webhook_secret_set: bool
    starter_price_id_set: bool
    pro_price_id_set: bool


class StripeConfigResponse(BaseModel):
    mode: str
    sandbox: StripeModeCredentials
    prod: StripeModeCredentials
    env_fallbacks_present: dict[str, bool]


class StripeModeUpdate(BaseModel):
    mode: str  # "sandbox" | "prod"


class StripeCredentialsUpdate(BaseModel):
    secret_key: Optional[str] = None
    publishable_key: Optional[str] = None
    webhook_secret: Optional[str] = None
    starter_price_id: Optional[str] = None
    pro_price_id: Optional[str] = None


@router.get("/stripe-config", response_model=StripeConfigResponse)
def get_stripe_config(
    _: CurrentSession = Depends(require_superadmin),
):
    from services.stripe_config import status_summary
    return status_summary()


@router.put("/stripe-config/mode", response_model=StripeConfigResponse)
def set_stripe_mode(
    req: StripeModeUpdate,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_superadmin),
):
    from services import stripe_config
    if req.mode not in ("sandbox", "prod"):
        raise HTTPException(status_code=400, detail="mode must be 'sandbox' or 'prod'")
    stripe_config.set_mode(req.mode)  # type: ignore[arg-type]
    record_audit(
        db,
        actor=session.user,
        action="stripe.mode.update",
        payload={"mode": req.mode},
        request=request,
    )
    return stripe_config.status_summary()


@router.put("/stripe-config/{mode}", response_model=StripeConfigResponse)
def update_stripe_credentials(
    mode: str,
    req: StripeCredentialsUpdate,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_superadmin),
):
    """Update one or more credentials for sandbox or prod. Pass empty
    string for a field to clear it (e.g. {"webhook_secret": ""})."""
    from services import stripe_config
    if mode not in ("sandbox", "prod"):
        raise HTTPException(status_code=404, detail="mode must be 'sandbox' or 'prod'")

    fields = {k: v for k, v in req.model_dump(exclude_unset=True).items() if v is not None}
    if not fields:
        raise HTTPException(status_code=400, detail="No fields to update")

    try:
        stripe_config.set_credentials(mode, **fields)  # type: ignore[arg-type]
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    record_audit(
        db,
        actor=session.user,
        action="stripe.credentials.update",
        payload={
            "mode": mode,
            "fields": list(fields.keys()),
            # never log the actual secret values
        },
        severity="warning",
        request=request,
    )
    return stripe_config.status_summary()


@router.delete("/stripe-config/{mode}")
def clear_stripe_credentials(
    mode: str,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_superadmin),
):
    """Wipe every key for the given mode. Falls back to env vars after."""
    from services import stripe_config
    if mode not in ("sandbox", "prod"):
        raise HTTPException(status_code=404, detail="mode must be 'sandbox' or 'prod'")
    stripe_config.clear_credentials(mode)  # type: ignore[arg-type]
    record_audit(
        db,
        actor=session.user,
        action="stripe.credentials.clear",
        payload={"mode": mode},
        severity="warning",
        request=request,
    )
    return {"cleared": True, "mode": mode}


@router.post("/stripe-config/{mode}/test")
def test_stripe_credentials(
    mode: str,
    session: CurrentSession = Depends(require_superadmin),
):
    """Exercise the saved Stripe credentials against the real Stripe API.

    Per-field pass/fail so the admin UI can show exactly which value is
    wrong. Does NOT mutate anything in Stripe or in our DB — read-only
    Account.retrieve + Price.retrieve calls. Read-only by design so it's
    safe to call repeatedly.

    Returns: {
      ok: bool,
      checks: [{ name, ok, detail }]
    }
    """
    from services import stripe_config
    import stripe as stripe_sdk  # type: ignore[import-not-found]

    if mode not in ("sandbox", "prod"):
        raise HTTPException(status_code=404, detail="mode must be 'sandbox' or 'prod'")

    secret_key = stripe_config.get_value("secret_key", mode)  # type: ignore[arg-type]
    publishable_key = stripe_config.get_value("publishable_key", mode)  # type: ignore[arg-type]
    webhook_secret = stripe_config.get_value("webhook_secret", mode)  # type: ignore[arg-type]
    starter_price_id = stripe_config.get_value("starter_price_id", mode)  # type: ignore[arg-type]
    pro_price_id = stripe_config.get_value("pro_price_id", mode)  # type: ignore[arg-type]

    checks: list[dict] = []

    # 1. Secret key — must reach Stripe successfully.
    if not secret_key:
        checks.append({"name": "secret_key", "ok": False, "detail": "Not set"})
    else:
        try:
            stripe_sdk.api_key = secret_key
            account = stripe_sdk.Account.retrieve()
            account_id = getattr(account, "id", "") if account else ""
            mode_mismatch = (
                (mode == "sandbox" and not secret_key.startswith("sk_test_"))
                or (mode == "prod" and not secret_key.startswith("sk_live_"))
            )
            detail = f"Connected to account {account_id}"
            if mode_mismatch:
                detail += " ⚠ key prefix doesn't match selected mode"
            checks.append({
                "name": "secret_key",
                "ok": True,
                "detail": detail,
            })
        except stripe_sdk.error.AuthenticationError as e:  # type: ignore[attr-defined]
            checks.append({
                "name": "secret_key",
                "ok": False,
                "detail": f"Auth failed: {str(e)[:200]}",
            })
        except Exception as e:
            checks.append({
                "name": "secret_key",
                "ok": False,
                "detail": f"Stripe error: {str(e)[:200]}",
            })

    # 2. Publishable key — format check only (no live API for this).
    if not publishable_key:
        checks.append({"name": "publishable_key", "ok": False, "detail": "Not set"})
    elif not publishable_key.startswith(("pk_test_", "pk_live_")):
        checks.append({
            "name": "publishable_key",
            "ok": False,
            "detail": "Must start with pk_test_ or pk_live_",
        })
    else:
        expected_prefix = "pk_test_" if mode == "sandbox" else "pk_live_"
        ok = publishable_key.startswith(expected_prefix)
        checks.append({
            "name": "publishable_key",
            "ok": True,
            "detail": "Format OK" if ok else f"⚠ prefix doesn't match {mode}",
        })

    # 3. Webhook secret — format check (can't live-verify without a real event).
    if not webhook_secret:
        checks.append({
            "name": "webhook_secret",
            "ok": False,
            "detail": "Not set — webhook events will be rejected",
        })
    elif not webhook_secret.startswith("whsec_"):
        checks.append({
            "name": "webhook_secret",
            "ok": False,
            "detail": "Must start with whsec_",
        })
    else:
        checks.append({
            "name": "webhook_secret",
            "ok": True,
            "detail": "Format OK (use Stripe's 'Send test event' to verify end-to-end)",
        })

    # 4 + 5. Price ids — Stripe Price.retrieve. Catches the prod_ vs price_
    # confusion that the UI can't catch at save time.
    for name, value in (("starter_price_id", starter_price_id), ("pro_price_id", pro_price_id)):
        if not value:
            checks.append({"name": name, "ok": False, "detail": "Not set"})
            continue
        if not value.startswith("price_"):
            checks.append({
                "name": name,
                "ok": False,
                "detail": f"Must start with 'price_' (got '{value[:8]}…'). Copy the Price ID, not the Product ID.",
            })
            continue
        if not secret_key:
            checks.append({
                "name": name,
                "ok": False,
                "detail": "Skipped — secret key missing",
            })
            continue
        try:
            stripe_sdk.api_key = secret_key
            price = stripe_sdk.Price.retrieve(value)
            unit = (getattr(price, "unit_amount", 0) or 0) / 100
            currency = (getattr(price, "currency", "") or "").upper()
            recurring = getattr(price, "recurring", None)
            interval = recurring.get("interval", "") if recurring else "one-off"
            checks.append({
                "name": name,
                "ok": True,
                "detail": f"{currency} {unit:.2f} / {interval}",
            })
        except stripe_sdk.error.InvalidRequestError as e:  # type: ignore[attr-defined]
            checks.append({
                "name": name,
                "ok": False,
                "detail": f"Not found in Stripe: {str(e)[:200]}",
            })
        except Exception as e:
            checks.append({
                "name": name,
                "ok": False,
                "detail": f"Stripe error: {str(e)[:200]}",
            })

    ok_overall = all(c["ok"] for c in checks)
    return {"ok": ok_overall, "mode": mode, "checks": checks}
