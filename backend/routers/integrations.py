"""Tenant integration credentials — Twilio, etc."""
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from auth.dependencies import current_session, CurrentSession
from database import get_db
from models import TenantIntegration
from services import twilio_service
from services.audit import write_audit

router = APIRouter(prefix="/api/v1/integrations", tags=["integrations"])


@router.get("")
def list_integrations(
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """List all integrations configured for this tenant. Secrets never leave."""
    rows = db.query(TenantIntegration).filter(
        TenantIntegration.tenant_id == session.tenant.id,
    ).all()
    return {"integrations": [twilio_service.to_response(r) for r in rows]}


@router.get("/twilio")
def get_twilio(
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    row = db.query(TenantIntegration).filter(
        TenantIntegration.tenant_id == session.tenant.id,
        TenantIntegration.provider == twilio_service.PROVIDER,
    ).first()
    if not row:
        return {"integration": None}
    return {"integration": twilio_service.to_response(row)}


class TwilioUpdateRequest(BaseModel):
    account_sid: str = Field(..., min_length=1)
    auth_token: Optional[str] = Field(default=None, description="Leave blank to keep the existing token")
    whatsapp_from: str = ""
    sms_from: str = ""
    enabled: bool = True


@router.put("/twilio")
def put_twilio(
    req: TwilioUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    existing = db.query(TenantIntegration).filter(
        TenantIntegration.tenant_id == session.tenant.id,
        TenantIntegration.provider == twilio_service.PROVIDER,
    ).first()
    is_create = existing is None

    try:
        row = twilio_service.upsert_config(
            db,
            tenant_id=session.tenant.id,
            account_sid=req.account_sid,
            auth_token=req.auth_token,
            whatsapp_from=req.whatsapp_from,
            sms_from=req.sms_from,
            enabled=req.enabled,
        )
    except twilio_service.TwilioConfigError as e:
        # Surface validation messages as 400 with the message as detail
        # — the settings UI displays it as a field-level error pill.
        raise HTTPException(status_code=400, detail=str(e))
    write_audit(
        db,
        action="integration.twilio.create" if is_create else "integration.twilio.update",
        actor=session.user,
        tenant_id=session.tenant.id,
        resource_type="integration",
        resource_id=row.id,
        payload={
            "account_sid_suffix": (req.account_sid or "")[-6:],
            "whatsapp_from": req.whatsapp_from,
            "sms_from": req.sms_from,
            "enabled": req.enabled,
            "auth_token_changed": bool(req.auth_token),
        },
        severity="warning",
        request=request,
    )
    return {"integration": twilio_service.to_response(row)}


@router.delete("/twilio")
def delete_twilio(
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    row = db.query(TenantIntegration).filter(
        TenantIntegration.tenant_id == session.tenant.id,
        TenantIntegration.provider == twilio_service.PROVIDER,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="No Twilio integration to remove")
    integration_id = row.id
    db.delete(row)
    db.commit()
    write_audit(
        db,
        action="integration.twilio.delete",
        actor=session.user,
        tenant_id=session.tenant.id,
        resource_type="integration",
        resource_id=integration_id,
        severity="warning",
        request=request,
    )
    return {"deleted": True}


class TwilioTestRequest(BaseModel):
    to: str = Field(..., description="WhatsApp number to test (E.164, with or without 'whatsapp:' prefix)")


@router.post("/twilio/test")
def test_twilio(
    req: TwilioTestRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Send a fixed test WhatsApp message to verify the credentials work."""
    try:
        cfg = twilio_service.load_config(db, session.tenant.id)
    except twilio_service.TwilioConfigError as e:
        raise HTTPException(status_code=400, detail=str(e))
    # Validate the recipient too — Twilio rejects non-E.164 numbers with
    # a generic 400 that's harder to debug than this field-level message.
    try:
        to_e164 = twilio_service._normalise_phone(
            req.to.replace("whatsapp:", ""),
            field="Test recipient",
            required=True,
        )
    except twilio_service.TwilioConfigError as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        result = twilio_service.send_test_message(cfg, to_e164)
    except Exception as e:
        # Persist the error so the Settings UI can surface it.
        row = db.query(TenantIntegration).filter(
            TenantIntegration.tenant_id == session.tenant.id,
            TenantIntegration.provider == twilio_service.PROVIDER,
        ).first()
        if row:
            row.last_error = str(e)[:500]
            db.commit()
        raise HTTPException(status_code=400, detail=str(e))
    # Stamp success
    row = db.query(TenantIntegration).filter(
        TenantIntegration.tenant_id == session.tenant.id,
        TenantIntegration.provider == twilio_service.PROVIDER,
    ).first()
    if row:
        row.last_used_at = datetime.utcnow()
        row.last_error = ""
        db.commit()
    return {"ok": True, "twilio_sid": result.get("sid"), "status": result.get("status")}
