"""Candidate management endpoints."""
from typing import Optional
import json
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlalchemy.orm import Session
from database import get_db
from models import Candidate, Email
from schemas import CandidateCreate, CandidateResponse, CandidateFromEmailResponse
from services.resume_service import extract_resume_text, parse_contact_info

router = APIRouter(prefix="/api/v1/candidates", tags=["candidates"])


def _candidate_to_response(c: Candidate) -> dict:
    return {
        "id": c.id,
        "name": c.name,
        "email": c.email,
        "phone": c.phone,
        "resume_text": c.resume_text,
        "resume_filename": c.resume_filename,
        "source_email_id": c.source_email_id,
        "notes": c.notes,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


@router.post("")
async def create_candidate(req: CandidateCreate, db: Session = Depends(get_db)):
    candidate = Candidate(
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
async def create_from_email(email_id: int, db: Session = Depends(get_db)):
    em = db.query(Email).filter(Email.id == email_id).first()
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


@router.post("/{candidate_id}/upload-resume")
async def upload_resume(
    candidate_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    candidate = db.query(Candidate).filter(Candidate.id == candidate_id).first()
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
):
    query = db.query(Candidate)
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
async def get_candidate(candidate_id: int, db: Session = Depends(get_db)):
    c = db.query(Candidate).filter(Candidate.id == candidate_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return _candidate_to_response(c)


@router.patch("/{candidate_id}/notes")
async def update_notes(candidate_id: int, body: dict, db: Session = Depends(get_db)):
    c = db.query(Candidate).filter(Candidate.id == candidate_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Candidate not found")
    c.notes = body.get("notes", "")
    c.updated_at = datetime.utcnow()
    db.commit()
    return {"status": "updated"}
