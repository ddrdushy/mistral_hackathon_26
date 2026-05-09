"""Jobs CRUD endpoints."""
from typing import Optional
import json
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import get_db
from models import Job, Application
from schemas import JobCreate, JobUpdate, JobResponse, JobListResponse
from agents.job_generator import generate_job_details
from auth.dependencies import current_session, CurrentSession
from billing.plans import check_quota
from billing.cost_guard import check_llm_budget
from billing.plans import gate_agent

router = APIRouter(prefix="/api/v1/jobs", tags=["jobs"])


class JobGenerateRequest(BaseModel):
    title: str


@router.post("/generate")
async def generate_job(
    req: JobGenerateRequest,
    session: CurrentSession = Depends(current_session),
):
    """Use Mistral AI to auto-generate job posting details from a title."""
    gate_agent(session.tenant, "job_generator")
    check_llm_budget()
    if not req.title.strip():
        raise HTTPException(status_code=400, detail="Title is required")
    result = await generate_job_details(req.title.strip())
    result["title"] = req.title.strip()
    return result


def _generate_job_id(db: Session, tenant_id: int) -> str:
    """Build the next JOB-YYYY-NNN id.

    job_id has a TABLE-WIDE unique constraint, so we cannot scope by tenant
    when computing the next number — the previous per-tenant count caused
    duplicates whenever the demo seeder or another tenant got there first.

    We scan the max existing JOB-YYYY-* id globally, parse the trailing
    integer, and increment. The format `JOB-YYYY-NNN` sorts lexically the
    same as numerically up to 999, after which we fall back to numeric parse.
    """
    year = datetime.utcnow().year
    prefix = f"JOB-{year}-"
    rows = (
        db.query(Job.job_id)
        .filter(Job.job_id.like(f"{prefix}%"))
        .all()
    )
    max_n = 0
    for (jid,) in rows:
        try:
            n = int(jid[len(prefix):])
        except (ValueError, TypeError):
            continue
        if n > max_n:
            max_n = n
    return f"{prefix}{max_n + 1:03d}"


def _job_to_response(job: Job, db: Session) -> dict:
    candidate_count = db.query(Application).filter(Application.job_id == job.id).count()
    return {
        "id": job.id,
        "job_id": job.job_id,
        "title": job.title,
        "department": job.department,
        "location": job.location,
        "seniority": job.seniority,
        "skills": json.loads(job.skills) if job.skills else [],
        "responsibilities": json.loads(job.responsibilities) if job.responsibilities else [],
        "qualifications": json.loads(job.qualifications) if job.qualifications else [],
        "description": job.description,
        "status": job.status,
        "interview_mode": job.interview_mode or "voice",
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "updated_at": job.updated_at.isoformat() if job.updated_at else None,
        "candidate_count": candidate_count,
    }


@router.post("", response_model=None)
async def create_job(
    req: JobCreate,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    check_quota(db, session.tenant, "jobs")

    # Race-safe insert: if two creates compute the same next id at the same
    # millisecond we'd hit the unique constraint and crash. Retry with a
    # fresh max-scan on IntegrityError.
    from sqlalchemy.exc import IntegrityError
    for attempt in range(5):
        job = Job(
            tenant_id=session.tenant.id,
            job_id=_generate_job_id(db, session.tenant.id),
            title=req.title,
            department=req.department,
            location=req.location,
            seniority=req.seniority,
            skills=json.dumps(req.skills),
            responsibilities=json.dumps(req.responsibilities),
            qualifications=json.dumps(req.qualifications),
            description=req.description,
            interview_mode=req.interview_mode,
        )
        db.add(job)
        try:
            db.commit()
            db.refresh(job)
            return _job_to_response(job, db)
        except IntegrityError:
            db.rollback()
            if attempt == 4:
                raise HTTPException(
                    status_code=503,
                    detail="Could not allocate a job id — try again",
                )
            continue


@router.get("")
async def list_jobs(
    status: Optional[str] = None,
    department: Optional[str] = None,
    page: int = 1,
    per_page: int = 20,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    query = db.query(Job).filter(Job.tenant_id == session.tenant.id)
    if status:
        query = query.filter(Job.status == status)
    if department:
        query = query.filter(Job.department == department)

    total = query.count()
    jobs = query.order_by(Job.created_at.desc()).offset((page - 1) * per_page).limit(per_page).all()

    return {
        "jobs": [_job_to_response(j, db) for j in jobs],
        "total": total,
    }


@router.get("/{job_id}")
async def get_job(
    job_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    job = db.query(Job).filter(
        Job.id == job_id,
        Job.tenant_id == session.tenant.id,
    ).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return _job_to_response(job, db)


@router.get("/{job_id}/suggested-candidates")
async def suggested_candidates(
    job_id: int,
    limit: int = 10,
    extract_missing: bool = True,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Suggest candidates from the tenant's talent bank by tag overlap.

    Tag-overlap scoring (no LLM): match the job's required skills against
    each candidate's profile_skills. Uses the cached profile_extracted_at
    column so we never re-LLM the same resume. Candidates without a profile
    yet are extracted on-the-fly (capped to PROFILE_LAZY_CAP per call).
    """
    from models import Candidate
    from agents.profile_extractor import extract_profile
    from datetime import datetime as _dt
    PROFILE_LAZY_CAP = 8  # ceiling on LLM calls per request

    job = db.query(Job).filter(
        Job.id == job_id,
        Job.tenant_id == session.tenant.id,
    ).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    job_skills = set()
    if job.skills:
        try:
            job_skills = {s.strip().lower().replace(" ", "-") for s in json.loads(job.skills) if s}
        except Exception:
            pass
    job_role = (job.title or "").lower()
    job_seniority = (job.seniority or "").lower()

    candidates = (
        db.query(Candidate)
        .filter(Candidate.tenant_id == session.tenant.id)
        .order_by(Candidate.created_at.desc())
        .limit(500)
        .all()
    )

    # Lazy-fill profiles for legacy rows. Bounded so a tenant with 5000
    # un-profiled candidates can't blow the LLM budget on one click.
    # Only runs if the tenant's plan unlocks the profile_extractor agent —
    # otherwise we just return whatever profiles already exist.
    from billing.plans import is_agent_allowed
    if extract_missing and is_agent_allowed(session.tenant, "profile_extractor"):
        missing = [c for c in candidates if not c.profile_extracted_at and (c.resume_text or "").strip()]
        for cand in missing[:PROFILE_LAZY_CAP]:
            try:
                prof = await extract_profile(cand.resume_text or "")
                cand.profile_skills = json.dumps(prof.skills)
                cand.profile_role = prof.role
                cand.profile_seniority = prof.seniority
                cand.profile_years_experience = prof.years_experience
                cand.profile_summary = prof.summary
                cand.profile_extracted_at = _dt.utcnow()
                db.commit()
            except Exception:
                db.rollback()

    suggestions = []
    for c in candidates:
        if not c.profile_extracted_at:
            continue
        try:
            cand_skills = {s for s in json.loads(c.profile_skills or "[]") if s}
        except Exception:
            cand_skills = set()
        if not cand_skills:
            continue

        overlap = job_skills & cand_skills
        # Tag overlap is the primary signal — ratio against the job's
        # required skills means a candidate matching all 4/4 scores higher
        # than one matching 6/12 of an unfocused job.
        if job_skills:
            base = (len(overlap) / len(job_skills)) * 80
        else:
            base = 0
        # Role match bonus — substring either way
        cand_role = (c.profile_role or "").lower()
        if cand_role and job_role and (cand_role in job_role or job_role in cand_role):
            base += 12
        # Seniority match
        if c.profile_seniority and job_seniority and c.profile_seniority in job_seniority:
            base += 8
        score = round(min(base, 100), 1)
        if score < 5:
            continue

        suggestions.append({
            "candidate_id": c.id,
            "name": c.name,
            "email": c.email,
            "role": c.profile_role,
            "seniority": c.profile_seniority,
            "years_experience": c.profile_years_experience,
            "summary": c.profile_summary,
            "skills": sorted(cand_skills)[:12],
            "matched_skills": sorted(overlap),
            "match_score": score,
        })

    suggestions.sort(key=lambda x: x["match_score"], reverse=True)
    return {
        "job_id": job_id,
        "job_skills": sorted(job_skills),
        "suggestions": suggestions[:limit],
        "total_profiled": sum(1 for c in candidates if c.profile_extracted_at),
        "total_candidates": len(candidates),
    }


@router.put("/{job_id}")
async def update_job(
    job_id: int,
    req: JobUpdate,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    job = db.query(Job).filter(
        Job.id == job_id,
        Job.tenant_id == session.tenant.id,
    ).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    update_data = req.model_dump(exclude_unset=True)
    for json_field in ("skills", "responsibilities", "qualifications"):
        if json_field in update_data:
            update_data[json_field] = json.dumps(update_data[json_field])

    for key, value in update_data.items():
        setattr(job, key, value)

    job.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(job)
    return _job_to_response(job, db)


@router.delete("/{job_id}")
async def delete_job(
    job_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    job = db.query(Job).filter(
        Job.id == job_id,
        Job.tenant_id == session.tenant.id,
    ).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Cascade by hand: the FKs from applications/interview_links/events/
    # qa_sessions to jobs aren't declared with ON DELETE CASCADE, so a plain
    # delete blows up with NOT NULL on applications.job_id. Walk the tree.
    from models import InterviewLink, QaSession, Event
    app_ids = [
        aid for (aid,) in db.query(Application.id).filter(Application.job_id == job.id).all()
    ]
    if app_ids:
        db.query(QaSession).filter(QaSession.app_id.in_(app_ids)).delete(synchronize_session=False)
        db.query(InterviewLink).filter(InterviewLink.app_id.in_(app_ids)).delete(synchronize_session=False)
        db.query(Event).filter(Event.app_id.in_(app_ids)).delete(synchronize_session=False)
        db.query(Application).filter(Application.id.in_(app_ids)).delete(synchronize_session=False)

    db.delete(job)
    db.commit()
    return {"status": "deleted", "applications_removed": len(app_ids)}
