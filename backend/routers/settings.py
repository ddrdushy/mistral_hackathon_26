"""Settings endpoints: Agent configuration, LLM usage reports, system config.

AUTH MODEL:
  - Agent config (read + write), system info, env-check → SUPERADMIN ONLY.
    These are platform-wide controls; one tenant flipping `use_mock` would
    break classification for everyone.
  - LLM usage report → tenant-scoped (a regular owner sees their tenant's
    usage; a superadmin sees the global aggregate via include_all=true).
"""
import os
import importlib
from datetime import datetime, timedelta
from typing import Optional
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
from models import LlmUsage
from billing.plans import get_plan
from services.llm_tracker import get_usage_report, get_all_logs
from auth.dependencies import (
    CurrentSession,
    current_session,
    require_superadmin,
)

router = APIRouter(prefix="/api/v1/settings", tags=["settings"])


# ═══════════════════════════════════════
# AGENT CONFIGURATION
# ═══════════════════════════════════════

class AgentConfig(BaseModel):
    agent_id: str = ""
    use_mock: bool = True
    model: str = ""
    description: str = ""


class AgentConfigUpdate(BaseModel):
    agent_id: Optional[str] = None
    use_mock: Optional[bool] = None


AGENT_MODULES = {
    "email_classifier": {
        "module": "agents.email_classifier",
        "display_name": "Email Classifier",
        "description": "Classifies incoming emails as candidate applications vs general emails",
        "default_model": "mistral-agent",
        "agent_id_var": "AGENT_ID",
        "mock_var": "USE_MOCK",
    },
    "resume_scorer": {
        "module": "agents.resume_scorer",
        "display_name": "Resume Scorer",
        "description": "Scores resumes against job descriptions with evidence and recommendations",
        "default_model": "mistral-agent",
        "agent_id_var": "AGENT_ID",
        "mock_var": "USE_MOCK",
    },
    "interview_evaluator": {
        "module": "agents.interview_evaluator",
        "display_name": "Interview Evaluator",
        "description": "Evaluates voice screening transcripts and generates interview decisions",
        "default_model": "mistral-agent",
        "agent_id_var": "AGENT_ID",
        "mock_var": "USE_MOCK",
    },
    "voice_screener": {
        "module": "agents.voice_screener",
        "display_name": "Voice Screener",
        "description": "Conducts automated voice screening calls via ElevenLabs",
        "default_model": "elevenlabs",
        "agent_id_var": "ELEVENLABS_AGENT_ID",
        "mock_var": "USE_MOCK",
    },
    "job_generator": {
        "module": "agents.job_generator",
        "display_name": "Job Generator",
        "description": "Auto-generates job posting details from a title using Mistral AI",
        "default_model": "mistral-large-latest",
        "agent_id_var": None,
        "mock_var": "USE_MOCK",
    },
}


def _get_agent_module(agent_key: str):
    """Import and return the agent module."""
    info = AGENT_MODULES.get(agent_key)
    if not info:
        raise HTTPException(status_code=404, detail=f"Agent '{agent_key}' not found")
    return importlib.import_module(info["module"]), info


@router.get("/agents")
async def list_agents(_: CurrentSession = Depends(require_superadmin)):
    """List all configured agents with their current status."""
    agents = []
    for key, info in AGENT_MODULES.items():
        try:
            mod = importlib.import_module(info["module"])
            agent_id = ""
            if info["agent_id_var"]:
                agent_id = getattr(mod, info["agent_id_var"], "")
            use_mock = getattr(mod, info["mock_var"], True)

            agents.append({
                "key": key,
                "display_name": info["display_name"],
                "description": info["description"],
                "model": info["default_model"],
                "agent_id": agent_id,
                "use_mock": use_mock,
                "status": "active" if (not use_mock and agent_id) else ("mock" if use_mock else "unconfigured"),
            })
        except Exception as e:
            agents.append({
                "key": key,
                "display_name": info["display_name"],
                "description": info["description"],
                "model": info["default_model"],
                "agent_id": "",
                "use_mock": True,
                "status": "error",
                "error": str(e),
            })

    return {"agents": agents}


@router.get("/agents/{agent_key}")
async def get_agent_config(
    agent_key: str,
    _: CurrentSession = Depends(require_superadmin),
):
    """Get a specific agent's configuration."""
    mod, info = _get_agent_module(agent_key)

    agent_id = ""
    if info["agent_id_var"]:
        agent_id = getattr(mod, info["agent_id_var"], "")

    return {
        "key": agent_key,
        "display_name": info["display_name"],
        "description": info["description"],
        "model": info["default_model"],
        "agent_id": agent_id,
        "use_mock": getattr(mod, info["mock_var"], True),
    }


@router.patch("/agents/{agent_key}")
async def update_agent_config(
    agent_key: str,
    req: AgentConfigUpdate,
    _: CurrentSession = Depends(require_superadmin),
):
    """Update an agent's configuration (agent_id, use_mock). Platform-wide."""
    mod, info = _get_agent_module(agent_key)

    if req.agent_id is not None and info["agent_id_var"]:
        setattr(mod, info["agent_id_var"], req.agent_id)

    if req.use_mock is not None:
        setattr(mod, info["mock_var"], req.use_mock)

    agent_id = ""
    if info["agent_id_var"]:
        agent_id = getattr(mod, info["agent_id_var"], "")

    return {
        "key": agent_key,
        "display_name": info["display_name"],
        "agent_id": agent_id,
        "use_mock": getattr(mod, info["mock_var"], True),
        "status": "updated",
    }


# ═══════════════════════════════════════
# LLM USAGE REPORTING
# ═══════════════════════════════════════

@router.get("/llm/usage")
async def llm_usage_report(
    days: int = 7,
    include_all: bool = False,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """LLM usage report. By default scoped to the caller's tenant. A superadmin
    may pass include_all=true to see the global aggregate (every tenant).

    Both branches read from the LlmUsage DB table. We do NOT use the
    in-memory llm_tracker because that list resets on every backend
    restart, which made the admin's global view look permanently empty.
    """
    if include_all and not session.user.is_superadmin:
        raise HTTPException(status_code=403, detail="Superadmin required")

    cutoff = datetime.utcnow() - timedelta(days=days)

    base_q = db.query(LlmUsage).filter(LlmUsage.created_at >= cutoff)
    if not include_all:
        base_q = base_q.filter(LlmUsage.tenant_id == session.tenant.id)

    # Per-agent breakdown (cheap aggregate query).
    agent_rows = (
        base_q.with_entities(
            LlmUsage.agent_name,
            func.count(LlmUsage.id),
            func.coalesce(func.sum(LlmUsage.input_tokens), 0),
            func.coalesce(func.sum(LlmUsage.output_tokens), 0),
            func.coalesce(func.sum(LlmUsage.cost_usd), 0.0),
            func.coalesce(func.avg(LlmUsage.latency_ms), 0),
        )
        .group_by(LlmUsage.agent_name)
        .all()
    )

    # Per-agent error counts — separate query because mixing a filtered
    # count with the unfiltered aggregate above requires a CASE expr
    # that's awkward across SQLite / Postgres. Two queries is fine; each
    # hits an indexed column.
    err_rows = (
        base_q.with_entities(
            LlmUsage.agent_name,
            func.count(LlmUsage.id),
        )
        .filter(LlmUsage.status == "error")
        .group_by(LlmUsage.agent_name)
        .all()
    )
    err_by_agent = {name: int(n or 0) for name, n in err_rows}

    by_agent: dict[str, dict] = {}
    total_calls = 0
    total_in = 0
    total_out = 0
    total_cost = 0.0
    total_latency_weighted = 0.0
    for name, calls, in_tokens, out_tokens, cost, avg_latency in agent_rows:
        calls_i = int(calls or 0)
        total_tokens = int((in_tokens or 0) + (out_tokens or 0))
        by_agent[name] = {
            "calls": calls_i,
            "input_tokens": int(in_tokens or 0),
            "output_tokens": int(out_tokens or 0),
            "total_tokens": total_tokens,
            # Frontend reads `tokens` (the old in-memory shape) on the
            # Usage-by-Agent table; aliased so both shapes work.
            "tokens": total_tokens,
            "cost_usd": round(float(cost or 0.0), 4),
            "avg_latency_ms": int(avg_latency or 0),
            "errors": err_by_agent.get(name, 0),
        }
        total_calls += calls_i
        total_in += int(in_tokens or 0)
        total_out += int(out_tokens or 0)
        total_cost += float(cost or 0.0)
        total_latency_weighted += float(avg_latency or 0) * calls_i

    avg_latency_overall = (
        int(total_latency_weighted / total_calls) if total_calls > 0 else 0
    )
    total_errors = sum(err_by_agent.values())
    error_rate = round((total_errors / total_calls * 100), 1) if total_calls > 0 else 0.0

    # Hourly trend (last 24h only) — fetch raw rows and bucket in Python
    # so we work on both SQLite (dev) and Postgres (prod) without
    # date_trunc / strftime gymnastics. 24h of rows is small.
    one_day_ago = datetime.utcnow() - timedelta(days=1)
    hourly_q = db.query(
        LlmUsage.created_at,
        LlmUsage.input_tokens,
        LlmUsage.output_tokens,
        LlmUsage.cost_usd,
    ).filter(LlmUsage.created_at >= one_day_ago)
    if not include_all:
        hourly_q = hourly_q.filter(LlmUsage.tenant_id == session.tenant.id)
    buckets: dict[str, dict] = {}
    for ts, in_t, out_t, cost in hourly_q.all():
        if not ts:
            continue
        key = ts.strftime("%Y-%m-%d %H:00")
        b = buckets.setdefault(key, {"calls": 0, "tokens": 0, "cost_usd": 0.0})
        b["calls"] += 1
        b["tokens"] += int((in_t or 0) + (out_t or 0))
        b["cost_usd"] = round(b["cost_usd"] + float(cost or 0.0), 4)
    hourly_trend = [{"hour": k, **v} for k, v in sorted(buckets.items())]

    # Recent calls — last 20 rows for the table at the bottom of the page.
    recent_q = base_q.order_by(LlmUsage.created_at.desc()).limit(20)
    recent_calls = []
    for r in recent_q.all():
        recent_calls.append({
            "timestamp": r.created_at.isoformat() if r.created_at else "",
            "agent_name": r.agent_name,
            "model": r.model or "",
            "input_tokens": int(r.input_tokens or 0),
            "output_tokens": int(r.output_tokens or 0),
            "total_tokens": int((r.input_tokens or 0) + (r.output_tokens or 0)),
            "cost_usd": round(float(r.cost_usd or 0.0), 6),
            "latency_ms": int(r.latency_ms or 0),
            "status": r.status or "success",
        })
    # Reverse so the frontend's `.slice().reverse()` puts newest first.
    recent_calls.reverse()

    # Apply plan-level markup so the tenant sees what they're billed for,
    # not raw provider cost. include_all=true (super-admin) keeps the raw
    # numbers so we can see actual margin per tenant in the admin panel.
    plan = get_plan(session.tenant.plan)
    markup = max(0.0, float(plan.llm_markup_multiplier or 1.0))
    if include_all and session.user.is_superadmin:
        # Admin view shows BOTH: raw cost from the column + the marked-up
        # billable they'd charge for, so we can monitor margin per agent
        # without losing the underlying number.
        billable_total = round(total_cost * markup, 4)
        margin_usd = round(billable_total - total_cost, 4)
        for ag in by_agent.values():
            ag["billable_usd"] = round(ag["cost_usd"] * markup, 4)
    else:
        # Tenant view: replace cost_usd with billable so they don't see
        # our provider price. Keep the field name to avoid a frontend
        # rename — the value they care about is what they pay.
        billable_total = round(total_cost * markup, 4)
        margin_usd = 0.0
        for ag in by_agent.values():
            ag["cost_usd"] = round(ag["cost_usd"] * markup, 4)
        total_cost = billable_total

    return {
        "scope": "global" if include_all else "tenant",
        "period_days": days,
        "days": days,
        "total_calls": total_calls,
        "total_input_tokens": total_in,
        "total_output_tokens": total_out,
        "total_tokens": total_in + total_out,
        "total_cost_usd": round(total_cost, 4),
        "billable_usd": billable_total,
        "markup_multiplier": markup,
        "margin_usd": margin_usd,
        "avg_latency_ms": avg_latency_overall,
        "error_count": total_errors,
        "error_rate": error_rate,
        "by_agent": by_agent,
        "agent_breakdown": by_agent,
        "model_breakdown": {},  # kept for shape parity with old in-memory tracker
        "hourly_trend": hourly_trend,
        "recent_calls": recent_calls,
    }


@router.get("/llm/logs")
async def llm_usage_logs(
    limit: int = 100,
    _: CurrentSession = Depends(require_superadmin),
):
    """Raw LLM usage logs across the platform. Superadmin-only — contains
    cross-tenant data."""
    return {"logs": get_all_logs(limit)}


@router.get("/voice/usage")
async def voice_usage_report(
    days: int = 30,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """ElevenLabs voice usage — both the platform's live subscription
    quota AND this tenant's own conversation rows from llm_usage.

    The subscription part is platform-wide (all tenants share the
    platform's ElevenLabs account); the tenant-scoped part shows how
    much of that pie this specific tenant is consuming.
    """
    from services import elevenlabs_usage
    return {
        "subscription": elevenlabs_usage.fetch_subscription_summary(),
        "tenant": elevenlabs_usage.tenant_voice_summary(
            db, session.tenant.id, days=days,
        ),
    }


@router.post("/voice/backfill")
async def backfill_voice_usage(
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Re-import this tenant's past voice calls from ElevenLabs.

    Needed for tenants whose interviews completed before per-tenant
    usage tracking was wired into the ElevenLabs webhook — those calls
    ran on the platform subscription but didn't write a per-tenant
    LlmUsage row, so the tenant card shows 0/0/0 even though the
    platform's character counter has moved.

    Idempotent: rows already present are left alone.
    """
    from services import elevenlabs_usage
    result = elevenlabs_usage.backfill_voice_from_links(db, session.tenant.id)
    return {
        "ok": True,
        "result": result,
        "tenant": elevenlabs_usage.tenant_voice_summary(db, session.tenant.id, days=30),
    }


# ═══════════════════════════════════════
# SYSTEM CONFIGURATION
# ═══════════════════════════════════════

@router.get("/system")
async def system_config(_: CurrentSession = Depends(require_superadmin)):
    """Get system configuration and environment info. Superadmin-only."""
    return {
        "mistral_api_key_set": bool(os.environ.get("MISTRAL_API_KEY")),
        "elevenlabs_api_key_set": bool(os.environ.get("ELEVENLABS_API_KEY")),
        "elevenlabs_webhook_secret_set": bool(os.environ.get("ELEVENLABS_WEBHOOK_SECRET")),
        "database_url_set": bool(os.environ.get("DATABASE_URL")),
        "environment": os.environ.get("ENVIRONMENT", "development"),
        "version": "1.0.0",
    }


@router.get("/env-check")
async def env_check(_: CurrentSession = Depends(require_superadmin)):
    """Quick environment variable check for setup validation. Superadmin-only."""
    keys = [
        "MISTRAL_API_KEY",
        "ELEVENLABS_API_KEY",
        "ELEVENLABS_WEBHOOK_SECRET",
        "DATABASE_URL",
    ]
    return {
        k: ("set" if os.environ.get(k) else "missing")
        for k in keys
    }
