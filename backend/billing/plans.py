"""
Plan definitions + quota enforcement.

Plans are static config — three tiers with hard quotas. Stripe price IDs are
env-driven (different IDs per environment). The free plan has no Stripe
subscription; signup creates a tenant on the free plan immediately.

Quotas are enforced at creation time via `check_quota(...)`, which raises
HTTPException 402 (Payment Required) when over limit. The frontend surfaces
this as "upgrade to add more".
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Literal

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from models import Tenant, Job, Candidate, Application, InterviewLink

PlanName = Literal["free", "starter", "pro"]


@dataclass
class Plan:
    name: PlanName
    display_name: str
    price_monthly_usd: int  # 0 for free, used for display only
    stripe_price_id: str | None  # Stripe Price ID (env-driven). None for free.
    max_jobs: int  # -1 for unlimited
    max_candidates: int
    max_interviews_per_month: int
    features: list[str] = field(default_factory=list)


# Resolved at import time. Override the *_PRICE_ID env vars in production.
PLANS: dict[PlanName, Plan] = {
    "free": Plan(
        name="free",
        display_name="Free",
        price_monthly_usd=0,
        stripe_price_id=None,
        max_jobs=5,
        max_candidates=25,
        max_interviews_per_month=10,
        features=[
            "5 active jobs",
            "25 candidates",
            "10 interviews / month",
            "Q&A + voice modes",
            "AI fraud detection",
        ],
    ),
    "starter": Plan(
        name="starter",
        display_name="Starter",
        price_monthly_usd=int(os.getenv("STARTER_PRICE_USD", "49")),
        stripe_price_id=os.getenv("STRIPE_STARTER_PRICE_ID") or None,
        max_jobs=25,
        max_candidates=250,
        max_interviews_per_month=100,
        features=[
            "25 active jobs",
            "250 candidates",
            "100 interviews / month",
            "Branded interview emails",
            "Priority support",
        ],
    ),
    "pro": Plan(
        name="pro",
        display_name="Pro",
        price_monthly_usd=int(os.getenv("PRO_PRICE_USD", "199")),
        stripe_price_id=os.getenv("STRIPE_PRO_PRICE_ID") or None,
        max_jobs=-1,
        max_candidates=-1,
        max_interviews_per_month=-1,
        features=[
            "Unlimited jobs",
            "Unlimited candidates",
            "Unlimited interviews",
            "Team seats",
            "SSO + audit logs (coming)",
        ],
    ),
}


def get_plan(name: str) -> Plan:
    return PLANS.get(name, PLANS["free"])  # unknown defaults to free


def effective_quota(tenant: Tenant, attr: str) -> int:
    """Tenant-level overrides win over plan defaults. -1 = unlimited."""
    plan = get_plan(tenant.plan)
    override = getattr(tenant, attr, None)
    if override is not None:
        return override
    return getattr(plan, attr)


# ── Usage counters ─────────────────────────────────────────────────────────


def count_jobs(db: Session, tenant: Tenant) -> int:
    return db.query(Job).filter(
        Job.tenant_id == tenant.id,
        Job.status != "closed",  # closed jobs don't count toward quota
    ).count()


def count_candidates(db: Session, tenant: Tenant) -> int:
    return db.query(Candidate).filter(Candidate.tenant_id == tenant.id).count()


def count_interviews_this_month(db: Session, tenant: Tenant) -> int:
    """Count interview links generated in the current calendar month."""
    from datetime import datetime
    start_of_month = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return db.query(InterviewLink).filter(
        InterviewLink.tenant_id == tenant.id,
        InterviewLink.created_at >= start_of_month,
    ).count()


# ── Quota enforcement ─────────────────────────────────────────────────────


def check_quota(db: Session, tenant: Tenant, resource: Literal["jobs", "candidates", "interviews"]):
    """Raise 402 Payment Required if the tenant is at quota for `resource`.
    Call this BEFORE creating a new resource of that type.
    """
    if resource == "jobs":
        limit = effective_quota(tenant, "max_jobs")
        if limit < 0:
            return  # unlimited
        used = count_jobs(db, tenant)
        if used >= limit:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail=(
                    f"Job quota reached ({used}/{limit}) on the {tenant.plan} plan. "
                    f"Upgrade to add more."
                ),
            )
    elif resource == "candidates":
        limit = effective_quota(tenant, "max_candidates")
        if limit < 0:
            return
        used = count_candidates(db, tenant)
        if used >= limit:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail=(
                    f"Candidate quota reached ({used}/{limit}) on the {tenant.plan} plan. "
                    f"Upgrade to add more."
                ),
            )
    elif resource == "interviews":
        limit = effective_quota(tenant, "max_interviews_per_month")
        if limit < 0:
            return
        used = count_interviews_this_month(db, tenant)
        if used >= limit:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail=(
                    f"Interview quota reached ({used}/{limit}) this month on the {tenant.plan} plan. "
                    f"Upgrade for more."
                ),
            )


def usage_summary(db: Session, tenant: Tenant) -> dict:
    """Snapshot of current usage vs limits, for the billing UI."""
    jobs_used = count_jobs(db, tenant)
    candidates_used = count_candidates(db, tenant)
    interviews_used = count_interviews_this_month(db, tenant)
    return {
        "jobs": {
            "used": jobs_used,
            "limit": effective_quota(tenant, "max_jobs"),
        },
        "candidates": {
            "used": candidates_used,
            "limit": effective_quota(tenant, "max_candidates"),
        },
        "interviews_this_month": {
            "used": interviews_used,
            "limit": effective_quota(tenant, "max_interviews_per_month"),
        },
    }
