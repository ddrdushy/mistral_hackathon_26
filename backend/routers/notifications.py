"""Tenant notifications feed — surfaces recent pipeline-relevant events
in the topbar bell dropdown.

No new tables: pulled live from the existing `events` table (interview
opened, transcript received, link generated, etc.) plus a few derived
signals (WhatsApp inbound replies, talent-bank status changes via
audit_log). Last-read timestamp is client-side (localStorage) — keeps
the backend simple and the indicator dot is sufficient for v1.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_
from sqlalchemy.orm import Session

from auth.dependencies import current_session, CurrentSession
from database import get_db
from models import Application, Candidate, Event, Job, Communication

logger = logging.getLogger("hireops.notifications")

router = APIRouter(prefix="/api/v1/notifications", tags=["notifications"])


# Events worth surfacing in the bell. Anything not on this list is
# operationally interesting but not "HR needs to react" — those stay
# in the audit log.
SURFACED_EVENTS = {
    "interview_link_generated",
    "interview_link_emailed",
    "interview_started",
    "interview_completed",
    "webhook_transcript_received",
    "interview_reschedule_requested",
    "interview_auto_rescheduled",
    "candidate_matched",
    "candidate_shortlisted",
    "candidate_rejected",
    "rescored",
}


_EVENT_TEMPLATES: dict[str, str] = {
    "interview_link_generated":   "Interview link generated for {candidate}",
    "interview_link_emailed":     "Interview link emailed to {candidate}",
    "interview_started":          "{candidate} started their interview for {job}",
    "interview_completed":        "{candidate} completed their interview for {job}",
    "webhook_transcript_received":"Transcript ready for {candidate} ({job})",
    "interview_reschedule_requested": "{candidate} asked to reschedule their interview",
    "interview_auto_rescheduled": "Auto-rescheduled {candidate}'s interview",
    "candidate_matched":          "{candidate} matched to {job}",
    "candidate_shortlisted":      "{candidate} shortlisted for {job}",
    "candidate_rejected":         "{candidate} was rejected",
    "rescored":                   "Re-scored {candidate}'s resume",
}


def _render_event(ev: Event, cand_map: dict, job_map: dict) -> dict:
    cand_name = "a candidate"
    job_title = "a role"
    if ev.app_id:
        app_info = cand_map.get(ev.app_id)
        if app_info:
            cand_name = app_info[0] or cand_name
            job_title = app_info[1] or job_title
    template = _EVENT_TEMPLATES.get(ev.event_type, ev.event_type.replace("_", " ").capitalize())
    return {
        "id": f"event:{ev.id}",
        "kind": "event",
        "event_type": ev.event_type,
        "message": template.format(candidate=cand_name, job=job_title),
        "app_id": ev.app_id,
        "candidate_name": cand_name,
        "job_title": job_title,
        "href": f"/candidates/{ev.app_id}" if ev.app_id else None,
        "created_at": ev.created_at.isoformat() if ev.created_at else None,
    }


@router.get("")
async def list_notifications(
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Most-recent first, capped at `limit`. Excludes events older than
    14 days — past that they're history, not notifications."""
    cutoff = datetime.utcnow() - timedelta(days=14)
    tenant_id = session.tenant.id

    # Pull events first.
    events_q = (
        db.query(Event)
        .filter(
            Event.tenant_id == tenant_id,
            Event.created_at >= cutoff,
            Event.event_type.in_(SURFACED_EVENTS),
        )
        .order_by(Event.created_at.desc())
        .limit(limit * 2)
    )
    events = events_q.all()

    app_ids = {e.app_id for e in events if e.app_id}
    cand_map: dict[int, tuple[str, str]] = {}
    if app_ids:
        rows = (
            db.query(Application.id, Candidate.name, Job.title)
            .join(Candidate, Candidate.id == Application.candidate_id)
            .join(Job, Job.id == Application.job_id)
            .filter(Application.id.in_(app_ids))
            .all()
        )
        for app_id, cname, jtitle in rows:
            cand_map[app_id] = (cname, jtitle)

    out = [_render_event(e, cand_map, {}) for e in events]

    # Add inbound WhatsApp replies as their own notification type so HR
    # sees them surfaced even when no event row was logged.
    wa_msgs = (
        db.query(Communication)
        .filter(
            Communication.tenant_id == tenant_id,
            Communication.direction == "inbound",
            Communication.channel == "whatsapp",
            Communication.sent_at >= cutoff,
        )
        .order_by(Communication.sent_at.desc())
        .limit(20)
        .all()
    )
    cand_names: dict[int, str] = {}
    if wa_msgs:
        cand_ids = {m.candidate_id for m in wa_msgs if m.candidate_id}
        if cand_ids:
            for cid, name in db.query(Candidate.id, Candidate.name).filter(
                Candidate.id.in_(cand_ids)
            ).all():
                cand_names[cid] = name

    for m in wa_msgs:
        cname = cand_names.get(m.candidate_id, "Unknown candidate")
        body = (m.body or "").strip().replace("\n", " ")
        body = (body[:80] + "…") if len(body) > 80 else body
        out.append({
            "id": f"comm:{m.id}",
            "kind": "whatsapp_inbound",
            "event_type": "whatsapp_reply",
            "message": f"{cname} replied on WhatsApp: “{body}”",
            "app_id": m.app_id,
            "candidate_name": cname,
            "job_title": None,
            "href": f"/inbox" if not m.app_id else f"/candidates/{m.app_id}",
            "created_at": m.sent_at.isoformat() if m.sent_at else None,
        })

    # Sort merged set by created_at desc + trim.
    out.sort(key=lambda n: n["created_at"] or "", reverse=True)
    return {
        "notifications": out[:limit],
        "total_returned": min(len(out), limit),
        "as_of": datetime.utcnow().isoformat(),
    }
