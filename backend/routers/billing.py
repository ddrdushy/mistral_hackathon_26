"""
Billing endpoints: list plans, current usage, start checkout, open customer portal,
Stripe webhook receiver.
"""
from __future__ import annotations

import json
import logging

import stripe as stripe_sdk
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import Tenant
from auth.dependencies import current_session, require_owner, CurrentSession
from billing.plans import PLANS, get_plan, usage_summary, PlanName
from billing import stripe_service
from billing.cost_guard import usage_today as llm_usage_today

logger = logging.getLogger("hireops.billing")

router = APIRouter(prefix="/api/v1/billing", tags=["billing"])
public_router = APIRouter(prefix="/api/v1/billing", tags=["billing"])


# ── Request / response models ─────────────────────────────────────────────


class PlanResponse(BaseModel):
    name: PlanName
    display_name: str
    price_monthly_usd: int
    features: list[str]
    available: bool  # false if plan has no Stripe price configured
    allowed_agents: list[str]  # ["*"] = all; otherwise the explicit allow-list


class CurrentPlanResponse(BaseModel):
    plan: PlanName
    display_name: str
    subscription_status: str | None
    current_period_end: str | None
    cancel_url_available: bool  # true if tenant has a stripe customer (portal works)
    unlocked_agents: list[str]
    locked_agents: list[str]
    is_trial: bool  # true when on the free plan with the email-classifier-only gate


class UsageItem(BaseModel):
    used: int
    limit: int  # -1 for unlimited


class LlmBudgetResponse(BaseModel):
    spent_usd: float
    budget_usd: float  # -1 for unlimited
    remaining_usd: float


class UsageResponse(BaseModel):
    jobs: UsageItem
    candidates: UsageItem
    interviews_this_month: UsageItem
    llm_today: LlmBudgetResponse


class CheckoutRequest(BaseModel):
    plan: PlanName


class CheckoutResponse(BaseModel):
    url: str


# ── Plans + usage ─────────────────────────────────────────────────────────


@router.get("/plans", response_model=list[PlanResponse])
def list_plans(_: CurrentSession = Depends(current_session)):
    from billing.stripe_service import _price_id_for_plan, configured as stripe_configured

    out = []
    stripe_ok = stripe_configured()
    # Iterate the static catalogue to preserve plan order, but resolve
    # each plan via get_plan() so DB-stored overrides (price, features,
    # stripe_price_id, allowed_agents) are applied.
    for static in PLANS.values():
        p = get_plan(static.name)
        # `available` must reflect what the upgrade button will actually
        # do. Checkout uses _price_id_for_plan() which consults the
        # Stripe-mode-aware config (settings.stripe.<mode>.<plan>_price_id)
        # before falling back to plan overrides — so the UI gate has to
        # do the same, otherwise an admin who configures Stripe via the
        # admin UI gets a paid checkout that works but a billing page
        # that shows everything as unavailable.
        if p.name == "free":
            available = True
        else:
            # Sales-led mode: until BILLING_SELF_SERVE=true is set, paid
            # plans always render as "Contact us" in the UI regardless
            # of Stripe config. Lets us launch the trial without exposing
            # half-finished Stripe self-serve.
            import os as _os
            self_serve = _os.getenv("BILLING_SELF_SERVE", "false").lower() in ("true", "1", "yes")
            if not self_serve:
                available = False
            else:
                available = stripe_ok and bool(_price_id_for_plan(p.name))
        out.append(PlanResponse(
            name=p.name,
            display_name=p.display_name,
            price_monthly_usd=p.price_monthly_usd,
            features=p.features,
            available=available,
            allowed_agents=sorted(p.allowed_agents),
        ))
    return out


@router.get("/me", response_model=CurrentPlanResponse)
def current_plan(session: CurrentSession = Depends(current_session)):
    from billing.plans import locked_agents_for, unlocked_agents_for, ALL_AGENTS
    t = session.tenant
    p = get_plan(t.plan)
    locked = locked_agents_for(t)
    unlocked = unlocked_agents_for(t)
    return CurrentPlanResponse(
        plan=p.name,
        display_name=p.display_name,
        subscription_status=t.subscription_status,
        current_period_end=t.current_period_end.isoformat() if t.current_period_end else None,
        cancel_url_available=bool(t.stripe_customer_id) and stripe_service.configured(),
        unlocked_agents=unlocked,
        locked_agents=locked,
        # "Trial" = on the free plan AND only the inbox classifier is on.
        is_trial=(p.name == "free" and ALL_AGENTS not in p.allowed_agents and len(p.allowed_agents) <= 1),
    )


@router.get("/usage", response_model=UsageResponse)
def get_usage(
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    summary = usage_summary(db, session.tenant)
    summary["llm_today"] = llm_usage_today(session.tenant.id)
    return summary


@router.get("/llm-trend")
def llm_spend_trend(
    days: int = 30,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Per-day LLM spend for the tenant, for the dashboard spend widget.

    Returns days of {date, spent_usd, calls}, oldest first. We bill the
    tenant at their plan's markup, so spend reflects the *billable*
    cost, not the platform's raw provider cost — keeps the number HR
    sees aligned with what they'd be invoiced.
    """
    from datetime import datetime, timedelta, date as _date
    from sqlalchemy import func, case
    from models import LlmUsage
    from billing.plans import get_plan

    days = max(1, min(int(days or 30), 90))
    end = datetime.utcnow()
    start = end - timedelta(days=days)

    markup = 1.0
    try:
        markup = float(get_plan(session.tenant.plan).llm_markup_multiplier or 1.0)
    except Exception:
        pass

    # Group by UTC date.
    rows = (
        db.query(
            func.date(LlmUsage.created_at).label("d"),
            func.count(LlmUsage.id).label("n"),
            func.coalesce(func.sum(LlmUsage.cost_usd), 0.0).label("raw"),
        )
        .filter(
            LlmUsage.tenant_id == session.tenant.id,
            LlmUsage.created_at >= start,
        )
        .group_by(func.date(LlmUsage.created_at))
        .all()
    )

    # Fill every day so the sparkline doesn't have gaps.
    by_date: dict[str, dict] = {}
    for r in rows:
        d = r.d.isoformat() if hasattr(r.d, "isoformat") else str(r.d)
        by_date[d] = {
            "date": d,
            "calls": int(r.n or 0),
            "spent_usd": round(float(r.raw or 0.0) * markup, 4),
        }
    out: list[dict] = []
    cursor = (end - timedelta(days=days - 1)).date()
    end_date = end.date()
    while cursor <= end_date:
        key = cursor.isoformat()
        out.append(
            by_date.get(key, {"date": key, "calls": 0, "spent_usd": 0.0})
        )
        cursor = cursor + timedelta(days=1)

    # Month-to-date for the headline number on the widget.
    first_of_month = end.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    month_raw = (
        db.query(func.coalesce(func.sum(LlmUsage.cost_usd), 0.0))
        .filter(
            LlmUsage.tenant_id == session.tenant.id,
            LlmUsage.created_at >= first_of_month,
        )
        .scalar()
        or 0.0
    )
    month_calls = (
        db.query(func.count(LlmUsage.id))
        .filter(
            LlmUsage.tenant_id == session.tenant.id,
            LlmUsage.created_at >= first_of_month,
        )
        .scalar()
        or 0
    )

    # NOTE: do NOT expose `markup_multiplier` in this response. The number
    # is a commercial detail (raw provider cost × plan markup) and HR /
    # tenant users should only see the final cost on their plan. Admins
    # see the raw + margin via /admin/* endpoints, not this one.
    return {
        "days": days,
        "trend": out,
        "month_to_date_usd": round(float(month_raw) * markup, 4),
        "month_calls": int(month_calls),
    }


# ── Checkout + portal (owner-only mutations) ──────────────────────────────


@router.post("/checkout", response_model=CheckoutResponse)
def start_checkout(
    req: CheckoutRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_owner),
):
    if not stripe_service.configured():
        raise HTTPException(
            status_code=503,
            detail="Billing is not configured on this server. Contact support.",
        )
    try:
        url = stripe_service.create_checkout_session(
            db, session.tenant, session.user, req.plan,
        )
        return CheckoutResponse(url=url)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except stripe_sdk.error.StripeError as e:  # type: ignore[attr-defined]
        logger.error("Stripe checkout error: %s", e)
        raise HTTPException(status_code=502, detail=f"Stripe error: {e}")


@router.post("/portal", response_model=CheckoutResponse)
def open_portal(
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_owner),
):
    if not stripe_service.configured():
        raise HTTPException(
            status_code=503,
            detail="Billing is not configured on this server.",
        )
    if not session.tenant.stripe_customer_id:
        raise HTTPException(
            status_code=400,
            detail="No billing account yet — upgrade to a paid plan first.",
        )
    try:
        url = stripe_service.create_portal_session(db, session.tenant, session.user)
        return CheckoutResponse(url=url)
    except stripe_sdk.error.StripeError as e:  # type: ignore[attr-defined]
        logger.error("Stripe portal error: %s", e)
        raise HTTPException(status_code=502, detail=f"Stripe error: {e}")


# ── Webhook (public, signature-verified) ──────────────────────────────────


@public_router.post("/webhook")
async def stripe_webhook(request: Request, db: Session = Depends(get_db)):
    payload = await request.body()
    signature = request.headers.get("stripe-signature", "")
    try:
        event = stripe_service.verify_webhook(payload, signature)
    except stripe_sdk.error.SignatureVerificationError:  # type: ignore[attr-defined]
        raise HTTPException(status_code=400, detail="Invalid signature")
    except Exception as e:
        logger.warning("Webhook verify failed: %s", e)
        raise HTTPException(status_code=400, detail="Webhook verification failed")

    try:
        result = stripe_service.handle_event(db, event)
        return {"received": True, **result}
    except Exception as e:
        logger.exception("Webhook handler error")
        raise HTTPException(status_code=500, detail=str(e))
