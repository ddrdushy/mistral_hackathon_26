"""Communications log — outbound (and future inbound) candidate touchpoints.

A single audit table backs every channel (email, WhatsApp, voice). Rows are
written by the manual send endpoints here AND by the auto-pipeline hooks
(Phase 3) so the candidate timeline shows every touchpoint in one place.
"""
import json
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from auth.dependencies import current_session, CurrentSession
from database import get_db
from models import Candidate, Communication, TenantIntegration
from services import twilio_service

logger = logging.getLogger("hireops.communications")

router = APIRouter(prefix="/api/v1/communications", tags=["communications"])


def _comm_to_response(c: Communication) -> dict:
    try:
        meta = json.loads(c.metadata_json or "{}")
    except Exception:
        meta = {}
    return {
        "id": c.id,
        "candidate_id": c.candidate_id,
        "app_id": c.app_id,
        "channel": c.channel,
        "direction": c.direction,
        "status": c.status,
        "to_address": c.to_address,
        "from_address": c.from_address,
        "subject": c.subject,
        "body": c.body,
        "error": c.error or "",
        "metadata": meta,
        "sent_by_user_id": c.sent_by_user_id,
        "sent_at": c.sent_at.isoformat() if c.sent_at else None,
        "delivered_at": c.delivered_at.isoformat() if c.delivered_at else None,
    }


class WhatsAppSendRequest(BaseModel):
    candidate_id: int
    body: str = Field(..., min_length=1, max_length=1600)


@router.post("/whatsapp")
def send_whatsapp(
    req: WhatsAppSendRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Send a one-off WhatsApp message to a candidate. Logs the attempt
    (success or failure) in communications so the timeline always reflects
    reality, even when the Twilio call blows up."""
    candidate = db.query(Candidate).filter(
        Candidate.id == req.candidate_id,
        Candidate.tenant_id == session.tenant.id,
    ).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    if not candidate.phone or not candidate.phone.strip():
        raise HTTPException(
            status_code=400,
            detail="Candidate has no phone number on file — add one before sending",
        )

    # Fail loudly when Twilio isn't configured — don't half-create a
    # 'pending' row that nothing will ever reconcile.
    try:
        cfg = twilio_service.load_config(db, session.tenant.id)
    except twilio_service.TwilioConfigError as e:
        raise HTTPException(status_code=400, detail=str(e))

    user_id = getattr(session, "user", None)
    user_id = user_id.id if user_id else None

    comm = Communication(
        tenant_id=session.tenant.id,
        candidate_id=candidate.id,
        channel="whatsapp",
        direction="outbound",
        status="pending",
        to_address=candidate.phone.strip(),
        from_address=cfg.whatsapp_from,
        body=req.body,
        sent_by_user_id=user_id,
        sent_at=datetime.utcnow(),
    )
    db.add(comm)
    db.commit()
    db.refresh(comm)

    try:
        result = twilio_service.send_whatsapp(cfg, candidate.phone, req.body)
        comm.status = result.get("status") or "sent"
        comm.metadata_json = json.dumps({
            "twilio_sid": result.get("sid"),
            "twilio_status": result.get("status"),
            "twilio_uri": result.get("uri"),
        })
        # Stamp the integration row for visibility in Settings.
        row = db.query(TenantIntegration).filter(
            TenantIntegration.tenant_id == session.tenant.id,
            TenantIntegration.provider == twilio_service.PROVIDER,
        ).first()
        if row:
            row.last_used_at = datetime.utcnow()
            row.last_error = ""
        db.commit()
        db.refresh(comm)
        return {"communication": _comm_to_response(comm)}
    except Exception as e:
        msg = str(e)[:1000]
        comm.status = "failed"
        comm.error = msg
        db.commit()
        db.refresh(comm)
        raise HTTPException(status_code=502, detail=msg)


@router.get("")
def list_communications(
    candidate_id: Optional[int] = None,
    channel: Optional[str] = None,
    limit: int = 100,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """List communications for the current tenant, newest first.

    Filter by candidate_id and/or channel. The candidate timeline merges
    these with events; this endpoint also drives a future Settings →
    Communications log page for tenant-wide audit.
    """
    q = db.query(Communication).filter(Communication.tenant_id == session.tenant.id)
    if candidate_id is not None:
        q = q.filter(Communication.candidate_id == candidate_id)
    if channel:
        q = q.filter(Communication.channel == channel)
    rows = q.order_by(Communication.sent_at.desc()).limit(min(limit, 500)).all()
    return {"communications": [_comm_to_response(r) for r in rows]}
