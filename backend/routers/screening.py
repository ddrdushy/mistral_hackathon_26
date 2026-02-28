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
    """Mark an interview link as sent to the candidate."""
    token = body.get("token")
    link = db.query(InterviewLink).filter(InterviewLink.token == token).first()
    if not link:
        raise HTTPException(status_code=404, detail="Interview link not found")

    link.status = "sent"
    app = db.query(Application).filter(Application.id == link.app_id).first()
    if app:
        app.interview_link_status = "sent"
        app.ai_next_action = "Interview link sent — waiting for candidate"
        app.updated_at = datetime.utcnow()

    _log_event(db, link.app_id, "interview_link_sent", {"token": token})
    db.commit()

    return {"status": "sent", "token": token}


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

    return InterviewLinkPublicResponse(
        token=token,
        status=link.status,
        candidate_first_name=candidate.name.split()[0] if candidate else "",
        job_title=job.title if job else "",
        company_name=company,
        elevenlabs_agent_id=agent_id,
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
        app.recommendation = result.decision
        app.ai_next_action = (
            "Schedule in-person interview" if result.decision == "advance"
            else "Place on hold for review" if result.decision == "hold"
            else "Send rejection email"
        )
        _log_event(db, app.id, "interview_auto_evaluated", {
            "score": result.score,
            "decision": result.decision,
        })
        evaluation_result = {"score": result.score, "decision": result.decision}
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
    app.ai_next_action = (
        "Schedule in-person interview" if result.decision == "advance"
        else "Place on hold for review" if result.decision == "hold"
        else "Send rejection email"
    )
    app.updated_at = datetime.utcnow()
    _log_event(db, app.id, "evaluated", {"interview_score": result.score, "decision": result.decision})
    db.commit()
    db.refresh(app)

    return {
        "app_id": app.id,
        "interview_score": result.score,
        "decision": result.decision,
        "strengths": result.strengths,
        "concerns": result.concerns,
        "email_draft": result.email_draft,
        "scheduling_slots": result.scheduling_slots,
        "summary": result.summary,
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
