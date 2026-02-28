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

router = APIRouter(prefix="/api/v1/jobs", tags=["jobs"])


class JobGenerateRequest(BaseModel):
    title: str


@router.post("/generate")
async def generate_job(req: JobGenerateRequest):
    """Use Mistral AI to auto-generate job posting details from a title."""
    if not req.title.strip():
        raise HTTPException(status_code=400, detail="Title is required")
    result = await generate_job_details(req.title.strip())
    result["title"] = req.title.strip()
    return result


def _generate_job_id(db: Session) -> str:
    year = datetime.utcnow().year
    count = db.query(Job).filter(Job.job_id.like(f"JOB-{year}-%")).count()
    return f"JOB-{year}-{count + 1:03d}"


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
        "description": job.description,
        "status": job.status,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "updated_at": job.updated_at.isoformat() if job.updated_at else None,
        "candidate_count": candidate_count,
    }


@router.post("", response_model=None)
async def create_job(req: JobCreate, db: Session = Depends(get_db)):
    job = Job(
        job_id=_generate_job_id(db),
        title=req.title,
        department=req.department,
        location=req.location,
        seniority=req.seniority,
        skills=json.dumps(req.skills),
        description=req.description,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return _job_to_response(job, db)


@router.get("")
async def list_jobs(
    status: Optional[str] = None,
    department: Optional[str] = None,
    page: int = 1,
    per_page: int = 20,
    db: Session = Depends(get_db),
):
    query = db.query(Job)
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
async def get_job(job_id: int, db: Session = Depends(get_db)):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return _job_to_response(job, db)


@router.put("/{job_id}")
async def update_job(job_id: int, req: JobUpdate, db: Session = Depends(get_db)):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    update_data = req.model_dump(exclude_unset=True)
    if "skills" in update_data:
        update_data["skills"] = json.dumps(update_data["skills"])

    for key, value in update_data.items():
        setattr(job, key, value)

    job.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(job)
    return _job_to_response(job, db)


@router.delete("/{job_id}")
async def delete_job(job_id: int, db: Session = Depends(get_db)):
    job = db.query(Job).filter(Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    db.delete(job)
    db.commit()
    return {"status": "deleted"}
