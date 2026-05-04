"""
Per-tenant LLM cost guard.

Enforces a hard daily Mistral spend cap per tenant. Uses a contextvar so
existing LLM call sites (LLMCallTimer) don't need to thread tenant_id
through their function signatures — middleware sets the var at request time.

Flow:
  1. Auth dependency `current_session` calls `set_active_tenant(tenant.id)`
  2. Before each LLM call, agent calls `check_llm_budget()` which raises 429
     if the tenant has exceeded their daily budget
  3. After the call, `record_llm_usage(...)` persists the spend to LlmUsage
"""
from __future__ import annotations

from contextvars import ContextVar
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import SessionLocal
from models import LlmUsage, Tenant
from billing.plans import get_plan

# Active tenant for the current request. Set by auth dependency.
_active_tenant: ContextVar[Optional[int]] = ContextVar("active_tenant", default=None)


def set_active_tenant(tenant_id: Optional[int]) -> None:
    _active_tenant.set(tenant_id)


def get_active_tenant() -> Optional[int]:
    return _active_tenant.get()


def _today_utc_start() -> datetime:
    return datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)


def daily_spend(db: Session, tenant_id: int) -> float:
    """Return today's total LLM spend (USD) for a tenant."""
    total = db.query(func.coalesce(func.sum(LlmUsage.cost_usd), 0.0)).filter(
        LlmUsage.tenant_id == tenant_id,
        LlmUsage.created_at >= _today_utc_start(),
    ).scalar()
    return float(total or 0.0)


def daily_budget(db: Session, tenant: Tenant) -> float:
    """Resolve the daily LLM budget for a tenant. -1 means unlimited."""
    plan = get_plan(tenant.plan)
    return plan.daily_llm_budget_usd


def check_llm_budget(tenant_id: Optional[int] = None) -> None:
    """Raise HTTPException 429 if today's spend has hit the daily cap.

    If tenant_id is None we look at the contextvar. If still None (e.g. system
    call outside a request), no enforcement — only logs.
    """
    tid = tenant_id if tenant_id is not None else get_active_tenant()
    if tid is None:
        return

    db = SessionLocal()
    try:
        tenant = db.query(Tenant).filter(Tenant.id == tid).first()
        if not tenant:
            return
        budget = daily_budget(db, tenant)
        if budget < 0:
            return  # unlimited

        spent = daily_spend(db, tid)
        if spent >= budget:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=(
                    f"Daily AI budget reached (${spent:.2f}/${budget:.2f}) on the {tenant.plan} plan. "
                    f"Resets at midnight UTC, or upgrade for a higher cap."
                ),
            )
    finally:
        db.close()


def record_llm_usage(
    agent_name: str,
    model: str,
    input_tokens: int,
    output_tokens: int,
    cost_usd: float,
    latency_ms: int,
    status_str: str = "success",
    tenant_id: Optional[int] = None,
) -> None:
    """Persist a usage record. Called from llm_tracker after each call."""
    tid = tenant_id if tenant_id is not None else get_active_tenant()
    db = SessionLocal()
    try:
        record = LlmUsage(
            tenant_id=tid,
            agent_name=agent_name,
            model=model,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=cost_usd,
            latency_ms=latency_ms,
            status=status_str,
            created_at=datetime.utcnow(),
        )
        db.add(record)
        db.commit()
    except Exception:
        db.rollback()  # never break the user request because of metrics
    finally:
        db.close()


def usage_today(tenant_id: int) -> dict:
    """Return today's spend + budget for billing UI."""
    db = SessionLocal()
    try:
        tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
        if not tenant:
            return {"spent_usd": 0.0, "budget_usd": 0.0, "remaining_usd": 0.0}
        spent = daily_spend(db, tenant_id)
        budget = daily_budget(db, tenant)
        return {
            "spent_usd": round(spent, 4),
            "budget_usd": budget,
            "remaining_usd": round(max(0.0, budget - spent), 4) if budget >= 0 else -1.0,
        }
    finally:
        db.close()
