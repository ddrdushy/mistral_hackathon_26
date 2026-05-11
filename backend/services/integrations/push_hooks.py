"""Push hooks: HireOps → external HRIS/ATS.

Called from the auto-workflow + application-stage router when an
internal event happens that should propagate to every connected
provider. All entry points are best-effort: they open their own DB
session, swallow adapter errors (logging them + writing a failed
IntegrationSyncLog row), and never raise back to the caller — a
candidate creation should never fail because Greenhouse is down.

Push is gated by:
  - ExternalIntegration.sync_enabled = True
  - ExternalIntegration.sync_status in {"active", "error"}
  - For optional AI-derived payload fields: push_ai_signals = True

Each push writes:
  - IntegrationSyncLog (direction='push', status=success|failed)
  - ExternalIdMapping when the adapter returns a new external id

The sync engine (pull) and push hooks share the same adapter, so any
provider that implements pull also gets push for free once these
hooks are wired.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import date, datetime
from typing import Optional

from sqlalchemy.orm import Session

from database import SessionLocal
from models import (
    Application, Candidate, ExternalIdMapping, ExternalIntegration,
    IntegrationSyncLog,
)
from services.integrations import get_adapter
from services.integrations.sync_engine import _save_mapping

logger = logging.getLogger("hireops.integrations.push")


# ─── Helpers ─────────────────────────────────────────────────────────────────


def _enabled_integrations(db: Session, tenant_id: int) -> list[ExternalIntegration]:
    return db.query(ExternalIntegration).filter(
        ExternalIntegration.tenant_id == tenant_id,
        ExternalIntegration.sync_enabled == True,  # noqa: E712
        ExternalIntegration.sync_status.in_(["active", "error"]),
    ).all()


def _mapping_external_id(
    db: Session,
    integration_id: int,
    internal_type: str,
    internal_id: int,
) -> Optional[str]:
    row = db.query(ExternalIdMapping).filter(
        ExternalIdMapping.integration_id == integration_id,
        ExternalIdMapping.internal_type == internal_type,
        ExternalIdMapping.internal_id == str(internal_id),
    ).first()
    return row.external_id if row else None


def _write_log(
    db: Session,
    integration: ExternalIntegration,
    *,
    status: str,
    summary: dict,
    error: str = "",
) -> None:
    log = IntegrationSyncLog(
        tenant_id=integration.tenant_id,
        integration_id=integration.id,
        started_at=datetime.utcnow(),
        finished_at=datetime.utcnow(),
        direction="push",
        status=status,
        records_processed=1 if status == "success" else 0,
        records_failed=1 if status == "failed" else 0,
        error_summary=(error or "")[:1000],
        payload_summary_json=json.dumps(summary)[:8000],
    )
    db.add(log)
    db.commit()


async def _push_one_candidate(
    db: Session,
    integration: ExternalIntegration,
    application: Application,
    candidate: Candidate,
) -> None:
    """Push a single candidate+application to one provider."""
    try:
        adapter = get_adapter(integration)
    except Exception as e:
        logger.warning("get_adapter failed for integration %s: %s", integration.id, e)
        _write_log(db, integration, status="failed",
                   summary={"action": "push_candidate", "application_id": application.id},
                   error=str(e))
        return

    try:
        # Skip if we already pushed this candidate (idempotency via
        # ExternalIdMapping — re-push would create duplicates upstream).
        existing = _mapping_external_id(db, integration.id, "candidate", candidate.id)
        if existing:
            _write_log(db, integration, status="success",
                       summary={"action": "push_candidate", "skipped": "already_pushed",
                                "candidate_id": candidate.id, "external_id": existing})
            return

        ext_id = await adapter.push_candidate(candidate, application)
        if ext_id:
            _save_mapping(
                db,
                tenant_id=integration.tenant_id,
                integration_id=integration.id,
                internal_type="candidate",
                internal_id=candidate.id,
                external_id=ext_id,
            )
            db.commit()
        _write_log(db, integration, status="success",
                   summary={"action": "push_candidate", "candidate_id": candidate.id,
                            "external_id": ext_id or ""})
    except NotImplementedError as e:
        # Stubbed provider — don't flip the integration to error since
        # that masks real auth issues. Log it once per run.
        _write_log(db, integration, status="failed",
                   summary={"action": "push_candidate", "candidate_id": candidate.id},
                   error=f"not_implemented: {e}")
    except Exception as e:
        logger.exception("push_candidate failed for integration %s: %s", integration.id, e)
        _write_log(db, integration, status="failed",
                   summary={"action": "push_candidate", "candidate_id": candidate.id},
                   error=str(e))


async def _push_one_stage(
    db: Session,
    integration: ExternalIntegration,
    application: Application,
    new_stage: str,
) -> None:
    try:
        adapter = get_adapter(integration)
    except Exception as e:
        _write_log(db, integration, status="failed",
                   summary={"action": "push_stage", "application_id": application.id},
                   error=str(e))
        return

    ext_app_id = _mapping_external_id(db, integration.id, "application", application.id)
    if not ext_app_id:
        # Application not yet known to the external system — nothing to do.
        # First push happens via push_candidate (which the provider
        # internally links to the right job/application).
        _write_log(db, integration, status="success",
                   summary={"action": "push_stage", "skipped": "no_external_app",
                            "application_id": application.id})
        return

    try:
        await adapter.push_stage_change(ext_app_id, new_stage)
        _write_log(db, integration, status="success",
                   summary={"action": "push_stage", "application_id": application.id,
                            "external_id": ext_app_id, "new_stage": new_stage})
    except NotImplementedError as e:
        _write_log(db, integration, status="failed",
                   summary={"action": "push_stage", "application_id": application.id},
                   error=f"not_implemented: {e}")
    except Exception as e:
        logger.exception("push_stage_change failed for integration %s: %s", integration.id, e)
        _write_log(db, integration, status="failed",
                   summary={"action": "push_stage", "application_id": application.id},
                   error=str(e))


async def _push_one_hire(
    db: Session,
    integration: ExternalIntegration,
    application: Application,
    start_date,
) -> None:
    try:
        adapter = get_adapter(integration)
    except Exception as e:
        _write_log(db, integration, status="failed",
                   summary={"action": "push_hire", "application_id": application.id},
                   error=str(e))
        return

    ext_app_id = _mapping_external_id(db, integration.id, "application", application.id)
    if not ext_app_id:
        _write_log(db, integration, status="success",
                   summary={"action": "push_hire", "skipped": "no_external_app",
                            "application_id": application.id})
        return

    try:
        await adapter.push_hire(ext_app_id, start_date)
        _write_log(db, integration, status="success",
                   summary={"action": "push_hire", "application_id": application.id,
                            "external_id": ext_app_id, "start_date": str(start_date)})
    except NotImplementedError as e:
        _write_log(db, integration, status="failed",
                   summary={"action": "push_hire", "application_id": application.id},
                   error=f"not_implemented: {e}")
    except Exception as e:
        logger.exception("push_hire failed for integration %s: %s", integration.id, e)
        _write_log(db, integration, status="failed",
                   summary={"action": "push_hire", "application_id": application.id},
                   error=str(e))


# ─── Public entry points ─────────────────────────────────────────────────────


async def push_application_created(application_id: int) -> None:
    """Fire-and-forget: a new Application just landed. Push the
    candidate to every connected provider so it appears upstream too.
    """
    db = SessionLocal()
    try:
        app = db.query(Application).filter(Application.id == application_id).first()
        if not app or not app.tenant_id:
            return
        cand = db.query(Candidate).filter(Candidate.id == app.candidate_id).first()
        if not cand:
            return
        integrations = _enabled_integrations(db, app.tenant_id)
        for integration in integrations:
            await _push_one_candidate(db, integration, app, cand)
    except Exception as e:
        logger.warning("push_application_created failed for app %s: %s", application_id, e)
    finally:
        db.close()


async def push_stage_changed(application_id: int, new_stage: str) -> None:
    """Fire-and-forget: an application's stage was just updated. Push
    the change to every connected provider that knows about this app.
    """
    db = SessionLocal()
    try:
        app = db.query(Application).filter(Application.id == application_id).first()
        if not app or not app.tenant_id:
            return
        integrations = _enabled_integrations(db, app.tenant_id)
        for integration in integrations:
            await _push_one_stage(db, integration, app, new_stage)
    except Exception as e:
        logger.warning("push_stage_changed failed for app %s: %s", application_id, e)
    finally:
        db.close()


async def push_hire(application_id: int, start_date=None) -> None:
    """Fire-and-forget: an application transitioned to a hired terminal
    stage. Push to every connected provider so HRIS payroll knows.
    """
    db = SessionLocal()
    try:
        app = db.query(Application).filter(Application.id == application_id).first()
        if not app or not app.tenant_id:
            return
        sd = start_date or date.today()
        integrations = _enabled_integrations(db, app.tenant_id)
        for integration in integrations:
            await _push_one_hire(db, integration, app, sd)
    except Exception as e:
        logger.warning("push_hire failed for app %s: %s", application_id, e)
    finally:
        db.close()


# ─── Sync helper: kick a push from inside a request handler ──────────────────


def schedule_push(coro) -> None:
    """Schedule a push coroutine without awaiting it. Safe to call from
    inside an async handler (running loop) or a sync handler / worker
    (we just fire a one-shot task).

    The request returns immediately; the push runs in the background.
    """
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            loop.create_task(coro)
        else:
            loop.run_until_complete(coro)
    except Exception as e:
        logger.warning("schedule_push failed: %s", e)
        # Drop the coroutine — never raise back to the caller.
        try:
            coro.close()
        except Exception:
            pass
