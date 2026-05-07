"""Tenant integration credentials — Twilio, etc."""
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from auth.dependencies import current_session, CurrentSession
from database import get_db
from models import TenantIntegration
from services import twilio_service

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
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    row = twilio_service.upsert_config(
        db,
        tenant_id=session.tenant.id,
        account_sid=req.account_sid,
        auth_token=req.auth_token,
        whatsapp_from=req.whatsapp_from,
        sms_from=req.sms_from,
        enabled=req.enabled,
    )
    return {"integration": twilio_service.to_response(row)}


@router.delete("/twilio")
def delete_twilio(
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    row = db.query(TenantIntegration).filter(
        TenantIntegration.tenant_id == session.tenant.id,
        TenantIntegration.provider == twilio_service.PROVIDER,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="No Twilio integration to remove")
    db.delete(row)
    db.commit()
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
    try:
        result = twilio_service.send_test_message(cfg, req.to)
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
