"""Jobs CRUD endpoints."""
from typing import Optional
import json
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
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
    result = await generate_job_details(req.title.strip(), tenant=session.tenant)
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
    expires_at = getattr(job, "expires_at", None)
    is_expired = bool(expires_at and expires_at < datetime.utcnow())
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
        "expires_at": expires_at.isoformat() if expires_at else None,
        "is_expired": is_expired,
        "resume_threshold_min": job.resume_threshold_min if job.resume_threshold_min is not None else 80.0,
        "interview_threshold_min": job.interview_threshold_min if job.interview_threshold_min is not None else 75.0,
        "final_threshold_reject": job.final_threshold_reject if job.final_threshold_reject is not None else 50.0,
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
    job: Optional[Job] = None
    for attempt in range(5):
        candidate = Job(
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
        db.add(candidate)
        try:
            db.commit()
            db.refresh(candidate)
            job = candidate
            break
        except IntegrityError:
            db.rollback()
            if attempt == 4:
                raise HTTPException(
                    status_code=503,
                    detail="Could not allocate a job id — try again",
                )
            continue

    if job is None:
        raise HTTPException(status_code=500, detail="Job creation failed")

    # Auto-generate per-job interview questions, if requested. This runs
    # AFTER the job row is committed so a failed Mistral call (LLM down,
    # budget exceeded, JSON parse error) never blocks the job create —
    # the user gets the empty job and can click "Suggest with AI" later.
    if req.interview_question_counts:
        await _auto_seed_interview_questions(db, session.tenant, job, req.interview_question_counts)

    return _job_to_response(job, db)


async def _auto_seed_interview_questions(
    db: Session, tenant, job: Job, counts: dict[str, int]
) -> None:
    """Generate + insert interview questions per type. Best-effort: any
    failure (LLM down, JSON parse, etc.) is swallowed so job creation
    isn't blocked. HR can always click Suggest later."""
    from agents.interview_question_generator import suggest_questions, ALLOWED_TYPES
    from models import JobInterviewQuestion

    # Sanitize & cap the per-type counts.
    cleaned: dict[str, int] = {}
    for t, n in counts.items():
        if t not in ALLOWED_TYPES:
            continue
        try:
            n_i = max(0, min(int(n), 8))
        except Exception:
            continue
        if n_i > 0:
            cleaned[t] = n_i

    total = sum(cleaned.values())
    if total == 0:
        return
    if total > 20:
        # Scale down proportionally so we stay under the per-job cap.
        scale = 20 / total
        cleaned = {t: max(1, int(n * scale)) for t, n in cleaned.items()}

    try:
        gate_agent(tenant, "interview_question_generator")
        check_llm_budget()
    except Exception:
        # If the tenant's plan doesn't include this agent, or they're over
        # budget, silently skip auto-seeding.
        return

    order = 0
    skills = []
    try:
        skills = json.loads(job.skills) if isinstance(job.skills, str) else (job.skills or [])
    except Exception:
        skills = []

    for qtype, count in cleaned.items():
        try:
            generated = await suggest_questions(
                job_title=job.title,
                job_description=job.description or "",
                required_skills=skills,
                seniority=job.seniority or "",
                count=count,
                types=[qtype],
            )
        except Exception:
            continue

        for g in generated:
            db.add(JobInterviewQuestion(
                tenant_id=tenant.id,
                job_id=job.id,
                question_text=g.question_text,
                question_type=g.question_type or qtype,
                order_index=order,
                is_required=False,
                weight=g.weight or 3,
                expected_keywords=json.dumps(g.expected_keywords or []),
                expected_answer_summary=g.expected_answer_summary or "",
            ))
            order += 1
    try:
        db.commit()
    except Exception:
        db.rollback()


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
        .filter(
            Candidate.tenant_id == session.tenant.id,
            # Skip people the WhatsApp bot has heard from saying they're
            # not in the market — keeping them in match results just wastes
            # outreach budget.
            Candidate.talent_bank_status == "available",
        )
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


class ReachOutRequest(BaseModel):
    candidate_ids: list[int] = Field(..., min_length=1, max_length=50)
    channels: list[str] = Field(default_factory=lambda: ["email", "whatsapp"])
    custom_message: Optional[str] = Field(default=None, max_length=1200)


@router.post("/{job_id}/reach-out")
async def reach_out_to_candidates(
    job_id: int,
    req: ReachOutRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Bulk availability ping: for each selected candidate from the
    Talent Bank, send an "are you available for this role?" message
    over WhatsApp + email. Channels are best-effort — if Twilio isn't
    set up for the tenant, WhatsApp is skipped silently while email
    still goes out.

    No interview link is generated here. That's the next step once the
    candidate confirms availability. Replies land in the tenant's
    existing inbox (email) or the Twilio inbound webhook (WhatsApp).
    """
    from models import Candidate, Communication
    from services.tenant_outbound import send_via_tenant_mailbox

    job = db.query(Job).filter(
        Job.id == job_id,
        Job.tenant_id == session.tenant.id,
    ).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    candidates = (
        db.query(Candidate)
        .filter(
            Candidate.tenant_id == session.tenant.id,
            Candidate.id.in_(req.candidate_ids),
        )
        .all()
    )
    if not candidates:
        raise HTTPException(status_code=404, detail="No matching candidates")

    channels_wanted = {c.lower().strip() for c in req.channels}
    company = session.tenant.name or "the recruitment team"

    # Twilio config is optional — load it once; if it's missing, WhatsApp
    # is skipped per candidate without taking the whole batch down.
    twilio_cfg = None
    twilio_err: Optional[str] = None
    if "whatsapp" in channels_wanted:
        try:
            from services.twilio_service import load_config as load_twilio
            twilio_cfg = load_twilio(db, session.tenant.id)
        except Exception as e:
            twilio_err = str(e)
            twilio_cfg = None

    results: list[dict] = []
    for cand in candidates:
        first_name = (cand.name or "there").split()[0] if cand.name else "there"
        default_msg = (
            f"Hi {first_name}, this is {company}. We have an opening for "
            f"{job.title} that looks like a strong match for your background. "
            f"Are you available for a short screening interview this week? "
            f"Reply with the days that work for you and we'll set it up."
        )
        body = (req.custom_message or default_msg).replace("{name}", first_name)

        per_result: dict = {
            "candidate_id": cand.id,
            "name": cand.name,
            "email": cand.email,
            "phone": cand.phone,
            "channels": {},
        }

        # ── Email ────────────────────────────────────────────────────────
        # Skip the legacy @uploaded.local placeholders too — those used to
        # be synthesised when a CV came in without an email; sending to
        # them would just error at SMTP.
        cand_email = (cand.email or "").strip()
        has_real_email = bool(cand_email) and not cand_email.lower().endswith("@uploaded.local")
        if "email" in channels_wanted and has_real_email:
            subject = f"Re: {job.title} at {company}"
            body_html = (
                f"<div style='font-family:Arial,sans-serif;max-width:560px;"
                f"line-height:1.6;color:#334155;'>"
                f"<p>{body.replace(chr(10), '<br>')}</p>"
                f"<p style='margin-top:24px;color:#94a3b8;font-size:12px;'>"
                f"Sent from {company} via HireOps AI.</p>"
                f"</div>"
            )
            email_outcome = send_via_tenant_mailbox(
                tenant_id=session.tenant.id,
                to_email=cand.email,
                subject=subject,
                body_html=body_html,
                body_text=body,
                db=db,
            )
            per_result["channels"]["email"] = email_outcome

            # Log to communications regardless of outcome so the trail
            # shows what we attempted.
            try:
                db.add(Communication(
                    tenant_id=session.tenant.id,
                    candidate_id=cand.id,
                    app_id=None,
                    channel="email",
                    direction="outbound",
                    status="sent" if email_outcome.get("success") else "failed",
                    to_address=cand.email,
                    from_address=email_outcome.get("from") or "",
                    subject=subject,
                    body=body,
                    error=None if email_outcome.get("success") else email_outcome.get("message"),
                    sent_by_user_id=session.user.id,
                    sent_at=datetime.utcnow(),
                ))
                db.commit()
            except Exception:
                db.rollback()

        # ── WhatsApp ─────────────────────────────────────────────────────
        if "whatsapp" in channels_wanted and cand.phone:
            if not twilio_cfg:
                per_result["channels"]["whatsapp"] = {
                    "success": False,
                    "message": twilio_err or "Twilio not configured",
                }
            else:
                try:
                    from services.twilio_service import send_whatsapp
                    send_whatsapp(twilio_cfg, cand.phone, body)
                    per_result["channels"]["whatsapp"] = {"success": True}
                    wa_status = "sent"
                    wa_err = None
                except Exception as e:
                    per_result["channels"]["whatsapp"] = {
                        "success": False,
                        "message": str(e),
                    }
                    wa_status = "failed"
                    wa_err = str(e)
                try:
                    db.add(Communication(
                        tenant_id=session.tenant.id,
                        candidate_id=cand.id,
                        app_id=None,
                        channel="whatsapp",
                        direction="outbound",
                        status=wa_status,
                        to_address=cand.phone,
                        from_address=getattr(twilio_cfg, "whatsapp_from", "") or "",
                        subject="Availability check",
                        body=body,
                        error=wa_err,
                        sent_by_user_id=session.user.id,
                        sent_at=datetime.utcnow(),
                    ))
                    db.commit()
                except Exception:
                    db.rollback()

        results.append(per_result)

    return {
        "job_id": job_id,
        "total_attempted": len(results),
        "results": results,
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
