"""Support tickets + product feedback.

Tenant-facing routes (`/api/v1/support/*` and `/api/v1/feedback`) let
recruiters file bugs / requests / feedback to the platform team.
Super-admin routes under `/api/v1/admin/support/*` and
`/api/v1/admin/feedback` triage them.

Privacy posture: the platform team can see WHAT tenants reported.
Tenants write the content themselves, so by design they choose what to
share. We do NOT join in candidate / application / CV data — admins
who need that context have to ask the tenant to attach it.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from auth.dependencies import (
    current_session, require_superadmin, CurrentSession,
)
from database import get_db
from models import SupportTicket, TenantFeedback, Tenant, User
from services.audit import write_audit

logger = logging.getLogger("hireops.support")

# Tenant-facing
router = APIRouter(prefix="/api/v1/support", tags=["support"])
feedback_router = APIRouter(prefix="/api/v1/feedback", tags=["support"])

# Super-admin
admin_router = APIRouter(prefix="/api/v1/admin", tags=["support-admin"])


VALID_CATEGORIES = {"bug", "feature_request", "billing", "other"}
VALID_PRIORITIES = {"low", "normal", "high", "urgent"}
VALID_STATUSES = {"open", "in_progress", "waiting_tenant", "resolved", "closed"}
VALID_FEEDBACK_CATEGORIES = {"praise", "suggestion", "bug", "other"}
VALID_RATING_SCALES = {"csat", "nps"}


# ─── Tenant: support tickets ────────────────────────────────────────────────


class TicketCreateRequest(BaseModel):
    subject: str = Field(min_length=3, max_length=200)
    description: str = Field(min_length=10, max_length=4000)
    category: str = Field(default="other")
    priority: str = Field(default="normal")


class TicketItem(BaseModel):
    id: int
    subject: str
    description: str
    category: str
    priority: str
    status: str
    admin_reply: str
    admin_replied_at: Optional[datetime]
    created_at: datetime
    updated_at: datetime
    created_by_email: Optional[str] = None


def _ticket_to_item(t: SupportTicket, created_by_email: Optional[str] = None) -> TicketItem:
    return TicketItem(
        id=t.id,
        subject=t.subject,
        description=t.description,
        category=t.category,
        priority=t.priority,
        status=t.status,
        admin_reply=t.admin_reply or "",
        admin_replied_at=t.admin_replied_at,
        created_at=t.created_at,
        updated_at=t.updated_at,
        created_by_email=created_by_email,
    )


@router.post("/tickets", status_code=201, response_model=TicketItem)
def create_ticket(
    req: TicketCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    if req.category not in VALID_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"category must be one of {sorted(VALID_CATEGORIES)}")
    if req.priority not in VALID_PRIORITIES:
        raise HTTPException(status_code=400, detail=f"priority must be one of {sorted(VALID_PRIORITIES)}")

    t = SupportTicket(
        tenant_id=session.tenant.id,
        created_by_user_id=session.user.id,
        subject=req.subject.strip(),
        description=req.description.strip(),
        category=req.category,
        priority=req.priority,
        status="open",
    )
    db.add(t)
    db.commit()
    db.refresh(t)

    write_audit(
        db, action="support.ticket.create", actor=session.user,
        tenant_id=session.tenant.id, resource_type="support_ticket",
        resource_id=t.id,
        payload={"subject": t.subject, "category": t.category, "priority": t.priority},
        severity="info", request=request,
    )
    return _ticket_to_item(t, created_by_email=session.user.email)


@router.get("/tickets")
def list_my_tickets(
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    q = db.query(SupportTicket).filter(SupportTicket.tenant_id == session.tenant.id)
    if status:
        if status not in VALID_STATUSES:
            raise HTTPException(status_code=400, detail="invalid status")
        q = q.filter(SupportTicket.status == status)
    rows = q.order_by(SupportTicket.created_at.desc()).all()

    # Hydrate creator email so the list page can show who filed it.
    user_ids = {r.created_by_user_id for r in rows}
    emails = {u.id: u.email for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}
    return {
        "tickets": [_ticket_to_item(t, emails.get(t.created_by_user_id)) for t in rows]
    }


@router.get("/tickets/{ticket_id}", response_model=TicketItem)
def get_my_ticket(
    ticket_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    t = db.query(SupportTicket).filter(
        SupportTicket.id == ticket_id,
        SupportTicket.tenant_id == session.tenant.id,
    ).first()
    if not t:
        raise HTTPException(status_code=404, detail="Ticket not found")
    creator = db.query(User).filter(User.id == t.created_by_user_id).first()
    return _ticket_to_item(t, creator.email if creator else None)


# ─── Tenant: feedback ───────────────────────────────────────────────────────


class FeedbackCreateRequest(BaseModel):
    message: str = Field(min_length=3, max_length=2000)
    rating: Optional[int] = None
    rating_scale: str = "csat"
    category: str = "suggestion"


@feedback_router.post("", status_code=201)
def submit_feedback(
    req: FeedbackCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    if req.category not in VALID_FEEDBACK_CATEGORIES:
        raise HTTPException(status_code=400, detail=f"category must be one of {sorted(VALID_FEEDBACK_CATEGORIES)}")
    if req.rating_scale not in VALID_RATING_SCALES:
        raise HTTPException(status_code=400, detail=f"rating_scale must be one of {sorted(VALID_RATING_SCALES)}")
    if req.rating is not None:
        if req.rating_scale == "csat" and not (1 <= req.rating <= 5):
            raise HTTPException(status_code=400, detail="csat rating must be 1–5")
        if req.rating_scale == "nps" and not (0 <= req.rating <= 10):
            raise HTTPException(status_code=400, detail="nps rating must be 0–10")

    fb = TenantFeedback(
        tenant_id=session.tenant.id,
        created_by_user_id=session.user.id,
        rating=req.rating,
        rating_scale=req.rating_scale,
        category=req.category,
        message=req.message.strip(),
    )
    db.add(fb)
    db.commit()
    db.refresh(fb)

    write_audit(
        db, action="feedback.submit", actor=session.user,
        tenant_id=session.tenant.id, resource_type="tenant_feedback",
        resource_id=fb.id,
        payload={"category": fb.category, "rating": fb.rating},
        severity="info", request=request,
    )
    return {
        "id": fb.id,
        "created_at": fb.created_at.isoformat(),
        "thanks": "Thanks — we read every piece of feedback.",
    }


# ─── Super-admin: triage ────────────────────────────────────────────────────


@admin_router.get("/support/tickets")
def admin_list_tickets(
    status: Optional[str] = None,
    priority: Optional[str] = None,
    tenant_id: Optional[int] = None,
    db: Session = Depends(get_db),
    _: CurrentSession = Depends(require_superadmin),
):
    q = db.query(SupportTicket)
    if status:
        q = q.filter(SupportTicket.status == status)
    if priority:
        q = q.filter(SupportTicket.priority == priority)
    if tenant_id:
        q = q.filter(SupportTicket.tenant_id == tenant_id)

    rows = q.order_by(SupportTicket.created_at.desc()).limit(500).all()
    tenant_ids = {r.tenant_id for r in rows}
    user_ids = {r.created_by_user_id for r in rows}
    tenants = {t.id: t for t in db.query(Tenant).filter(Tenant.id.in_(tenant_ids)).all()} if tenant_ids else {}
    users = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}

    out = []
    for r in rows:
        t = tenants.get(r.tenant_id)
        u = users.get(r.created_by_user_id)
        out.append({
            "id": r.id,
            "tenant_id": r.tenant_id,
            "tenant_name": t.name if t else None,
            "tenant_plan": t.plan if t else None,
            "created_by_email": u.email if u else None,
            "subject": r.subject,
            "description": r.description,
            "category": r.category,
            "priority": r.priority,
            "status": r.status,
            "admin_reply": r.admin_reply or "",
            "admin_replied_at": r.admin_replied_at.isoformat() if r.admin_replied_at else None,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "updated_at": r.updated_at.isoformat() if r.updated_at else None,
        })
    return {"tickets": out, "count": len(out)}


class TicketUpdateRequest(BaseModel):
    status: Optional[str] = None
    admin_reply: Optional[str] = Field(default=None, max_length=4000)


@admin_router.patch("/support/tickets/{ticket_id}")
def admin_update_ticket(
    ticket_id: int,
    req: TicketUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_superadmin),
):
    t = db.query(SupportTicket).filter(SupportTicket.id == ticket_id).first()
    if not t:
        raise HTTPException(status_code=404, detail="Ticket not found")

    changes = {}
    if req.status is not None:
        if req.status not in VALID_STATUSES:
            raise HTTPException(status_code=400, detail="invalid status")
        changes["status"] = (t.status, req.status)
        t.status = req.status
        if req.status in ("resolved", "closed") and not t.resolved_at:
            t.resolved_at = datetime.utcnow()
        elif req.status not in ("resolved", "closed"):
            t.resolved_at = None
    if req.admin_reply is not None:
        t.admin_reply = req.admin_reply.strip()
        t.admin_replied_at = datetime.utcnow()
        t.admin_replied_by_user_id = session.user.id
        changes["admin_reply_len"] = len(t.admin_reply)
    t.updated_at = datetime.utcnow()
    db.commit()

    write_audit(
        db, action="support.ticket.update", actor=session.user,
        target_tenant_id=t.tenant_id,
        resource_type="support_ticket", resource_id=t.id,
        payload={"changes": list(changes.keys())},
        severity="info", request=request,
    )
    return {"ok": True, "status": t.status}


@admin_router.get("/feedback")
def admin_list_feedback(
    category: Optional[str] = None,
    rating_scale: Optional[str] = None,
    db: Session = Depends(get_db),
    _: CurrentSession = Depends(require_superadmin),
):
    q = db.query(TenantFeedback)
    if category:
        q = q.filter(TenantFeedback.category == category)
    if rating_scale:
        q = q.filter(TenantFeedback.rating_scale == rating_scale)
    rows = q.order_by(TenantFeedback.created_at.desc()).limit(500).all()

    tenant_ids = {r.tenant_id for r in rows}
    user_ids = {r.created_by_user_id for r in rows}
    tenants = {t.id: t for t in db.query(Tenant).filter(Tenant.id.in_(tenant_ids)).all()} if tenant_ids else {}
    users = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()} if user_ids else {}

    out = []
    for r in rows:
        t = tenants.get(r.tenant_id)
        u = users.get(r.created_by_user_id)
        out.append({
            "id": r.id,
            "tenant_id": r.tenant_id,
            "tenant_name": t.name if t else None,
            "tenant_plan": t.plan if t else None,
            "created_by_email": u.email if u else None,
            "rating": r.rating,
            "rating_scale": r.rating_scale,
            "category": r.category,
            "message": r.message,
            "reviewed_at": r.reviewed_at.isoformat() if r.reviewed_at else None,
            "created_at": r.created_at.isoformat() if r.created_at else None,
        })
    # Aggregate stats inline so the admin UI can show 'avg CSAT' / NPS.
    csat_ratings = [r.rating for r in rows if r.rating_scale == "csat" and r.rating is not None]
    nps_ratings = [r.rating for r in rows if r.rating_scale == "nps" and r.rating is not None]
    stats = {
        "total": len(rows),
        "csat_count": len(csat_ratings),
        "csat_avg": round(sum(csat_ratings) / len(csat_ratings), 2) if csat_ratings else None,
        "nps_count": len(nps_ratings),
        "nps_avg": round(sum(nps_ratings) / len(nps_ratings), 2) if nps_ratings else None,
    }
    return {"feedback": out, "stats": stats}


class FeedbackReviewRequest(BaseModel):
    reviewed: bool = True


@admin_router.patch("/feedback/{feedback_id}")
def admin_review_feedback(
    feedback_id: int,
    req: FeedbackReviewRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_superadmin),
):
    r = db.query(TenantFeedback).filter(TenantFeedback.id == feedback_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Feedback not found")
    if req.reviewed:
        r.reviewed_at = datetime.utcnow()
        r.reviewed_by_user_id = session.user.id
    else:
        r.reviewed_at = None
        r.reviewed_by_user_id = None
    db.commit()
    return {"ok": True, "reviewed": bool(r.reviewed_at)}
