"""Candidate management endpoints."""
from typing import Optional
import json
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.orm import Session
from database import get_db
from models import Candidate, CandidateCvVersion, Email, CandidateTag, Tag
from schemas import CandidateCreate, CandidateResponse, CandidateFromEmailResponse
from services.resume_service import extract_resume_text, parse_contact_info
from auth.dependencies import current_session, CurrentSession
from billing.plans import check_quota, is_agent_allowed

router = APIRouter(prefix="/api/v1/candidates", tags=["candidates"])


def _candidate_to_response(c: Candidate, db: Optional[Session] = None) -> dict:
    try:
        skills = json.loads(c.profile_skills or "[]")
    except Exception:
        skills = []
    try:
        key_points = json.loads(c.profile_key_points or "[]")
    except Exception:
        key_points = []

    # Hand-applied HR tags (Feature 2). Optional db arg keeps the older
    # call sites that don't have a session compatible.
    tags: list[dict] = []
    if db is not None:
        rows = db.query(Tag).join(
            CandidateTag, CandidateTag.tag_id == Tag.id,
        ).filter(CandidateTag.candidate_id == c.id).all()
        tags = [{"id": t.id, "name": t.name, "color": t.color or "indigo"} for t in rows]

    return {
        "id": c.id,
        "name": c.name,
        "email": c.email,
        "phone": c.phone,
        "resume_text": c.resume_text,
        "resume_filename": c.resume_filename,
        "cv_version": c.cv_version or 1,
        "source_email_id": c.source_email_id,
        "notes": c.notes,
        "tags": tags,
        "profile": {
            "skills": skills,
            "role": c.profile_role or "",
            "seniority": c.profile_seniority or "",
            "years_experience": c.profile_years_experience,
            "summary": c.profile_summary or "",
            "key_points": key_points,
            "extracted_at": c.profile_extracted_at.isoformat() if c.profile_extracted_at else None,
        },
        "talent_bank_status": c.talent_bank_status or "available",
        "talent_bank_status_reason": c.talent_bank_status_reason or "",
        "talent_bank_status_updated_at": (
            c.talent_bank_status_updated_at.isoformat()
            if c.talent_bank_status_updated_at
            else None
        ),
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


@router.post("/parse")
async def parse_resume(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Pre-parse a CV without saving — returns name/email/phone the UI can
    use to pre-fill the upload form. Also reports whether a candidate with
    that email already exists in the tenant so HR knows it'll bump CV
    version instead of creating a duplicate."""
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Empty file")
    filename = file.filename or "resume.pdf"
    if not filename.lower().endswith((".pdf", ".docx", ".doc", ".txt", ".tex")):
        raise HTTPException(status_code=400, detail="Unsupported file type")
    try:
        text = extract_resume_text(filename, file_bytes=file_bytes)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not parse: {e}")
    contact = parse_contact_info(text or "")

    existing = None
    parsed_email = (contact.get("email") or "").strip().lower()
    if parsed_email:
        existing = db.query(Candidate).filter(
            Candidate.tenant_id == session.tenant.id,
            Candidate.email.ilike(parsed_email),
        ).first()

    return {
        "name": contact.get("name", "") or "",
        "email": contact.get("email", "") or "",
        "phone": contact.get("phone", "") or "",
        "resume_length": len(text or ""),
        "existing_candidate": (
            {
                "id": existing.id,
                "name": existing.name,
                "current_version": existing.cv_version or 1,
                "next_version": (existing.cv_version or 1) + 1,
            }
            if existing
            else None
        ),
    }


def _find_existing_candidate(db: Session, tenant_id: int, email: str) -> Optional[Candidate]:
    """Match by email (case-insensitive). None if no match or email empty."""
    e = (email or "").strip().lower()
    if not e or e.startswith("unknown+"):
        return None
    return db.query(Candidate).filter(
        Candidate.tenant_id == tenant_id,
        Candidate.email.ilike(e),
    ).first()


def _archive_current_cv(
    db: Session,
    candidate: Candidate,
    source: str = "manual_upload",
    user_id: Optional[int] = None,
) -> None:
    """Snapshot the candidate's CURRENT resume into candidate_cv_versions
    before the caller overwrites it. Skips when there's nothing to archive."""
    if not (candidate.resume_text or "").strip() and not candidate.resume_filename:
        return
    snapshot = CandidateCvVersion(
        tenant_id=candidate.tenant_id,
        candidate_id=candidate.id,
        version_number=candidate.cv_version or 1,
        filename=candidate.resume_filename or "",
        resume_text=candidate.resume_text or "",
        source=source,
        uploaded_by_user_id=user_id,
    )
    db.add(snapshot)


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

    # Dedup by email — same candidate re-uploading bumps cv_version instead
    # of creating a duplicate row. Profile is re-extracted from the new
    # resume so tags reflect the latest CV.
    existing = _find_existing_candidate(db, session.tenant.id, final_email)
    is_update = existing is not None
    if existing:
        candidate = existing
        # Snapshot v(N) into the archive BEFORE we overwrite with v(N+1).
        _archive_current_cv(db, candidate, source="manual_upload", user_id=session.user.id if hasattr(session, "user") else None)
        candidate.resume_text = resume_text
        candidate.resume_filename = filename
        candidate.cv_version = (candidate.cv_version or 1) + 1
        if final_phone:
            candidate.phone = final_phone
        if name and name.strip():
            candidate.name = final_name
        if notes and notes.strip():
            candidate.notes = (notes or "").strip()
        candidate.updated_at = datetime.utcnow()
        # Force re-extraction so tags follow the new CV.
        candidate.profile_extracted_at = None
    else:
        candidate = Candidate(
            tenant_id=session.tenant.id,
            name=final_name,
            email=final_email,
            phone=final_phone,
            resume_text=resume_text,
            resume_filename=filename,
            notes=(notes or "").strip(),
            source_email_id=None,
            cv_version=1,
        )
        db.add(candidate)
    db.commit()
    db.refresh(candidate)

    # Run profile extraction inline so the upload response carries the LLM
    # summary + key points back to the modal — HR sees the analysis right
    # after pressing Upload, no second click needed. Skipped silently if
    # the tenant's plan doesn't include the profile_extractor agent — the
    # candidate still gets created (so trial users can build a talent
    # bank), just without LLM tags.
    try:
        if is_agent_allowed(session.tenant, "profile_extractor"):
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
        "is_update": is_update,
        "cv_version": candidate.cv_version or 1,
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
            parsed_email = (contact.get("email") or "").strip()

            existing = _find_existing_candidate(db, session.tenant.id, parsed_email)
            is_update = existing is not None
            if existing:
                candidate = existing
                _archive_current_cv(db, candidate, source="manual_upload", user_id=session.user.id if hasattr(session, "user") else None)
                candidate.resume_text = resume_text
                candidate.resume_filename = fname
                candidate.cv_version = (candidate.cv_version or 1) + 1
                if contact.get("phone"):
                    candidate.phone = contact["phone"]
                candidate.updated_at = datetime.utcnow()
                candidate.profile_extracted_at = None
            else:
                candidate = Candidate(
                    tenant_id=session.tenant.id,
                    name=(contact.get("name") or fname.rsplit(".", 1)[0])[:80],
                    email=(parsed_email or placeholder_email),
                    phone=contact.get("phone", ""),
                    resume_text=resume_text,
                    resume_filename=fname,
                    source_email_id=None,
                    cv_version=1,
                )
                db.add(candidate)
            db.commit()
            db.refresh(candidate)

            # Profile extract inline — HR uploaded a stack and expects
            # all of them to be searchable when the dialog closes. Skipped
            # for plans that don't include the profile_extractor agent.
            try:
                if not is_agent_allowed(session.tenant, "profile_extractor"):
                    raise RuntimeError("profile_extractor not in plan")
                prof = await extract_profile(resume_text)
                _apply_profile(db, candidate, prof)
                db.refresh(candidate)
            except Exception:
                pass

            item["ok"] = True
            item["candidate"] = _candidate_to_response(candidate)
            item["is_update"] = is_update
            item["cv_version"] = candidate.cv_version or 1
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
    talent_bank_only: bool = False,
    tag_ids: Optional[str] = None,
    page: int = 1,
    per_page: int = 20,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """List candidates. talent_bank_only=true filters to candidates with no
    Application rows. tag_ids is a comma-separated list with AND semantics —
    a candidate must have EVERY listed tag to match (Feature 2)."""
    from models import Application
    query = db.query(Candidate).filter(Candidate.tenant_id == session.tenant.id)
    if search:
        query = query.filter(
            (Candidate.name.ilike(f"%{search}%")) |
            (Candidate.email.ilike(f"%{search}%"))
        )
    if talent_bank_only:
        applied_ids = db.query(Application.candidate_id).filter(
            Application.tenant_id == session.tenant.id
        ).distinct().subquery()
        query = query.filter(~Candidate.id.in_(applied_ids))

    if tag_ids:
        try:
            wanted = [int(x) for x in tag_ids.split(",") if x.strip()]
        except ValueError:
            wanted = []
        if wanted:
            from sqlalchemy import func
            # AND semantics: candidate must have ALL N tags. We GROUP BY
            # candidate_id and require the count of matching CandidateTag
            # rows to equal len(wanted).
            matching_ids_subq = (
                db.query(CandidateTag.candidate_id)
                .filter(CandidateTag.tag_id.in_(wanted))
                .group_by(CandidateTag.candidate_id)
                .having(func.count(CandidateTag.tag_id.distinct()) == len(wanted))
                .subquery()
            )
            query = query.filter(Candidate.id.in_(matching_ids_subq))

    total = query.count()
    candidates = query.order_by(Candidate.created_at.desc()).offset((page - 1) * per_page).limit(per_page).all()

    # Application counts in one round-trip (avoids N+1)
    cand_ids = [c.id for c in candidates]
    app_counts: dict[int, int] = {}
    tag_map: dict[int, list[dict]] = {}
    first_app_id: dict[int, int] = {}
    if cand_ids:
        from sqlalchemy import func
        rows = db.query(Application.candidate_id, func.count(Application.id)).filter(
            Application.tenant_id == session.tenant.id,
            Application.candidate_id.in_(cand_ids),
        ).group_by(Application.candidate_id).all()
        app_counts = {cid: n for cid, n in rows}

        # Most recent application per candidate — so the Talent Bank can
        # link "View detail" straight to that app's page. Talent-bank-only
        # candidates (no apps) skip this and link to the match flow instead.
        latest_rows = (
            db.query(Application.candidate_id, func.max(Application.id))
            .filter(
                Application.tenant_id == session.tenant.id,
                Application.candidate_id.in_(cand_ids),
            )
            .group_by(Application.candidate_id)
            .all()
        )
        first_app_id = {cid: aid for cid, aid in latest_rows}

        # Hand-applied tags per candidate, batched
        tag_rows = (
            db.query(CandidateTag.candidate_id, Tag.id, Tag.name, Tag.color)
            .join(Tag, Tag.id == CandidateTag.tag_id)
            .filter(CandidateTag.candidate_id.in_(cand_ids))
            .all()
        )
        for cid, tid, tname, tcolor in tag_rows:
            tag_map.setdefault(cid, []).append({"id": tid, "name": tname, "color": tcolor or "indigo"})

    out = []
    for c in candidates:
        # Pass db so _candidate_to_response can hydrate tags consistently —
        # but the per-candidate query inside it is a per-row N+1. We
        # prefer the batch we just computed.
        row = _candidate_to_response(c)
        row["application_count"] = app_counts.get(c.id, 0)
        row["first_application_id"] = first_app_id.get(c.id)
        row["tags"] = tag_map.get(c.id, [])
        out.append(row)

    return {
        "candidates": out,
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
    return _candidate_to_response(c, db=db)


@router.get("/{candidate_id}/cv-versions")
async def list_cv_versions(
    candidate_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """All historical CV uploads for this candidate, current first.

    The 'current' entry mirrors the live candidates row (so the UI can list
    everything in one place); older versions come from candidate_cv_versions
    where each row is a snapshot taken just before a re-upload."""
    c = db.query(Candidate).filter(
        Candidate.id == candidate_id,
        Candidate.tenant_id == session.tenant.id,
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail="Candidate not found")

    archived = db.query(CandidateCvVersion).filter(
        CandidateCvVersion.candidate_id == candidate_id,
    ).order_by(CandidateCvVersion.version_number.desc()).all()

    out = [{
        "id": None,
        "version_number": c.cv_version or 1,
        "is_current": True,
        "filename": c.resume_filename or "",
        "source": "current",
        "uploaded_at": c.updated_at.isoformat() if c.updated_at else (c.created_at.isoformat() if c.created_at else None),
        "char_count": len(c.resume_text or ""),
    }]
    for v in archived:
        out.append({
            "id": v.id,
            "version_number": v.version_number,
            "is_current": False,
            "filename": v.filename or "",
            "source": v.source or "manual_upload",
            "uploaded_at": v.uploaded_at.isoformat() if v.uploaded_at else None,
            "char_count": len(v.resume_text or ""),
        })
    return {"versions": out}


@router.get("/{candidate_id}/cv-versions/{version_id}/text")
async def get_cv_version_text(
    candidate_id: int,
    version_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Return the full text of a specific archived CV version. Used by the
    UI's 'View v1' button to peek at an older resume without overwriting
    the live one."""
    c = db.query(Candidate).filter(
        Candidate.id == candidate_id,
        Candidate.tenant_id == session.tenant.id,
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail="Candidate not found")
    v = db.query(CandidateCvVersion).filter(
        CandidateCvVersion.id == version_id,
        CandidateCvVersion.candidate_id == candidate_id,
    ).first()
    if not v:
        raise HTTPException(status_code=404, detail="Version not found")
    return {
        "version_number": v.version_number,
        "filename": v.filename,
        "resume_text": v.resume_text,
        "uploaded_at": v.uploaded_at.isoformat() if v.uploaded_at else None,
        "source": v.source,
    }


@router.get("/{candidate_id}/timeline")
async def candidate_timeline(
    candidate_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Chronological history for the candidate detail page.

    Pulls from multiple sources and renders a single ordered list:
      - cv uploads (current candidate row + candidate_cv_versions)
      - pipeline events (events table — classified, scored, stage changes,
        interview link generated/sent, …)
      - interview activity (interview_links opens / completes)
    """
    from models import Application, Event, InterviewLink, Communication, CallQueue, ResumeFraudSignal

    c = db.query(Candidate).filter(
        Candidate.id == candidate_id,
        Candidate.tenant_id == session.tenant.id,
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail="Candidate not found")

    items = []

    # Candidate creation
    if c.created_at:
        items.append({
            "type": "candidate_created",
            "at": c.created_at.isoformat(),
            "label": f"Candidate created · {c.resume_filename or 'no CV'}",
            "meta": {
                "filename": c.resume_filename or "",
                "source": "email" if c.source_email_id else "manual_upload",
            },
        })

    # Current CV (only show as separate event if it differs from creation)
    if c.cv_version and c.cv_version > 1 and c.updated_at:
        items.append({
            "type": "cv_uploaded",
            "at": c.updated_at.isoformat(),
            "label": f"CV updated to v{c.cv_version} · {c.resume_filename or ''}",
            "meta": {
                "version_number": c.cv_version,
                "filename": c.resume_filename or "",
                "is_current": True,
            },
        })

    # Archived CV versions
    archived = db.query(CandidateCvVersion).filter(
        CandidateCvVersion.candidate_id == candidate_id
    ).all()
    for v in archived:
        items.append({
            "type": "cv_archived",
            "at": v.uploaded_at.isoformat() if v.uploaded_at else None,
            "label": f"CV v{v.version_number} archived · {v.filename or ''}",
            "meta": {
                "version_id": v.id,
                "version_number": v.version_number,
                "filename": v.filename or "",
                "source": v.source,
            },
        })

    # Application events — find apps for this candidate, then events on them.
    app_ids = [
        aid for (aid,) in db.query(Application.id).filter(
            Application.candidate_id == candidate_id,
            Application.tenant_id == session.tenant.id,
        ).all()
    ]
    if app_ids:
        events = db.query(Event).filter(
            Event.app_id.in_(app_ids)
        ).order_by(Event.created_at.asc()).all()
        for e in events:
            try:
                payload = json.loads(e.payload) if e.payload else {}
            except Exception:
                payload = {}
            label = e.event_type.replace("_", " ").title()
            if e.event_type == "stage_changed":
                label = f"Stage: {payload.get('from','?')} → {payload.get('to','?')}"
            elif e.event_type == "matched":
                label = f"Matched · resume score {payload.get('resume_score', '?')}"
            elif e.event_type == "rescored":
                label = f"Re-scored · resume score {payload.get('resume_score', '?')}"
            elif e.event_type == "auto_workflow_matched":
                label = f"Auto-matched · score {payload.get('resume_score', '?')} · {payload.get('recommendation','')}"
            elif e.event_type == "auto_interview_link_generated":
                label = "Interview link auto-generated"
            elif e.event_type == "auto_interview_link_emailed":
                label = f"Interview link emailed to {payload.get('to_email','candidate')}"
            items.append({
                "type": e.event_type,
                "at": e.created_at.isoformat() if e.created_at else None,
                "label": label,
                "meta": payload,
                "app_id": e.app_id,
            })

    # Interview link milestones
    if app_ids:
        links = db.query(InterviewLink).filter(
            InterviewLink.app_id.in_(app_ids)
        ).all()
        for l in links:
            if l.opened_at:
                items.append({
                    "type": "interview_opened",
                    "at": l.opened_at.isoformat(),
                    "label": "Candidate opened the interview link",
                    "meta": {"token": l.token},
                })
            if l.interview_completed_at:
                items.append({
                    "type": "interview_completed",
                    "at": l.interview_completed_at.isoformat(),
                    "label": "Interview completed",
                    "meta": {"token": l.token},
                })

    # Communications (email / WhatsApp / voice) — outbound touchpoints
    comms = db.query(Communication).filter(
        Communication.tenant_id == session.tenant.id,
        Communication.candidate_id == candidate_id,
    ).all()
    for cm in comms:
        channel_label = {
            "email": "Email", "whatsapp": "WhatsApp", "voice": "Call",
        }.get(cm.channel, cm.channel.title())
        if cm.status == "failed":
            label = f"{channel_label} failed: {cm.error[:80] if cm.error else 'unknown error'}"
        elif cm.direction == "inbound":
            label = f"{channel_label} received from candidate"
        else:
            preview = (cm.body or "").replace("\n", " ").strip()
            if len(preview) > 80:
                preview = preview[:77] + "..."
            label = f"{channel_label} sent · {preview}"
        items.append({
            "type": f"comm_{cm.channel}",
            "at": cm.sent_at.isoformat() if cm.sent_at else None,
            "label": label,
            "meta": {
                "communication_id": cm.id,
                "channel": cm.channel,
                "status": cm.status,
                "direction": cm.direction,
                "body": cm.body[:500] if cm.body else "",
                "to": cm.to_address,
            },
        })

    # Queued / completed calls
    calls = db.query(CallQueue).filter(
        CallQueue.tenant_id == session.tenant.id,
        CallQueue.candidate_id == candidate_id,
    ).all()
    for cl in calls:
        if cl.status == "completed":
            label = f"Voice call completed · {cl.outcome or 'no outcome captured'}"
        elif cl.status == "rescheduled":
            label = "Voice call rescheduled"
        elif cl.status == "failed":
            label = f"Voice call failed: {(cl.last_error or '')[:80]}"
        elif cl.status == "cancelled":
            label = "Voice call cancelled"
        elif cl.status == "in_progress":
            label = "Voice call in progress"
        else:
            label = f"Voice call queued · {cl.purpose or 'screening'}"
        items.append({
            "type": f"call_{cl.status}",
            "at": (cl.scheduled_for or cl.created_at).isoformat() if (cl.scheduled_for or cl.created_at) else None,
            "label": label,
            "meta": {
                "call_id": cl.id,
                "purpose": cl.purpose,
                "status": cl.status,
                "to_phone": cl.to_phone,
            },
        })

    # Resume fraud signals — group by application + signal type so we
    # don't spam the timeline if a CV had 8 white-on-white spans.
    fraud_rows = db.query(ResumeFraudSignal).filter(
        ResumeFraudSignal.tenant_id == session.tenant.id,
        ResumeFraudSignal.candidate_id == candidate_id,
    ).all()
    grouped: dict[tuple, list[ResumeFraudSignal]] = {}
    for r in fraud_rows:
        grouped.setdefault((r.application_id, r.signal_type), []).append(r)
    for (app_id, sig_type), rows in grouped.items():
        first = min(rows, key=lambda r: r.detected_at or datetime.utcnow())
        crit = any(r.severity == "critical" for r in rows)
        items.append({
            "type": "fraud_detected",
            "at": first.detected_at.isoformat() if first.detected_at else None,
            "label": (
                f"⚠ Fraud signal: {sig_type.replace('_', ' ')} "
                f"(×{len(rows)}, {first.severity})"
            ),
            "meta": {
                "application_id": app_id,
                "signal_type": sig_type,
                "count": len(rows),
                "severity": "critical" if crit else first.severity,
            },
        })

    # Sort: chronological (oldest first). Treat None timestamps as oldest.
    items.sort(key=lambda x: x.get("at") or "")
    return {"timeline": items}


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
