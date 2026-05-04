"""
Stripe integration: customer creation, checkout sessions, customer portal,
webhook signature verification + event handling.

Env vars (set in production .env):
  STRIPE_SECRET_KEY       — sk_live_... or sk_test_...
  STRIPE_WEBHOOK_SECRET   — whsec_...
  STRIPE_STARTER_PRICE_ID — price_... for Starter plan
  STRIPE_PRO_PRICE_ID     — price_... for Pro plan

If STRIPE_SECRET_KEY is unset (e.g. local dev without Stripe), checkout/portal
endpoints return a clear error instead of crashing.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime
from typing import Optional

import stripe
from sqlalchemy.orm import Session

from models import Tenant, User
from billing.plans import get_plan, PLANS, PlanName

logger = logging.getLogger("hireops.billing")


def _api_key() -> str | None:
    return os.getenv("STRIPE_SECRET_KEY")


def configured() -> bool:
    return bool(_api_key())


def _stripe():
    """Lazy-init: avoid module-level config so the app boots without Stripe env."""
    key = _api_key()
    if not key:
        raise RuntimeError(
            "Stripe is not configured. Set STRIPE_SECRET_KEY in the backend env."
        )
    stripe.api_key = key
    return stripe


def _frontend_url() -> str:
    return os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")


# ── Customer + subscription ───────────────────────────────────────────────


def ensure_customer(db: Session, tenant: Tenant, user: User) -> str:
    """Get or create the Stripe Customer for this tenant. Persists the id."""
    if tenant.stripe_customer_id:
        return tenant.stripe_customer_id

    s = _stripe()
    customer = s.Customer.create(
        email=user.email,
        name=tenant.name,
        metadata={"tenant_id": str(tenant.id), "tenant_slug": tenant.slug},
    )
    tenant.stripe_customer_id = customer.id
    db.commit()
    return customer.id


def create_checkout_session(db: Session, tenant: Tenant, user: User, plan_name: PlanName) -> str:
    """Returns the Stripe Checkout URL for an upgrade. Raises ValueError if the
    plan can't be checked out (free or missing price id)."""
    plan = get_plan(plan_name)
    if plan.name == "free":
        raise ValueError("Cannot checkout to the free plan")
    if not plan.stripe_price_id:
        raise ValueError(
            f"Plan '{plan.name}' has no STRIPE_*_PRICE_ID configured. "
            f"Set it in backend env and restart."
        )

    s = _stripe()
    customer_id = ensure_customer(db, tenant, user)
    session = s.checkout.Session.create(
        mode="subscription",
        customer=customer_id,
        line_items=[{"price": plan.stripe_price_id, "quantity": 1}],
        success_url=f"{_frontend_url()}/settings/billing?upgraded=1",
        cancel_url=f"{_frontend_url()}/settings/billing?canceled=1",
        metadata={"tenant_id": str(tenant.id), "plan": plan.name},
        subscription_data={
            "metadata": {"tenant_id": str(tenant.id), "plan": plan.name},
        },
        allow_promotion_codes=True,
    )
    return session.url or ""


def create_portal_session(db: Session, tenant: Tenant, user: User) -> str:
    """Customer Portal URL for self-service plan management / cancellation."""
    s = _stripe()
    customer_id = ensure_customer(db, tenant, user)
    session = s.billing_portal.Session.create(
        customer=customer_id,
        return_url=f"{_frontend_url()}/settings/billing",
    )
    return session.url or ""


# ── Webhook handling ──────────────────────────────────────────────────────


def verify_webhook(payload: bytes, signature: str) -> dict:
    """Verify Stripe webhook signature. Raises stripe.SignatureVerificationError on bad sig."""
    secret = os.getenv("STRIPE_WEBHOOK_SECRET", "")
    if not secret:
        raise RuntimeError(
            "STRIPE_WEBHOOK_SECRET not set — cannot verify webhook signatures."
        )
    return stripe.Webhook.construct_event(payload, signature, secret)


def _plan_from_price(price_id: Optional[str]) -> Optional[PlanName]:
    """Reverse-map a Stripe Price ID to a plan name."""
    if not price_id:
        return None
    for plan in PLANS.values():
        if plan.stripe_price_id and plan.stripe_price_id == price_id:
            return plan.name
    return None


def handle_event(db: Session, event: dict) -> dict:
    """Apply a webhook event to a tenant's subscription state."""
    event_type = event.get("type", "")
    obj = (event.get("data") or {}).get("object") or {}

    if event_type == "checkout.session.completed":
        return _handle_checkout_completed(db, obj)
    elif event_type in ("customer.subscription.created", "customer.subscription.updated"):
        return _handle_subscription_updated(db, obj)
    elif event_type == "customer.subscription.deleted":
        return _handle_subscription_deleted(db, obj)
    elif event_type == "invoice.payment_failed":
        return _handle_payment_failed(db, obj)

    return {"status": "ignored", "type": event_type}


def _tenant_for_subscription(db: Session, sub: dict) -> Optional[Tenant]:
    # Try metadata first, then customer id lookup
    meta = sub.get("metadata") or {}
    tenant_id = meta.get("tenant_id")
    if tenant_id:
        try:
            return db.query(Tenant).filter(Tenant.id == int(tenant_id)).first()
        except (TypeError, ValueError):
            pass
    customer_id = sub.get("customer")
    if customer_id:
        return db.query(Tenant).filter(Tenant.stripe_customer_id == customer_id).first()
    return None


def _handle_checkout_completed(db: Session, session_obj: dict) -> dict:
    """checkout.session.completed: subscription created. Update plan + ids."""
    customer_id = session_obj.get("customer")
    subscription_id = session_obj.get("subscription")
    meta = session_obj.get("metadata") or {}
    tenant_id = meta.get("tenant_id")
    plan_name = meta.get("plan")

    tenant = None
    if tenant_id:
        try:
            tenant = db.query(Tenant).filter(Tenant.id == int(tenant_id)).first()
        except (TypeError, ValueError):
            tenant = None
    if not tenant and customer_id:
        tenant = db.query(Tenant).filter(Tenant.stripe_customer_id == customer_id).first()

    if not tenant:
        logger.warning("checkout.completed: tenant not found, customer=%s", customer_id)
        return {"status": "tenant_not_found"}

    if customer_id:
        tenant.stripe_customer_id = customer_id
    if subscription_id:
        tenant.stripe_subscription_id = subscription_id
    if plan_name in PLANS:
        tenant.plan = plan_name
    tenant.subscription_status = "active"
    tenant.updated_at = datetime.utcnow()
    db.commit()
    logger.info("Checkout completed: tenant=%s plan=%s", tenant.id, tenant.plan)
    return {"status": "applied", "tenant_id": tenant.id, "plan": tenant.plan}


def _handle_subscription_updated(db: Session, sub: dict) -> dict:
    tenant = _tenant_for_subscription(db, sub)
    if not tenant:
        return {"status": "tenant_not_found"}

    items = (sub.get("items") or {}).get("data") or []
    price_id = items[0]["price"]["id"] if items and items[0].get("price") else None
    plan = _plan_from_price(price_id)
    if plan:
        tenant.plan = plan
    tenant.subscription_status = sub.get("status", tenant.subscription_status)
    tenant.stripe_subscription_id = sub.get("id", tenant.stripe_subscription_id)
    cpe = sub.get("current_period_end")
    if cpe:
        tenant.current_period_end = datetime.utcfromtimestamp(int(cpe))
    tenant.updated_at = datetime.utcnow()
    db.commit()
    return {"status": "applied", "tenant_id": tenant.id, "plan": tenant.plan}


def _handle_subscription_deleted(db: Session, sub: dict) -> dict:
    tenant = _tenant_for_subscription(db, sub)
    if not tenant:
        return {"status": "tenant_not_found"}
    tenant.plan = "free"
    tenant.subscription_status = "canceled"
    tenant.stripe_subscription_id = None
    tenant.current_period_end = None
    tenant.updated_at = datetime.utcnow()
    db.commit()
    return {"status": "downgraded_to_free", "tenant_id": tenant.id}


def _handle_payment_failed(db: Session, invoice: dict) -> dict:
    customer_id = invoice.get("customer")
    if not customer_id:
        return {"status": "no_customer"}
    tenant = db.query(Tenant).filter(Tenant.stripe_customer_id == customer_id).first()
    if not tenant:
        return {"status": "tenant_not_found"}
    tenant.subscription_status = "past_due"
    tenant.updated_at = datetime.utcnow()
    db.commit()
    return {"status": "marked_past_due", "tenant_id": tenant.id}
