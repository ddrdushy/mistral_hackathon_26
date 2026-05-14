"""Inbox endpoints: connect, sync, classify, list emails, Gmail integration, auto-workflow."""
from typing import Optional
import json
from datetime import datetime, timedelta, timezone
from pydantic import BaseModel, Field
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session
from database import get_db
from models import Email, LlmUsage, MailAccount
from schemas import (
    InboxConnectRequest, InboxSyncResponse, InboxClassifyResponse, EmailResponse
)
from services.email_service import load_sample_inbox, fetch_imap_emails, sync_imap_emails
from agents.email_classifier import classify_email, EmailClassifierInput
from services.gmail_service import gmail_manager
from services.workflow_service import run_email_workflow, run_workflow_for_new_emails
from services import mail_account_service, mailbox_listener
from billing.cost_guard import usage_today as llm_usage_today
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
    application_email_ids: list[int] = []
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

        # Local override: when an email carries 2+ resume-shaped
        # attachments the LLM has been observed to label it "general"
        # (e.g. a recruiter forwarding a batch of profiles with subject
        # "FW: Profiles"). Multiple PDFs/DOCXs that look like CVs are
        # an extremely strong application signal — promote it.
        resume_like = [
            n for n in attachment_names
            if n and n.lower().endswith((".pdf", ".docx", ".doc"))
        ]
        if (
            len(resume_like) >= 2
            and output.category != "candidate_application"
        ):
            output.category = "candidate_application"
            output.confidence = max(output.confidence or 0.0, 0.9)
            output.reasoning = (
                (output.reasoning or "")
                + " [override: 2+ resume-shaped attachments]"
            )

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

        # Auto-create candidates for anything classified as an
        # application. HR was clicking "Create Candidate" by hand on
        # every row anyway; this just folds that step into classify.
        if output.category == "candidate_application":
            application_email_ids.append(em.id)

    db.commit()

    # Run the full workflow (CV extract → dedup → candidate row →
    # match → score) for every email we just classified as an
    # application. Best-effort: per-email failures don't break the
    # batch; the row stays at processed=1 so the existing manual
    # "Create Candidate" button is still a fallback if HR wants it.
    if application_email_ids:
        from services.workflow_service import run_email_workflow
        for eid in application_email_ids:
            try:
                await run_email_workflow(eid, db)
            except Exception as e:
                import logging as _log
                _log.getLogger("hireops.inbox").warning(
                    "Auto-workflow failed for email %s after classify: %s",
                    eid, e,
                )

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


# ═══════════════════════════════════════
# TENANT MAILBOX CONNECTIONS (multi-account, encrypted at rest)
# ═══════════════════════════════════════
#
# Replaces the old process-global `_inbox_config` for IMAP/POP3 providers.
# Each tenant can register any number of mailboxes (jobs@, hr@, careers@, …)
# and credentials are encrypted via services.secrets_crypto. The legacy
# `/inbox/connect` endpoint above stays for backward compat (sample mode).


_PROVIDER_PRESETS = {
    "outlook":  {"host": "outlook.office365.com", "port": 993, "ssl": True,  "auth": "imap_password"},
    "yahoo":    {"host": "imap.mail.yahoo.com",   "port": 993, "ssl": True,  "auth": "imap_password"},
    "icloud":   {"host": "imap.mail.me.com",      "port": 993, "ssl": True,  "auth": "imap_password"},
    "exchange": {"host": "outlook.office365.com", "port": 993, "ssl": True,  "auth": "imap_password"},
    "aol":      {"host": "imap.aol.com",          "port": 993, "ssl": True,  "auth": "imap_password"},
    "gmail":    {"host": "imap.gmail.com",        "port": 993, "ssl": True,  "auth": "imap_password"},
    "imap":     {"host": "",                      "port": 993, "ssl": True,  "auth": "imap_password"},
    "pop3":     {"host": "",                      "port": 995, "ssl": True,  "auth": "pop3_password"},
}


class MailAccountCreateRequest(BaseModel):
    provider: str = Field(..., description="gmail|outlook|yahoo|icloud|exchange|aol|imap|pop3")
    email_address: str
    secret: str = Field(..., min_length=1, description="App password or token")
    imap_host: Optional[str] = None
    imap_port: Optional[int] = None
    imap_ssl: Optional[bool] = None
    imap_user: Optional[str] = None


@router.get("/accounts")
async def list_mail_accounts(
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """List every mailbox the current tenant has connected."""
    accounts = mail_account_service.list_for_tenant(db, session.tenant.id)
    return {"accounts": [mail_account_service.to_response(a) for a in accounts]}


@router.post("/accounts", status_code=201)
async def create_mail_account(
    req: MailAccountCreateRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Add a new tenant mailbox. Validates the IMAP/POP3 login before saving so
    the user finds out about a bad password immediately, not on the next sync."""
    provider = req.provider.lower().strip()
    preset = _PROVIDER_PRESETS.get(provider)
    if not preset:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown provider '{provider}'. Pick one of: {', '.join(_PROVIDER_PRESETS)}",
        )

    host = (req.imap_host or preset["host"]).strip()
    if not host:
        raise HTTPException(status_code=400, detail="imap_host is required for this provider")

    port = req.imap_port if req.imap_port is not None else preset["port"]
    ssl = req.imap_ssl if req.imap_ssl is not None else preset["ssl"]
    auth_method = preset["auth"]
    imap_user = (req.imap_user or req.email_address).strip()

    try:
        account = mail_account_service.create_account(
            db,
            tenant_id=session.tenant.id,
            provider=provider,
            auth_method=auth_method,
            email_address=req.email_address,
            imap_host=host,
            imap_port=port,
            imap_ssl=ssl,
            imap_user=imap_user,
            secret=req.secret,
            test_first=True,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Boot a listener so this mailbox auto-pulls + classifies every ~20s
    # without the user having to click Sync.
    mailbox_listener.start_for_account(account.id)
    return {"account": mail_account_service.to_response(account)}


@router.delete("/accounts/{account_id}")
async def delete_mail_account(
    account_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Disconnect (delete) a tenant mailbox. Existing fetched emails stay."""
    ok = mail_account_service.delete_account(db, session.tenant.id, account_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Mailbox not found")
    mailbox_listener.stop_for_account(account_id)
    return {"ok": True}


class MailAccountPatchRequest(BaseModel):
    listener_enabled: Optional[bool] = None


@router.patch("/accounts/{account_id}")
async def patch_mail_account(
    account_id: int,
    req: MailAccountPatchRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Update a mailbox's per-account settings — currently the listener
    enable/pause flag. Pausing immediately stops auto-pickup so the tenant
    isn't burning classifier LLM tokens on a noisy mailbox."""
    account = mail_account_service.get_for_tenant(db, session.tenant.id, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Mailbox not found")

    if req.listener_enabled is not None:
        account.listener_enabled = req.listener_enabled
        db.commit()
        db.refresh(account)
        # The poll loop checks this flag every iteration, so we don't need to
        # cancel/respawn the task — just flip the bit.

    return {"account": mail_account_service.to_response(account)}


@router.post("/accounts/{account_id}/sync")
async def sync_mail_account(
    account_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Pull new mail from one tenant mailbox + run the auto-workflow."""
    account = mail_account_service.get_for_tenant(db, session.tenant.id, account_id)
    if not account:
        raise HTTPException(status_code=404, detail="Mailbox not found")

    try:
        new_emails = mail_account_service.sync_account(db, account)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Sync failed: {e}")

    workflow_results = []
    for em in new_emails:
        try:
            result = await run_email_workflow(em.id, db)
            workflow_results.append({"email_id": em.id, "result": result})
        except Exception as e:
            workflow_results.append({"email_id": em.id, "error": str(e)})

    return {
        "account": mail_account_service.to_response(account),
        "synced_count": len(new_emails),
        "workflow_results": workflow_results,
    }


@router.post("/accounts/sync-all")
async def sync_all_mail_accounts(
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Sync every mailbox for the tenant. Run the auto-workflow on the new
    emails. Per-account errors don't fail the whole batch."""
    summary = mail_account_service.sync_all_for_tenant(db, session.tenant.id)

    # Run workflow on freshly tagged emails for this tenant (newest first).
    # We don't track which emails came from which sync, so we pick everything
    # this tenant has that's still unprocessed.
    pending = (
        db.query(Email)
        .filter(Email.tenant_id == session.tenant.id, Email.processed == 0)
        .order_by(Email.created_at.desc())
        .limit(summary["total_synced"] or 1)
        .all()
    )
    workflow_results = []
    for em in pending:
        try:
            result = await run_email_workflow(em.id, db)
            workflow_results.append({"email_id": em.id, "result": result})
        except Exception as e:
            workflow_results.append({"email_id": em.id, "error": str(e)})

    return {
        **summary,
        "workflow_results": workflow_results,
    }


# ═══════════════════════════════════════
# USAGE METER (per tenant)
# ═══════════════════════════════════════

@router.get("/usage")
async def inbox_usage(
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Tenant-scoped inbox usage: emails received, emails classified, and
    LLM classifier spend (today + this month) plus the daily LLM budget.
    Used to render the Inbox usage meter so HR can see cost as classifier
    runs on each incoming email."""
    tenant_id = session.tenant.id
    now = datetime.utcnow()
    start_of_day = datetime(now.year, now.month, now.day)
    start_of_month = datetime(now.year, now.month, 1)

    def _email_count(*conds):
        q = db.query(func.count(Email.id)).filter(Email.tenant_id == tenant_id)
        for c in conds:
            q = q.filter(c)
        return q.scalar() or 0

    emails_today = _email_count(Email.created_at >= start_of_day)
    emails_month = _email_count(Email.created_at >= start_of_month)
    classified_today = _email_count(
        Email.created_at >= start_of_day, Email.processed >= 1
    )
    classified_month = _email_count(
        Email.created_at >= start_of_month, Email.processed >= 1
    )
    candidates_created_month = _email_count(
        Email.created_at >= start_of_month, Email.processed >= 2
    )

    def _classifier_spend(since: datetime) -> dict:
        row = (
            db.query(
                func.coalesce(func.sum(LlmUsage.cost_usd), 0.0),
                func.coalesce(func.sum(LlmUsage.input_tokens + LlmUsage.output_tokens), 0),
                func.count(LlmUsage.id),
            )
            .filter(
                LlmUsage.tenant_id == tenant_id,
                LlmUsage.agent_name == "email_classifier",
                LlmUsage.created_at >= since,
            )
            .one()
        )
        return {
            "cost_usd": round(float(row[0] or 0.0), 4),
            "tokens": int(row[1] or 0),
            "calls": int(row[2] or 0),
        }

    classifier_today = _classifier_spend(start_of_day)
    classifier_month = _classifier_spend(start_of_month)

    # Overall daily LLM budget snapshot (across all agents — same as billing/usage.llm_today)
    llm_budget = llm_usage_today(tenant_id)

    return {
        "emails": {
            "today": emails_today,
            "month": emails_month,
        },
        "classified": {
            "today": classified_today,
            "month": classified_month,
        },
        "candidates_created_month": candidates_created_month,
        "classifier_llm": {
            "today": classifier_today,
            "month": classifier_month,
        },
        "llm_budget_today": llm_budget,
        "as_of": now.replace(tzinfo=timezone.utc).isoformat(),
    }
