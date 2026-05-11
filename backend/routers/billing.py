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
    out = []
    # Iterate the static catalogue to preserve plan order, but resolve
    # each plan via get_plan() so DB-stored overrides (price, features,
    # stripe_price_id, allowed_agents) are applied. Without this the
    # `available` flag stays False for any tenant whose super-admin
    # configured the price in admin/plans rather than env vars.
    for static in PLANS.values():
        p = get_plan(static.name)
        out.append(PlanResponse(
            name=p.name,
            display_name=p.display_name,
            price_monthly_usd=p.price_monthly_usd,
            features=p.features,
            available=(p.name == "free") or bool(p.stripe_price_id),
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
