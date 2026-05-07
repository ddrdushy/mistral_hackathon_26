"""Candidate management endpoints."""
from typing import Optional
import json
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from database import get_db
from models import Candidate, Email
from schemas import CandidateCreate, CandidateResponse, CandidateFromEmailResponse
from services.resume_service import extract_resume_text, parse_contact_info
from auth.dependencies import current_session, CurrentSession
from billing.plans import check_quota

router = APIRouter(prefix="/api/v1/candidates", tags=["candidates"])


def _candidate_to_response(c: Candidate) -> dict:
    try:
        skills = json.loads(c.profile_skills or "[]")
    except Exception:
        skills = []
    try:
        key_points = json.loads(c.profile_key_points or "[]")
    except Exception:
        key_points = []
    return {
        "id": c.id,
        "name": c.name,
        "email": c.email,
        "phone": c.phone,
        "resume_text": c.resume_text,
        "resume_filename": c.resume_filename,
        "source_email_id": c.source_email_id,
        "notes": c.notes,
        "profile": {
            "skills": skills,
            "role": c.profile_role or "",
            "seniority": c.profile_seniority or "",
            "years_experience": c.profile_years_experience,
            "summary": c.profile_summary or "",
            "key_points": key_points,
            "extracted_at": c.profile_extracted_at.isoformat() if c.profile_extracted_at else None,
        },
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


@router.post("")
async def create_candidate(
    req: CandidateCreate,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    check_quota(db, session.tenant, "candidates")
    candidate = Candidate(
        tenant_id=session.tenant.id,
        name=req.name,
        email=req.email,
        phone=req.phone,
        resume_text=req.resume_text,
        source_email_id=req.source_email_id,
    )
    db.add(candidate)
    db.commit()
    db.refresh(candidate)
    return _candidate_to_response(candidate)


@router.post("/from-email/{email_id}")
async def create_from_email(
    email_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    check_quota(db, session.tenant, "candidates")
    em = db.query(Email).filter(
        Email.id == email_id,
        Email.tenant_id == session.tenant.id,
    ).first()
    if not em:
        raise HTTPException(status_code=404, detail="Email not found")

    if em.processed >= 2:
        raise HTTPException(status_code=400, detail="Candidate already created from this email")

    # Parse classification for detected name
    classification = json.loads(em.classification) if em.classification else {}
    detected_name = classification.get("detected_name", "")

    # Try to extract contact info from email body
    body_text = em.body_full or em.body_snippet
    contact = parse_contact_info(body_text)

    name = detected_name or contact.get("name", "") or em.from_name or em.from_address.split("@")[0].replace(".", " ").title()
    candidate_email = contact.get("email", "") or em.from_address
    phone = contact.get("phone", "")

    # Extract resume text from attachments (if sample data has resume_text in body)
    resume_text = ""
    resume_filename = ""
    attachments = json.loads(em.attachments) if em.attachments else []
    for att in attachments:
        filename = att.get("filename", "")
        if filename.lower().endswith(('.pdf', '.docx', '.doc', '.txt')):
            resume_filename = filename
            # In production, we'd extract from the actual file
            # For sample data, use the email body as resume proxy
            resume_text = body_text
            break

    candidate = Candidate(
        tenant_id=session.tenant.id,
        name=name,
        email=candidate_email,
        phone=phone,
        resume_text=resume_text,
        resume_filename=resume_filename,
        source_email_id=em.id,
    )
    db.add(candidate)
    em.processed = 2
    db.commit()
    db.refresh(candidate)

    return {
        "candidate": _candidate_to_response(candidate),
        "resume_extracted": bool(resume_text),
        "resume_length": len(resume_text),
    }


@router.post("/upload")
async def upload_candidate(
    file: UploadFile = File(...),
    name: Optional[str] = Form(None),
    email: Optional[str] = Form(None),
    phone: Optional[str] = Form(None),
    notes: Optional[str] = Form(None),
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Create a new candidate from an uploaded CV file.

    Use this to drop walk-in resumes / linkedin downloads / past CV stacks
    straight into the talent bank without needing an inbound email. We
    extract text from the file, parse name+email+phone if not provided,
    save the candidate, and kick off profile extraction in the background
    so the candidate is searchable for future jobs immediately.
    """
    check_quota(db, session.tenant, "candidates")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Empty file")

    filename = file.filename or "resume.pdf"
    if not filename.lower().endswith((".pdf", ".docx", ".doc", ".txt", ".tex")):
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type — upload a PDF, DOCX, DOC, TXT, or TEX",
        )

    try:
        resume_text = extract_resume_text(filename, file_bytes=file_bytes)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not parse resume: {e}")

    if not resume_text or not resume_text.strip():
        raise HTTPException(
            status_code=400,
            detail="No text extractable from this file — try a different format",
        )

    contact = parse_contact_info(resume_text)
    final_name = (name or contact.get("name") or "").strip()
    final_email = (email or contact.get("email") or "").strip()
    final_phone = (phone or contact.get("phone") or "").strip()

    if not final_name:
        # Last resort — derive a placeholder so the row is usable. HR can
        # rename in the UI.
        final_name = (filename.rsplit(".", 1)[0] or "Untitled candidate")[:80]
    if not final_email:
        # Email is "nullable but expected" everywhere downstream; placeholder
        # keeps queries safe and surfaces in the UI as "no email" so HR can
        # fill it in.
        final_email = f"unknown+{int(datetime.utcnow().timestamp())}@uploaded.local"

    candidate = Candidate(
        tenant_id=session.tenant.id,
        name=final_name,
        email=final_email,
        phone=final_phone,
        resume_text=resume_text,
        resume_filename=filename,
        notes=(notes or "").strip(),
        source_email_id=None,
    )
    db.add(candidate)
    db.commit()
    db.refresh(candidate)

    # Run profile extraction inline so the upload response carries the LLM
    # summary + key points back to the modal — HR sees the analysis right
    # after pressing Upload, no second click needed.
    try:
        from agents.profile_extractor import extract_profile
        from services.workflow_service import _apply_profile
        prof = await extract_profile(resume_text)
        _apply_profile(db, candidate, prof)
        db.refresh(candidate)
    except Exception:
        # If LLM fails (budget cap, network), fall back to schedule a
        # background retry — talent bank still works via lazy fill.
        try:
            import asyncio
            loop = asyncio.get_event_loop()
            if loop.is_running():
                from services.workflow_service import _async_apply_profile
                loop.create_task(_async_apply_profile(candidate.id))
        except Exception:
            pass

    return {
        "candidate": _candidate_to_response(candidate),
        "resume_length": len(resume_text),
        "parsed": {
            "name_from_resume": contact.get("name", "") or "",
            "email_from_resume": contact.get("email", "") or "",
            "phone_from_resume": contact.get("phone", "") or "",
        },
    }


@router.post("/upload-bulk")
async def upload_candidates_bulk(
    files: list[UploadFile] = File(...),
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Bulk CV upload — pass multiple files in one multipart request.

    Each file goes through the same parse → contact-info → create →
    profile-extract pipeline as the single upload, but we don't bail on
    the whole batch if one file is bad. Returns a per-file result so the
    UI can show success/failure individually.
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")
    if len(files) > 25:
        raise HTTPException(
            status_code=400,
            detail="Bulk upload limited to 25 files per batch — split into smaller batches",
        )

    from agents.profile_extractor import extract_profile
    from services.workflow_service import _apply_profile

    results = []
    successes = 0
    failures = 0

    for f in files:
        item = {
            "filename": f.filename or "unknown",
            "ok": False,
            "candidate": None,
            "error": None,
        }
        try:
            check_quota(db, session.tenant, "candidates")
        except HTTPException as e:
            item["error"] = e.detail if isinstance(e.detail, str) else "Quota exceeded"
            failures += 1
            results.append(item)
            continue

        try:
            file_bytes = await f.read()
            if not file_bytes:
                raise ValueError("empty file")
            fname = f.filename or "resume.pdf"
            if not fname.lower().endswith((".pdf", ".docx", ".doc", ".txt", ".tex")):
                raise ValueError("unsupported file type")
            resume_text = extract_resume_text(fname, file_bytes=file_bytes)
            if not resume_text or not resume_text.strip():
                raise ValueError("no text extractable")

            contact = parse_contact_info(resume_text)
            placeholder_email = f"unknown+{int(datetime.utcnow().timestamp())}-{successes}@uploaded.local"
            candidate = Candidate(
                tenant_id=session.tenant.id,
                name=(contact.get("name") or fname.rsplit(".", 1)[0])[:80],
                email=(contact.get("email") or placeholder_email),
                phone=contact.get("phone", ""),
                resume_text=resume_text,
                resume_filename=fname,
                source_email_id=None,
            )
            db.add(candidate)
            db.commit()
            db.refresh(candidate)

            # Profile extract inline — HR uploaded a stack and expects
            # all of them to be searchable when the dialog closes.
            try:
                prof = await extract_profile(resume_text)
                _apply_profile(db, candidate, prof)
                db.refresh(candidate)
            except Exception:
                pass

            item["ok"] = True
            item["candidate"] = _candidate_to_response(candidate)
            successes += 1
        except Exception as e:
            db.rollback()
            item["error"] = str(e)
            failures += 1
        results.append(item)

    return {
        "uploaded": successes,
        "failed": failures,
        "results": results,
    }


@router.post("/{candidate_id}/upload-resume")
async def upload_resume(
    candidate_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    candidate = db.query(Candidate).filter(
        Candidate.id == candidate_id,
        Candidate.tenant_id == session.tenant.id,
    ).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    file_bytes = await file.read()
    text = extract_resume_text(file.filename or "resume.pdf", file_bytes=file_bytes)

    candidate.resume_text = text
    candidate.resume_filename = file.filename or ""
    candidate.updated_at = datetime.utcnow()

    # Update contact info from resume if not already set
    if text:
        contact = parse_contact_info(text)
        if not candidate.phone and contact.get("phone"):
            candidate.phone = contact["phone"]

    db.commit()
    db.refresh(candidate)
    return {
        "candidate": _candidate_to_response(candidate),
        "resume_extracted": bool(text),
        "resume_length": len(text),
    }


@router.get("")
async def list_candidates(
    search: Optional[str] = None,
    page: int = 1,
    per_page: int = 20,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    query = db.query(Candidate).filter(Candidate.tenant_id == session.tenant.id)
    if search:
        query = query.filter(
            (Candidate.name.ilike(f"%{search}%")) |
            (Candidate.email.ilike(f"%{search}%"))
        )

    total = query.count()
    candidates = query.order_by(Candidate.created_at.desc()).offset((page - 1) * per_page).limit(per_page).all()

    return {
        "candidates": [_candidate_to_response(c) for c in candidates],
        "total": total,
        "page": page,
        "per_page": per_page,
    }


@router.get("/{candidate_id}")
async def get_candidate(
    candidate_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    c = db.query(Candidate).filter(
        Candidate.id == candidate_id,
        Candidate.tenant_id == session.tenant.id,
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return _candidate_to_response(c)


@router.patch("/{candidate_id}/notes")
async def update_notes(
    candidate_id: int,
    body: dict,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    c = db.query(Candidate).filter(
        Candidate.id == candidate_id,
        Candidate.tenant_id == session.tenant.id,
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail="Candidate not found")
    c.notes = body.get("notes", "")
    c.updated_at = datetime.utcnow()
    db.commit()
    return {"status": "updated"}
