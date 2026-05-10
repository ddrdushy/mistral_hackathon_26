"""Sequenced outreach (Feature 6).

Routes:
  /api/v1/outreach/sequences[/{id}[/steps[/{step_id}]]]
  /api/v1/outreach/enrollments
  /api/v1/outreach/enrollments/{id}/{stop|pause|resume}
"""
from datetime import datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from auth.dependencies import current_session, CurrentSession
from database import get_db
from models import (
    Candidate, OutreachEnrollment, OutreachMessage, OutreachSequence, OutreachStep,
)
from services.audit import write_audit

router = APIRouter(prefix="/api/v1/outreach", tags=["outreach"])

VALID_CHANNELS = {"email", "sms", "whatsapp"}
MAX_STEPS = 12


# ─── Helpers ─────────────────────────────────────────────────────────────────


def _seq(db: Session, tenant_id: int, seq_id: int) -> OutreachSequence:
    seq = db.query(OutreachSequence).filter(
        OutreachSequence.id == seq_id,
        OutreachSequence.tenant_id == tenant_id,
    ).first()
    if not seq:
        raise HTTPException(status_code=404, detail="Sequence not found")
    return seq


def _step_to_response(s: OutreachStep) -> dict:
    return {
        "id": s.id,
        "sequence_id": s.sequence_id,
        "order_index": s.order_index,
        "channel": s.channel,
        "delay_hours": s.delay_hours,
        "template_subject": s.template_subject or "",
        "template_body": s.template_body or "",
    }


def _seq_to_response(seq: OutreachSequence, db: Session, with_steps: bool = False, with_stats: bool = False) -> dict:
    out = {
        "id": seq.id,
        "name": seq.name,
        "description": seq.description or "",
        "is_active": bool(seq.is_active),
        "stop_on_reply": bool(seq.stop_on_reply),
        "stop_on_meeting_booked": bool(seq.stop_on_meeting_booked),
        "created_at": seq.created_at.isoformat() if seq.created_at else None,
        "updated_at": seq.updated_at.isoformat() if seq.updated_at else None,
    }
    if with_steps:
        steps = db.query(OutreachStep).filter(
            OutreachStep.sequence_id == seq.id
        ).order_by(OutreachStep.order_index.asc()).all()
        out["steps"] = [_step_to_response(s) for s in steps]
    if with_stats:
        from sqlalchemy import func
        rows = (
            db.query(OutreachEnrollment.status, func.count(OutreachEnrollment.id))
            .filter(OutreachEnrollment.sequence_id == seq.id)
            .group_by(OutreachEnrollment.status)
            .all()
        )
        out["stats"] = {s: int(n) for s, n in rows}
    return out


def _enrollment_to_response(e: OutreachEnrollment, db: Session) -> dict:
    return {
        "id": e.id,
        "sequence_id": e.sequence_id,
        "candidate_id": e.candidate_id,
        "application_id": e.application_id,
        "status": e.status,
        "paused_reason": e.paused_reason or "",
        "current_step_index": e.current_step_index or 0,
        "started_at": e.started_at.isoformat() if e.started_at else None,
        "completed_at": e.completed_at.isoformat() if e.completed_at else None,
    }


# ─── Sequences CRUD ──────────────────────────────────────────────────────────


class SequenceCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    description: str = ""
    is_active: bool = True
    stop_on_reply: bool = True
    stop_on_meeting_booked: bool = True


class SequenceUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=128)
    description: Optional[str] = None
    is_active: Optional[bool] = None
    stop_on_reply: Optional[bool] = None
    stop_on_meeting_booked: Optional[bool] = None


@router.get("/sequences")
def list_sequences(
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    rows = db.query(OutreachSequence).filter(
        OutreachSequence.tenant_id == session.tenant.id,
    ).order_by(OutreachSequence.is_active.desc(), OutreachSequence.name.asc()).all()
    return {"sequences": [_seq_to_response(s, db, with_stats=True) for s in rows]}


@router.post("/sequences", status_code=201)
def create_sequence(
    req: SequenceCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    seq = OutreachSequence(
        tenant_id=session.tenant.id,
        name=req.name.strip(),
        description=(req.description or "").strip(),
        is_active=req.is_active,
        stop_on_reply=req.stop_on_reply,
        stop_on_meeting_booked=req.stop_on_meeting_booked,
        created_by_user_id=session.user.id,
    )
    db.add(seq)
    try:
        db.commit()
        db.refresh(seq)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Sequence name already exists")
    write_audit(
        db, action="outreach.sequence.create", actor=session.user,
        tenant_id=session.tenant.id, resource_type="outreach_sequence",
        resource_id=seq.id, payload={"name": seq.name}, request=request,
    )
    return _seq_to_response(seq, db, with_steps=True)


@router.get("/sequences/{seq_id}")
def get_sequence(
    seq_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    seq = _seq(db, session.tenant.id, seq_id)
    return _seq_to_response(seq, db, with_steps=True, with_stats=True)


@router.put("/sequences/{seq_id}")
def update_sequence(
    seq_id: int,
    req: SequenceUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    seq = _seq(db, session.tenant.id, seq_id)
    fields = req.model_dump(exclude_unset=True)
    for k, v in fields.items():
        if k == "name" and v is not None:
            v = v.strip()
        setattr(seq, k, v)
    try:
        db.commit()
        db.refresh(seq)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Sequence name already exists")
    write_audit(
        db, action="outreach.sequence.update", actor=session.user,
        tenant_id=session.tenant.id, resource_type="outreach_sequence",
        resource_id=seq.id, request=request,
    )
    return _seq_to_response(seq, db, with_steps=True)


@router.delete("/sequences/{seq_id}")
def delete_sequence(
    seq_id: int,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    seq = _seq(db, session.tenant.id, seq_id)
    name = seq.name
    # Active enrollments on this sequence — refuse to delete; HR should
    # stop them first (or cascade-stop here. We choose explicit.)
    active = db.query(OutreachEnrollment).filter(
        OutreachEnrollment.sequence_id == seq_id,
        OutreachEnrollment.status == "active",
    ).count()
    if active > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete: {active} active enrollment(s). Stop them first.",
        )
    db.delete(seq)
    db.commit()
    write_audit(
        db, action="outreach.sequence.delete", actor=session.user,
        tenant_id=session.tenant.id, resource_type="outreach_sequence",
        resource_id=seq_id, payload={"name": name}, severity="warning",
        request=request,
    )
    return {"deleted": True}


# ─── Steps CRUD ──────────────────────────────────────────────────────────────


class StepCreateRequest(BaseModel):
    channel: str = Field(..., pattern="^(email|sms|whatsapp)$")
    delay_hours: int = Field(default=0, ge=0, le=24 * 90)
    template_subject: str = Field(default="", max_length=255)
    template_body: str = Field(..., min_length=1, max_length=8000)


class StepUpdateRequest(BaseModel):
    channel: Optional[str] = Field(default=None, pattern="^(email|sms|whatsapp)$")
    delay_hours: Optional[int] = Field(default=None, ge=0, le=24 * 90)
    template_subject: Optional[str] = Field(default=None, max_length=255)
    template_body: Optional[str] = Field(default=None, min_length=1, max_length=8000)


@router.post("/sequences/{seq_id}/steps", status_code=201)
def create_step(
    seq_id: int,
    req: StepCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    seq = _seq(db, session.tenant.id, seq_id)
    existing = db.query(OutreachStep).filter(OutreachStep.sequence_id == seq.id).count()
    if existing >= MAX_STEPS:
        raise HTTPException(status_code=400, detail=f"Maximum {MAX_STEPS} steps per sequence")
    step = OutreachStep(
        sequence_id=seq.id,
        order_index=existing,
        channel=req.channel,
        delay_hours=req.delay_hours,
        template_subject=req.template_subject,
        template_body=req.template_body,
    )
    db.add(step)
    db.commit()
    db.refresh(step)
    write_audit(
        db, action="outreach.step.create", actor=session.user,
        tenant_id=session.tenant.id, resource_type="outreach_step",
        resource_id=step.id, payload={"sequence_id": seq.id, "channel": step.channel},
        request=request,
    )
    return _step_to_response(step)


@router.put("/sequences/{seq_id}/steps/{step_id}")
def update_step(
    seq_id: int,
    step_id: int,
    req: StepUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    _seq(db, session.tenant.id, seq_id)
    step = db.query(OutreachStep).filter(
        OutreachStep.id == step_id,
        OutreachStep.sequence_id == seq_id,
    ).first()
    if not step:
        raise HTTPException(status_code=404, detail="Step not found")
    for k, v in req.model_dump(exclude_unset=True).items():
        setattr(step, k, v)
    db.commit()
    db.refresh(step)
    return _step_to_response(step)


@router.delete("/sequences/{seq_id}/steps/{step_id}")
def delete_step(
    seq_id: int,
    step_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    _seq(db, session.tenant.id, seq_id)
    step = db.query(OutreachStep).filter(
        OutreachStep.id == step_id,
        OutreachStep.sequence_id == seq_id,
    ).first()
    if not step:
        raise HTTPException(status_code=404, detail="Step not found")
    db.delete(step)
    # Re-sequence the survivors so order_index stays contiguous.
    survivors = db.query(OutreachStep).filter(
        OutreachStep.sequence_id == seq_id,
    ).order_by(OutreachStep.order_index.asc()).all()
    for i, s in enumerate(survivors):
        s.order_index = i
    db.commit()
    return {"deleted": True}


class ReorderRequest(BaseModel):
    step_ids: List[int] = Field(..., min_length=1)


@router.post("/sequences/{seq_id}/steps/reorder")
def reorder_steps(
    seq_id: int,
    req: ReorderRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    _seq(db, session.tenant.id, seq_id)
    steps = db.query(OutreachStep).filter(OutreachStep.sequence_id == seq_id).all()
    by_id = {s.id: s for s in steps}
    valid = [sid for sid in req.step_ids if sid in by_id]
    if not valid:
        raise HTTPException(status_code=400, detail="No valid step ids")
    for i, sid in enumerate(valid):
        by_id[sid].order_index = i
    next_idx = len(valid)
    for s in steps:
        if s.id not in valid:
            s.order_index = next_idx
            next_idx += 1
    db.commit()
    return {"reordered": len(valid)}


# ─── Enrollments ─────────────────────────────────────────────────────────────


class EnrollRequest(BaseModel):
    sequence_id: int
    candidate_ids: List[int] = Field(..., min_length=1, max_length=500)
    application_id: Optional[int] = None  # optional context for merge tags


@router.post("/enrollments", status_code=201)
def create_enrollments(
    req: EnrollRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    seq = _seq(db, session.tenant.id, req.sequence_id)
    if not seq.is_active:
        raise HTTPException(status_code=400, detail="Sequence is not active")

    first_step = db.query(OutreachStep).filter(
        OutreachStep.sequence_id == seq.id,
    ).order_by(OutreachStep.order_index.asc()).first()
    if not first_step:
        raise HTTPException(status_code=400, detail="Sequence has no steps yet")

    valid_cand_ids = [
        c.id for c in db.query(Candidate.id).filter(
            Candidate.tenant_id == session.tenant.id,
            Candidate.id.in_(req.candidate_ids),
        ).all()
    ]
    if not valid_cand_ids:
        raise HTTPException(status_code=400, detail="No valid candidates for this tenant")

    # Avoid duplicate active enrollments on the same sequence
    already_active = {
        e.candidate_id for e in db.query(OutreachEnrollment).filter(
            OutreachEnrollment.tenant_id == session.tenant.id,
            OutreachEnrollment.sequence_id == seq.id,
            OutreachEnrollment.candidate_id.in_(valid_cand_ids),
            OutreachEnrollment.status == "active",
        ).all()
    }

    enrolled = 0
    skipped = []
    now = datetime.utcnow()
    for cid in valid_cand_ids:
        if cid in already_active:
            skipped.append(cid)
            continue
        e = OutreachEnrollment(
            tenant_id=session.tenant.id,
            sequence_id=seq.id,
            candidate_id=cid,
            application_id=req.application_id,
            current_step_index=first_step.order_index,
            status="active",
            enrolled_by_user_id=session.user.id,
            started_at=now,
        )
        db.add(e)
        db.flush()  # need e.id for the message FK
        # Schedule first message
        msg = OutreachMessage(
            tenant_id=session.tenant.id,
            enrollment_id=e.id,
            step_id=first_step.id,
            channel=first_step.channel,
            scheduled_for=now + timedelta(hours=int(first_step.delay_hours or 0)),
            delivery_status="scheduled",
        )
        db.add(msg)
        enrolled += 1
    db.commit()

    write_audit(
        db, action="outreach.enroll", actor=session.user,
        tenant_id=session.tenant.id, resource_type="outreach_sequence",
        resource_id=seq.id,
        payload={
            "enrolled": enrolled,
            "skipped_already_active": len(skipped),
            "candidate_count": len(valid_cand_ids),
        },
        request=request,
    )
    return {
        "enrolled": enrolled,
        "skipped_already_active": skipped,
    }


@router.get("/enrollments")
def list_enrollments(
    sequence_id: Optional[int] = None,
    candidate_id: Optional[int] = None,
    status: Optional[str] = None,
    limit: int = 100,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    q = db.query(OutreachEnrollment).filter(
        OutreachEnrollment.tenant_id == session.tenant.id
    )
    if sequence_id:
        q = q.filter(OutreachEnrollment.sequence_id == sequence_id)
    if candidate_id:
        q = q.filter(OutreachEnrollment.candidate_id == candidate_id)
    if status:
        q = q.filter(OutreachEnrollment.status == status)
    rows = q.order_by(OutreachEnrollment.started_at.desc()).limit(min(limit, 500)).all()

    # Hydrate candidate name + email + sequence name for the UI
    cand_ids = list({r.candidate_id for r in rows})
    seq_ids = list({r.sequence_id for r in rows})
    cand_map = {
        c.id: c for c in db.query(Candidate).filter(Candidate.id.in_(cand_ids)).all()
    } if cand_ids else {}
    seq_map = {
        s.id: s for s in db.query(OutreachSequence).filter(OutreachSequence.id.in_(seq_ids)).all()
    } if seq_ids else {}

    out = []
    for r in rows:
        item = _enrollment_to_response(r, db)
        c = cand_map.get(r.candidate_id)
        s = seq_map.get(r.sequence_id)
        item["candidate"] = (
            {"id": c.id, "name": c.name, "email": c.email} if c else None
        )
        item["sequence_name"] = s.name if s else ""
        out.append(item)
    return {"enrollments": out}


@router.post("/enrollments/{enrollment_id}/stop")
def stop_enrollment(
    enrollment_id: int,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    e = db.query(OutreachEnrollment).filter(
        OutreachEnrollment.id == enrollment_id,
        OutreachEnrollment.tenant_id == session.tenant.id,
    ).first()
    if not e:
        raise HTTPException(status_code=404, detail="Enrollment not found")
    if e.status not in ("active", "paused"):
        raise HTTPException(status_code=400, detail=f"Cannot stop a {e.status} enrollment")
    e.status = "stopped"
    e.paused_reason = "manual"
    e.completed_at = datetime.utcnow()
    db.query(OutreachMessage).filter(
        OutreachMessage.enrollment_id == e.id,
        OutreachMessage.sent_at.is_(None),
        OutreachMessage.delivery_status == "scheduled",
    ).update({"delivery_status": "skipped"})
    db.commit()
    write_audit(
        db, action="outreach.enrollment.stop", actor=session.user,
        tenant_id=session.tenant.id, resource_type="outreach_enrollment",
        resource_id=e.id, severity="warning", request=request,
    )
    return _enrollment_to_response(e, db)


@router.post("/enrollments/{enrollment_id}/pause")
def pause_enrollment(
    enrollment_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    e = db.query(OutreachEnrollment).filter(
        OutreachEnrollment.id == enrollment_id,
        OutreachEnrollment.tenant_id == session.tenant.id,
    ).first()
    if not e:
        raise HTTPException(status_code=404, detail="Enrollment not found")
    if e.status != "active":
        raise HTTPException(status_code=400, detail=f"Cannot pause a {e.status} enrollment")
    e.status = "paused"
    e.paused_reason = "manual"
    db.commit()
    return _enrollment_to_response(e, db)


@router.post("/enrollments/{enrollment_id}/resume")
def resume_enrollment(
    enrollment_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    e = db.query(OutreachEnrollment).filter(
        OutreachEnrollment.id == enrollment_id,
        OutreachEnrollment.tenant_id == session.tenant.id,
    ).first()
    if not e:
        raise HTTPException(status_code=404, detail="Enrollment not found")
    if e.status != "paused":
        raise HTTPException(status_code=400, detail=f"Cannot resume a {e.status} enrollment")
    e.status = "active"
    e.paused_reason = ""
    db.commit()
    return _enrollment_to_response(e, db)


@router.get("/enrollments/{enrollment_id}/messages")
def list_messages(
    enrollment_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    e = db.query(OutreachEnrollment).filter(
        OutreachEnrollment.id == enrollment_id,
        OutreachEnrollment.tenant_id == session.tenant.id,
    ).first()
    if not e:
        raise HTTPException(status_code=404, detail="Enrollment not found")
    rows = db.query(OutreachMessage).filter(
        OutreachMessage.enrollment_id == enrollment_id,
    ).order_by(OutreachMessage.scheduled_for.asc()).all()
    return {
        "messages": [
            {
                "id": m.id,
                "step_id": m.step_id,
                "channel": m.channel,
                "scheduled_for": m.scheduled_for.isoformat() if m.scheduled_for else None,
                "sent_at": m.sent_at.isoformat() if m.sent_at else None,
                "delivery_status": m.delivery_status,
                "external_message_id": m.external_message_id or "",
                "to_address": m.to_address or "",
                "rendered_subject": m.rendered_subject or "",
                "rendered_body": m.rendered_body or "",
                "error_message": m.error_message or "",
            }
            for m in rows
        ]
    }
