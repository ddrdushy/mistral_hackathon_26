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
    may pass include_all=true to see the global aggregate (every tenant)."""
    if include_all and not session.user.is_superadmin:
        raise HTTPException(status_code=403, detail="Superadmin required")

    if include_all:
        # Global view — superadmin only. Use the in-memory tracker (already aggregated).
        return get_usage_report(days)

    # Tenant view — read directly from the LlmUsage table filtered by tenant_id.
    cutoff = datetime.utcnow() - timedelta(days=days)
    rows = (
        db.query(
            LlmUsage.agent_name,
            func.count(LlmUsage.id),
            func.coalesce(func.sum(LlmUsage.input_tokens), 0),
            func.coalesce(func.sum(LlmUsage.output_tokens), 0),
            func.coalesce(func.sum(LlmUsage.cost_usd), 0.0),
            func.coalesce(func.avg(LlmUsage.latency_ms), 0),
        )
        .filter(
            LlmUsage.tenant_id == session.tenant.id,
            LlmUsage.created_at >= cutoff,
        )
        .group_by(LlmUsage.agent_name)
        .all()
    )

    by_agent = {}
    total_calls = 0
    total_in = 0
    total_out = 0
    total_cost = 0.0
    for name, calls, in_tokens, out_tokens, cost, avg_latency in rows:
        by_agent[name] = {
            "calls": int(calls or 0),
            "input_tokens": int(in_tokens or 0),
            "output_tokens": int(out_tokens or 0),
            "total_tokens": int((in_tokens or 0) + (out_tokens or 0)),
            "cost_usd": round(float(cost or 0.0), 4),
            "avg_latency_ms": int(avg_latency or 0),
        }
        total_calls += int(calls or 0)
        total_in += int(in_tokens or 0)
        total_out += int(out_tokens or 0)
        total_cost += float(cost or 0.0)

    return {
        "scope": "tenant",
        "days": days,
        "total_calls": total_calls,
        "total_input_tokens": total_in,
        "total_output_tokens": total_out,
        "total_tokens": total_in + total_out,
        "total_cost_usd": round(total_cost, 4),
        "by_agent": by_agent,
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
