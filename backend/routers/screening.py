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
from models import Application, Candidate, Job, Event, InterviewLink
from schemas import (
    InterviewLinkGenerateRequest, InterviewLinkResponse,
    InterviewLinkPublicResponse, InterviewStatusUpdateRequest,
    FaceTrackingDataRequest, InterviewTranscriptSubmitRequest,
    ScreeningTranscriptRequest,
)
from agents.interview_evaluator import evaluate_interview, InterviewEvaluatorInput

router = APIRouter(prefix="/api/v1/screening", tags=["screening"])

WEBHOOK_SECRET = os.getenv("ELEVENLABS_WEBHOOK_SECRET", "")


def _log_event(db: Session, app_id: int, event_type: str, payload: dict):
    event = Event(app_id=app_id, event_type=event_type, payload=json.dumps(payload))
    db.add(event)


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
async def generate_interview_link(req: InterviewLinkGenerateRequest, db: Session = Depends(get_db)):
    """Generate a unique interview link for an application."""
    app = db.query(Application).filter(Application.id == req.app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    # Expire any existing active links for this application
    db.query(InterviewLink).filter(
        InterviewLink.app_id == req.app_id,
        InterviewLink.status.in_(["generated", "sent", "opened"])
    ).update({"status": "expired"}, synchronize_session="fetch")

    token = uuid.uuid4().hex
    link = InterviewLink(
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

    _log_event(db, app.id, "interview_link_generated", {"token": token, "expires_hours": req.expires_hours})
    db.commit()
    db.refresh(link)

    base_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
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
async def send_interview_link(body: dict, db: Session = Depends(get_db)):
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

    base_url = os.getenv("FRONTEND_URL", "http://localhost:3000")
    interview_url = f"{base_url}/interview/{token}"
    company = os.getenv("COMPANY_NAME", "HireOps AI")

    # Send the actual email
    from services.smtp_service import send_interview_link_email
    result = send_interview_link_email(
        to_email=candidate.email,
        candidate_name=candidate.name.split()[0],
        job_title=job.title if job else "Open Position",
        company_name=company,
        interview_url=interview_url,
    )

    if result["success"]:
        link.status = "sent"
        app.interview_link_status = "sent"
        app.ai_next_action = "Interview link emailed to candidate — waiting for response"
        app.updated_at = datetime.utcnow()
        _log_event(db, link.app_id, "interview_link_emailed", {
            "token": token,
            "to_email": candidate.email,
        })
        db.commit()
        return {"status": "sent", "token": token, "email_sent": True, "to": candidate.email}
    else:
        # Mark as sent (status) even if email fails — recruiter can copy link
        link.status = "sent"
        app.interview_link_status = "sent"
        app.updated_at = datetime.utcnow()
        db.commit()
        return {"status": "sent", "token": token, "email_sent": False, "error": result["message"]}


@router.post("/{app_id}/send-rejection")
async def send_rejection_email(app_id: int, db: Session = Depends(get_db)):
    """Send rejection email to candidate."""
    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

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
        _log_event(db, app.id, "rejection_email_sent", {"to_email": candidate.email})
        db.commit()

    return result


@router.post("/{app_id}/send-email")
async def send_custom_email_endpoint(app_id: int, body: dict, db: Session = Depends(get_db)):
    """Send a custom email to candidate (e.g., AI-generated follow-up draft)."""
    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

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
async def book_interview_slot(app_id: int, body: dict, db: Session = Depends(get_db)):
    """Book an interview time slot and auto-send scheduling email to candidate."""
    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    slot = body.get("slot", "")
    if not slot:
        raise HTTPException(status_code=400, detail="Slot is required")

    candidate = db.query(Candidate).filter(Candidate.id == app.candidate_id).first()
    job = db.query(Job).filter(Job.id == app.job_id).first()

    if not candidate or not candidate.email:
        raise HTTPException(status_code=400, detail="Candidate email not found")

    # Store the booked slot
    app.scheduled_interview_slot = slot
    app.stage = "shortlisted"
    app.ai_next_action = f"In-person interview scheduled: {slot}"
    app.updated_at = datetime.utcnow()

    _log_event(db, app.id, "interview_slot_booked", {"slot": slot})

    # Auto-send scheduling email
    email_result = {"success": False, "message": "Not attempted"}
    try:
        company = os.getenv("COMPANY_NAME", "HireOps AI")
        email_draft = ""
        if app.interview_score_json:
            score_data = json.loads(app.interview_score_json)
            email_draft = score_data.get("email_draft", "")

        from services.smtp_service import send_scheduling_email
        email_result = send_scheduling_email(
            to_email=candidate.email,
            candidate_name=candidate.name.split()[0],
            job_title=job.title if job else "Open Position",
            company_name=company,
            slot=slot,
            email_draft=email_draft,
        )
        if email_result["success"]:
            app.email_draft_sent = 1
            _log_event(db, app.id, "scheduling_email_sent", {
                "to_email": candidate.email,
                "slot": slot,
            })
    except Exception as e:
        email_result = {"success": False, "message": str(e)}

    db.commit()

    return {
        "status": "booked",
        "slot": slot,
        "email_sent": email_result.get("success", False),
        "email_message": email_result.get("message", ""),
    }


@router.post("/{app_id}/send-draft")
async def send_email_draft(app_id: int, db: Session = Depends(get_db)):
    """Send the AI-generated email draft to the candidate."""
    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

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
async def calculate_final_score(app_id: int, db: Session = Depends(get_db)):
    """Calculate a combined final score from resume + interview using LLM."""
    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

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
    })

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


@router.get("/{app_id}/links")
async def get_application_links(app_id: int, db: Session = Depends(get_db)):
    """Get all interview links for an application."""
    links = db.query(InterviewLink).filter(
        InterviewLink.app_id == app_id
    ).order_by(InterviewLink.created_at.desc()).all()

    base_url = os.getenv("FRONTEND_URL", "http://localhost:3000")

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

    return InterviewLinkPublicResponse(
        token=token,
        status=link.status,
        candidate_first_name=candidate.name.split()[0] if candidate else "",
        job_title=job.title if job else "",
        job_code=job.job_id if job else "",
        company_name=company,
        elevenlabs_agent_id=agent_id,
        screening_questions=screening_questions,
        is_valid=True,
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
async def evaluate_screening(body: dict, db: Session = Depends(get_db)):
    """Manually trigger evaluation of an existing transcript."""
    app_id = body.get("app_id")
    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

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
    })
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
async def store_transcript(req: ScreeningTranscriptRequest, db: Session = Depends(get_db)):
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
async def get_screening_status(app_id: int, db: Session = Depends(get_db)):
    """Get screening/interview status for an application."""
    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    # Get latest active link
    latest_link = db.query(InterviewLink).filter(
        InterviewLink.app_id == app_id
    ).order_by(InterviewLink.created_at.desc()).first()

    base_url = os.getenv("FRONTEND_URL", "http://localhost:3000")

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
async def get_interview_audio(app_id: int, db: Session = Depends(get_db)):
    """Proxy the interview audio recording from ElevenLabs API."""
    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

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
