"""Twilio WhatsApp inbound webhook.

Twilio fires this URL (configured once at the platform level — the same
URL works for every tenant) every time a candidate replies to one of our
outbound WhatsApp messages. We:

  1. Resolve the tenant from the `To` field (the tenant's WhatsApp sender
     number, stored on the Twilio TenantIntegration row).
  2. Match the inbound `From` to an existing Candidate in that tenant.
  3. Log the message to communications (direction=inbound).
  4. Classify intent (confirm / decline / joined-another / unclear).
  5. If confirm: generate a fresh interview link and reply with it.
  6. If decline-joined: mark the candidate as joined_another in the
     talent bank so they stop appearing in match results.
  7. Send a contextual TwiML auto-reply that closes the loop without
     blocking the recruiter.
"""
from __future__ import annotations

import json
import logging
import os
import uuid
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from database import get_db
from models import (
    Application,
    Candidate,
    Communication,
    InterviewLink,
    Job,
    Tenant,
    TenantIntegration,
)
from services.whatsapp_intent import classify

logger = logging.getLogger("hireops.whatsapp_webhook")

router = APIRouter(prefix="/api/v1/webhook/twilio", tags=["webhooks"])


# ── Helpers ──────────────────────────────────────────────────────────────────


def _normalise_phone(addr: str) -> str:
    """Strip whatsapp: prefix + whitespace; leave the rest (e.g. +60…) alone."""
    a = (addr or "").strip()
    if a.startswith("whatsapp:"):
        a = a[len("whatsapp:"):]
    return a.strip()


def _resolve_tenant(db: Session, to_addr: str) -> Tenant | None:
    """Find the tenant whose Twilio integration uses this `To` number.

    The Twilio webhook posts `To` as e.g. `whatsapp:+14155238886`. That
    same number is stored in the tenant's TenantIntegration config under
    `whatsapp_from`. Compare normalised.
    """
    target = _normalise_phone(to_addr)
    if not target:
        return None
    rows = (
        db.query(TenantIntegration)
        .filter(TenantIntegration.provider == "twilio", TenantIntegration.enabled.is_(True))
        .all()
    )
    for r in rows:
        try:
            cfg = json.loads(r.config_json or "{}")
        except Exception:
            continue
        configured = _normalise_phone(cfg.get("whatsapp_from") or "")
        if configured and configured == target:
            return db.query(Tenant).filter(Tenant.id == r.tenant_id).first()
    return None


def _find_candidate(db: Session, tenant_id: int, from_addr: str) -> Candidate | None:
    phone = _normalise_phone(from_addr)
    if not phone:
        return None
    # Match exact phone first, then a loose `endswith` fallback (handles
    # candidates saved without the country code prefix).
    cand = (
        db.query(Candidate)
        .filter(Candidate.tenant_id == tenant_id, Candidate.phone == phone)
        .first()
    )
    if cand:
        return cand
    last_digits = phone.lstrip("+")[-9:]
    if last_digits:
        return (
            db.query(Candidate)
            .filter(
                Candidate.tenant_id == tenant_id,
                Candidate.phone.like(f"%{last_digits}"),
            )
            .first()
        )
    return None


def _latest_open_app(db: Session, candidate: Candidate) -> Application | None:
    """The most recent application for this candidate that's still in the
    pipeline. Used to figure out which job the inbound reply is about."""
    return (
        db.query(Application)
        .filter(
            Application.tenant_id == candidate.tenant_id,
            Application.candidate_id == candidate.id,
            Application.stage.notin_(["rejected", "hired"]),
        )
        .order_by(Application.updated_at.desc())
        .first()
    )


def _twiml(message: str = "") -> Response:
    """Return a TwiML response — empty body means no auto-reply, a
    non-empty body sends `message` back to the candidate on the same
    WhatsApp thread."""
    if message:
        # Twilio expects XML; escape the message body minimally.
        safe = (message
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;"))
        body = f"<Response><Message>{safe}</Message></Response>"
    else:
        body = "<Response/>"
    return Response(content=body, media_type="application/xml")


def _generate_link_for(app: Application, db: Session, hours: int = 72) -> tuple[str, str]:
    """Expire prior active links, create a fresh one, return (token, url)."""
    db.query(InterviewLink).filter(
        InterviewLink.app_id == app.id,
        InterviewLink.status.in_(["generated", "sent", "opened", "send_failed"]),
    ).update({"status": "expired"}, synchronize_session="fetch")

    token = uuid.uuid4().hex
    link = InterviewLink(
        tenant_id=app.tenant_id,
        token=token,
        app_id=app.id,
        status="generated",
        expires_at=datetime.utcnow() + timedelta(hours=hours),
    )
    db.add(link)
    db.flush()
    base = os.getenv("FRONTEND_URL", "").rstrip("/")
    return token, f"{base}/interview/{token}"


# ── Endpoint ─────────────────────────────────────────────────────────────────


@router.post("/whatsapp")
async def twilio_whatsapp_inbound(
    request: Request,
    db: Session = Depends(get_db),
):
    """Twilio posts here as application/x-www-form-urlencoded for every
    incoming WhatsApp message. We ALWAYS return TwiML (even on failure)
    so Twilio doesn't disable the webhook over retries."""
    form = await request.form()
    from_addr = str(form.get("From", "") or "")
    to_addr = str(form.get("To", "") or "")
    body_text = str(form.get("Body", "") or "")
    message_sid = str(form.get("MessageSid", "") or "")

    if not from_addr or not to_addr:
        logger.warning("twilio inbound missing From/To: %s", dict(form))
        return _twiml()

    tenant = _resolve_tenant(db, to_addr)
    if not tenant:
        logger.warning("twilio inbound: no tenant matches To=%s", to_addr)
        return _twiml()

    candidate = _find_candidate(db, tenant.id, from_addr)

    # Always log the message — even if we can't match a candidate, HR
    # will want to see it in the inbox to investigate.
    try:
        db.add(Communication(
            tenant_id=tenant.id,
            candidate_id=candidate.id if candidate else None,
            app_id=None,
            channel="whatsapp",
            direction="inbound",
            status="received",
            to_address=_normalise_phone(to_addr),
            from_address=_normalise_phone(from_addr),
            subject="WhatsApp reply",
            body=body_text,
            metadata_json=json.dumps({"twilio_sid": message_sid}),
            sent_at=datetime.utcnow(),
            delivered_at=datetime.utcnow(),
        ))
        db.commit()
    except Exception as e:
        db.rollback()
        logger.warning("inbound communication log failed: %s", e)

    if not candidate:
        # Unknown sender — log and acknowledge so Twilio is happy.
        return _twiml(
            "Thanks — we couldn't match this number to a candidate in our "
            "system. A recruiter will review your message shortly."
        )

    result = classify(body_text)
    logger.info(
        "whatsapp inbound tenant=%s candidate=%s intent=%s phrase=%r",
        tenant.id, candidate.id, result.intent, result.matched_phrase,
    )

    # ── Confirm → auto-send interview link ──────────────────────────────────
    if result.intent == "confirm":
        app = _latest_open_app(db, candidate)
        if not app:
            # Candidate confirmed but we have no open app for them. Could
            # happen if HR pinged via the talent-bank reach-out flow which
            # doesn't create an application. Reply asking for context and
            # let HR follow up.
            return _twiml(
                "Thanks for confirming! A recruiter will follow up shortly "
                "with interview details."
            )

        job = db.query(Job).filter(Job.id == app.job_id).first()
        try:
            token, interview_url = _generate_link_for(app, db)
            app.interview_link_status = "sent"
            app.stage = "interview_link_sent"
            app.screening_status = "link_generated"
            app.ai_next_action = "Candidate confirmed availability via WhatsApp — link auto-sent"
            app.updated_at = datetime.utcnow()
            # Mark the just-created link as sent (we're delivering the URL
            # in the TwiML reply, which counts as sent over WhatsApp).
            db.query(InterviewLink).filter(InterviewLink.token == token).update(
                {"status": "sent"}, synchronize_session=False,
            )
            db.commit()
        except Exception as e:
            logger.exception("auto-link generation failed: %s", e)
            db.rollback()
            return _twiml(
                "Thanks for confirming. A recruiter will send you the "
                "interview link shortly."
            )

        title = (job.title if job else "the role")
        return _twiml(
            f"Great — thanks for confirming! Here is your interview link "
            f"for {title}:\n\n{interview_url}\n\n"
            f"It's valid for 72 hours. The interview takes 8–10 minutes; "
            f"please join in a quiet space with mic and camera available."
        )

    # ── Joined another company → update talent bank ──────────────────────────
    if result.intent == "decline_joined_another":
        candidate.talent_bank_status = "joined_another"
        candidate.talent_bank_status_reason = body_text[:240]
        candidate.talent_bank_status_updated_at = datetime.utcnow()
        candidate.updated_at = datetime.utcnow()
        db.commit()
        return _twiml(
            "Thanks for letting us know — and congrats on the new role! "
            "We'll keep your profile in our talent bank and reach out again "
            "if you're ever open to a move."
        )

    # ── Not available right now ─────────────────────────────────────────────
    if result.intent == "decline_not_available":
        candidate.talent_bank_status = "not_available"
        candidate.talent_bank_status_reason = body_text[:240]
        candidate.talent_bank_status_updated_at = datetime.utcnow()
        candidate.updated_at = datetime.utcnow()
        db.commit()
        return _twiml(
            "No problem — thanks for the quick reply. We'll keep you in mind "
            "for future opportunities."
        )

    # ── Unclear ──────────────────────────────────────────────────────────────
    # Don't reply automatically when we can't tell — surface it to HR so
    # they handle the nuance.
    return _twiml()
