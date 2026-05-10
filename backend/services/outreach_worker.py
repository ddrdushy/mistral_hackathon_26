"""Sequenced outreach worker — Feature 6.

Single asyncio task started at app boot. Polls every 60s for due messages,
dispatches them via the right channel adapter (email / WhatsApp / SMS),
logs a Communication row so the candidate timeline reflects every send,
and schedules the next step.

Dispatch errors:
- Per-message failure marks the message as failed and continues — the
  enrollment is not stopped automatically; HR can review and resume.
- Twilio config missing for a tenant → message marked failed with a
  clear error_message.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from database import SessionLocal
from models import (
    Candidate, Communication, Job, OutreachEnrollment, OutreachMessage,
    OutreachSequence, OutreachStep, Tenant, User,
)

logger = logging.getLogger("hireops.outreach_worker")

POLL_INTERVAL_SECONDS = 60
BATCH_SIZE = 50

_worker_task: Optional[asyncio.Task] = None


# ─── Template rendering ──────────────────────────────────────────────────────


def render_template(
    template: str,
    *,
    candidate: Optional[Candidate] = None,
    job: Optional[Job] = None,
    recruiter: Optional[User] = None,
    tenant: Optional[Tenant] = None,
) -> str:
    """Substitute {{candidate.first_name}}-style merge tags. Missing
    values render as {{?path?}} so HR catches typos in the editor."""
    if not template:
        return ""
    import re

    def replace(m: "re.Match[str]") -> str:
        path = m.group(1).strip()
        val = _resolve(path, candidate=candidate, job=job, recruiter=recruiter, tenant=tenant)
        if val is None or val == "":
            return f"{{{{?{path}?}}}}"
        return str(val)

    return re.sub(r"{{\s*([\w.]+)\s*}}", replace, template)


def _resolve(path: str, **ctx) -> Optional[str]:
    parts = path.split(".")
    if not parts:
        return None
    obj_name = parts[0]
    obj = ctx.get(obj_name)
    if obj is None:
        return None
    cur = obj
    for attr in parts[1:]:
        # Support {{candidate.first_name}} via a synthetic first_name accessor
        if obj_name == "candidate" and attr == "first_name":
            full = getattr(obj, "name", "") or ""
            return full.split()[0] if full else ""
        if obj_name == "candidate" and attr == "last_name":
            full = getattr(obj, "name", "") or ""
            parts = full.split()
            return " ".join(parts[1:]) if len(parts) > 1 else ""
        cur = getattr(cur, attr, None)
        if cur is None:
            return None
    return cur if cur is None else str(cur)


# ─── Dispatch ────────────────────────────────────────────────────────────────


def _dispatch_message(db: Session, msg: OutreachMessage) -> None:
    enrollment = db.query(OutreachEnrollment).filter(
        OutreachEnrollment.id == msg.enrollment_id
    ).first()
    if not enrollment:
        msg.delivery_status = "failed"
        msg.error_message = "Enrollment missing"
        db.commit()
        return

    if enrollment.status != "active":
        msg.delivery_status = "skipped"
        db.commit()
        return

    step = db.query(OutreachStep).filter(OutreachStep.id == msg.step_id).first()
    candidate = db.query(Candidate).filter(Candidate.id == enrollment.candidate_id).first()
    if not step or not candidate:
        msg.delivery_status = "failed"
        msg.error_message = "Step or candidate missing"
        db.commit()
        return

    # Resolve job + recruiter for merge tags. Both optional.
    job = None
    if enrollment.application_id:
        from models import Application
        app = db.query(Application).filter(Application.id == enrollment.application_id).first()
        if app and app.job_id:
            job = db.query(Job).filter(Job.id == app.job_id).first()
    recruiter = None
    if enrollment.enrolled_by_user_id:
        recruiter = db.query(User).filter(User.id == enrollment.enrolled_by_user_id).first()
    tenant = db.query(Tenant).filter(Tenant.id == enrollment.tenant_id).first()

    rendered_subject = render_template(
        step.template_subject or "",
        candidate=candidate, job=job, recruiter=recruiter, tenant=tenant,
    )
    rendered_body = render_template(
        step.template_body or "",
        candidate=candidate, job=job, recruiter=recruiter, tenant=tenant,
    )

    # Determine destination + dispatch
    to_address = ""
    external_id = ""
    success = False
    err_msg = ""
    try:
        if msg.channel == "email":
            to_address = candidate.email or ""
            if not to_address:
                raise RuntimeError("Candidate has no email on file")
            from services.smtp_service import send_email
            result = send_email(to_address, rendered_subject, rendered_body, rendered_body)
            if not result.get("success"):
                raise RuntimeError(result.get("message") or "Email send failed")
            external_id = (result.get("message_id") or "")
            success = True

        elif msg.channel in ("whatsapp", "sms"):
            to_address = (candidate.phone or "").strip()
            if not to_address:
                raise RuntimeError("Candidate has no phone on file")
            from services import twilio_service
            cfg = twilio_service.load_config(db, enrollment.tenant_id)
            if msg.channel == "whatsapp":
                resp = twilio_service.send_whatsapp(cfg, to_address, rendered_body)
            else:
                resp = twilio_service.send_sms(cfg, to_address, rendered_body)
            external_id = resp.get("sid", "")
            success = True
        else:
            raise RuntimeError(f"Unknown channel: {msg.channel}")

    except Exception as e:
        err_msg = str(e)[:1000]
        logger.warning("Outreach dispatch failed for msg %s: %s", msg.id, err_msg)

    msg.to_address = to_address
    msg.rendered_subject = rendered_subject
    msg.rendered_body = rendered_body
    if success:
        msg.sent_at = datetime.utcnow()
        msg.delivery_status = "sent"
        msg.external_message_id = external_id
    else:
        msg.delivery_status = "failed"
        msg.error_message = err_msg
    db.commit()

    # Communication audit row regardless of success — the timeline
    # should show that we tried.
    try:
        comm = Communication(
            tenant_id=enrollment.tenant_id,
            candidate_id=candidate.id,
            app_id=enrollment.application_id,
            channel=msg.channel,
            direction="outbound",
            status="sent" if success else "failed",
            to_address=to_address,
            from_address="",
            subject=rendered_subject if msg.channel == "email" else "",
            body=rendered_body,
            metadata_json=json.dumps({
                "outreach_enrollment_id": enrollment.id,
                "outreach_step_id": step.id,
                "external_id": external_id,
            }),
            error=err_msg,
            sent_by_user_id=enrollment.enrolled_by_user_id,
            sent_at=datetime.utcnow(),
        )
        db.add(comm)
        db.commit()
    except Exception as e:
        logger.warning("Communication log write failed for outreach msg %s: %s", msg.id, e)
        db.rollback()

    # Schedule next step (only if dispatch succeeded — failures don't
    # block the chain forever, but they don't auto-advance either)
    if success:
        _advance_to_next_step(db, enrollment)


def _advance_to_next_step(db: Session, enrollment: OutreachEnrollment) -> None:
    next_step = db.query(OutreachStep).filter(
        OutreachStep.sequence_id == enrollment.sequence_id,
        OutreachStep.order_index > enrollment.current_step_index,
    ).order_by(OutreachStep.order_index.asc()).first()

    if next_step:
        enrollment.current_step_index = next_step.order_index
        msg = OutreachMessage(
            tenant_id=enrollment.tenant_id,
            enrollment_id=enrollment.id,
            step_id=next_step.id,
            channel=next_step.channel,
            scheduled_for=datetime.utcnow() + timedelta(hours=int(next_step.delay_hours or 0)),
            delivery_status="scheduled",
        )
        db.add(msg)
    else:
        enrollment.status = "completed"
        enrollment.completed_at = datetime.utcnow()
    db.commit()


# ─── Worker loop ─────────────────────────────────────────────────────────────


async def _tick() -> int:
    db = SessionLocal()
    try:
        now = datetime.utcnow()
        due = (
            db.query(OutreachMessage)
            .filter(
                OutreachMessage.scheduled_for <= now,
                OutreachMessage.sent_at.is_(None),
                OutreachMessage.delivery_status == "scheduled",
            )
            .order_by(OutreachMessage.scheduled_for.asc())
            .limit(BATCH_SIZE)
            .all()
        )
        for msg in due:
            try:
                _dispatch_message(db, msg)
            except Exception as e:
                logger.exception("dispatch error for msg %s: %s", msg.id, e)
                msg.delivery_status = "failed"
                msg.error_message = str(e)[:1000]
                db.commit()
        return len(due)
    finally:
        db.close()


async def _worker_loop() -> None:
    logger.info("outreach_worker started (poll every %ss)", POLL_INTERVAL_SECONDS)
    while True:
        try:
            await _tick()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.exception("outreach_worker tick failed: %s", e)
        await asyncio.sleep(POLL_INTERVAL_SECONDS)


async def start_worker() -> None:
    global _worker_task
    if _worker_task and not _worker_task.done():
        return
    loop = asyncio.get_running_loop()
    _worker_task = loop.create_task(_worker_loop(), name="outreach_worker")


async def stop_worker() -> None:
    global _worker_task
    if _worker_task and not _worker_task.done():
        _worker_task.cancel()
        try:
            await _worker_task
        except asyncio.CancelledError:
            pass
    _worker_task = None


# ─── Reply detection (called from mailbox_listener) ─────────────────────────


def stop_enrollments_on_reply(db: Session, tenant_id: int, from_email: str) -> int:
    """When an inbound email arrives, stop active enrollments for the
    candidate matching that from-address — IF the sequence has
    stop_on_reply=True. Cancels any still-scheduled messages.

    Returns the number of enrollments stopped.
    """
    if not from_email:
        return 0
    sender = from_email.strip().lower()
    if not sender:
        return 0

    candidates = (
        db.query(Candidate)
        .filter(
            Candidate.tenant_id == tenant_id,
            Candidate.email.ilike(sender),
        )
        .all()
    )
    if not candidates:
        return 0
    cand_ids = [c.id for c in candidates]

    enrollments = (
        db.query(OutreachEnrollment)
        .filter(
            OutreachEnrollment.tenant_id == tenant_id,
            OutreachEnrollment.candidate_id.in_(cand_ids),
            OutreachEnrollment.status == "active",
        )
        .all()
    )
    if not enrollments:
        return 0

    seq_ids = {e.sequence_id for e in enrollments}
    seqs_by_id = {
        s.id: s for s in db.query(OutreachSequence).filter(OutreachSequence.id.in_(seq_ids)).all()
    }

    stopped = 0
    for e in enrollments:
        seq = seqs_by_id.get(e.sequence_id)
        if not seq or not seq.stop_on_reply:
            continue
        e.status = "stopped"
        e.paused_reason = "replied"
        e.completed_at = datetime.utcnow()
        # Cancel any still-scheduled messages for this enrollment
        db.query(OutreachMessage).filter(
            OutreachMessage.enrollment_id == e.id,
            OutreachMessage.sent_at.is_(None),
            OutreachMessage.delivery_status == "scheduled",
        ).update({"delivery_status": "skipped"})
        stopped += 1

    if stopped:
        db.commit()
        logger.info(
            "Outreach: stopped %s enrollment(s) for tenant=%s sender=%s",
            stopped, tenant_id, sender,
        )
    return stopped
