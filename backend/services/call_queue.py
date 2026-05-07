"""Phone queueing system — outbound voice calls scheduled per tenant.

Architecture:
  enqueue() writes a CallQueue row in 'pending' state.
  A single asyncio worker started at app boot polls for due rows
  (scheduled_for <= now() AND status='pending') and dispatches them
  via Twilio. Each tenant is concurrency-bounded so a single tenant
  can't burn through Twilio's rate limit.

Twilio dispatch:
  POST /Accounts/{sid}/Calls.json with the candidate's number and a
  TwiML callback URL on our backend. The TwiML endpoint (in the
  communications router) returns either Twilio's <Say>... or, when
  ElevenLabs is configured at the platform level, a <Connect><Stream>
  to the conversational agent.

Status reconciliation:
  Twilio fires status callbacks (initiated/ringing/answered/completed)
  to /api/v1/calls/twilio/status which updates the CallQueue row +
  records the transcript/outcome.

Reschedule:
  When the outcome lands as 'reschedule' the original row is marked
  'rescheduled' and a new pending row is enqueued at the requested time.
  Keeps the full attempt history visible.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timedelta
from typing import Optional

import httpx
from sqlalchemy.orm import Session

from database import SessionLocal
from models import CallQueue, Candidate, Communication, TenantIntegration
from services import twilio_service

logger = logging.getLogger("hireops.call_queue")

POLL_INTERVAL_SECONDS = 30
MAX_CONCURRENT_PER_TENANT = 3
MAX_RETRY = 2

_worker_task: Optional[asyncio.Task] = None
_in_flight: dict[int, set[int]] = {}  # tenant_id → set[call_id]


# ─── Public enqueue API ──────────────────────────────────────────────────────


def enqueue_call(
    db: Session,
    *,
    tenant_id: int,
    candidate_id: int,
    to_phone: str,
    purpose: str = "screening",
    scheduled_for: Optional[datetime] = None,
    script_prompt: str = "",
    app_id: Optional[int] = None,
    created_by_user_id: Optional[int] = None,
) -> CallQueue:
    if not to_phone or not to_phone.strip():
        raise ValueError("to_phone is required")
    row = CallQueue(
        tenant_id=tenant_id,
        candidate_id=candidate_id,
        app_id=app_id,
        purpose=purpose,
        status="pending",
        scheduled_for=scheduled_for or datetime.utcnow(),
        to_phone=to_phone.strip(),
        script_prompt=(script_prompt or "").strip(),
        created_by_user_id=created_by_user_id,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    logger.info(
        "Queued call %s for candidate=%s tenant=%s scheduled_for=%s purpose=%s",
        row.id, candidate_id, tenant_id, row.scheduled_for, purpose,
    )
    return row


def cancel_call(db: Session, tenant_id: int, call_id: int) -> Optional[CallQueue]:
    row = db.query(CallQueue).filter(
        CallQueue.id == call_id,
        CallQueue.tenant_id == tenant_id,
    ).first()
    if not row:
        return None
    if row.status not in ("pending", "in_progress"):
        return row
    row.status = "cancelled"
    row.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(row)
    return row


def reschedule_call(
    db: Session,
    *,
    tenant_id: int,
    call_id: int,
    new_time: datetime,
    note: str = "",
) -> CallQueue:
    """Mark the existing call 'rescheduled' and enqueue a fresh pending row
    at new_time. Returns the NEW row."""
    original = db.query(CallQueue).filter(
        CallQueue.id == call_id,
        CallQueue.tenant_id == tenant_id,
    ).first()
    if not original:
        raise ValueError("call not found")
    original.status = "rescheduled"
    original.outcome = original.outcome or "reschedule"
    if note:
        details = {}
        try:
            details = json.loads(original.outcome_details_json or "{}")
        except Exception:
            details = {}
        details["reschedule_note"] = note
        original.outcome_details_json = json.dumps(details)
    original.updated_at = datetime.utcnow()

    new_row = CallQueue(
        tenant_id=tenant_id,
        candidate_id=original.candidate_id,
        app_id=original.app_id,
        purpose=original.purpose if original.purpose else "reschedule",
        status="pending",
        scheduled_for=new_time,
        to_phone=original.to_phone,
        script_prompt=original.script_prompt,
        created_by_user_id=original.created_by_user_id,
    )
    db.add(new_row)
    db.flush()
    original.rescheduled_to_id = new_row.id
    db.commit()
    db.refresh(new_row)
    return new_row


# ─── Dispatch ────────────────────────────────────────────────────────────────


def _build_twiml_url(call_id: int) -> str:
    base = (os.getenv("BACKEND_PUBLIC_URL") or os.getenv("FRONTEND_URL") or "").rstrip("/")
    if not base:
        return ""
    if base.startswith("http://localhost") or base.startswith("http://127.0.0.1"):
        # Twilio can't reach localhost — caller will see the failure logged.
        return f"{base}/api/v1/calls/twiml/{call_id}"
    return f"{base}/api/v1/calls/twiml/{call_id}"


def _build_status_callback() -> str:
    base = (os.getenv("BACKEND_PUBLIC_URL") or os.getenv("FRONTEND_URL") or "").rstrip("/")
    if not base:
        return ""
    return f"{base}/api/v1/calls/twilio/status"


async def _dispatch_via_twilio(db: Session, call: CallQueue) -> None:
    """Fire the actual outbound call via Twilio. Logs a Communication row so
    the candidate timeline reflects the call attempt either way."""
    try:
        cfg = twilio_service.load_config(db, call.tenant_id)
    except twilio_service.TwilioConfigError as e:
        _mark_failed(db, call, f"Twilio not configured: {e}")
        return

    twiml_url = _build_twiml_url(call.id)
    if not twiml_url:
        _mark_failed(
            db, call,
            "BACKEND_PUBLIC_URL not set — Twilio cannot reach our TwiML endpoint",
        )
        return

    sid = cfg.account_sid
    payload = {
        "From": cfg.sms_from or cfg.whatsapp_from,
        "To": call.to_phone,
        "Url": twiml_url,
        "StatusCallback": _build_status_callback(),
        "StatusCallbackEvent": ["initiated", "ringing", "answered", "completed"],
        "StatusCallbackMethod": "POST",
    }
    if not payload["From"]:
        _mark_failed(
            db, call,
            "Twilio voice 'From' number missing — set sms_from on Twilio integration",
        )
        return

    url = f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Calls.json"
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            res = await client.post(
                url,
                data={k: v for k, v in payload.items() if v is not None and not isinstance(v, list)},
                auth=(sid, cfg.auth_token),
            )
            # Multi-value fields
            for ev in payload["StatusCallbackEvent"]:
                pass  # placeholder if we ever need to retry without dropping these
    except httpx.RequestError as e:
        _mark_failed(db, call, f"Twilio request failed: {e}")
        return

    if res.status_code >= 400:
        try:
            body = res.json()
        except Exception:
            body = {"message": res.text}
        _mark_failed(
            db, call,
            f"Twilio API {res.status_code}: {body.get('message') or body}",
        )
        return

    data = res.json()
    call.twilio_call_sid = data.get("sid", "")
    call.attempted_at = datetime.utcnow()
    call.from_phone = payload["From"]
    db.commit()

    # Mirror to communications log so the timeline shows the call.
    comm = Communication(
        tenant_id=call.tenant_id,
        candidate_id=call.candidate_id,
        app_id=call.app_id,
        channel="voice",
        direction="outbound",
        status="initiated",
        to_address=call.to_phone,
        from_address=payload["From"],
        body=call.script_prompt or "[scheduled call]",
        metadata_json=json.dumps({
            "call_queue_id": call.id,
            "twilio_call_sid": call.twilio_call_sid,
            "purpose": call.purpose,
        }),
        sent_by_user_id=call.created_by_user_id,
    )
    db.add(comm)
    db.commit()


def _mark_failed(db: Session, call: CallQueue, reason: str) -> None:
    call.status = "failed" if (call.retry_count or 0) >= MAX_RETRY else "pending"
    call.last_error = reason[:1000]
    call.retry_count = (call.retry_count or 0) + 1
    if call.status == "pending":
        # Exponential back-off, capped at 30 minutes.
        delay = min(60 * (2 ** call.retry_count), 1800)
        call.scheduled_for = datetime.utcnow() + timedelta(seconds=delay)
        logger.warning(
            "Call %s dispatch failed (%s) — retry #%s in %ss",
            call.id, reason, call.retry_count, delay,
        )
    else:
        logger.error("Call %s permanently failed: %s", call.id, reason)
    db.commit()


# ─── Worker loop ─────────────────────────────────────────────────────────────


async def _process_due() -> None:
    db = SessionLocal()
    try:
        due = db.query(CallQueue).filter(
            CallQueue.status == "pending",
            CallQueue.scheduled_for <= datetime.utcnow(),
        ).order_by(CallQueue.scheduled_for.asc()).limit(50).all()
        for call in due:
            slots = _in_flight.setdefault(call.tenant_id, set())
            if len(slots) >= MAX_CONCURRENT_PER_TENANT:
                continue
            if call.id in slots:
                continue
            slots.add(call.id)

            call.status = "in_progress"
            call.attempted_at = datetime.utcnow()
            db.commit()

            try:
                await _dispatch_via_twilio(db, call)
            except Exception as e:
                logger.exception("Unhandled dispatch error for call %s: %s", call.id, e)
                _mark_failed(db, call, str(e))
            finally:
                slots.discard(call.id)
    finally:
        db.close()


async def _worker_loop() -> None:
    logger.info("call_queue worker started (poll every %ss)", POLL_INTERVAL_SECONDS)
    while True:
        try:
            await _process_due()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.exception("call_queue worker iteration failed: %s", e)
        await asyncio.sleep(POLL_INTERVAL_SECONDS)


async def start_worker() -> None:
    global _worker_task
    if _worker_task and not _worker_task.done():
        return
    loop = asyncio.get_running_loop()
    _worker_task = loop.create_task(_worker_loop(), name="call_queue_worker")


async def stop_worker() -> None:
    global _worker_task
    if _worker_task and not _worker_task.done():
        _worker_task.cancel()
        try:
            await _worker_task
        except asyncio.CancelledError:
            pass
    _worker_task = None


# ─── Status reconciliation ───────────────────────────────────────────────────


def apply_twilio_status(
    db: Session,
    twilio_call_sid: str,
    call_status: str,
    extras: Optional[dict] = None,
) -> Optional[CallQueue]:
    """Twilio status webhook calls into this. Maps Twilio statuses
    (initiated/ringing/answered/completed/failed/no-answer/busy) onto our
    CallQueue.status."""
    call = db.query(CallQueue).filter(CallQueue.twilio_call_sid == twilio_call_sid).first()
    if not call:
        return None

    mapping = {
        "initiated": "in_progress",
        "ringing": "in_progress",
        "answered": "in_progress",
        "in-progress": "in_progress",
        "completed": "completed",
        "busy": "failed",
        "failed": "failed",
        "no-answer": "failed",
        "canceled": "cancelled",
    }
    new_status = mapping.get(call_status.lower(), call.status)
    call.status = new_status
    if new_status in ("completed", "failed", "cancelled"):
        call.completed_at = datetime.utcnow()
    if extras:
        details = {}
        try:
            details = json.loads(call.outcome_details_json or "{}")
        except Exception:
            details = {}
        details.update(extras)
        call.outcome_details_json = json.dumps(details)

    # Update the linked Communication row.
    comm = db.query(Communication).filter(
        Communication.tenant_id == call.tenant_id,
        Communication.metadata_json.like(f'%"twilio_call_sid": "{twilio_call_sid}"%'),
    ).first()
    if comm:
        comm.status = new_status
        if new_status == "completed":
            comm.delivered_at = datetime.utcnow()
        db.commit()

    db.commit()
    return call


def to_response(c: CallQueue) -> dict:
    try:
        details = json.loads(c.outcome_details_json or "{}")
    except Exception:
        details = {}
    return {
        "id": c.id,
        "candidate_id": c.candidate_id,
        "app_id": c.app_id,
        "purpose": c.purpose,
        "status": c.status,
        "scheduled_for": c.scheduled_for.isoformat() if c.scheduled_for else None,
        "attempted_at": c.attempted_at.isoformat() if c.attempted_at else None,
        "completed_at": c.completed_at.isoformat() if c.completed_at else None,
        "to_phone": c.to_phone,
        "from_phone": c.from_phone,
        "twilio_call_sid": c.twilio_call_sid,
        "elevenlabs_conversation_id": c.elevenlabs_conversation_id,
        "script_prompt": c.script_prompt,
        "transcript": c.transcript,
        "outcome": c.outcome,
        "outcome_details": details,
        "retry_count": c.retry_count or 0,
        "last_error": c.last_error or "",
        "rescheduled_to_id": c.rescheduled_to_id,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }
