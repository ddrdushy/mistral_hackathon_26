"""Candidate management endpoints."""
from typing import Optional
import json
import re
from datetime import datetime
from urllib.parse import quote
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Request

# Hard cap on the original-binary uploads we persist. A real CV PDF is
# under 5 MB; 15 MB is generous and stops a tenant from filling the
# disk or OOM-ing the worker with a single request.
MAX_RESUME_BYTES = 15 * 1024 * 1024


def _check_size(file_bytes: bytes) -> None:
    if len(file_bytes) > MAX_RESUME_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"File too large — limit is {MAX_RESUME_BYTES // (1024 * 1024)} MB per resume.",
        )


_FILENAME_SAFE = re.compile(r"[^A-Za-z0-9._\- ]+")


def _content_disposition(filename: str, *, inline: bool) -> str:
    """Build a safe Content-Disposition header value.

    Strips control chars from the ASCII fallback and also emits the
    RFC 5987 ``filename*`` form so non-ASCII names (e.g. CVs with
    accented characters) survive without breaking the header.
    """
    base = (filename or "resume").replace("\\", "/").split("/")[-1]
    ascii_name = _FILENAME_SAFE.sub("_", base).strip("._ ") or "resume"
    if len(ascii_name) > 120:
        ascii_name = ascii_name[:120]
    encoded = quote(base, safe="")
    disp = "inline" if inline else "attachment"
    return f"{disp}; filename=\"{ascii_name}\"; filename*=UTF-8''{encoded}"
from pydantic import BaseModel
from sqlalchemy.orm import Session
from database import get_db
from models import Candidate, CandidateCvVersion, Email, CandidateTag, Tag
from schemas import CandidateCreate, CandidateResponse, CandidateFromEmailResponse
from services.resume_service import (
    extract_resume_text,
    parse_contact_info,
    looks_like_job_description,
)
from services.resume_storage import (
    save_resume as save_resume_blob,
    load_resume as load_resume_blob,
    delete_resume as delete_resume_blob,
)
from auth.dependencies import current_session, CurrentSession
from billing.plans import check_quota, check_disk_quota, is_agent_allowed

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

    email_str = (c.email or "").strip()
    email_is_placeholder = email_str.lower().endswith("@uploaded.local")
    return {
        "id": c.id,
        "name": c.name,
        # Surface the email as empty when it's a legacy placeholder so the
        # UI's "missing email" treatment fires consistently across new
        # uploads (now empty) and older rows (still on @uploaded.local).
        "email": "" if email_is_placeholder else c.email,
        "email_missing": (not email_str) or email_is_placeholder,
        "phone": c.phone,
        "resume_text": c.resume_text,
        "resume_filename": c.resume_filename,
        "resume_blob_available": bool((c.resume_blob_path or "").strip()),
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
    """LEGACY email-only lookup. Used by /candidates/upload (the
    single-upload preview path) and a few admin endpoints. New code
    uses `_find_same_person` which requires name + email/phone match."""
    e = (email or "").strip().lower()
    if not e or e.startswith("unknown+") or e.startswith("forwarded+"):
        return None
    return db.query(Candidate).filter(
        Candidate.tenant_id == tenant_id,
        Candidate.email.ilike(e),
    ).first()


_PLACEHOLDER_EMAIL_DOMAIN = "@uploaded.local"


def _norm_name(s: Optional[str]) -> str:
    """Lowercase + strip whitespace + chop trailing credential suffixes
    (PMP®, PhD, MBA, etc.) so 'John Smith' matches 'John Smith PMP®'."""
    import re
    if not s:
        return ""
    out = s.strip().lower()
    out = re.sub(
        r"[,\s]+(pmp|phd|ph\.d|mba|mba\.|cisa|cissp|cpa|cfa|csm)\b.*$",
        "",
        out,
        flags=re.IGNORECASE,
    )
    # Strip stray trademark symbols + extra whitespace.
    out = out.replace("®", "").replace("™", "")
    return re.sub(r"\s+", " ", out).strip()


def _norm_phone(s: Optional[str]) -> str:
    """Digits only — '0176490285' / '+60 176 490 285' / '(017) 649-0285' all collapse."""
    import re
    return re.sub(r"\D", "", s or "")


def _is_placeholder_email(s: str) -> bool:
    return (s or "").lower().endswith(_PLACEHOLDER_EMAIL_DOMAIN)


def _is_same_person(
    existing: Candidate,
    *,
    name: str,
    email: str,
    phone: str,
) -> bool:
    """Treat `existing` as the same person if all three hold:
      1. names match after normalisation,
      2. at least one of email / phone also matches,
      3. no field present on both sides contradicts.

    Placeholder emails (@uploaded.local) are never a real identity
    signal — a candidate with a placeholder email can only be deduped
    via name + phone match.
    """
    en = _norm_name(existing.name)
    nn = _norm_name(name)
    if not en or not nn or en != nn:
        return False

    ee = (existing.email or "").strip().lower()
    ne = (email or "").strip().lower()
    ep = _norm_phone(existing.phone)
    np = _norm_phone(phone)

    real_existing_email = bool(ee) and not _is_placeholder_email(ee)
    real_new_email = bool(ne) and not _is_placeholder_email(ne)
    if real_existing_email and real_new_email and ee != ne:
        return False  # different real emails = different person
    if ep and np and ep != np:
        return False  # different phones = different person

    email_match = real_existing_email and real_new_email and ee == ne
    phone_match = bool(ep) and bool(np) and ep == np
    return email_match or phone_match


def _find_same_person(
    db: Session,
    tenant_id: int,
    *,
    name: str,
    email: str,
    phone: str,
) -> Optional[Candidate]:
    """Linear scan over the tenant's candidates looking for a name +
    (email or phone) match. Sub-second on talent banks under ~10k —
    add a (tenant_id, lower(name)) index when we have to scale past that."""
    if not _norm_name(name):
        return None
    rows = (
        db.query(Candidate)
        .filter(Candidate.tenant_id == tenant_id)
        .all()
    )
    for c in rows:
        if _is_same_person(c, name=name, email=email, phone=phone):
            return c
    return None


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
        blob_path=candidate.resume_blob_path or "",
        source=source,
        uploaded_by_user_id=user_id,
    )
    db.add(snapshot)


# How many archived CV versions to retain per candidate. The most recent
# `MAX_CV_VERSIONS` (live + archived) stay; older archives are deleted
# along with their on-disk binaries. Picked at 10 so HR keeps real
# revision history without letting chatty re-uploaders fill the disk.
MAX_CV_VERSIONS = 10


async def _extract_contact_and_profile(
    resume_text: str,
    tenant,
) -> tuple[dict, "object | None"]:
    """LLM-first contact extraction.

    Sends the resume text to the profile_extractor LLM and uses its
    structured output for name / email / phone — resumes come in every
    layout under the sun (sidebar pills, ASCII art headers, contact
    block buried on page 2), and a regex-on-the-first-5-lines parser
    misses most of them. Returns ``(contact_dict, profile_or_none)``:

      • ``contact_dict``: {"name", "email", "phone"} from the LLM where
        present, regex fallback for any field the LLM left blank.
      • ``profile_or_none``: the full ProfileExtractorOutput when the
        LLM call succeeded (caller will apply it to skip a second
        round-trip), or ``None`` when the plan doesn't include the
        agent / the LLM failed.
    """
    regex_contact = parse_contact_info(resume_text)
    llm_profile = None
    if is_agent_allowed(tenant, "profile_extractor"):
        try:
            from agents.profile_extractor import extract_profile
            llm_profile = await extract_profile(resume_text)
        except Exception:
            llm_profile = None

    def _pick(field: str) -> str:
        if llm_profile is not None:
            val = getattr(llm_profile, field, "") or ""
            if val.strip():
                return val.strip()
        return (regex_contact.get(field) or "").strip()

    contact = {
        "name": _pick("name"),
        "email": _pick("email"),
        "phone": _pick("phone"),
    }
    return contact, llm_profile


def _prune_old_cv_versions(db: Session, candidate: Candidate) -> None:
    """Trim archived CV versions for a candidate to MAX_CV_VERSIONS - 1
    (the live `candidates` row counts as the +1). Deletes the on-disk
    binary for any version we drop.

    Best-effort: silently no-ops on FS errors so a sweep failure can't
    block the upload that triggered it.
    """
    keep = max(1, MAX_CV_VERSIONS - 1)
    rows = (
        db.query(CandidateCvVersion)
        .filter(CandidateCvVersion.candidate_id == candidate.id)
        .order_by(CandidateCvVersion.version_number.desc())
        .all()
    )
    excess = rows[keep:]
    if not excess:
        return
    for v in excess:
        if (v.blob_path or "").strip():
            try:
                delete_resume_blob(v.blob_path)
            except Exception:
                pass
        db.delete(v)


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
    _check_size(file_bytes)
    check_disk_quota(session.tenant, len(file_bytes))

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

    if looks_like_job_description(resume_text, filename):
        raise HTTPException(
            status_code=400,
            detail=(
                "This looks like a job description, not a candidate resume. "
                "Job descriptions belong on the Jobs page — try creating a "
                "new job and uploading this file as the JD instead."
            ),
        )

    # LLM-first contact extraction (regex fallback if plan doesn't
    # include the profile_extractor agent or the call fails).
    contact, llm_profile = await _extract_contact_and_profile(resume_text, session.tenant)
    final_name = (name or contact.get("name") or "").strip()
    final_email = (email or contact.get("email") or "").strip()
    final_phone = (phone or contact.get("phone") or "").strip()

    if not final_name:
        # Last resort — derive a placeholder name so the row is usable.
        # HR can rename in the UI.
        final_name = (filename.rsplit(".", 1)[0] or "Untitled candidate")[:80]
    # Email is left empty when neither the form nor the resume provided
    # one. The UI flags missing-email candidates so HR knows they can't
    # be emailed until a real address is added; all outbound senders
    # (`/applications/{id}/send-interview-invite`, offer, generic email)
    # check for a non-empty email and refuse to send.
    if not final_email:
        final_email = ""

    # Strict same-person dedup: name + (email or phone) must match
    # with no contradictions. Email alone isn't enough — multiple
    # forwarded CVs can share a placeholder email, and family members
    # can share a real one.
    existing = _find_same_person(
        db,
        session.tenant.id,
        name=final_name,
        email=final_email,
        phone=final_phone,
    )
    is_update = existing is not None
    if existing:
        candidate = existing
        # Snapshot v(N) into the archive BEFORE we overwrite with v(N+1).
        _archive_current_cv(db, candidate, source="manual_upload", user_id=session.user.id if hasattr(session, "user") else None)
        _prune_old_cv_versions(db, candidate)
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

    # Persist the original binary on disk in the tenant's directory.
    # Saved after the commit so we have a candidate_id to namespace
    # under. If disk write fails we still keep the row (extracted text
    # alone is useful); we just log and skip blob_path.
    try:
        rel = save_resume_blob(
            tenant_id=candidate.tenant_id,
            candidate_id=candidate.id,
            version=candidate.cv_version or 1,
            filename=filename,
            file_bytes=file_bytes,
        )
        candidate.resume_blob_path = rel
        db.commit()
    except Exception:
        pass

    # Apply the profile we already got from _extract_contact_and_profile
    # — same call extracted contact + skills + role + summary, so no
    # second LLM round-trip. If the call hadn't succeeded (plan gate
    # or transient failure), schedule a lazy background retry so the
    # talent bank eventually gets the tags.
    if llm_profile is not None:
        try:
            from services.workflow_service import _apply_profile
            _apply_profile(db, candidate, llm_profile)
            db.refresh(candidate)
        except Exception:
            pass
    else:
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
            if len(file_bytes) > MAX_RESUME_BYTES:
                raise ValueError(
                    f"file too large (limit {MAX_RESUME_BYTES // (1024 * 1024)} MB)"
                )
            try:
                check_disk_quota(session.tenant, len(file_bytes))
            except HTTPException as e:
                raise ValueError(e.detail if isinstance(e.detail, str) else "disk quota reached")
            fname = f.filename or "resume.pdf"
            if not fname.lower().endswith((".pdf", ".docx", ".doc", ".txt", ".tex")):
                raise ValueError("unsupported file type")
            resume_text = extract_resume_text(fname, file_bytes=file_bytes)
            if not resume_text or not resume_text.strip():
                raise ValueError("no text extractable")
            if looks_like_job_description(resume_text, fname):
                raise ValueError(
                    "looks like a job description — skipped (upload JDs via the Jobs page)"
                )

            # LLM-first contact extraction (regex fallback when the
            # plan doesn't allow the agent or the call fails).
            contact, llm_profile = await _extract_contact_and_profile(
                resume_text, session.tenant
            )
            parsed_email = (contact.get("email") or "").strip()
            parsed_name = (contact.get("name") or fname.rsplit(".", 1)[0])[:80]
            parsed_phone = (contact.get("phone") or "").strip()

            # Strict same-person dedup: name + (email or phone) must
            # match with no contradictions. Otherwise it's a new row,
            # even when email happens to be reused.
            existing = _find_same_person(
                db,
                session.tenant.id,
                name=parsed_name,
                email=parsed_email,
                phone=parsed_phone,
            )
            is_update = existing is not None
            if existing:
                candidate = existing
                _archive_current_cv(db, candidate, source="manual_upload", user_id=session.user.id if hasattr(session, "user") else None)
                _prune_old_cv_versions(db, candidate)
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
                    # Empty email when neither LLM nor regex found one
                    # — UI flags this so HR can add it before sending.
                    email=parsed_email,
                    phone=contact.get("phone", ""),
                    resume_text=resume_text,
                    resume_filename=fname,
                    source_email_id=None,
                    cv_version=1,
                )
                db.add(candidate)
            db.commit()
            db.refresh(candidate)

            try:
                rel = save_resume_blob(
                    tenant_id=candidate.tenant_id,
                    candidate_id=candidate.id,
                    version=candidate.cv_version or 1,
                    filename=fname,
                    file_bytes=file_bytes,
                )
                candidate.resume_blob_path = rel
                db.commit()
            except Exception:
                pass

            # Reuse the profile we already extracted for contact info
            # so we don't pay for a second LLM round-trip per file.
            if llm_profile is not None:
                try:
                    _apply_profile(db, candidate, llm_profile)
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
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Empty file")
    _check_size(file_bytes)
    check_disk_quota(session.tenant, len(file_bytes))
    fname = file.filename or "resume.pdf"
    text = extract_resume_text(fname, file_bytes=file_bytes)
    if text and looks_like_job_description(text, fname):
        raise HTTPException(
            status_code=400,
            detail="This file looks like a job description, not a candidate resume.",
        )

    # Snapshot the previous version (text + blob) before overwriting.
    _archive_current_cv(
        db,
        candidate,
        source="manual_upload",
        user_id=session.user.id if hasattr(session, "user") else None,
    )
    _prune_old_cv_versions(db, candidate)

    candidate.resume_text = text
    candidate.resume_filename = fname
    candidate.cv_version = (candidate.cv_version or 1) + 1
    candidate.updated_at = datetime.utcnow()
    # Force re-extraction so tags follow the new CV.
    candidate.profile_extracted_at = None

    # LLM-first contact extraction. Only fills in fields that are
    # currently blank — never overwrites HR-edited contact info.
    llm_profile = None
    if text:
        contact, llm_profile = await _extract_contact_and_profile(text, session.tenant)
        if not (candidate.phone or "").strip() and contact.get("phone"):
            candidate.phone = contact["phone"]
        if not (candidate.email or "").strip() and contact.get("email"):
            candidate.email = contact["email"]

    db.commit()
    db.refresh(candidate)

    if llm_profile is not None:
        try:
            from services.workflow_service import _apply_profile
            _apply_profile(db, candidate, llm_profile)
            db.refresh(candidate)
        except Exception:
            pass

    try:
        rel = save_resume_blob(
            tenant_id=candidate.tenant_id,
            candidate_id=candidate.id,
            version=candidate.cv_version or 1,
            filename=fname,
            file_bytes=file_bytes,
        )
        candidate.resume_blob_path = rel
        db.commit()
    except Exception:
        pass

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
        # Match across all the fields HR actually thinks of when searching.
        # Phone is digits-only normalised so "+60 176 490 285" also finds
        # rows stored as "0176490285". profile_skills is JSON-stringified
        # so a substring match works without parsing.
        import re
        s = f"%{search}%"
        digits = re.sub(r"\D", "", search)
        clauses = [
            Candidate.name.ilike(s),
            Candidate.email.ilike(s),
            Candidate.profile_role.ilike(s),
            Candidate.profile_summary.ilike(s),
            Candidate.profile_skills.ilike(s),
        ]
        if digits and len(digits) >= 4:
            clauses.append(Candidate.phone.ilike(f"%{digits}%"))
        from sqlalchemy import or_
        query = query.filter(or_(*clauses))
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


class CandidateUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    notes: Optional[str] = None
    talent_bank_status: Optional[str] = None  # available | joined_another | not_available | hired_elsewhere
    talent_bank_status_reason: Optional[str] = None


@router.put("/{candidate_id}")
async def update_candidate(
    candidate_id: int,
    req: CandidateUpdate,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Edit a candidate's contact / notes / availability. Sensible field
    validation; talent_bank_status_updated_at refreshed whenever status
    changes so the WhatsApp inbound bot's reason doesn't override HR's
    manual edit."""
    c = db.query(Candidate).filter(
        Candidate.id == candidate_id,
        Candidate.tenant_id == session.tenant.id,
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail="Candidate not found")

    valid_statuses = {"available", "joined_another", "not_available", "hired_elsewhere"}
    changed = False
    if req.name is not None and req.name.strip():
        c.name = req.name.strip()[:200]
        changed = True
    if req.email is not None:
        e = req.email.strip().lower()
        if e:
            # Soft validation — `_norm_email` doesn't care about format, but
            # reject obvious garbage.
            if "@" not in e or "." not in e.split("@")[-1]:
                raise HTTPException(status_code=400, detail="Email looks malformed")
        c.email = e
        changed = True
    if req.phone is not None:
        c.phone = req.phone.strip()[:60]
        changed = True
    if req.notes is not None:
        c.notes = req.notes.strip()[:4000]
        changed = True
    if req.talent_bank_status is not None:
        if req.talent_bank_status not in valid_statuses:
            raise HTTPException(
                status_code=400,
                detail=f"talent_bank_status must be one of {sorted(valid_statuses)}",
            )
        if c.talent_bank_status != req.talent_bank_status:
            c.talent_bank_status = req.talent_bank_status
            c.talent_bank_status_updated_at = datetime.utcnow()
            if req.talent_bank_status_reason is not None:
                c.talent_bank_status_reason = req.talent_bank_status_reason.strip()[:240]
            changed = True

    if changed:
        c.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(c)
    return _candidate_to_response(c, db=db)


@router.delete("/{candidate_id}")
async def delete_candidate(
    candidate_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Hard-delete a candidate.

    Refuses to delete candidates that already have applications — those
    carry interview history HR needs to keep. Use the talent_bank_status
    flags to "archive" instead, or delete the applications first.
    """
    c = db.query(Candidate).filter(
        Candidate.id == candidate_id,
        Candidate.tenant_id == session.tenant.id,
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail="Candidate not found")

    from models import Application as _App
    app_count = db.query(_App).filter(_App.candidate_id == c.id).count()
    if app_count > 0:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Candidate has {app_count} application(s). Delete those first, "
                "or mark the candidate as 'hired_elsewhere' / 'not_available' "
                "to archive without losing pipeline history."
            ),
        )

    # Collect blob paths BEFORE we delete the row (and let cascades wipe
    # the archived versions). Disk cleanup happens after the DB commit
    # so a transient FS error doesn't roll back the delete.
    blob_paths: list[str] = []
    if (c.resume_blob_path or "").strip():
        blob_paths.append(c.resume_blob_path)
    for v in db.query(CandidateCvVersion).filter(
        CandidateCvVersion.candidate_id == c.id,
        CandidateCvVersion.blob_path.isnot(None),
        CandidateCvVersion.blob_path != "",
    ).all():
        blob_paths.append(v.blob_path)

    # CV version snapshots, tags, communications cascade where the FK
    # is ON DELETE CASCADE; the rest fail-loud here so we know if a
    # downstream reference is unhandled.
    db.delete(c)
    db.commit()

    # Best-effort: drop the on-disk originals. Per-path delete uses
    # _resolve_relative so a bad row in the DB can't take us outside
    # the upload root.
    for p in blob_paths:
        try:
            delete_resume_blob(p)
        except Exception:
            pass

    return {"ok": True, "deleted_id": candidate_id}


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
        "blob_available": bool((c.resume_blob_path or "").strip()),
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
            "blob_available": bool((v.blob_path or "").strip()),
        })
    return {"versions": out}


@router.post("/{candidate_id}/re-extract")
async def re_extract_profile(
    candidate_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Re-run LLM profile extraction for a candidate.

    Surfaces in the talent-bank UI when ``profile_extracted_at`` is null
    (e.g. the original upload's LLM call failed or the tenant's plan
    didn't include the agent yet). Runs ``extract_profile`` against the
    current ``resume_text`` and applies the result.

    Returns the refreshed candidate row so the card re-renders with the
    new role/skills/summary without a page reload.
    """
    c = db.query(Candidate).filter(
        Candidate.id == candidate_id,
        Candidate.tenant_id == session.tenant.id,
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail="Candidate not found")
    if not (c.resume_text or "").strip():
        raise HTTPException(
            status_code=400,
            detail="No resume text to extract from — re-upload the CV first.",
        )
    if not is_agent_allowed(session.tenant, "profile_extractor"):
        raise HTTPException(
            status_code=402,
            detail=(
                "Profile extraction isn't included in the current plan — "
                "upgrade to Starter or Pro to enable AI tagging."
            ),
        )

    from agents.profile_extractor import extract_profile
    from services.workflow_service import _apply_profile
    try:
        prof = await extract_profile(c.resume_text)
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"LLM extraction failed: {e}. Try again in a moment.",
        )
    _apply_profile(db, c, prof)
    db.refresh(c)

    # Also backfill contact fields ONLY when they're currently placeholders
    # — don't overwrite anything HR has edited or that we got at upload time.
    if prof.name and not (c.name or "").strip():
        c.name = prof.name[:200]
    if prof.email and (
        not (c.email or "").strip() or "@uploaded.local" in (c.email or "")
    ):
        c.email = prof.email[:200]
    if prof.phone and not (c.phone or "").strip():
        c.phone = prof.phone[:40]
    db.commit()
    db.refresh(c)

    return {
        "candidate": _candidate_to_response(c, db=db),
        "ok": True,
    }


@router.get("/{candidate_id}/resume/text")
async def get_candidate_resume_text(
    candidate_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Return the extracted text of the candidate's current CV.

    Powers the "View" modal on the talent-bank card — recruiters often
    want a quick text scan without opening the PDF in a new tab.
    """
    c = db.query(Candidate).filter(
        Candidate.id == candidate_id,
        Candidate.tenant_id == session.tenant.id,
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return {
        "candidate_id": c.id,
        "name": c.name,
        "filename": c.resume_filename or "",
        "cv_version": c.cv_version or 1,
        "resume_text": c.resume_text or "",
        "resume_blob_available": bool((c.resume_blob_path or "").strip()),
    }


@router.get("/{candidate_id}/resume/file")
async def download_candidate_resume(
    candidate_id: int,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Stream the original CV binary back to the browser.

    Only works for direct uploads (we keep the original on disk under a
    tenant-scoped dir). Email-arrived resumes still need to be fetched
    via the inbox view since the binary lives in emails.attachments.
    """
    from fastapi.responses import Response
    import mimetypes

    c = db.query(Candidate).filter(
        Candidate.id == candidate_id,
        Candidate.tenant_id == session.tenant.id,
    ).first()
    if not c:
        raise HTTPException(status_code=404, detail="Candidate not found")
    if not (c.resume_blob_path or "").strip():
        raise HTTPException(
            status_code=404,
            detail="No original file on disk for this candidate (was the CV uploaded directly?).",
        )
    data = load_resume_blob(c.resume_blob_path, session.tenant.id)
    if data is None:
        raise HTTPException(status_code=404, detail="Resume file missing on disk")
    fname = c.resume_filename or "resume.pdf"
    mt, _ = mimetypes.guess_type(fname)
    is_pdf = (mt == "application/pdf")

    # Audit-log every CV download. Compliance teams (and us) need to
    # know who pulled a candidate's original file and when — this is
    # PII leaving the system. Best-effort: don't block the download
    # if the audit write fails.
    try:
        from auth.audit import record_audit
        record_audit(
            db,
            actor=session.user,
            action="candidate.resume_download",
            tenant_id=session.tenant.id,
            resource_type="candidate",
            resource_id=str(candidate_id),
            payload={"filename": fname, "bytes": len(data), "scope": "current"},
            request=request,
        )
        db.commit()
    except Exception:
        db.rollback()

    return Response(
        content=data,
        media_type=mt or "application/octet-stream",
        headers={
            # Only PDFs render inline (Chrome's sandboxed viewer); every
            # other type is forced to download so a malicious .txt /
            # .docx can't render in the browser's main frame.
            "Content-Disposition": _content_disposition(fname, inline=is_pdf),
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
        },
    )


@router.get("/{candidate_id}/cv-versions/{version_id}/file")
async def download_cv_version_file(
    candidate_id: int,
    version_id: int,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Download the original binary for a specific archived CV version."""
    from fastapi.responses import Response
    import mimetypes

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
    if not (v.blob_path or "").strip():
        raise HTTPException(status_code=404, detail="No original file archived for this version")
    data = load_resume_blob(v.blob_path, session.tenant.id)
    if data is None:
        raise HTTPException(status_code=404, detail="Archived file missing on disk")
    fname = v.filename or "resume.pdf"
    mt, _ = mimetypes.guess_type(fname)
    is_pdf = (mt == "application/pdf")

    try:
        from auth.audit import record_audit
        record_audit(
            db,
            actor=session.user,
            action="candidate.resume_download",
            tenant_id=session.tenant.id,
            resource_type="candidate",
            resource_id=str(candidate_id),
            payload={
                "filename": fname,
                "bytes": len(data),
                "scope": "archived",
                "version_id": version_id,
                "version_number": v.version_number,
            },
            request=request,
        )
        db.commit()
    except Exception:
        db.rollback()

    return Response(
        content=data,
        media_type=mt or "application/octet-stream",
        headers={
            "Content-Disposition": _content_disposition(fname, inline=is_pdf),
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "Referrer-Policy": "no-referrer",
        },
    )


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
