"""Reports endpoints: funnel, top candidates, summary."""
from typing import Optional
import json
from sqlalchemy import func
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from database import get_db
from models import Application, Candidate, Job, Event

router = APIRouter(prefix="/api/v1/reports", tags=["reports"])

PIPELINE_STAGES = [
    "new", "classified", "matched",
    "screening_scheduled", "screened",
    "shortlisted", "rejected",
]


@router.get("/funnel")
async def get_funnel(job_id: Optional[int] = None, db: Session = Depends(get_db)):
    query = db.query(Application.stage, func.count(Application.id))
    if job_id:
        query = query.filter(Application.job_id == job_id)
    stage_counts = query.group_by(Application.stage).all()

    count_map = {stage: count for stage, count in stage_counts}
    total = sum(count_map.values())

    stages = []
    for stage in PIPELINE_STAGES:
        count = count_map.get(stage, 0)
        stages.append({
            "stage": stage,
            "count": count,
            "percentage": round((count / total * 100) if total > 0 else 0, 1),
        })

    job_title = None
    if job_id:
        job = db.query(Job).filter(Job.id == job_id).first()
        job_title = job.title if job else None

    return {
        "job_id": job_id,
        "job_title": job_title,
        "stages": stages,
        "total": total,
    }


@router.get("/top-candidates")
async def get_top_candidates(
    job_id: Optional[int] = None,
    limit: int = 10,
    db: Session = Depends(get_db),
):
    query = db.query(Application).filter(Application.resume_score.isnot(None))
    if job_id:
        query = query.filter(Application.job_id == job_id)

    applications = query.order_by(Application.resume_score.desc()).limit(limit).all()

    candidates = []
    for app in applications:
        candidate = db.query(Candidate).filter(Candidate.id == app.candidate_id).first()
        job = db.query(Job).filter(Job.id == app.job_id).first()

        resume_score = app.resume_score or 0
        interview_score = app.interview_score or 0
        combined = resume_score * 0.6 + interview_score * 0.4 if app.interview_score else resume_score

        candidates.append({
            "candidate_id": candidate.id if candidate else 0,
            "candidate_name": candidate.name if candidate else "",
            "candidate_email": candidate.email if candidate else "",
            "job_title": job.title if job else "",
            "job_code": job.job_id if job else "",
            "resume_score": app.resume_score,
            "interview_score": app.interview_score,
            "combined_score": round(combined, 1),
            "recommendation": app.recommendation,
            "stage": app.stage,
        })

    return {"candidates": candidates}


@router.get("/summary")
async def get_summary(db: Session = Depends(get_db)):
    total_jobs = db.query(Job).count()
    total_candidates = db.query(Candidate).count()
    total_applications = db.query(Application).count()
    active_screenings = db.query(Application).filter(
        Application.stage.in_(["screening_scheduled", "screened"])
    ).count()
    shortlisted_count = db.query(Application).filter(Application.stage == "shortlisted").count()
    rejected_count = db.query(Application).filter(Application.stage == "rejected").count()

    avg_score_result = db.query(func.avg(Application.resume_score)).filter(
        Application.resume_score.isnot(None)
    ).scalar()
    avg_resume_score = round(float(avg_score_result), 1) if avg_score_result else 0.0

    # Stage distribution
    stage_counts = db.query(
        Application.stage, func.count(Application.id)
    ).group_by(Application.stage).all()
    count_map = {stage: count for stage, count in stage_counts}
    total_in_pipeline = sum(count_map.values())

    stage_distribution = []
    for stage in PIPELINE_STAGES:
        count = count_map.get(stage, 0)
        stage_distribution.append({
            "stage": stage,
            "count": count,
            "percentage": round((count / total_in_pipeline * 100) if total_in_pipeline > 0 else 0, 1),
        })

    # Top 5 candidates
    top_apps = db.query(Application).filter(
        Application.resume_score.isnot(None)
    ).order_by(Application.resume_score.desc()).limit(5).all()

    top_candidates = []
    for app in top_apps:
        candidate = db.query(Candidate).filter(Candidate.id == app.candidate_id).first()
        job = db.query(Job).filter(Job.id == app.job_id).first()
        resume_score = app.resume_score or 0
        interview_score = app.interview_score or 0
        combined = resume_score * 0.6 + interview_score * 0.4 if app.interview_score else resume_score

        top_candidates.append({
            "candidate_id": candidate.id if candidate else 0,
            "candidate_name": candidate.name if candidate else "",
            "candidate_email": candidate.email if candidate else "",
            "job_title": job.title if job else "",
            "job_code": job.job_id if job else "",
            "resume_score": app.resume_score,
            "interview_score": app.interview_score,
            "combined_score": round(combined, 1),
            "recommendation": app.recommendation,
            "stage": app.stage,
        })

    return {
        "total_jobs": total_jobs,
        "total_candidates": total_candidates,
        "total_applications": total_applications,
        "active_screenings": active_screenings,
        "avg_resume_score": avg_resume_score,
        "shortlisted_count": shortlisted_count,
        "rejected_count": rejected_count,
        "stage_distribution": stage_distribution,
        "top_candidates": top_candidates,
    }


@router.get("/activity")
async def get_recent_activity(limit: int = 20, db: Session = Depends(get_db)):
    events = db.query(Event).order_by(Event.created_at.desc()).limit(limit).all()

    activity = []
    for event in events:
        app = db.query(Application).filter(Application.id == event.app_id).first() if event.app_id else None
        candidate_name = ""
        if app:
            candidate = db.query(Candidate).filter(Candidate.id == app.candidate_id).first()
            candidate_name = candidate.name if candidate else ""

        activity.append({
            "id": event.id,
            "event_type": event.event_type,
            "payload": json.loads(event.payload) if event.payload else {},
            "candidate_name": candidate_name,
            "app_id": event.app_id,
            "created_at": event.created_at.isoformat() if event.created_at else None,
        })

    return {"activity": activity}
