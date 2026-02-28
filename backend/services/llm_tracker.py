"""
LLM Usage Tracker — Logs all LLM API calls for usage reporting.
Tracks: agent, model, tokens, cost, latency, status.
"""
import time
import json
import logging
from datetime import datetime, timedelta
from typing import Optional, List, Dict
from dataclasses import dataclass, asdict
from sqlalchemy.orm import Session
from sqlalchemy import func

logger = logging.getLogger("hireops.llm_tracker")

# In-memory log for fast access (also persisted to DB)
_usage_logs: List[Dict] = []

# Cost per 1M tokens (Mistral pricing approximation)
COST_PER_1M_INPUT = {
    "mistral-large-latest": 2.0,
    "mistral-medium-latest": 2.7,
    "mistral-small-latest": 0.2,
    "open-mistral-nemo": 0.15,
    "agent": 3.0,  # Agent calls (estimated)
}
COST_PER_1M_OUTPUT = {
    "mistral-large-latest": 6.0,
    "mistral-medium-latest": 8.1,
    "mistral-small-latest": 0.6,
    "open-mistral-nemo": 0.15,
    "agent": 9.0,
}


@dataclass
class LLMUsageEntry:
    timestamp: str
    agent_name: str
    model: str
    input_tokens: int
    output_tokens: int
    total_tokens: int
    latency_ms: int
    cost_usd: float
    status: str  # success / error
    error_message: str = ""
    metadata: str = ""  # JSON string for extra info


def log_usage(
    agent_name: str,
    model: str,
    input_tokens: int = 0,
    output_tokens: int = 0,
    latency_ms: int = 0,
    status: str = "success",
    error_message: str = "",
    metadata: Optional[dict] = None,
):
    """Log an LLM API call."""
    total = input_tokens + output_tokens
    input_cost = (input_tokens / 1_000_000) * COST_PER_1M_INPUT.get(model, 3.0)
    output_cost = (output_tokens / 1_000_000) * COST_PER_1M_OUTPUT.get(model, 9.0)
    cost = round(input_cost + output_cost, 6)

    entry = LLMUsageEntry(
        timestamp=datetime.utcnow().isoformat(),
        agent_name=agent_name,
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=total,
        latency_ms=latency_ms,
        cost_usd=cost,
        status=status,
        error_message=error_message,
        metadata=json.dumps(metadata or {}),
    )

    _usage_logs.append(asdict(entry))

    # Keep only last 1000 entries in memory
    if len(_usage_logs) > 1000:
        _usage_logs.pop(0)

    logger.info(
        f"LLM call: {agent_name} | {model} | {total} tokens | "
        f"${cost:.4f} | {latency_ms}ms | {status}"
    )


def get_usage_report(days: int = 7) -> Dict:
    """Generate a usage report for the last N days."""
    cutoff = (datetime.utcnow() - timedelta(days=days)).isoformat()
    recent = [e for e in _usage_logs if e["timestamp"] >= cutoff]

    total_calls = len(recent)
    total_tokens = sum(e["total_tokens"] for e in recent)
    total_input = sum(e["input_tokens"] for e in recent)
    total_output = sum(e["output_tokens"] for e in recent)
    total_cost = round(sum(e["cost_usd"] for e in recent), 4)
    avg_latency = round(
        sum(e["latency_ms"] for e in recent) / max(total_calls, 1), 0
    )
    error_count = sum(1 for e in recent if e["status"] == "error")

    # Per-agent breakdown
    agent_breakdown = {}
    for e in recent:
        name = e["agent_name"]
        if name not in agent_breakdown:
            agent_breakdown[name] = {
                "calls": 0,
                "tokens": 0,
                "cost_usd": 0.0,
                "errors": 0,
                "avg_latency_ms": 0,
                "total_latency": 0,
            }
        agent_breakdown[name]["calls"] += 1
        agent_breakdown[name]["tokens"] += e["total_tokens"]
        agent_breakdown[name]["cost_usd"] = round(
            agent_breakdown[name]["cost_usd"] + e["cost_usd"], 4
        )
        if e["status"] == "error":
            agent_breakdown[name]["errors"] += 1
        agent_breakdown[name]["total_latency"] += e["latency_ms"]

    for name, data in agent_breakdown.items():
        data["avg_latency_ms"] = round(data["total_latency"] / max(data["calls"], 1))
        del data["total_latency"]

    # Per-model breakdown
    model_breakdown = {}
    for e in recent:
        model = e["model"]
        if model not in model_breakdown:
            model_breakdown[model] = {"calls": 0, "tokens": 0, "cost_usd": 0.0}
        model_breakdown[model]["calls"] += 1
        model_breakdown[model]["tokens"] += e["total_tokens"]
        model_breakdown[model]["cost_usd"] = round(
            model_breakdown[model]["cost_usd"] + e["cost_usd"], 4
        )

    # Hourly trend (last 24h)
    now = datetime.utcnow()
    hourly = {}
    for e in recent:
        ts = datetime.fromisoformat(e["timestamp"])
        if (now - ts).total_seconds() <= 86400:
            hour_key = ts.strftime("%Y-%m-%d %H:00")
            if hour_key not in hourly:
                hourly[hour_key] = {"calls": 0, "tokens": 0, "cost_usd": 0.0}
            hourly[hour_key]["calls"] += 1
            hourly[hour_key]["tokens"] += e["total_tokens"]
            hourly[hour_key]["cost_usd"] = round(
                hourly[hour_key]["cost_usd"] + e["cost_usd"], 4
            )

    return {
        "period_days": days,
        "total_calls": total_calls,
        "total_tokens": total_tokens,
        "total_input_tokens": total_input,
        "total_output_tokens": total_output,
        "total_cost_usd": total_cost,
        "avg_latency_ms": avg_latency,
        "error_count": error_count,
        "error_rate": round(error_count / max(total_calls, 1) * 100, 1),
        "agent_breakdown": agent_breakdown,
        "model_breakdown": model_breakdown,
        "hourly_trend": [
            {"hour": k, **v}
            for k, v in sorted(hourly.items())
        ],
        "recent_calls": recent[-20:],  # Last 20 calls
    }


def get_all_logs(limit: int = 100) -> List[Dict]:
    """Get raw usage logs."""
    return _usage_logs[-limit:]


class LLMCallTimer:
    """Context manager for timing LLM calls and auto-logging."""

    def __init__(self, agent_name: str, model: str = "agent"):
        self.agent_name = agent_name
        self.model = model
        self.start_time = 0
        self.input_tokens = 0
        self.output_tokens = 0

    def __enter__(self):
        self.start_time = time.time()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        latency = int((time.time() - self.start_time) * 1000)
        status = "error" if exc_type else "success"
        error_msg = str(exc_val) if exc_val else ""

        log_usage(
            agent_name=self.agent_name,
            model=self.model,
            input_tokens=self.input_tokens,
            output_tokens=self.output_tokens,
            latency_ms=latency,
            status=status,
            error_message=error_msg,
        )
        return False  # Don't suppress exceptions
