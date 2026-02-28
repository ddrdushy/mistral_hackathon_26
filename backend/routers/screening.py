"""Screening endpoints: start, transcript, evaluate, webhook, retry."""
import json
import os
import hmac
import hashlib
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from database import get_db
from models import Application, Candidate, Job, Event
from schemas import ScreeningStartRequest, ScreeningTranscriptRequest
from agents.voice_screener import start_voice_screening, VoiceScreenerInput
from agents.interview_evaluator import evaluate_interview, InterviewEvaluatorInput

router = APIRouter(prefix="/api/v1/screening", tags=["screening"])

WEBHOOK_SECRET = os.getenv("ELEVENLABS_WEBHOOK_SECRET", "")

# Max retry attempts for failed calls
MAX_SCREENING_ATTEMPTS = 3


def _log_event(db: Session, app_id: int, event_type: str, payload: dict):
    event = Event(app_id=app_id, event_type=event_type, payload=json.dumps(payload))
    db.add(event)


@router.post("/start")
async def start_screening(req: ScreeningStartRequest, db: Session = Depends(get_db)):
    app = db.query(Application).filter(Application.id == req.app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    candidate = db.query(Candidate).filter(Candidate.id == app.candidate_id).first()
    job = db.query(Job).filter(Job.id == app.job_id).first()
    if not candidate or not job:
        raise HTTPException(status_code=404, detail="Candidate or job not found")

    # Check if max attempts exceeded
    if app.screening_attempts >= (app.screening_max_attempts or MAX_SCREENING_ATTEMPTS):
        raise HTTPException(
            status_code=400,
            detail=f"Maximum screening attempts ({app.screening_max_attempts or MAX_SCREENING_ATTEMPTS}) reached. "
                   f"Manually reschedule or update candidate contact info."
        )

    # Get screening questions from resume score
    questions = []
    if app.resume_score_json:
        score_data = json.loads(app.resume_score_json)
        questions = score_data.get("screening_questions", [])
    if not questions:
        questions = [
            f"Tell me about your experience relevant to the {job.title} role",
            "What interests you most about this position?",
            "Describe a challenging project you've worked on recently",
            "How do you handle tight deadlines?",
            "Where do you see yourself in 2 years?",
        ]

    screener_input = VoiceScreenerInput(
        candidate_name=candidate.name,
        candidate_phone=candidate.phone,
        job_title=job.title,
        screening_questions=questions,
    )
    result = await start_voice_screening(screener_input)

    # Update tracking fields
    app.screening_attempts = (app.screening_attempts or 0) + 1
    app.screening_last_attempt_at = datetime.utcnow()

    # If mock mode, store the transcript immediately
    if result.transcript:
        app.screening_transcript = result.transcript
        app.stage = "screened"
        app.screening_status = "completed"
    else:
        app.stage = "screening_scheduled"
        app.screening_status = "scheduled"

    app.screening_failure_reason = None
    app.updated_at = datetime.utcnow()
    _log_event(db, app.id, "screening_started", {
        "status": result.status,
        "conversation_id": result.conversation_id,
        "attempt": app.screening_attempts,
    })
    db.commit()

    return {
        "app_id": app.id,
        "status": result.status,
        "questions": questions,
        "conversation_id": result.conversation_id,
        "attempt": app.screening_attempts,
        "max_attempts": app.screening_max_attempts or MAX_SCREENING_ATTEMPTS,
    }


@router.post("/retry")
async def retry_screening(body: dict, db: Session = Depends(get_db)):
    """Retry a failed screening call."""
    app_id = body.get("app_id")
    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    if app.screening_status not in ("no_answer", "failed", "voicemail", None):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot retry: current screening status is '{app.screening_status}'. "
                   f"Only no_answer, failed, or voicemail can be retried."
        )

    if app.screening_attempts >= (app.screening_max_attempts or MAX_SCREENING_ATTEMPTS):
        raise HTTPException(
            status_code=400,
            detail=f"Maximum attempts ({app.screening_max_attempts or MAX_SCREENING_ATTEMPTS}) reached. "
                   f"Use /screening/reset-attempts to allow more."
        )

    # Reset stage to allow re-scheduling
    app.stage = "matched"
    app.screening_status = None
    app.screening_failure_reason = None
    app.updated_at = datetime.utcnow()
    _log_event(db, app.id, "screening_retry_requested", {
        "previous_attempts": app.screening_attempts,
        "previous_failure": app.screening_failure_reason,
    })
    db.commit()

    # Now start the screening
    req = ScreeningStartRequest(app_id=app_id)
    return await start_screening(req, db)


@router.post("/reset-attempts")
async def reset_screening_attempts(body: dict, db: Session = Depends(get_db)):
    """Reset screening attempts counter (admin action)."""
    app_id = body.get("app_id")
    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    old_attempts = app.screening_attempts
    app.screening_attempts = 0
    app.screening_status = None
    app.screening_failure_reason = None
    app.updated_at = datetime.utcnow()
    _log_event(db, app.id, "screening_attempts_reset", {
        "old_attempts": old_attempts,
    })
    db.commit()

    return {
        "app_id": app.id,
        "status": "reset",
        "screening_attempts": 0,
    }


@router.post("/reschedule")
async def reschedule_screening(body: dict, db: Session = Depends(get_db)):
    """Reschedule a screening call to a specific time slot."""
    app_id = body.get("app_id")
    scheduled_at = body.get("scheduled_at")  # ISO datetime string
    reason = body.get("reason", "Candidate requested reschedule")

    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    # Reset screening state for reschedule (don't increment attempts)
    app.stage = "screening_scheduled"
    app.screening_status = "rescheduled"
    app.screening_failure_reason = None
    app.ai_next_action = f"Screening rescheduled — {reason}"
    app.updated_at = datetime.utcnow()

    _log_event(db, app.id, "screening_rescheduled", {
        "scheduled_at": scheduled_at,
        "reason": reason,
        "attempt": app.screening_attempts or 0,
    })
    db.commit()

    return {
        "app_id": app.id,
        "status": "rescheduled",
        "scheduled_at": scheduled_at,
        "screening_attempts": app.screening_attempts or 0,
    }


@router.post("/transcript")
async def store_transcript(req: ScreeningTranscriptRequest, db: Session = Depends(get_db)):
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


@router.post("/evaluate")
async def evaluate_screening(body: dict, db: Session = Depends(get_db)):
    app_id = body.get("app_id")
    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    if not app.screening_transcript:
        raise HTTPException(status_code=400, detail="No transcript available. Run screening first.")

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


@router.get("/{app_id}/status")
async def get_screening_status(app_id: int, db: Session = Depends(get_db)):
    app = db.query(Application).filter(Application.id == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    has_transcript = bool(app.screening_transcript)
    has_evaluation = bool(app.interview_score_json)
    can_retry = (
        app.screening_status in ("no_answer", "failed", "voicemail", None)
        and (app.screening_attempts or 0) < (app.screening_max_attempts or MAX_SCREENING_ATTEMPTS)
    )

    return {
        "app_id": app.id,
        "stage": app.stage,
        "screening_status": app.screening_status,
        "screening_attempts": app.screening_attempts or 0,
        "screening_max_attempts": app.screening_max_attempts or MAX_SCREENING_ATTEMPTS,
        "screening_failure_reason": app.screening_failure_reason,
        "screening_last_attempt_at": (
            app.screening_last_attempt_at.isoformat()
            if app.screening_last_attempt_at else None
        ),
        "has_transcript": has_transcript,
        "has_evaluation": has_evaluation,
        "interview_score": app.interview_score,
        "can_retry": can_retry,
    }


# ═══════════════════════════════════════
# ELEVENLABS WEBHOOK
# ═══════════════════════════════════════

# Map ElevenLabs failure reasons to our screening statuses
FAILURE_REASON_MAP = {
    "no_answer": "no_answer",
    "busy": "no_answer",
    "voicemail": "voicemail",
    "invalid_number": "failed",
    "network_error": "failed",
    "timeout": "no_answer",
    "rejected": "no_answer",
    "carrier_error": "failed",
}


def _find_app_by_conversation(db: Session, conversation_id: str) -> Application:
    """Find the application linked to an ElevenLabs conversation ID."""
    # First try: look in events for the conversation_id
    if conversation_id:
        events = db.query(Event).filter(
            Event.event_type == "screening_started",
            Event.payload.contains(conversation_id),
        ).order_by(Event.created_at.desc()).all()

        for event in events:
            if event.app_id:
                app = db.query(Application).filter(Application.id == event.app_id).first()
                if app:
                    return app

    # Fallback: most recent screening_scheduled application
    return db.query(Application).filter(
        Application.stage == "screening_scheduled"
    ).order_by(Application.updated_at.desc()).first()


@router.post("/webhook/elevenlabs")
async def elevenlabs_webhook(request: Request, db: Session = Depends(get_db)):
    """Handle ElevenLabs post-call webhooks."""
    body = await request.body()
    signature = request.headers.get("elevenlabs-signature", "")

    # Verify HMAC signature if webhook secret is configured
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

    # ─── SUCCESSFUL CALL: Got transcript ───
    if event_type == "post_call_transcription":
        conversation_id = data.get("conversation_id", "")
        transcript_turns = data.get("transcript", [])
        analysis = data.get("analysis", {})
        metadata = data.get("metadata", {})
        call_successful = analysis.get("call_successful", True)
        call_duration = metadata.get("call_duration_secs", 0)

        # Format transcript
        transcript_text = ""
        for turn in transcript_turns:
            role = turn.get("role", "unknown").title()
            message = turn.get("message", "")
            time_secs = turn.get("time_in_call_secs", 0)
            transcript_text += f"[{time_secs:.0f}s] {role}: {message}\n"

        app = _find_app_by_conversation(db, conversation_id)

        if app:
            # Check if this was a very short call (likely voicemail/no real conversation)
            if call_duration < 15 and not call_successful:
                app.screening_status = "no_answer"
                app.screening_failure_reason = "Call too short — candidate may not have answered"
                app.ai_next_action = f"Retry screening (attempt {(app.screening_attempts or 0)}/{app.screening_max_attempts or MAX_SCREENING_ATTEMPTS})"
                _log_event(db, app.id, "screening_no_answer", {
                    "conversation_id": conversation_id,
                    "duration_secs": call_duration,
                    "call_successful": False,
                    "attempt": app.screening_attempts,
                })
            else:
                # Real conversation happened
                app.screening_transcript = transcript_text
                app.stage = "screened"
                app.screening_status = "completed"
                app.screening_failure_reason = None
                _log_event(db, app.id, "webhook_transcript_received", {
                    "conversation_id": conversation_id,
                    "duration_secs": call_duration,
                    "call_successful": call_successful,
                    "summary": analysis.get("transcript_summary", ""),
                    "attempt": app.screening_attempts,
                })

                # Auto-trigger evaluation
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
                    app.ai_next_action = (
                        "Schedule in-person interview" if result.decision == "advance"
                        else "Place on hold for review" if result.decision == "hold"
                        else "Send rejection email"
                    )
                    _log_event(db, app.id, "auto_evaluated", {
                        "interview_score": result.score,
                        "decision": result.decision,
                    })
                except Exception as e:
                    _log_event(db, app.id, "auto_evaluate_failed", {"error": str(e)})

            app.updated_at = datetime.utcnow()
            db.commit()

        return {"status": "received", "conversation_id": conversation_id}

    # ─── AUDIO (optional) ───
    elif event_type == "post_call_audio":
        return {"status": "received", "type": "audio"}

    # ─── CALL FAILED TO CONNECT ───
    elif event_type == "call_initiation_failure":
        conversation_id = data.get("conversation_id", "")
        failure_reason = data.get("failure_reason", "unknown")
        error_message = data.get("error_message", "")

        # Map ElevenLabs failure reason to our status
        screening_status = FAILURE_REASON_MAP.get(failure_reason, "failed")
        human_reason = {
            "no_answer": "Candidate did not answer the call",
            "busy": "Candidate's line was busy",
            "voicemail": "Call went to voicemail",
            "invalid_number": "Phone number is invalid or disconnected",
            "network_error": "Network error during call",
            "timeout": "Call timed out — no response",
            "rejected": "Call was rejected/declined",
            "carrier_error": "Carrier/network error",
        }.get(failure_reason, f"Call failed: {failure_reason}")

        app = _find_app_by_conversation(db, conversation_id)

        if app:
            app.screening_status = screening_status
            app.screening_failure_reason = human_reason
            app.updated_at = datetime.utcnow()

            attempts = app.screening_attempts or 0
            max_attempts = app.screening_max_attempts or MAX_SCREENING_ATTEMPTS
            remaining = max_attempts - attempts

            if remaining > 0:
                app.ai_next_action = f"Retry screening call ({remaining} attempts remaining)"
            else:
                app.ai_next_action = "Maximum call attempts reached — contact candidate via email"
                # If we exhausted all attempts on no_answer, suggest email outreach
                if screening_status in ("no_answer", "voicemail"):
                    app.stage = "matched"  # Reset to matched so recruiter can decide
                    app.screening_status = "exhausted"
                    app.screening_failure_reason = (
                        f"Candidate unreachable after {max_attempts} attempts. "
                        f"Last reason: {human_reason}"
                    )

            _log_event(db, app.id, "screening_call_failed", {
                "conversation_id": conversation_id,
                "failure_reason": failure_reason,
                "error_message": error_message,
                "human_reason": human_reason,
                "attempt": attempts,
                "remaining_attempts": remaining,
            })
            db.commit()

        return {
            "status": "received",
            "failure_reason": failure_reason,
            "screening_status": screening_status,
        }

    return {"status": "received"}
