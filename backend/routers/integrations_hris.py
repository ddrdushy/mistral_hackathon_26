"""HRIS / ATS integrations router (Feature 9)."""
import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from auth.dependencies import current_session, CurrentSession, require_owner
from database import get_db
from models import ExternalIntegration, IntegrationSyncLog
from services.audit import write_audit
from services.secrets_crypto import encrypt
from services.integrations import available_providers, get_adapter
from services.integrations.sync_engine import sync_one

router = APIRouter(prefix="/api/v1/integrations/hris", tags=["integrations-hris"])


def _row_to_response(row: ExternalIntegration) -> dict:
    try:
        settings = json.loads(row.settings_json or "{}")
    except Exception:
        settings = {}
    return {
        "id": row.id,
        "provider": row.provider,
        "provider_account_id": row.provider_account_id or "",
        "sync_enabled": bool(row.sync_enabled),
        "sync_status": row.sync_status or "active",
        "last_synced_at": row.last_synced_at.isoformat() if row.last_synced_at else None,
        "last_error": row.last_error or "",
        "settings": settings,
        "push_ai_signals": bool(row.push_ai_signals),
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


# ─── Catalog + list ──────────────────────────────────────────────────────────


@router.get("/available")
def list_available(_: CurrentSession = Depends(current_session)):
    """Provider catalog for the UI."""
    return {"providers": available_providers()}


@router.get("")
def list_my_integrations(
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    rows = db.query(ExternalIntegration).filter(
        ExternalIntegration.tenant_id == session.tenant.id,
    ).order_by(ExternalIntegration.provider.asc()).all()
    return {"integrations": [_row_to_response(r) for r in rows]}


# ─── Connect / disconnect ────────────────────────────────────────────────────


class ConnectRequest(BaseModel):
    # All known auth fields — the adapter only reads the ones it needs.
    api_key: Optional[str] = None
    public_token: Optional[str] = None   # Merge.dev
    access_token: Optional[str] = None   # OAuth
    refresh_token: Optional[str] = None  # OAuth
    seed: Optional[str] = None           # Mock provider
    provider_account_id: Optional[str] = None
    settings: dict = Field(default_factory=dict)


@router.post("/connect/{provider}", status_code=201)
async def connect(
    provider: str,
    req: ConnectRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_owner),
):
    """Connect (or reconnect) a provider for the current tenant."""
    catalog = {p["id"]: p for p in available_providers()}
    if provider not in catalog:
        raise HTTPException(status_code=404, detail=f"Unknown provider: {provider}")
    if not catalog[provider]["enabled"]:
        raise HTTPException(
            status_code=400,
            detail=f"{catalog[provider]['name']} adapter is not implemented yet — only the mock provider is fully wired in v1.",
        )

    credentials = {
        k: v for k, v in {
            "api_key": req.api_key,
            "public_token": req.public_token,
            "access_token": req.access_token,
            "refresh_token": req.refresh_token,
            "seed": req.seed,
        }.items() if v is not None
    }

    row = db.query(ExternalIntegration).filter(
        ExternalIntegration.tenant_id == session.tenant.id,
        ExternalIntegration.provider == provider,
    ).first()

    if row:
        row.encrypted_credentials = encrypt(json.dumps(credentials))
        row.settings_json = json.dumps(req.settings or {})
        row.provider_account_id = req.provider_account_id or ""
        row.sync_enabled = True
        row.sync_status = "active"
        row.last_error = ""
    else:
        row = ExternalIntegration(
            tenant_id=session.tenant.id,
            provider=provider,
            provider_account_id=req.provider_account_id or "",
            encrypted_credentials=encrypt(json.dumps(credentials)),
            settings_json=json.dumps(req.settings or {}),
            sync_enabled=True,
            sync_status="active",
        )
        db.add(row)
    try:
        db.commit()
        db.refresh(row)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Already connected — use PUT to update.")

    # Probe the connection. Failure is captured but doesn't undo the
    # save — tenant can re-enter creds and re-sync.
    try:
        adapter = get_adapter(row)
        ok = await adapter.test_connection()
        if not ok:
            row.sync_status = "auth_failed"
            row.last_error = "test_connection returned False"
    except NotImplementedError as e:
        row.sync_status = "error"
        row.last_error = str(e)
    except Exception as e:
        row.sync_status = "auth_failed"
        row.last_error = str(e)[:500]
    db.commit()

    write_audit(
        db, action="integration.hris.connect", actor=session.user,
        tenant_id=session.tenant.id, resource_type="external_integration",
        resource_id=row.id,
        payload={
            "provider": provider,
            # Never log raw credentials — only which fields were supplied.
            "credentials_keys": sorted(credentials.keys()),
            "status": row.sync_status,
        },
        severity="warning", request=request,
    )
    return _row_to_response(row)


@router.delete("/{integration_id}")
def disconnect(
    integration_id: int,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_owner),
):
    row = db.query(ExternalIntegration).filter(
        ExternalIntegration.id == integration_id,
        ExternalIntegration.tenant_id == session.tenant.id,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Integration not found")
    provider = row.provider
    db.delete(row)
    db.commit()
    write_audit(
        db, action="integration.hris.disconnect", actor=session.user,
        tenant_id=session.tenant.id, resource_type="external_integration",
        resource_id=integration_id,
        payload={"provider": provider},
        severity="warning", request=request,
    )
    return {"deleted": True}


# ─── Mapping update ──────────────────────────────────────────────────────────


class MappingUpdateRequest(BaseModel):
    settings: dict
    push_ai_signals: Optional[bool] = None


@router.put("/{integration_id}/mapping")
def update_mapping(
    integration_id: int,
    req: MappingUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_owner),
):
    row = db.query(ExternalIntegration).filter(
        ExternalIntegration.id == integration_id,
        ExternalIntegration.tenant_id == session.tenant.id,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Integration not found")
    row.settings_json = json.dumps(req.settings or {})
    if req.push_ai_signals is not None:
        row.push_ai_signals = bool(req.push_ai_signals)
    db.commit()
    write_audit(
        db, action="integration.hris.mapping_update", actor=session.user,
        tenant_id=session.tenant.id, resource_type="external_integration",
        resource_id=integration_id, request=request,
    )
    return _row_to_response(row)


# ─── Status + manual sync + logs ─────────────────────────────────────────────


@router.get("/{integration_id}/status")
def get_status(
    integration_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    row = db.query(ExternalIntegration).filter(
        ExternalIntegration.id == integration_id,
        ExternalIntegration.tenant_id == session.tenant.id,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Integration not found")
    latest_log = db.query(IntegrationSyncLog).filter(
        IntegrationSyncLog.integration_id == integration_id,
    ).order_by(IntegrationSyncLog.started_at.desc()).first()
    return {
        "integration": _row_to_response(row),
        "latest_log": _log_to_response(latest_log) if latest_log else None,
    }


def _log_to_response(log: IntegrationSyncLog) -> dict:
    try:
        payload = json.loads(log.payload_summary_json or "{}")
    except Exception:
        payload = {}
    return {
        "id": log.id,
        "started_at": log.started_at.isoformat() if log.started_at else None,
        "finished_at": log.finished_at.isoformat() if log.finished_at else None,
        "direction": log.direction,
        "status": log.status,
        "records_processed": log.records_processed or 0,
        "records_failed": log.records_failed or 0,
        "error_summary": log.error_summary or "",
        "payload": payload,
    }


@router.get("/{integration_id}/logs")
def list_logs(
    integration_id: int,
    limit: int = 50,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    row = db.query(ExternalIntegration).filter(
        ExternalIntegration.id == integration_id,
        ExternalIntegration.tenant_id == session.tenant.id,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Integration not found")
    logs = db.query(IntegrationSyncLog).filter(
        IntegrationSyncLog.integration_id == integration_id,
    ).order_by(IntegrationSyncLog.started_at.desc()).limit(min(limit, 200)).all()
    return {"logs": [_log_to_response(l) for l in logs]}


@router.post("/{integration_id}/sync")
async def trigger_sync(
    integration_id: int,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_owner),
):
    """Force a sync NOW (bypasses the 15-min worker cadence)."""
    row = db.query(ExternalIntegration).filter(
        ExternalIntegration.id == integration_id,
        ExternalIntegration.tenant_id == session.tenant.id,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Integration not found")
    try:
        result = await sync_one(integration_id)
    except NotImplementedError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Sync failed: {e}")

    write_audit(
        db, action="integration.hris.manual_sync", actor=session.user,
        tenant_id=session.tenant.id, resource_type="external_integration",
        resource_id=integration_id, payload=result, request=request,
    )
    return result


class TogglePauseRequest(BaseModel):
    enabled: bool


@router.post("/{integration_id}/toggle")
def toggle(
    integration_id: int,
    req: TogglePauseRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_owner),
):
    row = db.query(ExternalIntegration).filter(
        ExternalIntegration.id == integration_id,
        ExternalIntegration.tenant_id == session.tenant.id,
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="Integration not found")
    row.sync_enabled = bool(req.enabled)
    if not req.enabled:
        row.sync_status = "paused"
    elif row.sync_status == "paused":
        row.sync_status = "active"
    db.commit()
    return _row_to_response(row)
