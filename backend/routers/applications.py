"""Applications endpoints: match, list, update stage, CSV export."""
from typing import Optional
import json
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from sqlalchemy import or_
from database import get_db
import os
from models import Application, Candidate, Job, Event, InterviewLink, QaSession
from schemas import (
    ApplicationMatchRequest, ApplicationStageUpdate, ApplicationNotesUpdate,
    BulkStageUpdate,
)
from agents.resume_scorer import score_resume, ResumeScorerInput
from services.csv_service import generate_applications_csv
from auth.dependencies import current_session, CurrentSession
from billing.cost_guard import check_llm_budget

router = APIRouter(prefix="/api/v1/applications", tags=["applications"])


def _qa_fraud_risk(app: Application, db: Session) -> Optional[float]:
    session = db.query(QaSession).filter(QaSession.app_id == app.id).first()
    return session.fraud_risk_score if session else None


def _qa_signals_summary(app: Application, db: Session) -> Optional[dict]:
    """Per-round behavioural signals + the components used to compute the risk score."""
    session = db.query(QaSession).filter(QaSession.app_id == app.id).first()
    if not session or not session.signals_json:
        return None
    try:
        signals = json.loads(session.signals_json)
    except (json.JSONDecodeError, TypeError):
        return None
    # Surface a summary if it's been computed and stored on interview_score_json
    summary_block = None
    if app.interview_score_json:
        try:
            iv = json.loads(app.interview_score_json)
            summary_block = iv.get("signals_summary")
        except (json.JSONDecodeError, TypeError):
            summary_block = None
    return {"per_round": signals, "summary": summary_block}


def _get_interview_room_url(app: Application, db: Session) -> Optional[str]:
    """Look up the latest active Round 2 interview link for this application."""
    link = db.query(InterviewLink).filter(
        InterviewLink.app_id == app.id,
        InterviewLink.round == 2,
        InterviewLink.status != "expired",
    ).order_by(InterviewLink.created_at.desc()).first()
    if link:
        base_url = os.getenv("FRONTEND_URL", "https://dushy2009-hireops-ai.hf.space")
        return "%s/interview/%s" % (base_url, link.token)
    return None


def _app_to_response(app: Application, db: Session) -> dict:
    candidate = db.query(Candidate).filter(Candidate.id == app.candidate_id).first()
    job = db.query(Job).filter(Job.id == app.job_id).first()
    return {
        "id": app.id,
        "candidate_id": app.candidate_id,
        "candidate_name": candidate.name if candidate else "",
        "candidate_email": candidate.email if candidate else "",
        "candidate_phone": candidate.phone if candidate else "",
        "job_id": app.job_id,
        "job_title": job.title if job else "",
        "job_code": job.job_id if job else "",
        "stage": app.stage,
        "resume_score": app.resume_score,
        "interview_score": app.interview_score,
        "recommendation": app.recommendation,
        "ai_next_action": app.ai_next_action,
        "ai_snippets": json.loads(app.ai_snippets) if app.ai_snippets else None,
        "screening_transcript": app.screening_transcript,
        "screening_status": app.screening_status,
        "screening_attempts": app.screening_attempts or 0,
        "screening_max_attempts": app.screening_max_attempts or 3,
        "screening_failure_reason": app.screening_failure_reason,
        "screening_last_attempt_at": (
            app.screening_last_attempt_at.isoformat()
            if app.screening_last_attempt_at else None
        ),
        "resume_score_json": json.loads(app.resume_score_json) if app.resume_score_json else None,
        "interview_score_json": json.loads(app.interview_score_json) if app.interview_score_json else None,
        "interview_link_status": app.interview_link_status,
        "interview_face_tracking_json": json.loads(app.interview_face_tracking_json) if app.interview_face_tracking_json else None,
        "qa_fraud_risk_score": _qa_fraud_risk(app, db),
        "qa_signals_summary": _qa_signals_summary(app, db),
        "scheduled_interview_at": app.scheduled_interview_at.isoformat() if app.scheduled_interview_at else None,
        "scheduled_interview_slot": app.scheduled_interview_slot,
        "email_draft_sent": app.email_draft_sent or 0,
        "final_score": app.final_score,
        "final_summary": app.final_summary,
        "interview_room_url": _get_interview_room_url(app, db),
        "thresholds": {
            "resume_min": job.resume_threshold_min if job and job.resume_threshold_min is not None else 80.0,
            "interview_min": job.interview_threshold_min if job and job.interview_threshold_min is not None else 75.0,
            "reject_below": job.final_threshold_reject if job and job.final_threshold_reject is not None else 50.0,
        } if job else {"resume_min": 80.0, "interview_min": 75.0, "reject_below": 50.0},
        "created_at": app.created_at.isoformat() if app.created_at else None,
        "updated_at": app.updated_at.isoformat() if app.updated_at else None,
    }


def _log_event(db: Session, app_id: int, event_type: str, payload: dict, tenant_id: int | None = None):
    event = Event(
        app_id=app_id,
        event_type=event_type,
        payload=json.dumps(payload),
        tenant_id=tenant_id,
    )
    db.add(event)


@router.post("/match")
async def match_candidate_to_job(
    req: ApplicationMatchRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    check_llm_budget()
    candidate = db.query(Candidate).filter(
        Candidate.id == req.candidate_id,
        Candidate.tenant_id == session.tenant.id,
    ).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    job = db.query(Job).filter(
        Job.id == req.job_id,
        Job.tenant_id == session.tenant.id,
    ).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Check for existing application
    existing = db.query(Application).filter(
        Application.candidate_id == req.candidate_id,
        Application.job_id == req.job_id,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Application already exists for this candidate-job pair")

    skills = json.loads(job.skills) if job.skills else []
    responsibilities = json.loads(job.responsibilities) if job.responsibilities else []
    scorer_input = ResumeScorerInput(
        resume_text=candidate.resume_text,
        job_id=job.job_id,
        job_title=job.title,
        job_description=job.description,
        must_have_skills=skills,
        nice_to_have_skills=[],
        seniority=job.seniority,
        responsibilities=responsibilities,
    )
    score_result = await score_resume(scorer_input)

    application = Application(
        tenant_id=session.tenant.id,
        candidate_id=candidate.id,
        job_id=job.id,
        stage="matched",
        resume_score=score_result.score,
        resume_score_json=json.dumps({
            "score": score_result.score,
            "evidence": score_result.evidence,
            "gaps": score_result.gaps,
            "risks": score_result.risks,
            "recommendation": score_result.recommendation,
            "screening_questions": score_result.screening_questions,
            "summary": score_result.summary,
        }),
        recommendation=score_result.recommendation,
        ai_next_action="Schedule voice screening" if score_result.recommendation == "advance"
                       else "Review manually" if score_result.recommendation == "hold"
                       else "Send rejection email",
        ai_snippets=json.dumps({
            "why_shortlisted": score_result.why_shortlisted,
            "key_strengths": score_result.key_strengths,
            "main_gaps": score_result.main_gaps,
            "interview_focus": score_result.interview_focus,
        }),
    )
    db.add(application)
    db.commit()
    db.refresh(application)

    _log_event(db, application.id, "matched", {"resume_score": score_result.score, "recommendation": score_result.recommendation}, tenant_id=session.tenant.id)
    db.commit()

    return {
        "application": _app_to_response(application, db),
        "resume_score_details": {
            "score": score_result.score,
            "evidence": score_result.evidence,
            "gaps": score_result.gaps,
            "risks": score_result.risks,
            "recommendation": score_result.recommendation,
            "screening_questions": score_result.screening_questions,
            "summary": score_result.summary,
        },
    }


@router.get("")
async def list_applications(
    job_id: Optional[int] = None,
    stage: Optional[str] = None,
    min_score: Optional[float] = None,
    max_score: Optional[float] = None,
    search: Optional[str] = None,
    sort_by: str = "updated_at",
    order: str = "desc",
    page: int = 1,
    per_page: int = 20,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    query = db.query(Application).filter(Application.tenant_id == session.tenant.id)

    if job_id:
        query = query.filter(Application.job_id == job_id)
    if stage:
        stages = stage.split(",")
        query = query.filter(Application.stage.in_(stages))
    if min_score is not None:
        query = query.filter(Application.resume_score >= min_score)
    if max_score is not None:
        query = query.filter(Application.resume_score <= max_score)
    if search:
        candidate_ids = db.query(Candidate.id).filter(
            or_(
                Candidate.name.ilike(f"%{search}%"),
                Candidate.email.ilike(f"%{search}%"),
            )
        ).all()
        candidate_id_list = [c[0] for c in candidate_ids]
        query = query.filter(Application.candidate_id.in_(candidate_id_list))

    total = query.count()

    sort_column = getattr(Application, sort_by, Application.updated_at)
    if order == "asc":
        query = query.order_by(sort_column.asc())
    else:
        query = query.order_by(sort_column.desc())

    applications = query.offset((page - 1) * per_page).limit(per_page).all()

    return {
        "applications": [_app_to_response(a, db) for a in applications],
        "total": total,
        "page": page,
        "per_page": per_page,
    }


@router.get("/export/csv")
async def export_csv(
    job_id: Optional[int] = None,
    stage: Optional[str] = None,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    query = db.query(Application).filter(Application.tenant_id == session.tenant.id)
    if job_id:
        query = query.filter(Application.job_id == job_id)
    if stage:
        stages = stage.split(",")
        query = query.filter(Application.stage.in_(stages))

    applications = query.all()
    app_dicts = [_app_to_response(a, db) for a in applications]
    csv_content = generate_applications_csv(app_dicts)

    return StreamingResponse(
        iter([csv_content]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=applications_export.csv"},
    )


@router.get("/{app_id}")
async def get_application(
    app_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    app = db.query(Application).filter(
        Application.id == app_id,
        Application.tenant_id == session.tenant.id,
    ).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    return _app_to_response(app, db)


@router.patch("/{app_id}/stage")
async def update_stage(
    app_id: int,
    req: ApplicationStageUpdate,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    app = db.query(Application).filter(
        Application.id == app_id,
        Application.tenant_id == session.tenant.id,
    ).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    old_stage = app.stage
    app.stage = req.stage
    app.updated_at = datetime.utcnow()

    _log_event(db, app.id, "stage_changed", {"from": old_stage, "to": req.stage}, tenant_id=session.tenant.id)
    db.commit()
    db.refresh(app)
    return _app_to_response(app, db)


@router.post("/{app_id}/rescore")
async def rescore_application(
    app_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Re-extract resume text from the source email and re-run the scorer.

    Use this on applications that scored 0/100 because the email arrived
    before the IMAP fetcher persisted attachment bytes. Pulls fresh resume
    text out of the (now refreshed) email attachments and writes a new
    resume_score / recommendation.
    """
    check_llm_budget()
    app = db.query(Application).filter(
        Application.id == app_id,
        Application.tenant_id == session.tenant.id,
    ).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    candidate = db.query(Candidate).filter(Candidate.id == app.candidate_id).first()
    job = db.query(Job).filter(Job.id == app.job_id).first()
    if not candidate or not job:
        raise HTTPException(status_code=404, detail="Candidate or job missing")

    # Re-extract resume text from the source email's attachments. The IMAP
    # listener's next sync should have refreshed content_b64 — if it hasn't,
    # we fall back to whatever resume_text already exists on the candidate.
    from models import Email
    em = db.query(Email).filter(Email.id == candidate.source_email_id).first()
    if em:
        atts = json.loads(em.attachments) if em.attachments else []
        for att in atts:
            content_b64 = att.get("content_b64", "")
            filename = att.get("filename", "")
            if content_b64 and filename.lower().endswith(('.pdf', '.docx', '.doc', '.txt', '.tex')):
                try:
                    import base64
                    from services.resume_service import extract_resume_text
                    file_bytes = base64.b64decode(content_b64)
                    new_text = extract_resume_text(filename, file_bytes=file_bytes)
                    if new_text and new_text.strip():
                        candidate.resume_text = new_text
                        candidate.resume_filename = filename
                        db.commit()
                        break
                except Exception:
                    pass

    if not candidate.resume_text or not candidate.resume_text.strip():
        raise HTTPException(
            status_code=400,
            detail="No resume text available — wait for the next mailbox sync to refresh attachments, then try again",
        )

    skills = json.loads(job.skills) if job.skills else []
    responsibilities = json.loads(job.responsibilities) if job.responsibilities else []
    scorer_input = ResumeScorerInput(
        resume_text=candidate.resume_text,
        job_id=job.job_id,
        job_title=job.title,
        job_description=job.description,
        must_have_skills=skills,
        nice_to_have_skills=[],
        seniority=job.seniority,
        responsibilities=responsibilities,
    )
    score_result = await score_resume(scorer_input)

    app.resume_score = score_result.score
    app.resume_score_json = json.dumps({
        "score": score_result.score,
        "evidence": score_result.evidence,
        "gaps": score_result.gaps,
        "risks": score_result.risks,
        "recommendation": score_result.recommendation,
        "screening_questions": score_result.screening_questions,
        "summary": score_result.summary,
    })
    app.recommendation = score_result.recommendation
    app.ai_snippets = json.dumps({
        "why_shortlisted": score_result.why_shortlisted,
        "key_strengths": score_result.key_strengths,
        "main_gaps": score_result.main_gaps,
        "interview_focus": score_result.interview_focus,
    })
    app.updated_at = datetime.utcnow()
    _log_event(
        db, app.id, "rescored",
        {"resume_score": score_result.score, "recommendation": score_result.recommendation},
        tenant_id=session.tenant.id,
    )
    db.commit()
    db.refresh(app)
    return _app_to_response(app, db)


@router.patch("/{app_id}/notes")
async def update_application_notes(
    app_id: int,
    req: ApplicationNotesUpdate,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    app = db.query(Application).filter(
        Application.id == app_id,
        Application.tenant_id == session.tenant.id,
    ).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    candidate = db.query(Candidate).filter(
        Candidate.id == app.candidate_id,
        Candidate.tenant_id == session.tenant.id,
    ).first()
    if candidate:
        candidate.notes = req.notes
        candidate.updated_at = datetime.utcnow()

    app.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(app)
    return _app_to_response(app, db)


@router.post("/bulk/stage")
async def bulk_update_stage(
    req: BulkStageUpdate,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    updated = 0
    for app_id in req.application_ids:
        app = db.query(Application).filter(
            Application.id == app_id,
            Application.tenant_id == session.tenant.id,
        ).first()
        if app:
            old_stage = app.stage
            app.stage = req.stage
            app.updated_at = datetime.utcnow()
            _log_event(db, app.id, "stage_changed", {"from": old_stage, "to": req.stage}, tenant_id=session.tenant.id)
            updated += 1

    db.commit()
    return {"updated": updated}
