"""Per-job custom interview question CRUD + AI suggest (Feature 4).

Mounted under /api/v1/jobs/{job_id}/interview-questions so it sits next to
the existing job endpoints. Tenant-scoped via the parent job lookup.
"""
import json
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from auth.dependencies import current_session, CurrentSession
from billing.cost_guard import check_llm_budget
from billing.plans import gate_agent
from database import get_db
from models import Job, JobInterviewQuestion
from services.audit import write_audit
from agents.interview_question_generator import suggest_questions, ALLOWED_TYPES

logger = logging.getLogger("hireops.interview_questions")

router = APIRouter(prefix="/api/v1/jobs", tags=["interview-questions"])

MAX_QUESTIONS_PER_JOB = 20


def _ensure_job(db: Session, job_id: int, tenant_id: int) -> Job:
    job = db.query(Job).filter(
        Job.id == job_id,
        Job.tenant_id == tenant_id,
    ).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


def _to_response(q: JobInterviewQuestion) -> dict:
    try:
        keywords = json.loads(q.expected_keywords or "[]")
    except Exception:
        keywords = []
    return {
        "id": q.id,
        "question_text": q.question_text,
        "question_type": q.question_type or "behavioural",
        "order_index": q.order_index or 0,
        "is_required": bool(q.is_required),
        "weight": q.weight or 3,
        "expected_keywords": keywords,
        "expected_answer_summary": q.expected_answer_summary or "",
        "created_at": q.created_at.isoformat() if q.created_at else None,
        "updated_at": q.updated_at.isoformat() if q.updated_at else None,
    }


@router.get("/{job_id}/interview-questions")
def list_questions(
    job_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    _ensure_job(db, job_id, session.tenant.id)
    rows = db.query(JobInterviewQuestion).filter(
        JobInterviewQuestion.job_id == job_id,
        JobInterviewQuestion.tenant_id == session.tenant.id,
    ).order_by(
        JobInterviewQuestion.order_index.asc(),
        JobInterviewQuestion.id.asc(),
    ).all()
    return {"questions": [_to_response(q) for q in rows]}


class QuestionCreateRequest(BaseModel):
    question_text: str = Field(..., min_length=1, max_length=1000)
    question_type: str = Field(default="behavioural")
    is_required: bool = False
    weight: int = Field(default=3, ge=1, le=5)
    expected_keywords: List[str] = Field(default_factory=list)
    expected_answer_summary: str = Field(default="", max_length=2000)

    @field_validator("question_type")
    @classmethod
    def _validate_type(cls, v: str) -> str:
        v = (v or "").lower().strip()
        return v if v in ALLOWED_TYPES else "behavioural"


@router.post("/{job_id}/interview-questions", status_code=201)
def create_question(
    job_id: int,
    req: QuestionCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    _ensure_job(db, job_id, session.tenant.id)
    existing_count = db.query(JobInterviewQuestion).filter(
        JobInterviewQuestion.job_id == job_id,
        JobInterviewQuestion.tenant_id == session.tenant.id,
    ).count()
    if existing_count >= MAX_QUESTIONS_PER_JOB:
        raise HTTPException(
            status_code=400,
            detail=f"Maximum {MAX_QUESTIONS_PER_JOB} interview questions per job",
        )

    q = JobInterviewQuestion(
        tenant_id=session.tenant.id,
        job_id=job_id,
        question_text=req.question_text.strip(),
        question_type=req.question_type,
        order_index=existing_count,  # append by default
        is_required=req.is_required,
        weight=req.weight,
        expected_keywords=json.dumps([k.strip() for k in req.expected_keywords if k.strip()][:12]),
        expected_answer_summary=req.expected_answer_summary.strip(),
    )
    db.add(q)
    db.commit()
    db.refresh(q)
    write_audit(
        db,
        action="job.interview_question.create",
        actor=session.user,
        tenant_id=session.tenant.id,
        resource_type="job_interview_question",
        resource_id=q.id,
        payload={"job_id": job_id, "question_type": q.question_type, "weight": q.weight},
        request=request,
    )
    return _to_response(q)


class QuestionUpdateRequest(BaseModel):
    question_text: Optional[str] = Field(default=None, min_length=1, max_length=1000)
    question_type: Optional[str] = None
    is_required: Optional[bool] = None
    weight: Optional[int] = Field(default=None, ge=1, le=5)
    expected_keywords: Optional[List[str]] = None
    expected_answer_summary: Optional[str] = Field(default=None, max_length=2000)


@router.put("/{job_id}/interview-questions/{question_id}")
def update_question(
    job_id: int,
    question_id: int,
    req: QuestionUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    _ensure_job(db, job_id, session.tenant.id)
    q = db.query(JobInterviewQuestion).filter(
        JobInterviewQuestion.id == question_id,
        JobInterviewQuestion.job_id == job_id,
        JobInterviewQuestion.tenant_id == session.tenant.id,
    ).first()
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")

    if req.question_text is not None:
        q.question_text = req.question_text.strip()
    if req.question_type is not None:
        qt = req.question_type.lower().strip()
        q.question_type = qt if qt in ALLOWED_TYPES else "behavioural"
    if req.is_required is not None:
        q.is_required = bool(req.is_required)
    if req.weight is not None:
        q.weight = req.weight
    if req.expected_keywords is not None:
        q.expected_keywords = json.dumps([k.strip() for k in req.expected_keywords if k.strip()][:12])
    if req.expected_answer_summary is not None:
        q.expected_answer_summary = req.expected_answer_summary.strip()

    db.commit()
    db.refresh(q)
    write_audit(
        db,
        action="job.interview_question.update",
        actor=session.user,
        tenant_id=session.tenant.id,
        resource_type="job_interview_question",
        resource_id=q.id,
        payload={"job_id": job_id},
        request=request,
    )
    return _to_response(q)


@router.delete("/{job_id}/interview-questions/{question_id}")
def delete_question(
    job_id: int,
    question_id: int,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    _ensure_job(db, job_id, session.tenant.id)
    q = db.query(JobInterviewQuestion).filter(
        JobInterviewQuestion.id == question_id,
        JobInterviewQuestion.job_id == job_id,
        JobInterviewQuestion.tenant_id == session.tenant.id,
    ).first()
    if not q:
        raise HTTPException(status_code=404, detail="Question not found")
    db.delete(q)
    db.commit()
    write_audit(
        db,
        action="job.interview_question.delete",
        actor=session.user,
        tenant_id=session.tenant.id,
        resource_type="job_interview_question",
        resource_id=question_id,
        payload={"job_id": job_id},
        request=request,
    )
    return {"deleted": True}


class ReorderRequest(BaseModel):
    question_ids: List[int] = Field(..., min_length=1)


@router.post("/{job_id}/interview-questions/reorder")
def reorder_questions(
    job_id: int,
    req: ReorderRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    _ensure_job(db, job_id, session.tenant.id)
    rows = db.query(JobInterviewQuestion).filter(
        JobInterviewQuestion.job_id == job_id,
        JobInterviewQuestion.tenant_id == session.tenant.id,
    ).all()
    by_id = {q.id: q for q in rows}
    valid_ids = [qid for qid in req.question_ids if qid in by_id]
    if not valid_ids:
        raise HTTPException(status_code=400, detail="No valid question ids for this job")
    for idx, qid in enumerate(valid_ids):
        by_id[qid].order_index = idx
    # Anything not in the supplied list keeps its prior order, pushed to the end
    next_idx = len(valid_ids)
    for q in rows:
        if q.id not in valid_ids:
            q.order_index = next_idx
            next_idx += 1
    db.commit()
    return {"reordered": len(valid_ids)}


class SuggestRequest(BaseModel):
    count: int = Field(default=5, ge=1, le=12)
    types: Optional[List[str]] = None  # subset of ALLOWED_TYPES; defaults below


@router.post("/{job_id}/interview-questions/suggest")
async def suggest(
    job_id: int,
    req: SuggestRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """LLM-suggest custom interview questions based on the job context.

    Returns suggestions WITHOUT saving them — the UI lets HR pick which
    to keep before posting them via /interview-questions.
    """
    job = _ensure_job(db, job_id, session.tenant.id)
    gate_agent(session.tenant, "interview_question_generator")
    check_llm_budget()  # raises 402 if tenant is over their daily LLM cap

    skills = []
    try:
        skills = json.loads(job.skills) if job.skills else []
    except Exception:
        skills = []

    questions = await suggest_questions(
        job_title=job.title or "",
        job_description=job.description or "",
        required_skills=skills,
        seniority=job.seniority or "",
        count=req.count,
        types=req.types,
    )
    return {
        "suggestions": [
            {
                "question_text": q.question_text,
                "question_type": q.question_type,
                "weight": q.weight,
                "expected_keywords": q.expected_keywords,
                "expected_answer_summary": q.expected_answer_summary,
            }
            for q in questions
        ]
    }
