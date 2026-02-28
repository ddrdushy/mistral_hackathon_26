"""Settings endpoints: Agent configuration, LLM usage reports, system config."""
import os
import importlib
from typing import Optional
from pydantic import BaseModel
from fastapi import APIRouter, HTTPException

from services.llm_tracker import get_usage_report, get_all_logs

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
async def list_agents():
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
async def get_agent_config(agent_key: str):
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
async def update_agent_config(agent_key: str, req: AgentConfigUpdate):
    """Update an agent's configuration (agent_id, use_mock)."""
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
async def llm_usage_report(days: int = 7):
    """Get LLM usage report for the last N days."""
    return get_usage_report(days)


@router.get("/llm/logs")
async def llm_usage_logs(limit: int = 100):
    """Get raw LLM usage logs."""
    return {"logs": get_all_logs(limit)}


# ═══════════════════════════════════════
# SYSTEM CONFIGURATION
# ═══════════════════════════════════════

@router.get("/system")
async def system_config():
    """Get system configuration and environment info."""
    return {
        "mistral_api_key_set": bool(os.environ.get("MISTRAL_API_KEY")),
        "elevenlabs_api_key_set": bool(os.environ.get("ELEVENLABS_API_KEY")),
        "elevenlabs_webhook_secret_set": bool(os.environ.get("ELEVENLABS_WEBHOOK_SECRET")),
        "database_url_set": bool(os.environ.get("DATABASE_URL")),
        "environment": os.environ.get("ENVIRONMENT", "development"),
        "version": "1.0.0",
    }


@router.get("/env-check")
async def env_check():
    """Quick environment variable check for setup validation."""
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
