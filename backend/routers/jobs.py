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

router = APIRouter(prefix="/api/v1/jobs", tags=["jobs"])


class JobGenerateRequest(BaseModel):
    title: str


@router.post("/generate")
async def generate_job(
    req: JobGenerateRequest,
    _: CurrentSession = Depends(current_session),
):
    """Use Mistral AI to auto-generate job posting details from a title."""
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
    db.delete(job)
    db.commit()
    return {"status": "deleted"}
