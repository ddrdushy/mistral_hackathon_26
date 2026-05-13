"""ElevenLabs usage tracking — voice screening cost visibility.

Two surfaces:
  1. Live subscription quota (`fetch_subscription_summary`) — calls
     /v1/user/subscription to get the platform-wide character count vs
     limit. Useful so HR can see how close the platform is to its tier
     ceiling.
  2. Per-conversation logging (`record_voice_call`) — writes a row into
     the existing `llm_usage` table tagged agent_name='elevenlabs_voice'
     so it shows up alongside Mistral spend in the tenant usage report.

ElevenLabs pricing changes quarterly. We don't hardcode a price; we
record characters + duration and let the UI do whatever conversion the
tenant wants. The platform-level subscription endpoint already returns
the authoritative figure.
"""
from __future__ import annotations

import json
import logging
import os
from datetime import datetime
from typing import Optional

import httpx
from sqlalchemy.orm import Session

from models import LlmUsage

logger = logging.getLogger("hireops.elevenlabs_usage")

ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1"
AGENT_NAME = "elevenlabs_voice"

# Approximate cost-per-minute estimate for the platform's tier. Override
# via env if your tier differs from the default Conversational AI Creator
# bracket. Used only for the voice usage card; the live subscription
# response is the source of truth for character / minute caps.
COST_PER_MINUTE_USD = float(os.getenv("ELEVENLABS_COST_PER_MIN", "0.10"))


def _api_key() -> Optional[str]:
    return os.getenv("ELEVENLABS_API_KEY") or None


def _headers() -> dict:
    key = _api_key()
    if not key:
        return {}
    return {"xi-api-key": key, "accept": "application/json"}


# ─── Live subscription / quota ──────────────────────────────────────────────


def fetch_subscription_summary(timeout_s: float = 10.0) -> dict:
    """Pull /v1/user/subscription. Returns a stripped-down dict the UI
    can render directly. On error returns {"available": False, "error": ...}
    so the UI degrades gracefully."""
    if not _api_key():
        return {"available": False, "error": "ELEVENLABS_API_KEY not configured"}

    url = f"{ELEVENLABS_API_BASE}/user/subscription"
    try:
        with httpx.Client(timeout=timeout_s) as c:
            res = c.get(url, headers=_headers())
    except httpx.RequestError as e:
        return {"available": False, "error": f"Network error: {e}"}

    if res.status_code >= 400:
        return {
            "available": False,
            "error": f"ElevenLabs {res.status_code}",
            "status": res.status_code,
        }

    try:
        data = res.json()
    except Exception:
        return {"available": False, "error": "Bad JSON from ElevenLabs"}

    char_count = int(data.get("character_count") or 0)
    char_limit = int(data.get("character_limit") or 0)
    pct = round((char_count / char_limit) * 100, 1) if char_limit else 0.0

    return {
        "available": True,
        "tier": data.get("tier") or data.get("subscription_tier") or "",
        "status": data.get("status", ""),
        "character_count": char_count,
        "character_limit": char_limit,
        "characters_remaining": max(0, char_limit - char_count),
        "percent_used": pct,
        "next_invoice": data.get("next_invoice", {}),
        "next_character_count_reset_unix": data.get("next_character_count_reset_unix"),
        "voice_limit": data.get("voice_limit"),
        "professional_voice_limit": data.get("professional_voice_limit"),
        "can_extend_character_limit": data.get("can_extend_character_limit", False),
        "allowed_to_extend_character_limit": data.get("allowed_to_extend_character_limit", False),
    }


# ─── Per-conversation metadata (post-call logging) ──────────────────────────


def fetch_conversation_metadata(conversation_id: str, timeout_s: float = 10.0) -> dict:
    """Pull /v1/convai/conversations/{id}. Returns duration + status. We
    don't always have character counts on conversational AI; total cost
    is dominated by minutes. Best-effort — caller must handle the empty
    case."""
    if not conversation_id or not _api_key():
        return {}
    url = f"{ELEVENLABS_API_BASE}/convai/conversations/{conversation_id}"
    try:
        with httpx.Client(timeout=timeout_s) as c:
            res = c.get(url, headers=_headers())
    except httpx.RequestError as e:
        logger.warning("ElevenLabs conversation fetch failed: %s", e)
        return {}
    if res.status_code >= 400:
        logger.warning("ElevenLabs conversation %s -> %s", conversation_id, res.status_code)
        return {}
    try:
        return res.json() or {}
    except Exception:
        return {}


def record_voice_call(
    db: Session,
    *,
    tenant_id: int,
    conversation_id: str = "",
    duration_seconds: int = 0,
    character_count: int = 0,
    app_id: Optional[int] = None,
    status: str = "success",
    error_message: str = "",
) -> LlmUsage:
    """Write an `llm_usage` row for a completed ElevenLabs voice call so
    it shows up in the tenant's existing usage breakdown.

    We map the schema:
      - input_tokens  → character_count (proxy for TTS chars consumed)
      - output_tokens → duration_seconds (proxy for conversation length)
      - latency_ms    → 0 (per-call latency isn't meaningful; the call
                         IS the latency)
      - cost_usd      → estimated from duration × ELEVENLABS_COST_PER_MIN
      - metadata      → {conversation_id, app_id}
    """
    minutes = duration_seconds / 60.0 if duration_seconds else 0.0
    cost = round(minutes * COST_PER_MINUTE_USD, 4)
    # LlmUsage schema has no metadata column; conversation_id + app_id
    # are looked up via InterviewLink/Application separately when the
    # tenant drills into the row. We stash duration_seconds in
    # output_tokens and character_count in input_tokens so the existing
    # /llm/usage report shows useful numbers per voice agent.
    row = LlmUsage(
        tenant_id=tenant_id,
        agent_name=AGENT_NAME,
        model="convai",
        input_tokens=int(character_count or 0),
        output_tokens=int(duration_seconds or 0),
        latency_ms=0,
        cost_usd=cost,
        status=status,
        created_at=datetime.utcnow(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    logger.info(
        "ElevenLabs voice call recorded: tenant=%s conv=%s sec=%s chars=%s cost=$%s",
        tenant_id, conversation_id, duration_seconds, character_count, cost,
    )
    return row


# ─── Tenant-scoped aggregate (last N days) ──────────────────────────────────


def backfill_voice_from_links(
    db: Session, tenant_id: int, *, lookback_days: int = 180
) -> dict:
    """Walk every completed InterviewLink for this tenant and write a
    matching LlmUsage row for any that don't already have one.

    Needed because per-tenant voice tracking only started writing rows
    after a recent fix — past interviews ran successfully on the
    platform's ElevenLabs subscription but never landed in llm_usage,
    so the tenant card showed 0 calls / 0 minutes / $0.

    Returns ``{"scanned", "added", "skipped"}``. Best-effort — any per-
    link failure (e.g. ElevenLabs returns 404 for an old conversation
    id) just skips that row.
    """
    from datetime import timedelta
    from sqlalchemy import and_
    from models import InterviewLink, Application

    cutoff = datetime.utcnow() - timedelta(days=max(1, lookback_days))

    # Only consider tenant's completed interview links that have an
    # ElevenLabs conversation id attached. Lifting tenant_id from the
    # joined Application keeps this cheap on Postgres' indexes.
    links = (
        db.query(InterviewLink, Application)
        .join(Application, Application.id == InterviewLink.app_id)
        .filter(
            Application.tenant_id == tenant_id,
            InterviewLink.elevenlabs_conversation_id.isnot(None),
            InterviewLink.elevenlabs_conversation_id != "",
            InterviewLink.interview_completed_at.isnot(None),
            InterviewLink.interview_completed_at >= cutoff,
        )
        .all()
    )

    scanned = len(links)
    added = 0
    skipped = 0

    for link, app in links:
        # Skip if we already wrote a usage row for this conversation.
        # Use the same "approximate match" heuristic the webhook uses:
        # tenant + agent + duration as a proxy for conversation id.
        if link.interview_completed_at and link.interview_started_at:
            local_dur = int(
                (link.interview_completed_at - link.interview_started_at).total_seconds()
            )
        else:
            local_dur = 0
        existing = (
            db.query(LlmUsage)
            .filter(
                and_(
                    LlmUsage.tenant_id == tenant_id,
                    LlmUsage.agent_name == AGENT_NAME,
                    LlmUsage.output_tokens == local_dur,
                    LlmUsage.created_at >= link.interview_completed_at - timedelta(hours=2),
                    LlmUsage.created_at <= link.interview_completed_at + timedelta(hours=2),
                )
            )
            .first()
        )
        if existing:
            skipped += 1
            continue

        # Fetch authoritative duration + chars from ElevenLabs. Falls
        # back to the locally-computed duration if the API is unreachable.
        duration = local_dur
        chars = 0
        try:
            meta = fetch_conversation_metadata(link.elevenlabs_conversation_id)
            if meta:
                md = meta.get("metadata") or {}
                duration = int(
                    md.get("call_duration_secs")
                    or meta.get("call_duration_secs")
                    or local_dur
                )
                chars = int(
                    md.get("character_count")
                    or meta.get("character_count")
                    or 0
                )
        except Exception:
            pass

        try:
            record_voice_call(
                db,
                tenant_id=tenant_id,
                conversation_id=link.elevenlabs_conversation_id,
                duration_seconds=max(0, duration),
                character_count=chars,
                app_id=app.id,
            )
            added += 1
        except Exception:
            skipped += 1

    return {"scanned": scanned, "added": added, "skipped": skipped}


def tenant_voice_summary(db: Session, tenant_id: int, days: int = 30) -> dict:
    """Sum the tenant's voice rows over the last `days`. Used by the
    Settings → Voice usage card so HR sees their own ElevenLabs spend
    independent of platform tier."""
    from datetime import timedelta
    from sqlalchemy import func

    cutoff = datetime.utcnow() - timedelta(days=max(days, 1))
    row = db.query(
        func.count(LlmUsage.id),
        func.coalesce(func.sum(LlmUsage.input_tokens), 0),   # chars
        func.coalesce(func.sum(LlmUsage.output_tokens), 0),  # seconds
        func.coalesce(func.sum(LlmUsage.cost_usd), 0.0),
    ).filter(
        LlmUsage.tenant_id == tenant_id,
        LlmUsage.agent_name == AGENT_NAME,
        LlmUsage.created_at >= cutoff,
    ).one()

    calls, chars, secs, cost = row
    return {
        "days": days,
        "calls": int(calls or 0),
        "characters": int(chars or 0),
        "seconds": int(secs or 0),
        "minutes": round(float(secs or 0) / 60.0, 2),
        "estimated_cost_usd": round(float(cost or 0.0), 4),
        "cost_per_minute_assumption": COST_PER_MINUTE_USD,
    }
