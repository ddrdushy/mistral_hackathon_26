"""Outbound voice call queue — schedule, list, cancel, reschedule.

Twilio webhooks land here too:
  GET  /calls/twiml/{call_id}   → TwiML the candidate hears (no auth; signed URL via Twilio)
  POST /calls/twilio/status     → Twilio status callbacks (initiated/ringing/.../completed)
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Form
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from auth.dependencies import current_session, CurrentSession
from database import get_db
from models import CallQueue, Candidate
from services import call_queue as call_queue_service

router = APIRouter(prefix="/api/v1/calls", tags=["calls"])


class EnqueueCallRequest(BaseModel):
    candidate_id: int
    purpose: str = Field(default="screening", description="screening | reschedule | reminder | availability_check | custom")
    scheduled_for: Optional[datetime] = Field(
        default=None,
        description="ISO datetime in UTC. Omit to dispatch ASAP (next worker tick).",
    )
    script_prompt: str = Field(default="", description="Free-form context for the AI agent (or HR notes)")
    app_id: Optional[int] = None


@router.post("")
def enqueue(
    req: EnqueueCallRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    candidate = db.query(Candidate).filter(
        Candidate.id == req.candidate_id,
        Candidate.tenant_id == session.tenant.id,
    ).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    if not candidate.phone or not candidate.phone.strip():
        raise HTTPException(
            status_code=400,
            detail="Candidate has no phone on file — add one before queuing a call",
        )

    user_id = getattr(session, "user", None)
    user_id = user_id.id if user_id else None
    try:
        row = call_queue_service.enqueue_call(
            db,
            tenant_id=session.tenant.id,
            candidate_id=candidate.id,
            to_phone=candidate.phone,
            purpose=req.purpose,
            scheduled_for=req.scheduled_for,
            script_prompt=req.script_prompt,
            app_id=req.app_id,
            created_by_user_id=user_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"call": call_queue_service.to_response(row)}


@router.get("")
def list_calls(
    candidate_id: Optional[int] = None,
    status: Optional[str] = None,
    purpose: Optional[str] = None,
    limit: int = 100,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    q = db.query(CallQueue).filter(CallQueue.tenant_id == session.tenant.id)
    if candidate_id is not None:
        q = q.filter(CallQueue.candidate_id == candidate_id)
    if status:
        # Comma-separated status filter so the UI can request "pending,in_progress" in one go.
        statuses = [s.strip() for s in status.split(",") if s.strip()]
        if statuses:
            q = q.filter(CallQueue.status.in_(statuses))
    if purpose:
        q = q.filter(CallQueue.purpose == purpose)
    rows = q.order_by(CallQueue.scheduled_for.desc()).limit(min(limit, 500)).all()

    # Hydrate with candidate name/email so the queue list page doesn't have
    # to do per-row lookups.
    cand_ids = list({r.candidate_id for r in rows if r.candidate_id})
    cand_map: dict[int, dict] = {}
    if cand_ids:
        for c in db.query(Candidate).filter(Candidate.id.in_(cand_ids)).all():
            cand_map[c.id] = {"id": c.id, "name": c.name, "email": c.email}

    out = []
    for r in rows:
        item = call_queue_service.to_response(r)
        item["candidate"] = cand_map.get(r.candidate_id)
        out.append(item)
    return {"calls": out}


@router.get("/summary")
def calls_summary(
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Tenant-wide counters for the Call Queue page header."""
    from sqlalchemy import func
    rows = db.query(CallQueue.status, func.count(CallQueue.id)).filter(
        CallQueue.tenant_id == session.tenant.id,
    ).group_by(CallQueue.status).all()
    counts = {s: n for s, n in rows}
    return {
        "pending": counts.get("pending", 0),
        "in_progress": counts.get("in_progress", 0),
        "completed": counts.get("completed", 0),
        "failed": counts.get("failed", 0),
        "cancelled": counts.get("cancelled", 0),
        "rescheduled": counts.get("rescheduled", 0),
        "total": sum(counts.values()),
    }


@router.post("/{call_id}/cancel")
def cancel(
    call_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    row = call_queue_service.cancel_call(db, session.tenant.id, call_id)
    if not row:
        raise HTTPException(status_code=404, detail="Call not found")
    return {"call": call_queue_service.to_response(row)}


class RescheduleRequest(BaseModel):
    new_time: datetime
    note: str = ""


@router.post("/{call_id}/reschedule")
def reschedule(
    call_id: int,
    req: RescheduleRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    try:
        new_row = call_queue_service.reschedule_call(
            db,
            tenant_id=session.tenant.id,
            call_id=call_id,
            new_time=req.new_time,
            note=req.note,
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    return {"call": call_queue_service.to_response(new_row)}


# ─── Public Twilio endpoints (no auth — signed by Twilio) ───────────────────


@router.api_route("/twiml/{call_id}", methods=["GET", "POST"])
def call_twiml(call_id: int, db: Session = Depends(get_db)):
    """TwiML returned to Twilio when it dials the candidate.

    Phase 3a: a simple <Say> greeting + record + hang up so we have an
    end-to-end working call. Phase 3b swaps the body for <Connect><Stream>
    pointing at an ElevenLabs Conversational AI agent.
    """
    call = db.query(CallQueue).filter(CallQueue.id == call_id).first()
    if not call:
        twiml = (
            '<?xml version="1.0" encoding="UTF-8"?>'
            "<Response><Say>Sorry, this call is no longer scheduled.</Say><Hangup/></Response>"
        )
        return Response(content=twiml, media_type="application/xml")

    candidate = db.query(Candidate).filter(Candidate.id == call.candidate_id).first()
    name = (candidate.name.split()[0] if candidate and candidate.name else "there")
    purpose = call.purpose or "screening"

    if purpose == "availability_check":
        msg = (
            f"Hi {name}, this is HireOps calling about a role we think you'd be a fit for. "
            "Are you currently open to new opportunities? Please reply by phone or email and "
            "we'll follow up with details. Thank you."
        )
    elif purpose == "reminder":
        msg = (
            f"Hi {name}, this is a quick reminder of your upcoming interview. "
            "Please make sure you have a quiet space and a working microphone ready. "
            "If you need to reschedule, reply to our email. Thank you."
        )
    elif purpose == "reschedule":
        msg = (
            f"Hi {name}, this is HireOps following up on your interview reschedule. "
            "We'll send the new details by email shortly. Thank you."
        )
    else:
        msg = (
            f"Hi {name}, this is HireOps calling about your job application. "
            "We'd like to schedule a short screening interview. "
            "Please check your email for the interview link, or reply to confirm. Thank you."
        )

    twiml = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        "<Response>"
        f"<Say voice=\"Polly.Joanna\">{msg}</Say>"
        "<Pause length=\"1\"/>"
        "<Hangup/>"
        "</Response>"
    )
    return Response(content=twiml, media_type="application/xml")


@router.post("/twilio/status")
async def twilio_status_webhook(request: Request, db: Session = Depends(get_db)):
    """Twilio fires this on initiated/ringing/answered/completed/failed.

    Twilio posts as application/x-www-form-urlencoded. We parse loosely so
    extra fields don't break us.
    """
    form = await request.form()
    sid = form.get("CallSid", "")
    status = form.get("CallStatus", "")
    if not sid:
        return {"ok": False, "error": "missing CallSid"}
    extras = {
        "twilio_status": status,
        "duration": form.get("CallDuration", ""),
        "answered_by": form.get("AnsweredBy", ""),
        "to": form.get("To", ""),
        "from": form.get("From", ""),
    }
    call = call_queue_service.apply_twilio_status(db, sid, status, extras=extras)
    return {"ok": True, "call_id": call.id if call else None}
