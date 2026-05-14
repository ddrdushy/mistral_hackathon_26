"""Tenant notifications feed — surfaces recent pipeline-relevant events
in the topbar bell dropdown.

No new tables: pulled live from the existing `events` table (interview
opened, transcript received, link generated, etc.) plus a few derived
signals (WhatsApp inbound replies, talent-bank status changes via
audit_log). Last-read timestamp is client-side (localStorage) — keeps
the backend simple and the indicator dot is sufficient for v1.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import or_
from sqlalchemy.orm import Session

from auth.dependencies import current_session, CurrentSession
from database import SessionLocal, get_db
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


# ─── Server-sent events stream ──────────────────────────────────────────────


async def _notification_stream_generator(tenant_id: int, request: Request):
    """Async generator yielding SSE-formatted events for one tenant.

    Strategy: poll the Event + Communication tables every 4 seconds for
    rows newer than the last id we sent. Send each new row as a separate
    SSE `data:` event. Send a keepalive comment every 20s to defeat
    intermediate proxy timeouts (nginx default is 60s; 20s leaves
    headroom for a missed poll).

    Stops cleanly when the client disconnects (FastAPI's
    `request.is_disconnected()` flips after the EventSource closes).

    We use a fresh DB session per loop iteration so we don't hold a
    long-lived transaction open. Each query is cheap (small index on
    (tenant_id, id)).
    """
    # Anchor on the most recent ids at connection time so we don't
    # replay the full 14-day history; the catch-up list is loaded once
    # by the client via /notifications and SSE only delivers deltas.
    db = SessionLocal()
    try:
        last_event_id = (
            db.query(Event.id)
            .filter(Event.tenant_id == tenant_id)
            .order_by(Event.id.desc())
            .limit(1)
            .scalar()
        ) or 0
        last_comm_id = (
            db.query(Communication.id)
            .filter(
                Communication.tenant_id == tenant_id,
                Communication.direction == "inbound",
                Communication.channel == "whatsapp",
            )
            .order_by(Communication.id.desc())
            .limit(1)
            .scalar()
        ) or 0
    finally:
        db.close()

    # Tell the client we're alive and what the cursor is.
    yield (
        f"event: hello\n"
        f"data: {json.dumps({'last_event_id': last_event_id, 'last_comm_id': last_comm_id})}\n\n"
    )

    last_keepalive = datetime.utcnow()
    POLL_INTERVAL_S = 4
    KEEPALIVE_INTERVAL_S = 20

    while True:
        if await request.is_disconnected():
            return

        # Poll for new rows.
        db = SessionLocal()
        try:
            new_events = (
                db.query(Event)
                .filter(
                    Event.tenant_id == tenant_id,
                    Event.id > last_event_id,
                    Event.event_type.in_(SURFACED_EVENTS),
                )
                .order_by(Event.id.asc())
                .limit(20)
                .all()
            )
            # Resolve candidate + job names for these events in one batch.
            app_ids = {e.app_id for e in new_events if e.app_id}
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

            for ev in new_events:
                payload = _render_event(ev, cand_map, {})
                yield f"event: notification\ndata: {json.dumps(payload)}\n\n"
                last_event_id = ev.id

            new_comms = (
                db.query(Communication)
                .filter(
                    Communication.tenant_id == tenant_id,
                    Communication.id > last_comm_id,
                    Communication.direction == "inbound",
                    Communication.channel == "whatsapp",
                )
                .order_by(Communication.id.asc())
                .limit(20)
                .all()
            )
            cand_names: dict[int, str] = {}
            if new_comms:
                cand_ids = {m.candidate_id for m in new_comms if m.candidate_id}
                if cand_ids:
                    for cid, name in db.query(Candidate.id, Candidate.name).filter(
                        Candidate.id.in_(cand_ids)
                    ).all():
                        cand_names[cid] = name

            for m in new_comms:
                cname = cand_names.get(m.candidate_id, "Unknown candidate")
                body = (m.body or "").strip().replace("\n", " ")
                body = (body[:80] + "…") if len(body) > 80 else body
                payload = {
                    "id": f"comm:{m.id}",
                    "kind": "whatsapp_inbound",
                    "event_type": "whatsapp_reply",
                    "message": f"{cname} replied on WhatsApp: “{body}”",
                    "app_id": m.app_id,
                    "candidate_name": cname,
                    "job_title": None,
                    "href": "/inbox" if not m.app_id else f"/candidates/{m.app_id}",
                    "created_at": m.sent_at.isoformat() if m.sent_at else None,
                }
                yield f"event: notification\ndata: {json.dumps(payload)}\n\n"
                last_comm_id = m.id
        except Exception as e:
            logger.warning("SSE poll failed for tenant %s: %s", tenant_id, e)
        finally:
            db.close()

        # Keepalive comment every 20s — anything starting with `:` is
        # a comment per the SSE spec, ignored by EventSource but keeps
        # nginx + browser from killing the idle connection.
        now = datetime.utcnow()
        if (now - last_keepalive).total_seconds() >= KEEPALIVE_INTERVAL_S:
            yield ": keepalive\n\n"
            last_keepalive = now

        await asyncio.sleep(POLL_INTERVAL_S)


@router.get("/stream")
async def stream_notifications(
    request: Request,
    session: CurrentSession = Depends(current_session),
):
    """Server-Sent Events stream of live notifications for this tenant.

    Replaces the 60s polling loop in the bell icon. Client opens an
    EventSource against this URL; we keep the connection open and push
    each new event / WhatsApp reply within ~4 seconds of it landing.

    Auth: session cookie via the standard current_session dependency.
    Per-tenant scoped — the generator only ever queries rows tagged
    with session.tenant.id.
    """
    return StreamingResponse(
        _notification_stream_generator(session.tenant.id, request),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",  # disable nginx buffering of the stream
            "Connection": "keep-alive",
        },
    )
