"""Screening endpoints: interview links, face tracking, transcript, evaluate, webhook."""
import json
import os
import uuid
import hmac
import hashlib
import httpx
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from database import get_db
from models import Application, Candidate, Job, Event, InterviewLink, QaSession
from schemas import (
    InterviewLinkGenerateRequest, InterviewLinkResponse,
    InterviewLinkPublicResponse, InterviewStatusUpdateRequest,
    FaceTrackingDataRequest, InterviewTranscriptSubmitRequest,
    ScreeningTranscriptRequest,
    QaSessionStartResponse, QaRoundSubmitRequest, QaRoundSubmitResponse,
)
from agents.interview_evaluator import evaluate_interview, InterviewEvaluatorInput
from agents.qa_interview import (
    QaGenerateInput, QaScoreInput, ROUND_ORDER,
    generate_question_set, score_round, aggregate_final,
)
from auth.dependencies import current_session, CurrentSession
from billing.plans import check_quota, gate_agent

router = APIRouter(prefix="/api/v1/screening", tags=["screening"])

WEBHOOK_SECRET = os.getenv("ELEVENLABS_WEBHOOK_SECRET", "")


def _log_event(
    db: Session,
    app_id: int,
    event_type: str,
    payload: dict,
    tenant_id: int | None = None,
    actor_user_id: int | None = None,
):
    event = Event(
        app_id=app_id,
        event_type=event_type,
        payload=json.dumps(payload),
        tenant_id=tenant_id,
        actioned_by_user_id=actor_user_id,
    )
    db.add(event)


def _hr_app(db: Session, app_id: int, session: CurrentSession) -> Application:
    """Look up an Application that belongs to the calling tenant. 404 otherwise.

    Use this in every HR-side endpoint instead of a raw `db.query(Application)...first()`.
    """
    app = db.query(Application).filter(
        Application.id == app_id,
        Application.tenant_id == session.tenant.id,
    ).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    return app


def _apply_threshold_decision(app: Application, job: Job, db: Session) -> dict:
    """Apply threshold-based auto-decision after evaluation.

    Rules:
      - Resume >= resume_threshold_min AND Interview >= interview_threshold_min → ADVANCE
      - Final score < final_threshold_reject → REJECT
      - Otherwise → HOLD (HR review needed)

    Returns dict with decision details.
    """
    resume_score = app.resume_score or 0
    interview_score = app.interview_score or 0
    final_score = app.final_score or 0

    # Job thresholds (with defaults)
    resume_min = job.resume_threshold_min if job.resume_threshold_min is not None else 80.0
    interview_min = job.interview_threshold_min if job.interview_threshold_min is not None else 75.0
    reject_below = job.final_threshold_reject if job.final_threshold_reject is not None else 50.0

    resume_pass = resume_score >= resume_min
    interview_pass = interview_score >= interview_min
    above_reject = final_score >= reject_below

    result = {
        "resume_score": resume_score,
        "interview_score": interview_score,
        "final_score": final_score,
        "resume_threshold": resume_min,
        "interview_threshold": interview_min,
        "reject_threshold": reject_below,
        "resume_pass": resume_pass,
        "interview_pass": interview_pass,
    }

    if resume_pass and interview_pass:
        # Both scores above threshold → AUTO-ADVANCE
        decision = "advance"
        app.recommendation = "advance"
        app.stage = "shortlisted"
        app.ai_next_action = (
            f"Auto-advanced: Resume {resume_score}% ≥ {resume_min}% ✓, "
            f"Interview {interview_score}% ≥ {interview_min}% ✓ — "
            f"Select interview slot to schedule"
        )
        result["decision"] = decision
        result["reason"] = "Both scores meet threshold"

        _log_event(db, app.id, "threshold_auto_advance", {
            "resume_score": resume_score,
            "interview_score": interview_score,
            "final_score": final_score,
            "thresholds": {"resume": resume_min, "interview": interview_min},
        })

    elif not above_reject:
        # Final score below reject threshold → AUTO-REJECT
        decision = "reject"
        app.recommendation = "reject"
        app.stage = "rejected"
        app.ai_next_action = (
            f"Auto-rejected: Final score {final_score}% below {reject_below}% threshold"
        )
        result["decision"] = decision
        result["reason"] = f"Final score {final_score} below reject threshold {reject_below}"

        # Auto-send rejection email
        try:
            candidate = db.query(Candidate).filter(Candidate.id == app.candidate_id).first()
            company = os.getenv("COMPANY_NAME", "HireOps AI")
            from services.smtp_service import send_rejection_email
            send_rejection_email(
                to_email=candidate.email,
                candidate_name=candidate.name.split()[0],
                job_title=job.title,
                company_name=company,
            )
            _log_event(db, app.id, "auto_rejection_email_sent", {"to": candidate.email})
        except Exception:
            pass

    else:
        # Scores partially pass → HOLD for HR review
        decision = "hold"
        app.recommendation = "hold"
        missing = []
        if not resume_pass:
            missing.append(f"Resume {resume_score}% < {resume_min}%")
        if not interview_pass:
            missing.append(f"Interview {interview_score}% < {interview_min}%")
        app.ai_next_action = (
            f"Hold for HR review: {', '.join(missing)} — "
            f"Final score {final_score}% (above reject threshold {reject_below}%)"
        )
        result["decision"] = decision
        result["reason"] = f"Partial pass: {', '.join(missing)}"

        _log_event(db, app.id, "threshold_hold", {
            "resume_score": resume_score,
            "interview_score": interview_score,
            "final_score": final_score,
            "missing": missing,
        })

    app.updated_at = datetime.utcnow()
    return result


# ═══════════════════════════════════════
# INTERVIEW LINK MANAGEMENT (Dashboard)
# ═══════════════════════════════════════

@router.post("/generate-link")
async def generate_interview_link(
    req: InterviewLinkGenerateRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Generate a unique interview link for an application."""
    check_quota(db, session.tenant, "interviews")
    # The job's interview_mode decides which agent will run when the
    # candidate joins. Gate at link-generation time so trial tenants
    # don't issue links to interviews their plan can't conduct.
    app = db.query(Application).filter(
        Application.id == req.app_id,
        Application.tenant_id == session.tenant.id,
    ).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    job = db.query(Job).filter(Job.id == app.job_id).first() if app else None
    interview_mode = (job.interview_mode if job else "voice") or "voice"
    if interview_mode == "qa":
        gate_agent(session.tenant, "qa_interview_generate")
    else:
        gate_agent(session.tenant, "voice_screener")

    # Expire any existing active links for this application
    db.query(InterviewLink).filter(
        InterviewLink.app_id == req.app_id,
        InterviewLink.status.in_(["generated", "sent", "opened"])
    ).update({"status": "expired"}, synchronize_session="fetch")

    token = uuid.uuid4().hex
    link = InterviewLink(
        tenant_id=session.tenant.id,
        token=token,
        app_id=app.id,
        status="generated",
        expires_at=datetime.utcnow() + timedelta(hours=req.expires_hours),
    )
    db.add(link)

    app.interview_link_status = "generated"
    app.stage = "interview_link_sent"
    app.screening_status = "link_generated"
    app.ai_next_action = "Interview link generated — send to candidate"
    app.updated_at = datetime.utcnow()

    _log_event(db, app.id, "interview_link_generated", {"token": token, "expires_hours": req.expires_hours}, tenant_id=session.tenant.id, actor_user_id=session.user.id)
    db.commit()
    db.refresh(link)

    base_url = os.getenv("FRONTEND_URL", "").rstrip("/")
    interview_url = f"{base_url}/interview/{token}"

    return InterviewLinkResponse(
        id=link.id,
        token=token,
        app_id=app.id,
        status=link.status,
        interview_url=interview_url,
        expires_at=link.expires_at,
        opened_at=link.opened_at,
        interview_started_at=link.interview_started_at,
        interview_completed_at=link.interview_completed_at,
        created_at=link.created_at,
    )


@router.post("/send-link")
async def send_interview_link(body: dict, db: Session = Depends(get_db), session: CurrentSession = Depends(current_session)):
    """Actually send interview link email to the candidate via SMTP."""
    token = body.get("token")
    link = db.query(InterviewLink).filter(InterviewLink.token == token).first()
    if not link:
        raise HTTPException(status_code=404, detail="Interview link not found")

    app = db.query(Application).filter(Application.id == link.app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    candidate = db.query(Candidate).filter(Candidate.id == app.candidate_id).first()
    job = db.query(Job).filter(Job.id == app.job_id).first()

    if not candidate or not candidate.email:
        raise HTTPException(status_code=400, detail="Candidate email not found")

    base_url = os.getenv("FRONTEND_URL", "").rstrip("/")
    interview_url = f"{base_url}/interview/{token}"
    company = (
        session.tenant.name
        or os.getenv("COMPANY_NAME", "HireOps AI")
    )

    # Build the email body once and try the tenant's own connected
    # mailbox first; fall back to the legacy gmail_manager only if no
    # MailAccount exists.
    from services.smtp_service import send_interview_link_email
    from services.tenant_outbound import send_via_tenant_mailbox

    subject = f"Interview Invitation — {job.title if job else 'Open Position'} at {company}"
    name_for_template = candidate.name.split()[0] if candidate.name else "there"

    # Re-use the legacy template generator for body content, then dispatch
    # through the tenant-aware SMTP path. The helper returns the same
    # success/message dict shape, so the rest of the flow doesn't change.
    body_html, body_text = _interview_link_body(
        name_for_template,
        job.title if job else "Open Position",
        company,
        interview_url,
    )

    result = send_via_tenant_mailbox(
        tenant_id=session.tenant.id,
        to_email=candidate.email,
        subject=subject,
        body_html=body_html,
        body_text=body_text,
        db=db,
    )

    # Fall back to the legacy gmail_manager path only if the tenant has
    # no MailAccount at all (e.g. brand-new tenant who hasn't connected
    # Gmail yet). Keeps existing demo deploys working.
    if not result["success"] and "No connected mailbox" in result.get("message", ""):
        legacy = send_interview_link_email(
            to_email=candidate.email,
            candidate_name=name_for_template,
            job_title=job.title if job else "Open Position",
            company_name=company,
            interview_url=interview_url,
        )
        if legacy.get("success"):
            result = {"success": True, "message": legacy.get("message", "Sent"), "from": None}

    if result["success"]:
        link.status = "sent"
        app.interview_link_status = "sent"
        app.ai_next_action = "Interview link emailed to candidate — waiting for response"
        app.updated_at = datetime.utcnow()
        _log_event(db, link.app_id, "interview_link_emailed", {
            "token": token,
            "to_email": candidate.email,
            "from": result.get("from"),
        })
        db.commit()
        return {
            "status": "sent",
            "token": token,
            "email_sent": True,
            "to": candidate.email,
            "from": result.get("from"),
        }

    # Real failure: don't lie to HR. Mark the link send_failed so the
    # UI can flag it and prompt the user to fix the mailbox / copy the
    # link manually.
    link.status = "send_failed"
    app.interview_link_status = "send_failed"
    app.ai_next_action = (
        f"Interview email failed — {result.get('message','SMTP error')}"
    )
    app.updated_at = datetime.utcnow()
    db.commit()
    return {
        "status": "send_failed",
        "token": token,
        "email_sent": False,
        "error": result["message"],
        "interview_url": interview_url,  # let HR copy/send manually
    }


def _interview_link_body(name: str, job_title: str, company: str, url: str) -> tuple[str, str]:
    """Render the same interview-invite HTML + text we already had in
    smtp_service, so the tenant_outbound path produces visually identical
    emails."""
    body_html = f"""
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
      <div style="background: linear-gradient(135deg,#6366f1,#8b5cf6); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
        <h1 style="color: white; margin: 0; font-size: 24px;">{company}</h1>
        <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0;">Interview Invitation</p>
      </div>
      <div style="background:#fff; padding:30px; border:1px solid #e2e8f0; border-top:none;">
        <p style="color:#334155; font-size:16px; line-height:1.6;">Hi {name},</p>
        <p style="color:#334155; font-size:16px; line-height:1.6;">
          Thank you for applying for the <strong>{job_title}</strong> position at {company}.
          We'd like to invite you to a short AI-powered screening interview.
        </p>
        <p style="color:#334155; font-size:16px; line-height:1.6;">
          The interview takes about <strong>8–10 minutes</strong>. You'll need a
          working microphone and camera in a quiet environment.
        </p>
        <div style="text-align:center; margin:30px 0;">
          <a href="{url}" style="background:#6366f1; color:white; padding:14px 32px;
             border-radius:8px; text-decoration:none; font-weight:600;">Start your interview</a>
        </div>
        <p style="color:#64748b; font-size:14px; line-height:1.6;">
          This link is valid for 72 hours. If the button doesn't work, copy this URL into your browser:<br>
          <span style="font-family:monospace; word-break:break-all;">{url}</span>
        </p>
      </div>
    </div>"""
    body_text = (
        f"Hi {name},\n\n"
        f"Thank you for applying for the {job_title} position at {company}.\n"
        f"We'd like to invite you to a short AI-powered screening interview (8-10 minutes).\n\n"
        f"Start your interview here: {url}\n\n"
        f"This link is valid for 72 hours.\n\n"
        f"Best regards,\n{company} Recruitment Team"
    )
    return body_html, body_text


@router.post("/{app_id}/send-rejection")
async def send_rejection_email(app_id: int, db: Session = Depends(get_db), session: CurrentSession = Depends(current_session)):
    """Send rejection email to candidate."""
    app = _hr_app(db, app_id, session)

    candidate = db.query(Candidate).filter(Candidate.id == app.candidate_id).first()
    job = db.query(Job).filter(Job.id == app.job_id).first()

    if not candidate or not candidate.email:
        raise HTTPException(status_code=400, detail="Candidate email not found")

    company = os.getenv("COMPANY_NAME", "HireOps AI")

    from services.smtp_service import send_rejection_email as _send_rejection
    result = _send_rejection(
        to_email=candidate.email,
        candidate_name=candidate.name.split()[0],
        job_title=job.title if job else "Open Position",
        company_name=company,
    )

    if result["success"]:
        app.stage = "rejected"
        app.recommendation = "reject"
        app.ai_next_action = "Rejection email sent"
        app.updated_at = datetime.utcnow()
        _log_event(db, app.id, "rejection_email_sent", {"to_email": candidate.email}, tenant_id=session.tenant.id, actor_user_id=session.user.id)
        db.commit()

    return result


@router.post("/{app_id}/send-email")
async def send_custom_email_endpoint(app_id: int, body: dict, db: Session = Depends(get_db), session: CurrentSession = Depends(current_session)):
    """Send a custom email to candidate (e.g., AI-generated follow-up draft)."""
    app = _hr_app(db, app_id, session)

    candidate = db.query(Candidate).filter(Candidate.id == app.candidate_id).first()
    if not candidate or not candidate.email:
        raise HTTPException(status_code=400, detail="Candidate email not found")

    subject = body.get("subject", "")
    email_body = body.get("body", "")
    if not subject or not email_body:
        raise HTTPException(status_code=400, detail="Subject and body are required")

    company = os.getenv("COMPANY_NAME", "HireOps AI")

    from services.smtp_service import send_custom_email
    result = send_custom_email(
        to_email=candidate.email,
        candidate_name=candidate.name.split()[0],
        subject=subject,
        body=email_body,
        company_name=company,
    )

    if result["success"]:
        _log_event(db, app.id, "custom_email_sent", {
            "to_email": candidate.email,
            "subject": subject,
        })
        db.commit()

    return result


@router.post("/{app_id}/book-slot")
async def book_interview_slot(app_id: int, body: dict, db: Session = Depends(get_db), session: CurrentSession = Depends(current_session)):
    """Book an interview slot, generate Round 2 interview link, and send email with .ics calendar invite."""
    app = _hr_app(db, app_id, session)

    slot = body.get("slot", "")
    if not slot:
        raise HTTPException(status_code=400, detail="Slot is required")

    candidate = db.query(Candidate).filter(Candidate.id == app.candidate_id).first()
    job = db.query(Job).filter(Job.id == app.job_id).first()

    if not candidate or not candidate.email:
        raise HTTPException(status_code=400, detail="Candidate email not found")

    company = os.getenv("COMPANY_NAME", "HireOps AI")
    base_url = os.getenv("FRONTEND_URL", "").rstrip("/")
    job_title = job.title if job else "Open Position"

    # ── 1. Parse slot text → datetime ──
    from services.ics_generator import parse_slot_to_datetime
    interview_dt = parse_slot_to_datetime(slot)

    # ── 2. Store slot + advance to shortlisted ──
    app.scheduled_interview_slot = slot
    app.scheduled_interview_at = interview_dt
    app.stage = "shortlisted"
    app.updated_at = datetime.utcnow()

    # ── 3. Generate Round 2 interview link ──
    # Expire existing active links
    db.query(InterviewLink).filter(
        InterviewLink.app_id == app.id,
        InterviewLink.status.in_(["generated", "sent", "opened"]),
    ).update({"status": "expired"}, synchronize_session="fetch")

    token = uuid.uuid4().hex
    link = InterviewLink(
        token=token,
        app_id=app.id,
        status="sent",
        round=2,
        scheduled_at=interview_dt,
        expires_at=datetime.utcnow() + timedelta(hours=168),  # 7 days
    )
    db.add(link)
    app.interview_link_status = "sent"

    interview_url = f"{base_url}/interview/{token}"
    app.ai_next_action = f"Round 2 interview scheduled: {slot} — link sent to {candidate.email}"

    _log_event(db, app.id, "interview_slot_booked", {
        "slot": slot,
        "interview_dt": interview_dt.isoformat(),
        "interview_url": interview_url,
        "round": 2,
    }, tenant_id=session.tenant.id, actor_user_id=session.user.id)

    # ── 4. Generate .ics calendar invite ──
    from services.ics_generator import generate_ics
    from services.gmail_service import gmail_manager

    organizer_creds = gmail_manager._load_credentials()
    organizer_email = organizer_creds["email"] if organizer_creds else ""

    ics_content = generate_ics(
        summary=f"Round 2 Interview — {job_title} at {company}",
        dtstart=interview_dt,
        duration_minutes=60,
        description=(
            f"Round 2 Interview for {job_title} position at {company}.\n\n"
            f"Candidate: {candidate.name}\n"
            f"Join the interview room: {interview_url}\n\n"
            f"Our AI assistant will join to transcribe and summarize the conversation.\n"
            f"Please have your webcam and microphone ready."
        ),
        location=interview_url,
        organizer_email=organizer_email,
        organizer_name=company,
        attendee_email=candidate.email,
        attendee_name=candidate.name,
        url=interview_url,
    )

    # ── 5. Send scheduling email with .ics + interview link ──
    email_result = {"success": False, "message": "Not attempted"}
    try:
        email_draft = ""
        if app.interview_score_json:
            score_data = json.loads(app.interview_score_json)
            email_draft = score_data.get("email_draft", "")

        from services.smtp_service import send_scheduling_email
        email_result = send_scheduling_email(
            to_email=candidate.email,
            candidate_name=candidate.name.split()[0],
            job_title=job_title,
            company_name=company,
            slot=slot,
            email_draft=email_draft,
            interview_url=interview_url,
            ics_attachment=ics_content,
        )
        if email_result["success"]:
            app.email_draft_sent = 1
            _log_event(db, app.id, "scheduling_email_sent", {
                "to_email": candidate.email,
                "slot": slot,
                "interview_url": interview_url,
                "ics_attached": True,
            })
    except Exception as e:
        email_result = {"success": False, "message": str(e)}

    db.commit()

    return {
        "status": "booked",
        "slot": slot,
        "interview_url": interview_url,
        "interview_token": token,
        "email_sent": email_result.get("success", False),
        "email_message": email_result.get("message", ""),
    }


@router.post("/{app_id}/send-draft")
async def send_email_draft(app_id: int, db: Session = Depends(get_db), session: CurrentSession = Depends(current_session)):
    """Send the AI-generated email draft to the candidate."""
    app = _hr_app(db, app_id, session)

    if not app.interview_score_json:
        raise HTTPException(status_code=400, detail="No interview evaluation available")

    score_data = json.loads(app.interview_score_json)
    email_draft = score_data.get("email_draft", "")
    if not email_draft:
        raise HTTPException(status_code=400, detail="No email draft available")

    candidate = db.query(Candidate).filter(Candidate.id == app.candidate_id).first()
    job = db.query(Job).filter(Job.id == app.job_id).first()

    if not candidate or not candidate.email:
        raise HTTPException(status_code=400, detail="Candidate email not found")

    company = os.getenv("COMPANY_NAME", "HireOps AI")
    decision = score_data.get("decision", "")
    subject = (
        f"Next Steps — {job.title if job else 'Position'} at {company}"
        if decision == "advance"
        else f"Update on Your Application — {job.title if job else 'Position'} at {company}"
    )

    from services.smtp_service import send_custom_email
    result = send_custom_email(
        to_email=candidate.email,
        candidate_name=candidate.name.split()[0],
        subject=subject,
        body=email_draft,
        company_name=company,
    )

    if result["success"]:
        app.email_draft_sent = 1
        app.updated_at = datetime.utcnow()
        _log_event(db, app.id, "email_draft_sent", {
            "to_email": candidate.email,
            "subject": subject,
        })
        db.commit()

    return result


@router.post("/{app_id}/calculate-final-score")
async def calculate_final_score(app_id: int, db: Session = Depends(get_db), session: CurrentSession = Depends(current_session)):
    """Calculate a combined final score from resume + interview using LLM."""
    app = _hr_app(db, app_id, session)

    resume_score = app.resume_score or 0
    interview_score = app.interview_score or 0

    # Weighted combination: 40% resume, 60% interview
    final_score = round(resume_score * 0.4 + interview_score * 0.6, 1)

    # Generate LLM summary combining both assessments
    resume_data = json.loads(app.resume_score_json) if app.resume_score_json else {}
    interview_data = json.loads(app.interview_score_json) if app.interview_score_json else {}
    candidate = db.query(Candidate).filter(Candidate.id == app.candidate_id).first()
    job = db.query(Job).filter(Job.id == app.job_id).first()

    final_summary = ""
    try:
        from mistralai import Mistral
        client = Mistral(api_key=os.environ.get("MISTRAL_API_KEY", ""))

        prompt = (
            f"You are an HR assessment summarizer. Generate a concise 2-3 sentence final assessment "
            f"for a candidate based on their resume and interview scores.\n\n"
            f"Candidate: {candidate.name if candidate else 'Unknown'}\n"
            f"Position: {job.title if job else 'Unknown'}\n"
            f"Resume Score: {resume_score}/100\n"
            f"Resume Summary: {resume_data.get('summary', 'N/A')}\n"
            f"Interview Score: {interview_score}/100\n"
            f"Interview Summary: {interview_data.get('summary', 'N/A')}\n"
            f"Interview Decision: {interview_data.get('decision', 'N/A')}\n"
            f"Strengths: {', '.join(interview_data.get('strengths', []))}\n"
            f"Concerns: {', '.join(interview_data.get('concerns', []))}\n"
            f"Communication: {interview_data.get('communication_rating', 'N/A')}\n"
            f"Technical Depth: {interview_data.get('technical_depth', 'N/A')}\n"
            f"Final Score: {final_score}/100\n\n"
            f"Write a professional 2-3 sentence summary. Include the final recommendation (advance/hold/reject). "
            f"Be specific about key strengths and concerns."
        )

        response = client.chat.complete(
            model="mistral-small-latest",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=200,
        )
        final_summary = response.choices[0].message.content.strip()
    except Exception as e:
        # Fallback to a simple summary
        decision = interview_data.get("decision", app.recommendation or "hold")
        final_summary = (
            f"Combined assessment for {candidate.name if candidate else 'candidate'} "
            f"({job.title if job else 'position'}): Resume score {resume_score}/100, "
            f"Interview score {interview_score}/100, Final score {final_score}/100. "
            f"Recommendation: {decision}."
        )

    app.final_score = final_score
    app.final_summary = final_summary
    app.updated_at = datetime.utcnow()
    _log_event(db, app.id, "final_score_calculated", {
        "resume_score": resume_score,
        "interview_score": interview_score,
        "final_score": final_score,
    }, tenant_id=session.tenant.id, actor_user_id=session.user.id)

    # Apply threshold-based auto-decision
    threshold_result = {}
    if job:
        threshold_result = _apply_threshold_decision(app, job, db)

    db.commit()

    return {
        "final_score": final_score,
        "final_summary": final_summary,
        "resume_score": resume_score,
        "interview_score": interview_score,
        "threshold_decision": threshold_result,
    }


@router.get("/{app_id}/hiring-report")
async def get_hiring_report(app_id: int, db: Session = Depends(get_db), session: CurrentSession = Depends(current_session)):
    """Generate a comprehensive autonomous hiring report for an application."""
    gate_agent(session.tenant, "hiring_report")
    from agents.hiring_report import generate_hiring_report, HiringReportInput
    from dataclasses import asdict

    app = _hr_app(db, app_id, session)

    candidate = db.query(Candidate).filter(Candidate.id == app.candidate_id).first()
    job = db.query(Job).filter(Job.id == app.job_id).first()

    resume_data = json.loads(app.resume_score_json) if app.resume_score_json else {}
    interview_data = json.loads(app.interview_score_json) if app.interview_score_json else {}
    snippets = json.loads(app.ai_snippets) if app.ai_snippets else {}

    inp = HiringReportInput(
        candidate_name=candidate.name if candidate else "Unknown",
        candidate_email=candidate.email if candidate else "",
        job_title=job.title if job else "",
        job_code=job.job_id if job else "",
        resume_score=app.resume_score or 0,
        interview_score=app.interview_score,
        final_score=app.final_score,
        recommendation=app.recommendation or "hold",
        resume_evidence=resume_data.get("evidence", []),
        resume_gaps=resume_data.get("gaps", []),
        resume_risks=resume_data.get("risks", []),
        resume_summary=resume_data.get("summary", ""),
        key_strengths=snippets.get("key_strengths", []),
        main_gaps=snippets.get("main_gaps", []),
        why_shortlisted=snippets.get("why_shortlisted", []),
        interview_strengths=interview_data.get("strengths", []),
        interview_concerns=interview_data.get("concerns", []),
        communication_rating=interview_data.get("communication_rating", "N/A"),
        technical_depth=interview_data.get("technical_depth", "N/A"),
        cultural_fit=interview_data.get("cultural_fit", "N/A"),
        interview_summary=interview_data.get("summary", ""),
        final_summary=app.final_summary or "",
        thresholds={
            "resume_min": job.resume_threshold_min if job and job.resume_threshold_min else 80.0,
            "interview_min": job.interview_threshold_min if job and job.interview_threshold_min else 75.0,
            "reject_below": job.final_threshold_reject if job and job.final_threshold_reject else 50.0,
        },
    )

    report = await generate_hiring_report(inp)
    return asdict(report)


@router.get("/{app_id}/links")
async def get_application_links(app_id: int, db: Session = Depends(get_db), session: CurrentSession = Depends(current_session)):
    """Get all interview links for an application."""
    links = db.query(InterviewLink).filter(
        InterviewLink.app_id == app_id
    ).order_by(InterviewLink.created_at.desc()).all()

    base_url = os.getenv("FRONTEND_URL", "").rstrip("/")

    return {
        "links": [
            {
                "id": link.id,
                "token": link.token,
                "status": link.status,
                "interview_url": f"{base_url}/interview/{link.token}",
                "expires_at": link.expires_at.isoformat() if link.expires_at else None,
                "opened_at": link.opened_at.isoformat() if link.opened_at else None,
                "interview_started_at": link.interview_started_at.isoformat() if link.interview_started_at else None,
                "interview_completed_at": link.interview_completed_at.isoformat() if link.interview_completed_at else None,
                "face_tracking_json": json.loads(link.face_tracking_json) if link.face_tracking_json else None,
                "created_at": link.created_at.isoformat() if link.created_at else None,
            }
            for link in links
        ]
    }


# ═══════════════════════════════════════
# PUBLIC INTERVIEW ENDPOINTS
# ═══════════════════════════════════════

@router.get("/link/{token}")
async def get_interview_link_public(token: str, db: Session = Depends(get_db)):
    """Public endpoint: validate interview token and return config."""
    link = db.query(InterviewLink).filter(InterviewLink.token == token).first()
    if not link:
        return InterviewLinkPublicResponse(
            token=token, status="invalid", candidate_first_name="",
            job_title="", company_name="", elevenlabs_agent_id="",
            is_valid=False, error="Interview link not found.",
        )

    # Check expiry
    if link.expires_at < datetime.utcnow():
        if link.status not in ("expired", "interview_completed"):
            link.status = "expired"
            db.commit()
        return InterviewLinkPublicResponse(
            token=token, status="expired", candidate_first_name="",
            job_title="", company_name="", elevenlabs_agent_id="",
            is_valid=False, error="This interview link has expired. Please contact the recruiter for a new link.",
        )

    # Check if already completed
    if link.status == "interview_completed":
        return InterviewLinkPublicResponse(
            token=token, status="interview_completed", candidate_first_name="",
            job_title="", company_name="", elevenlabs_agent_id="",
            is_valid=False, error="This interview has already been completed. Thank you!",
        )

    # ── Time-gate check for Round 2 scheduled interviews ──
    interview_round = link.round or 1
    scheduled_at_iso = None
    available_in_minutes = None

    if link.scheduled_at and interview_round == 2:
        now = datetime.utcnow()
        opens_at = link.scheduled_at - timedelta(minutes=15)  # Room opens 15 min early
        closes_at = link.scheduled_at + timedelta(hours=2)    # Room closes 2 hours after

        scheduled_at_iso = link.scheduled_at.isoformat() + "Z"

        if now < opens_at:
            # Too early — show waiting/countdown
            diff = opens_at - now
            available_in_minutes = int(diff.total_seconds() / 60) + 1

            app = db.query(Application).filter(Application.id == link.app_id).first()
            candidate = db.query(Candidate).filter(Candidate.id == app.candidate_id).first() if app else None
            job = db.query(Job).filter(Job.id == app.job_id).first() if app else None
            company = os.getenv("COMPANY_NAME", "HireOps AI")

            return InterviewLinkPublicResponse(
                token=token,
                status="waiting",
                candidate_first_name=candidate.name.split()[0] if candidate else "",
                job_title=job.title if job else "",
                job_code="",
                company_name=company,
                elevenlabs_agent_id="",
                is_valid=True,
                error=None,
                scheduled_at=scheduled_at_iso,
                available_in_minutes=available_in_minutes,
                interview_round=interview_round,
            )

        if now > closes_at:
            # Too late — room closed
            if link.status not in ("expired", "interview_completed"):
                link.status = "expired"
                db.commit()
            return InterviewLinkPublicResponse(
                token=token, status="expired", candidate_first_name="",
                job_title="", company_name="", elevenlabs_agent_id="",
                is_valid=False,
                error="This interview session has ended. The room was available until 2 hours after the scheduled time. Please contact the recruiter to reschedule.",
            )

    # Mark as opened on first access
    if link.status in ("generated", "sent"):
        link.status = "opened"
        link.opened_at = datetime.utcnow()
        app = db.query(Application).filter(Application.id == link.app_id).first()
        if app:
            app.interview_link_status = "opened"
            app.ai_next_action = "Candidate has opened the interview link"
            app.updated_at = datetime.utcnow()
        _log_event(db, link.app_id, "interview_link_opened", {"token": token})
        db.commit()

    # Get candidate + job info
    app = db.query(Application).filter(Application.id == link.app_id).first()
    candidate = db.query(Candidate).filter(Candidate.id == app.candidate_id).first() if app else None
    job = db.query(Job).filter(Job.id == app.job_id).first() if app else None

    # Use a different ElevenLabs agent for Round 2 (HR + AI assistant)
    if link.round and link.round == 2:
        agent_id = os.getenv("ELEVENLABS_ROUND2_AGENT_ID", os.getenv("ELEVENLABS_AGENT_ID", ""))
    else:
        agent_id = os.getenv("ELEVENLABS_AGENT_ID", "")
    company = os.getenv("COMPANY_NAME", "HireOps AI")

    # Extract screening questions from the application's resume score
    screening_questions = []
    if app and app.resume_score_json:
        try:
            score_data = json.loads(app.resume_score_json)
            screening_questions = score_data.get("screening_questions", [])
        except (json.JSONDecodeError, TypeError):
            pass

    # Custom interview questions (Feature 4) — surfaced for the voice
    # interview room to pass into ElevenLabs as dynamic_variables.
    custom_questions: list[dict] = []
    if job and app:
        from models import JobInterviewQuestion as _JobQ
        rows = db.query(_JobQ).filter(
            _JobQ.job_id == job.id,
            _JobQ.tenant_id == app.tenant_id,
        ).order_by(_JobQ.order_index.asc(), _JobQ.id.asc()).all()
        for q in rows:
            try:
                kw = json.loads(q.expected_keywords or "[]")
            except Exception:
                kw = []
            custom_questions.append({
                "id": q.id,
                "text": q.question_text,
                "type": q.question_type or "behavioural",
                "weight": q.weight or 3,
                "is_required": bool(q.is_required),
                "expected_keywords": kw,
            })

    return InterviewLinkPublicResponse(
        token=token,
        status=link.status,
        candidate_first_name=candidate.name.split()[0] if candidate else "",
        job_title=job.title if job else "",
        job_code=job.job_id if job else "",
        company_name=company,
        elevenlabs_agent_id=agent_id,
        screening_questions=screening_questions,
        custom_questions=custom_questions,
        is_valid=True,
        scheduled_at=scheduled_at_iso,
        available_in_minutes=None,
        interview_round=interview_round,
        interview_mode=(job.interview_mode if job else "voice") or "voice",
    )


@router.post("/link/{token}/status")
async def update_interview_status(token: str, req: InterviewStatusUpdateRequest, db: Session = Depends(get_db)):
    """Public endpoint: update interview status from the interview page."""
    link = db.query(InterviewLink).filter(InterviewLink.token == token).first()
    if not link:
        raise HTTPException(status_code=404, detail="Interview link not found")

    if req.status == "interview_started":
        link.status = "interview_started"
        link.interview_started_at = datetime.utcnow()
        if req.elevenlabs_conversation_id:
            link.elevenlabs_conversation_id = req.elevenlabs_conversation_id

        app = db.query(Application).filter(Application.id == link.app_id).first()
        if app:
            app.interview_link_status = "interview_started"
            app.screening_status = "in_progress"
            app.ai_next_action = "Interview in progress"
            app.updated_at = datetime.utcnow()

        _log_event(db, link.app_id, "interview_started", {
            "token": token,
            "conversation_id": req.elevenlabs_conversation_id,
        })

    elif req.status == "interview_completed":
        link.status = "interview_completed"
        link.interview_completed_at = datetime.utcnow()

        app = db.query(Application).filter(Application.id == link.app_id).first()
        if app:
            app.interview_link_status = "interview_completed"
            app.ai_next_action = "Interview completed — awaiting transcript evaluation"
            app.updated_at = datetime.utcnow()

        _log_event(db, link.app_id, "interview_completed", {"token": token})

        # Record ElevenLabs voice usage for this interview so the tenant
        # usage report shows voice spend alongside Mistral spend.
        # Best-effort: pulls duration from ElevenLabs if a conversation_id
        # is set; logs zero-duration row otherwise so call counts still
        # show up.
        try:
            if app and app.tenant_id:
                from services import elevenlabs_usage
                duration = 0
                chars = 0
                if link.elevenlabs_conversation_id:
                    meta = elevenlabs_usage.fetch_conversation_metadata(
                        link.elevenlabs_conversation_id,
                    )
                    if meta:
                        # ElevenLabs convai response shape: metadata.call_duration_secs
                        # OR top-level call_duration_secs depending on version.
                        md = meta.get("metadata") or {}
                        duration = int(
                            md.get("call_duration_secs")
                            or meta.get("call_duration_secs")
                            or 0
                        )
                        chars = int(
                            md.get("character_count")
                            or meta.get("character_count")
                            or 0
                        )
                # Compute interview duration locally as a fallback
                if duration == 0 and link.interview_started_at:
                    duration = int(
                        (link.interview_completed_at - link.interview_started_at)
                        .total_seconds()
                    )
                elevenlabs_usage.record_voice_call(
                    db,
                    tenant_id=app.tenant_id,
                    conversation_id=link.elevenlabs_conversation_id or "",
                    duration_seconds=max(0, duration),
                    character_count=chars,
                    app_id=app.id,
                )
        except Exception as e:
            # Don't fail the interview-completion webhook over a usage row.
            import logging as _log
            _log.getLogger("hireops.screening").warning(
                "ElevenLabs usage logging failed for token %s: %s", token, e
            )

    db.commit()
    return {"status": link.status, "token": token}


@router.post("/link/{token}/face-tracking")
async def submit_face_tracking(token: str, req: FaceTrackingDataRequest, db: Session = Depends(get_db)):
    """Public endpoint: receive periodic face tracking data."""
    link = db.query(InterviewLink).filter(InterviewLink.token == token).first()
    if not link:
        raise HTTPException(status_code=404, detail="Interview link not found")

    # Load existing tracking data
    tracking = json.loads(link.face_tracking_json) if link.face_tracking_json else {
        "snapshots": [],
        "avg_attention_score": 0,
        "face_present_count": 0,
        "total_snapshots": 0,
    }

    # Add snapshot
    tracking["snapshots"].append({
        "face_present": req.face_present,
        "attention_score": req.attention_score,
        "timestamp": req.timestamp,
        "face_count": req.face_count,
    })
    tracking["total_snapshots"] += 1
    if req.face_present:
        tracking["face_present_count"] += 1

    # Compute running averages
    total = tracking["total_snapshots"]
    tracking["avg_attention_score"] = round(
        sum(s["attention_score"] for s in tracking["snapshots"]) / total, 3
    )
    tracking["face_present_percentage"] = round(
        tracking["face_present_count"] / total * 100, 1
    )

    # Keep only last 100 snapshots to limit storage
    if len(tracking["snapshots"]) > 100:
        tracking["snapshots"] = tracking["snapshots"][-100:]

    link.face_tracking_json = json.dumps(tracking)

    # Also update application aggregate
    app = db.query(Application).filter(Application.id == link.app_id).first()
    if app:
        app.interview_face_tracking_json = json.dumps({
            "avg_attention_score": tracking["avg_attention_score"],
            "face_present_percentage": tracking["face_present_percentage"],
            "total_snapshots": tracking["total_snapshots"],
        })

    db.commit()
    return {"status": "received", "total_snapshots": tracking["total_snapshots"]}


@router.post("/link/{token}/transcript")
async def submit_interview_transcript(token: str, req: InterviewTranscriptSubmitRequest, db: Session = Depends(get_db)):
    """Public endpoint: submit transcript after interview completion."""
    link = db.query(InterviewLink).filter(InterviewLink.token == token).first()
    if not link:
        raise HTTPException(status_code=404, detail="Interview link not found")

    app = db.query(Application).filter(Application.id == link.app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    # Store transcript
    app.screening_transcript = req.transcript
    app.stage = "screened"
    app.screening_status = "completed"
    app.updated_at = datetime.utcnow()

    if req.elevenlabs_conversation_id:
        link.elevenlabs_conversation_id = req.elevenlabs_conversation_id
    link.status = "interview_completed"
    link.interview_completed_at = link.interview_completed_at or datetime.utcnow()

    _log_event(db, app.id, "interview_transcript_received", {
        "token": token,
        "duration_seconds": req.duration_seconds,
        "transcript_length": len(req.transcript),
    })
    db.commit()

    # Auto-trigger evaluation
    evaluation_result = None
    try:
        job = db.query(Job).filter(Job.id == app.job_id).first()
        skills = json.loads(job.skills) if job and job.skills else []
        resume_summary = ""
        if app.resume_score_json:
            score_data = json.loads(app.resume_score_json)
            resume_summary = score_data.get("summary", "")

        eval_input = InterviewEvaluatorInput(
            transcript=req.transcript,
            job_title=job.title if job else "",
            job_description=job.description if job else "",
            required_skills=skills,
            resume_score=app.resume_score or 0,
            resume_summary=resume_summary,
        )
        result = await evaluate_interview(eval_input)

        app.interview_score = result.score
        app.interview_score_json = json.dumps({
            "score": result.score,
            "decision": result.decision,
            "strengths": result.strengths,
            "concerns": result.concerns,
            "communication_rating": result.communication_rating,
            "technical_depth": result.technical_depth,
            "cultural_fit": result.cultural_fit,
            "email_draft": result.email_draft,
            "scheduling_slots": result.scheduling_slots,
            "summary": result.summary,
        })
        # Calculate final combined score
        resume_score = app.resume_score or 0
        final_score = round(resume_score * 0.4 + result.score * 0.6, 1)
        app.final_score = final_score

        # Generate quick final summary
        try:
            from mistralai import Mistral as _Mistral
            _client = _Mistral(api_key=os.environ.get("MISTRAL_API_KEY", ""))
            _candidate = db.query(Candidate).filter(Candidate.id == app.candidate_id).first()
            _job = db.query(Job).filter(Job.id == app.job_id).first()
            _prompt = (
                f"Write a 2-sentence HR assessment summary.\n"
                f"Candidate: {_candidate.name if _candidate else 'Unknown'}, "
                f"Position: {_job.title if _job else 'Unknown'}, "
                f"Resume: {resume_score}/100, Interview: {result.score}/100, "
                f"Final: {final_score}/100, Decision: {result.decision}. "
                f"Strengths: {', '.join(result.strengths[:3])}. "
                f"Concerns: {', '.join(result.concerns[:2])}."
            )
            _resp = _client.chat.complete(
                model="mistral-small-latest",
                messages=[{"role": "user", "content": _prompt}],
                max_tokens=150,
            )
            app.final_summary = _resp.choices[0].message.content.strip()
        except Exception:
            app.final_summary = (
                f"Final score: {final_score}/100 (Resume: {resume_score}, Interview: {result.score}). "
                f"Recommendation: {result.decision}."
            )

        # Apply threshold-based auto-decision
        threshold_result = _apply_threshold_decision(app, job, db)

        # Auto-send email draft for advance candidates
        if threshold_result["decision"] == "advance":
            try:
                _candidate = db.query(Candidate).filter(Candidate.id == app.candidate_id).first()
                _job = db.query(Job).filter(Job.id == app.job_id).first()
                company = os.getenv("COMPANY_NAME", "HireOps AI")
                from services.smtp_service import send_custom_email as _send_custom
                _email_result = _send_custom(
                    to_email=_candidate.email,
                    candidate_name=_candidate.name.split()[0],
                    subject=f"Next Steps — {_job.title if _job else 'Position'} at {company}",
                    body=result.email_draft,
                    company_name=company,
                )
                if _email_result["success"]:
                    app.email_draft_sent = 1
                    _log_event(db, app.id, "auto_email_draft_sent", {
                        "to_email": _candidate.email,
                        "decision": threshold_result["decision"],
                    })
            except Exception:
                pass

        _log_event(db, app.id, "interview_auto_evaluated", {
            "score": result.score,
            "decision": threshold_result["decision"],
            "final_score": final_score,
            "threshold_result": threshold_result,
        })
        evaluation_result = {
            "score": result.score,
            "decision": threshold_result["decision"],
            "final_score": final_score,
            "threshold": threshold_result,
        }
    except Exception as e:
        _log_event(db, app.id, "interview_auto_evaluate_failed", {"error": str(e)})

    db.commit()

    return {
        "status": "transcript_stored",
        "app_id": app.id,
        "evaluation": evaluation_result,
    }


# ═══════════════════════════════════════
# MANUAL EVALUATION (Dashboard)
# ═══════════════════════════════════════

@router.post("/evaluate")
async def evaluate_screening(body: dict, db: Session = Depends(get_db), session: CurrentSession = Depends(current_session)):
    """Manually trigger evaluation of an existing transcript."""
    app_id = body.get("app_id")
    app = _hr_app(db, app_id, session)

    if not app.screening_transcript:
        raise HTTPException(status_code=400, detail="No transcript available. Complete an interview first.")

    job = db.query(Job).filter(Job.id == app.job_id).first()
    skills = json.loads(job.skills) if job and job.skills else []

    resume_summary = ""
    if app.resume_score_json:
        score_data = json.loads(app.resume_score_json)
        resume_summary = score_data.get("summary", "")

    eval_input = InterviewEvaluatorInput(
        transcript=app.screening_transcript,
        job_title=job.title if job else "",
        job_description=job.description if job else "",
        required_skills=skills,
        resume_score=app.resume_score or 0,
        resume_summary=resume_summary,
    )
    result = await evaluate_interview(eval_input)

    app.interview_score = result.score

    # ── Extract candidate's preferred slot from transcript JSON ───────────
    candidate_preferred_slot = None
    try:
        # The transcript ends with a JSON payload from the agent
        idx = app.screening_transcript.rfind('{"candidate_name"')
        if idx >= 0:
            transcript_payload = json.loads(app.screening_transcript[idx:])
            avail = transcript_payload.get("availability", {})
            candidate_preferred_slot = avail.get("candidate_preferred_slot")
    except Exception:
        pass  # If parsing fails, just skip

    # NOTE: Auto-booking happens AFTER threshold decision (see below)

    app.interview_score_json = json.dumps({
        "score": result.score,
        "decision": result.decision,
        "strengths": result.strengths,
        "concerns": result.concerns,
        "communication_rating": result.communication_rating,
        "technical_depth": result.technical_depth,
        "cultural_fit": result.cultural_fit,
        "email_draft": result.email_draft,
        "scheduling_slots": result.scheduling_slots,
        "candidate_preferred_slot": candidate_preferred_slot,
        "summary": result.summary,
    })
    # Calculate final combined score
    resume_score = app.resume_score or 0
    final_score = round(resume_score * 0.4 + result.score * 0.6, 1)
    app.final_score = final_score

    # Generate final summary
    try:
        from mistralai import Mistral as _Mistral
        _client = _Mistral(api_key=os.environ.get("MISTRAL_API_KEY", ""))
        _candidate = db.query(Candidate).filter(Candidate.id == app.candidate_id).first()
        _prompt = (
            f"Write a 2-sentence HR assessment summary.\n"
            f"Candidate: {_candidate.name if _candidate else 'Unknown'}, "
            f"Position: {job.title if job else 'Unknown'}, "
            f"Resume: {resume_score}/100, Interview: {result.score}/100, "
            f"Final: {final_score}/100, Decision: {result.decision}. "
            f"Strengths: {', '.join(result.strengths[:3])}. "
            f"Concerns: {', '.join(result.concerns[:2])}."
        )
        _resp = _client.chat.complete(
            model="mistral-small-latest",
            messages=[{"role": "user", "content": _prompt}],
            max_tokens=150,
        )
        app.final_summary = _resp.choices[0].message.content.strip()
    except Exception:
        app.final_summary = (
            f"Final score: {final_score}/100 (Resume: {resume_score}, Interview: {result.score}). "
            f"Recommendation: {result.decision}."
        )

    # Apply threshold-based auto-decision
    threshold_result = _apply_threshold_decision(app, job, db)

    # ── Auto-book slot ONLY if decision is ADVANCE ────────────────────────
    # If candidate passed all thresholds → auto-book their preferred slot.
    # If HOLD or REJECT → clear any previously booked slot; HR must decide first.
    if threshold_result.get("decision") == "advance" and candidate_preferred_slot:
        app.scheduled_interview_slot = candidate_preferred_slot
        app.scheduled_interview_at = datetime.utcnow()
    else:
        # Clear any stale booking from a previous evaluation
        app.scheduled_interview_slot = None
        app.scheduled_interview_at = None

    app.updated_at = datetime.utcnow()
    _log_event(db, app.id, "evaluated", {
        "interview_score": result.score,
        "decision": threshold_result["decision"],
        "final_score": final_score,
        "threshold_result": threshold_result,
    }, tenant_id=session.tenant.id, actor_user_id=session.user.id)
    db.commit()
    db.refresh(app)

    return {
        "app_id": app.id,
        "interview_score": result.score,
        "decision": threshold_result["decision"],
        "strengths": result.strengths,
        "concerns": result.concerns,
        "email_draft": result.email_draft,
        "scheduling_slots": result.scheduling_slots,
        "summary": result.summary,
        "final_score": final_score,
        "final_summary": app.final_summary,
    }


@router.post("/transcript")
async def store_transcript(req: ScreeningTranscriptRequest, db: Session = Depends(get_db), session: CurrentSession = Depends(current_session)):
    """Manual transcript upload (fallback)."""
    app = db.query(Application).filter(Application.id == req.app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    app.screening_transcript = req.transcript
    app.stage = "screened"
    app.screening_status = "completed"
    app.updated_at = datetime.utcnow()
    _log_event(db, app.id, "transcript_received", {"length": len(req.transcript)})
    db.commit()

    return {"status": "transcript_stored", "app_id": app.id}


@router.get("/{app_id}/status")
async def get_screening_status(app_id: int, db: Session = Depends(get_db), session: CurrentSession = Depends(current_session)):
    """Get screening/interview status for an application."""
    app = _hr_app(db, app_id, session)

    # Get latest active link
    latest_link = db.query(InterviewLink).filter(
        InterviewLink.app_id == app_id
    ).order_by(InterviewLink.created_at.desc()).first()

    base_url = os.getenv("FRONTEND_URL", "").rstrip("/")

    return {
        "app_id": app.id,
        "stage": app.stage,
        "screening_status": app.screening_status,
        "interview_link_status": app.interview_link_status,
        "has_transcript": bool(app.screening_transcript),
        "has_evaluation": bool(app.interview_score_json),
        "interview_score": app.interview_score,
        "face_tracking": json.loads(app.interview_face_tracking_json) if app.interview_face_tracking_json else None,
        "latest_link": {
            "token": latest_link.token,
            "status": latest_link.status,
            "interview_url": f"{base_url}/interview/{latest_link.token}",
            "expires_at": latest_link.expires_at.isoformat() if latest_link.expires_at else None,
            "opened_at": latest_link.opened_at.isoformat() if latest_link.opened_at else None,
            "interview_started_at": latest_link.interview_started_at.isoformat() if latest_link.interview_started_at else None,
            "interview_completed_at": latest_link.interview_completed_at.isoformat() if latest_link.interview_completed_at else None,
        } if latest_link else None,
    }


# ═══════════════════════════════════════
# INTERVIEW AUDIO RECORDING
# ═══════════════════════════════════════

@router.get("/{app_id}/audio")
async def get_interview_audio(app_id: int, db: Session = Depends(get_db), session: CurrentSession = Depends(current_session)):
    """Proxy the interview audio recording from ElevenLabs API."""
    app = _hr_app(db, app_id, session)

    # Find the conversation ID from the latest completed interview link
    link = db.query(InterviewLink).filter(
        InterviewLink.app_id == app_id,
        InterviewLink.elevenlabs_conversation_id.isnot(None),
    ).order_by(InterviewLink.created_at.desc()).first()

    if not link or not link.elevenlabs_conversation_id:
        raise HTTPException(status_code=404, detail="No interview recording found. The conversation ID is missing.")

    api_key = os.getenv("ELEVENLABS_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=500, detail="ElevenLabs API key not configured")

    conversation_id = link.elevenlabs_conversation_id

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"https://api.elevenlabs.io/v1/convai/conversations/{conversation_id}/audio",
                headers={"xi-api-key": api_key},
            )
            if resp.status_code != 200:
                raise HTTPException(
                    status_code=resp.status_code,
                    detail=f"ElevenLabs API error: {resp.text[:200]}"
                )

            return StreamingResponse(
                iter([resp.content]),
                media_type="audio/mpeg",
                headers={
                    "Content-Disposition": f'inline; filename="interview_{app_id}_{conversation_id}.mp3"',
                    "Cache-Control": "public, max-age=3600",
                },
            )
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Failed to fetch audio from ElevenLabs: {str(e)}")


# ═══════════════════════════════════════
# ELEVENLABS WEBHOOK (kept for transcript delivery)
# ═══════════════════════════════════════

@router.post("/webhook/elevenlabs")
async def elevenlabs_webhook(request: Request, db: Session = Depends(get_db)):
    """Handle ElevenLabs post-call webhooks."""
    body = await request.body()
    signature = request.headers.get("elevenlabs-signature", "")

    if WEBHOOK_SECRET:
        try:
            expected = hmac.new(
                WEBHOOK_SECRET.encode(), body, hashlib.sha256
            ).hexdigest()
            if not hmac.compare_digest(signature, expected):
                raise HTTPException(status_code=401, detail="Invalid webhook signature")
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=401, detail="Signature verification failed")

    payload = json.loads(body.decode("utf-8"))
    event_type = payload.get("type", "")
    data = payload.get("data", {})

    if event_type == "post_call_transcription":
        conversation_id = data.get("conversation_id", "")
        transcript_turns = data.get("transcript", [])
        metadata = data.get("metadata", {})

        # Format transcript
        transcript_text = ""
        for turn in transcript_turns:
            role = turn.get("role", "unknown").title()
            message = turn.get("message", "")
            time_secs = turn.get("time_in_call_secs", 0)
            transcript_text += f"[{time_secs:.0f}s] {role}: {message}\n"

        # Find application via InterviewLink
        link = db.query(InterviewLink).filter(
            InterviewLink.elevenlabs_conversation_id == conversation_id
        ).first()

        if link:
            app = db.query(Application).filter(Application.id == link.app_id).first()
            if app and not app.screening_transcript:
                # Only store if not already stored by client-side submission
                app.screening_transcript = transcript_text
                app.stage = "screened"
                app.screening_status = "completed"
                app.updated_at = datetime.utcnow()

                _log_event(db, app.id, "webhook_transcript_received", {
                    "conversation_id": conversation_id,
                    "duration_secs": metadata.get("call_duration_secs", 0),
                })

                # Auto-trigger evaluation if not already done
                if not app.interview_score_json:
                    try:
                        job = db.query(Job).filter(Job.id == app.job_id).first()
                        skills = json.loads(job.skills) if job and job.skills else []
                        resume_summary = ""
                        if app.resume_score_json:
                            score_data = json.loads(app.resume_score_json)
                            resume_summary = score_data.get("summary", "")

                        eval_input = InterviewEvaluatorInput(
                            transcript=transcript_text,
                            job_title=job.title if job else "",
                            job_description=job.description if job else "",
                            required_skills=skills,
                            resume_score=app.resume_score or 0,
                            resume_summary=resume_summary,
                        )
                        result = await evaluate_interview(eval_input)

                        app.interview_score = result.score
                        app.interview_score_json = json.dumps({
                            "score": result.score,
                            "decision": result.decision,
                            "strengths": result.strengths,
                            "concerns": result.concerns,
                            "communication_rating": result.communication_rating,
                            "technical_depth": result.technical_depth,
                            "cultural_fit": result.cultural_fit,
                            "email_draft": result.email_draft,
                            "scheduling_slots": result.scheduling_slots,
                            "summary": result.summary,
                        })
                        app.recommendation = result.decision
                        _log_event(db, app.id, "webhook_auto_evaluated", {
                            "score": result.score, "decision": result.decision,
                        })
                    except Exception as e:
                        _log_event(db, app.id, "webhook_auto_evaluate_failed", {"error": str(e)})

                db.commit()

        return {"status": "received", "conversation_id": conversation_id}

    elif event_type == "post_call_audio":
        return {"status": "received", "type": "audio"}

    return {"status": "received"}


# ═══════════════════════════════════════════════════════════════════════════
# Q&A INTERVIEW (LLM-generated written rounds — alternative to voice)
# ═══════════════════════════════════════════════════════════════════════════


def _validate_qa_link(token: str, db: Session):
    """Resolve token → (link, app, job, candidate); raise on common errors.

    Used by all Q&A public endpoints. Returns a 4-tuple.
    """
    link = db.query(InterviewLink).filter(InterviewLink.token == token).first()
    if not link:
        raise HTTPException(status_code=404, detail="Interview link not found")
    if link.expires_at < datetime.utcnow():
        raise HTTPException(status_code=410, detail="Interview link has expired")
    if link.status == "interview_completed":
        raise HTTPException(status_code=410, detail="Interview already completed")

    app = db.query(Application).filter(Application.id == link.app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    job = db.query(Job).filter(Job.id == app.job_id).first()
    candidate = db.query(Candidate).filter(Candidate.id == app.candidate_id).first()
    if not job or not candidate:
        raise HTTPException(status_code=404, detail="Job or candidate missing")
    if (job.interview_mode or "voice") != "qa":
        raise HTTPException(status_code=400, detail="This job is not configured for Q&A interviews")
    return link, app, job, candidate


@router.post("/qa/{token}/start", response_model=QaSessionStartResponse)
async def qa_start(token: str, db: Session = Depends(get_db)):
    """Start (or resume) a Q&A session for the given interview token."""
    link, app, job, candidate = _validate_qa_link(token, db)

    session = db.query(QaSession).filter(QaSession.app_id == app.id).first()

    if not session:
        # Generate question set on first start
        try:
            skills = json.loads(job.skills) if job.skills else []
        except (json.JSONDecodeError, TypeError):
            skills = []

        # Custom interview questions for this job (Feature 4) — required
        # ones get forced into the technical round; optional ones nudge
        # the LLM's prompt.
        from models import JobInterviewQuestion as _JobQ
        custom_q_rows = db.query(_JobQ).filter(
            _JobQ.job_id == job.id,
            _JobQ.tenant_id == app.tenant_id,
        ).order_by(_JobQ.order_index.asc(), _JobQ.id.asc()).all()
        custom_questions_payload = [
            {
                "id": q.id,
                "question_text": q.question_text,
                "question_type": q.question_type or "behavioural",
                "is_required": bool(q.is_required),
                "weight": q.weight or 3,
            }
            for q in custom_q_rows
        ]

        questions = generate_question_set(QaGenerateInput(
            candidate_name=candidate.name,
            resume_text=candidate.resume_text or "",
            job_title=job.title,
            job_description=job.description or "",
            required_skills=skills,
            seniority=job.seniority or "mid",
            custom_questions=custom_questions_payload,
        ))

        session = QaSession(
            app_id=app.id,
            token=token,
            questions_json=json.dumps(questions),
            answers_json=json.dumps({}),
            scores_json=json.dumps({}),
            current_round="aptitude",
        )
        db.add(session)

        # Mark interview started
        if link.status in ("generated", "sent", "opened"):
            link.status = "interview_started"
            link.interview_started_at = datetime.utcnow()
        app.interview_link_status = "interview_started"
        app.screening_status = "in_progress"
        app.ai_next_action = "Q&A interview in progress"
        app.updated_at = datetime.utcnow()
        _log_event(db, app.id, "qa_interview_started", {"token": token})
        db.commit()
        db.refresh(session)

    # Resolve current round (handles resume after partial completion)
    questions_map = json.loads(session.questions_json)
    current = session.current_round if session.current_round in ROUND_ORDER else "aptitude"
    round_index = ROUND_ORDER.index(current) + 1

    company = os.getenv("COMPANY_NAME", "HireOps AI")
    return QaSessionStartResponse(
        token=token,
        candidate_first_name=candidate.name.split()[0] if candidate.name else "",
        job_title=job.title,
        company_name=company,
        current_round=current,
        round_index=round_index,
        total_rounds=len(ROUND_ORDER),
        questions=_questions_for_client(questions_map.get(current, [])),
    )


def _questions_for_client(stored: list) -> list:
    """Strip server-only fields (correct_index) before sending to candidate."""
    out = []
    for q in stored or []:
        if not isinstance(q, dict):
            # Backwards-compat: legacy stored questions were plain strings
            out.append({"text": str(q)})
            continue
        item = {"text": q.get("text", "")}
        if isinstance(q.get("options"), list) and q.get("options"):
            item["options"] = [str(o) for o in q["options"]]
        out.append(item)
    return out


def _compute_fraud_risk(signals_map: dict, face_tracking: dict | None) -> tuple[float, dict]:
    """Combine per-round behavioural signals + face-tracking aggregate into a 0-100 score.

    Heuristic — not a final decision, just a flag for HR review:
      - Each focus-loss event: +5 (capped at 30 from focus alone)
      - Pasted chars: +1 per 50 chars (capped at 30)
      - Face-presence below 80%: scaled penalty up to 25
      - Avg attention below 0.6: scaled penalty up to 15
    """
    focus_loss_count = 0
    paste_chars = 0
    paste_count = 0
    for r in ROUND_ORDER:
        s = signals_map.get(r) or {}
        focus_loss_count += int(s.get("focus_loss_count") or 0)
        paste_chars += int(s.get("paste_chars") or 0)
        paste_count += int(s.get("paste_count") or 0)

    focus_penalty = min(30, focus_loss_count * 5)
    paste_penalty = min(30, paste_chars // 50)

    face_penalty = 0
    attention_penalty = 0
    if face_tracking:
        face_present_pct = float(face_tracking.get("face_present_percentage") or 100)
        if face_present_pct < 80:
            face_penalty = min(25, (80 - face_present_pct) * 1.25)
        attention = float(face_tracking.get("avg_attention_score") or 1.0)
        if attention < 0.6:
            attention_penalty = min(15, (0.6 - attention) * 30)

    score = round(min(100, focus_penalty + paste_penalty + face_penalty + attention_penalty), 1)

    summary = {
        "focus_loss_count": focus_loss_count,
        "paste_count": paste_count,
        "paste_chars": paste_chars,
        "face_present_percentage": float(face_tracking.get("face_present_percentage")) if face_tracking else None,
        "avg_attention_score": float(face_tracking.get("avg_attention_score")) if face_tracking else None,
        "components": {
            "focus": focus_penalty,
            "paste": paste_penalty,
            "face": face_penalty,
            "attention": attention_penalty,
        },
    }
    return score, summary


@router.post("/qa/{token}/submit-round", response_model=QaRoundSubmitResponse)
async def qa_submit_round(token: str, req: QaRoundSubmitRequest, db: Session = Depends(get_db)):
    """Submit answers for the current round; score it; return next round or final."""
    link, app, job, candidate = _validate_qa_link(token, db)

    session = db.query(QaSession).filter(QaSession.app_id == app.id).first()
    if not session:
        raise HTTPException(status_code=400, detail="Q&A session not started — call /start first")

    questions_map = json.loads(session.questions_json)
    answers_map = json.loads(session.answers_json or "{}")
    scores_map = json.loads(session.scores_json or "{}")
    signals_map = json.loads(session.signals_json or "{}")

    if req.round != session.current_round:
        raise HTTPException(
            status_code=400,
            detail=f"Out-of-order round submission: expected {session.current_round}, got {req.round}",
        )

    questions = questions_map.get(req.round, [])
    # Pad/truncate answers to match question count
    answers = list(req.answers)[: len(questions)]
    while len(answers) < len(questions):
        answers.append("")

    try:
        skills = json.loads(job.skills) if job.skills else []
    except (json.JSONDecodeError, TypeError):
        skills = []

    score_result = score_round(QaScoreInput(
        round=req.round,
        questions=questions,
        answers=answers,
        job_title=job.title,
        required_skills=skills,
        resume_text=candidate.resume_text or "",
    ))

    answers_map[req.round] = answers
    scores_map[req.round] = score_result
    if req.signals is not None:
        signals_map[req.round] = req.signals.model_dump()
    session.answers_json = json.dumps(answers_map)
    session.scores_json = json.dumps(scores_map)
    session.signals_json = json.dumps(signals_map)

    # Advance round
    current_idx = ROUND_ORDER.index(req.round)
    next_round = ROUND_ORDER[current_idx + 1] if current_idx + 1 < len(ROUND_ORDER) else None

    _log_event(db, app.id, "qa_round_submitted", {
        "round": req.round,
        "score": score_result.get("score"),
        "focus_loss_count": (req.signals.focus_loss_count if req.signals else 0),
        "paste_count": (req.signals.paste_count if req.signals else 0),
    })

    if next_round:
        session.current_round = next_round
        db.commit()
        return QaRoundSubmitResponse(
            round=req.round,
            round_score=score_result.get("score", 0),
            feedback=score_result.get("feedback", ""),
            next_round=next_round,
            next_questions=_questions_for_client(questions_map.get(next_round, [])),
            completed=False,
        )

    # Final round — aggregate, write back to Application
    final = aggregate_final(scores_map)
    session.current_round = "completed"
    session.final_score = final["final_score"]
    session.final_summary = final["summary"]
    session.completed_at = datetime.utcnow()

    # Compute fraud risk from collected signals + face tracking aggregate (set by face-tracking endpoint)
    face_tracking = None
    if app.interview_face_tracking_json:
        try:
            face_tracking = json.loads(app.interview_face_tracking_json)
        except (json.JSONDecodeError, TypeError):
            face_tracking = None
    fraud_score, fraud_summary = _compute_fraud_risk(signals_map, face_tracking)
    session.fraud_risk_score = fraud_score

    # Aggregate strengths/concerns from per-round scoring so the existing Interview Score
    # panel renders with useful info (mirrors the voice-flow shape).
    aggregated_strengths: list[str] = []
    aggregated_gaps: list[str] = []
    for r in ROUND_ORDER:
        rs = scores_map.get(r) or {}
        for s in (rs.get("strengths") or [])[:3]:
            label = f"[{r.title()}] {s}"
            if label not in aggregated_strengths:
                aggregated_strengths.append(label)
        for g in (rs.get("gaps") or [])[:3]:
            label = f"[{r.title()}] {g}"
            if label not in aggregated_gaps:
                aggregated_gaps.append(label)

    app.interview_score = final["final_score"]
    app.interview_score_json = json.dumps({
        "score": final["final_score"],
        "decision": "pending",  # threshold logic re-derives
        "summary": final["summary"],
        "strengths": aggregated_strengths[:8],
        "concerns": aggregated_gaps[:8],
        "communication_rating": "n/a",
        "technical_depth": "see technical round score",
        "cultural_fit": "n/a",
        "scheduling_slots": [],
        "rounds": scores_map,
        "mode": "qa",
        "fraud_risk_score": fraud_score,
        "signals_summary": fraud_summary,
    })
    app.screening_transcript = _build_transcript_from_qa(questions_map, answers_map)
    app.screening_status = "completed"
    app.interview_link_status = "interview_completed"
    app.stage = "screened"
    app.ai_next_action = (
        f"Q&A interview completed — fraud risk {fraud_score}/100 — awaiting threshold decision"
    )
    app.updated_at = datetime.utcnow()

    link.status = "interview_completed"
    link.interview_completed_at = datetime.utcnow()

    # Compute final_score field used by threshold logic (resume*0.4 + interview*0.6)
    if app.resume_score is not None:
        app.final_score = round(app.resume_score * 0.4 + final["final_score"] * 0.6, 1)
    else:
        app.final_score = final["final_score"]

    decision = _apply_threshold_decision(app, job, db)
    _log_event(db, app.id, "qa_interview_completed", {
        "final_score": final["final_score"],
        "decision": decision.get("decision"),
        "fraud_risk_score": fraud_score,
    })
    db.commit()

    return QaRoundSubmitResponse(
        round=req.round,
        round_score=score_result.get("score", 0),
        feedback=score_result.get("feedback", ""),
        next_round=None,
        next_questions=[],
        completed=True,
        final_score=final["final_score"],
        final_summary=final["summary"],
        fraud_risk_score=fraud_score,
    )


def _build_transcript_from_qa(questions_map: dict, answers_map: dict) -> str:
    parts = []
    for r in ROUND_ORDER:
        qs = questions_map.get(r, [])
        ans = answers_map.get(r, [])
        if not qs:
            continue
        parts.append(f"=== Round: {r.upper()} ===")
        for i, q in enumerate(qs):
            raw = ans[i] if i < len(ans) else ""
            if isinstance(q, dict):
                text = q.get("text", "")
                options = q.get("options")
                parts.append(f"Q{i+1}: {text}")
                if isinstance(options, list) and options:
                    # MCQ: render options + which one was picked vs correct
                    for j, opt in enumerate(options):
                        marker = ""
                        if j == q.get("correct_index"):
                            marker += " (correct)"
                        try:
                            if int(str(raw).strip()) == j:
                                marker += " ← chosen"
                        except (ValueError, TypeError):
                            pass
                        parts.append(f"   {chr(65 + j)}. {opt}{marker}")
                    parts.append(f"A{i+1}: option {raw}" if str(raw).strip() != "" else f"A{i+1}: (no answer)")
                else:
                    # Free-form
                    parts.append(f"A{i+1}: {raw or '(no answer)'}")
            else:
                # Legacy: stored question is a plain string
                parts.append(f"Q{i+1}: {q}")
                parts.append(f"A{i+1}: {raw or '(no answer)'}")
        parts.append("")
    return "\n".join(parts)

