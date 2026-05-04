"""Inbox endpoints: connect, sync, classify, list emails, Gmail integration, auto-workflow."""
from typing import Optional
import json
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models import Email
from schemas import (
    InboxConnectRequest, InboxSyncResponse, InboxClassifyResponse, EmailResponse
)
from services.email_service import load_sample_inbox, fetch_imap_emails, sync_imap_emails
from agents.email_classifier import classify_email, EmailClassifierInput
from services.gmail_service import gmail_manager
from services.workflow_service import run_email_workflow, run_workflow_for_new_emails
from auth.dependencies import current_session, CurrentSession

router = APIRouter(prefix="/api/v1/inbox", tags=["inbox"])

# In-memory connection state
_inbox_config: dict = {}


# ═══════════════════════════════════════
# GMAIL INTEGRATION
# ═══════════════════════════════════════

class GmailConnectRequest(BaseModel):
    email: str
    app_password: str = ""  # No longer required (OAuth2 via env vars)


class GmailPollRequest(BaseModel):
    interval: int = 30


@router.post("/gmail/connect")
async def connect_gmail(
    req: GmailConnectRequest,
    _: CurrentSession = Depends(current_session),
):
    """Connect to Gmail via IMAP with App Password."""
    try:
        result = gmail_manager.connect(req.email, req.app_password)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/gmail/disconnect")
async def disconnect_gmail(_: CurrentSession = Depends(current_session)):
    """Disconnect Gmail and clear saved credentials."""
    gmail_manager.disconnect()
    return {"status": "disconnected"}


@router.post("/gmail/sync")
async def sync_gmail(
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Fetch new emails from Gmail and store them under the caller's tenant."""
    if not gmail_manager.connected:
        raise HTTPException(status_code=400, detail="Gmail not connected")

    try:
        new_emails = gmail_manager.fetch_new_emails(db, limit=20)
        # Tag any newly synced emails (which were inserted with no tenant_id) for this tenant
        for em in new_emails:
            if em.tenant_id is None:
                em.tenant_id = session.tenant.id
        db.commit()
        return {
            "synced_count": len(new_emails),
            "new_emails": [_email_to_response(e) for e in new_emails],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/gmail/sync-and-process")
async def sync_and_process_gmail(
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Fetch new emails from Gmail AND run auto-workflow on each."""
    if not gmail_manager.connected:
        raise HTTPException(status_code=400, detail="Gmail not connected")

    try:
        new_emails = gmail_manager.fetch_new_emails(db, limit=20)
        for em in new_emails:
            if em.tenant_id is None:
                em.tenant_id = session.tenant.id
        db.commit()

        workflow_results = []

        for em in new_emails:
            try:
                result = await run_email_workflow(em.id, db)
                workflow_results.append(result)
            except Exception as e:
                workflow_results.append({
                    "email_id": em.id,
                    "status": "error",
                    "message": str(e),
                })

        return {
            "synced_count": len(new_emails),
            "workflow_results": workflow_results,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/gmail/watch")
async def start_gmail_watch(
    req: GmailPollRequest,
    _: CurrentSession = Depends(current_session),
):
    """Start automatic polling for new Gmail emails + auto-workflow (legacy)."""
    try:
        result = gmail_manager.start_polling(interval=req.interval)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/gmail/idle/start")
async def start_gmail_idle(_: CurrentSession = Depends(current_session)):
    """Start IMAP IDLE listener — triggers workflow instantly on new email."""
    try:
        result = gmail_manager.start_idle_listener()
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/gmail/idle/stop")
async def stop_gmail_idle(_: CurrentSession = Depends(current_session)):
    """Stop IMAP IDLE listener."""
    return gmail_manager.stop_idle_listener()


@router.post("/gmail/stop")
async def stop_gmail_watch(_: CurrentSession = Depends(current_session)):
    """Stop any active listener (IDLE or polling)."""
    return gmail_manager.stop_all()


@router.get("/gmail/status")
async def gmail_status(_: CurrentSession = Depends(current_session)):
    """Get Gmail connection and auto-workflow status."""
    return gmail_manager.get_status()


# ═══════════════════════════════════════
# AUTO-WORKFLOW
# ═══════════════════════════════════════

@router.post("/workflow/run")
async def run_auto_workflow(
    db: Session = Depends(get_db),
    _: CurrentSession = Depends(current_session),
):
    """Run auto-workflow on all unprocessed emails."""
    results = await run_workflow_for_new_emails(db)
    return {
        "processed_count": len(results),
        "results": results,
    }


@router.post("/workflow/run/{email_id}")
async def run_workflow_single(
    email_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Run auto-workflow for a single email."""
    em = db.query(Email).filter(
        Email.id == email_id,
        Email.tenant_id == session.tenant.id,
    ).first()
    if not em:
        raise HTTPException(status_code=404, detail="Email not found")
    result = await run_email_workflow(email_id, db)
    return result


# ═══════════════════════════════════════
# EXISTING SAMPLE / IMAP ENDPOINTS
# ═══════════════════════════════════════

@router.post("/connect")
async def connect_inbox(
    req: InboxConnectRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    global _inbox_config
    _inbox_config = req.model_dump()
    if req.mode == "sample":
        emails = load_sample_inbox(db)
        for em in emails:
            if em.tenant_id is None:
                em.tenant_id = session.tenant.id
        db.commit()
        return {"status": "connected", "mode": "sample", "emails_loaded": len(emails)}
    else:
        return {"status": "connected", "mode": "imap", "host": req.imap_host}


@router.post("/sync", response_model=InboxSyncResponse)
async def sync_inbox(
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    mode = _inbox_config.get("mode", "sample")
    if mode == "sample":
        emails = load_sample_inbox(db)
    else:
        host = _inbox_config.get("imap_host", "")
        if not host:
            raise HTTPException(status_code=400, detail="No inbox connected. Call /inbox/connect first.")
        fetched = fetch_imap_emails(
            host=host,
            port=_inbox_config.get("imap_port", 993),
            user=_inbox_config.get("imap_user", ""),
            password=_inbox_config.get("imap_pass", ""),
            ssl=_inbox_config.get("imap_ssl", True),
        )
        emails = sync_imap_emails(db, fetched)

    for em in emails:
        if em.tenant_id is None:
            em.tenant_id = session.tenant.id
    db.commit()

    return InboxSyncResponse(
        synced_count=len(emails),
        new_emails=[_email_to_response(e) for e in emails],
    )


@router.post("/classify", response_model=InboxClassifyResponse)
async def classify_emails(
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    unclassified = db.query(Email).filter(
        Email.tenant_id == session.tenant.id,
        Email.classified_as.is_(None),
    ).all()
    results = []
    for em in unclassified:
        attachments = json.loads(em.attachments) if em.attachments else []
        attachment_names = [a.get("filename", "") for a in attachments]

        input_data = EmailClassifierInput(
            subject=em.subject,
            from_name=em.from_name,
            from_email=em.from_address,
            attachment_names=attachment_names,
            body_text=em.body_snippet,
        )
        output = await classify_email(input_data)

        em.classified_as = output.category
        em.confidence = output.confidence
        em.classification = json.dumps({
            "category": output.category,
            "confidence": output.confidence,
            "reasoning": output.reasoning,
            "suggested_action": output.suggested_action,
            "detected_name": output.detected_name,
            "detected_role": output.detected_role,
        })
        em.processed = 1

        results.append({
            "email_id": em.id,
            "classified_as": output.category,
            "confidence": output.confidence,
            "detected_name": output.detected_name,
        })

    db.commit()
    return InboxClassifyResponse(classified_count=len(results), results=results)


@router.get("/emails")
async def list_emails(
    classified_as: Optional[str] = None,
    page: int = 1,
    per_page: int = 20,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    query = db.query(Email).filter(Email.tenant_id == session.tenant.id)
    if classified_as:
        query = query.filter(Email.classified_as == classified_as)

    total = query.count()
    emails = query.order_by(Email.received_at.desc()).offset((page - 1) * per_page).limit(per_page).all()

    return {
        "emails": [_email_to_response(e) for e in emails],
        "total": total,
        "page": page,
        "per_page": per_page,
    }


@router.get("/emails/{email_id}")
async def get_email(
    email_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    em = db.query(Email).filter(
        Email.id == email_id,
        Email.tenant_id == session.tenant.id,
    ).first()
    if not em:
        raise HTTPException(status_code=404, detail="Email not found")
    resp = _email_to_response(em)
    resp["body_full"] = em.body_full
    resp["classification"] = json.loads(em.classification) if em.classification else None
    return resp


def _email_to_response(em: Email) -> dict:
    return {
        "id": em.id,
        "message_id": em.message_id,
        "from_address": em.from_address,
        "from_name": em.from_name,
        "subject": em.subject,
        "body_snippet": em.body_snippet,
        "attachments": json.loads(em.attachments) if em.attachments else [],
        "classified_as": em.classified_as,
        "confidence": em.confidence,
        "processed": em.processed,
        "received_at": em.received_at.isoformat() if em.received_at else None,
        "created_at": em.created_at.isoformat() if em.created_at else None,
    }
