"""Sync engine — runs an integration's pull cycle and persists records.

Pull strategy:
1. Adapter returns ExternalJob/Candidate/Application DTOs.
2. Engine upserts via ExternalIdMapping. Internal HireOps rows are
   created when missing; updated in place when they already exist.
3. Conflict resolution v1: external-originated records have external
   ownership of editable fields; HireOps owns AI scoring + fraud
   signals + tags + custom fields. (Push is wired by Phase 3 hooks
   in workflow_service — beyond v1's scope here.)

Each run writes an IntegrationSyncLog row. The worker can call
`sync_one(integration)` directly; the router exposes a manual trigger.
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from database import SessionLocal
from models import (
    Application, Candidate, ExternalIdMapping, ExternalIntegration,
    IntegrationSyncLog, Job,
)
from services.integrations import get_adapter
from services.integrations.base import (
    ExternalApplication,
    ExternalCandidate,
    ExternalJob,
)

logger = logging.getLogger("hireops.integrations.sync")

POLL_INTERVAL_SECONDS = 15 * 60  # 15 min default

_worker_task: Optional[asyncio.Task] = None


# ─── Upsert helpers ──────────────────────────────────────────────────────────


def _mapping_for(db: Session, integration_id: int, internal_type: str, external_id: str) -> Optional[ExternalIdMapping]:
    return db.query(ExternalIdMapping).filter(
        ExternalIdMapping.integration_id == integration_id,
        ExternalIdMapping.internal_type == internal_type,
        ExternalIdMapping.external_id == external_id,
    ).first()


def _save_mapping(
    db: Session, *,
    tenant_id: int, integration_id: int,
    internal_type: str, internal_id: int, external_id: str,
) -> ExternalIdMapping:
    existing = db.query(ExternalIdMapping).filter(
        ExternalIdMapping.integration_id == integration_id,
        ExternalIdMapping.internal_type == internal_type,
        ExternalIdMapping.internal_id == str(internal_id),
    ).first()
    if existing:
        existing.external_id = external_id
        existing.last_synced_at = datetime.utcnow()
        return existing
    m = ExternalIdMapping(
        tenant_id=tenant_id,
        integration_id=integration_id,
        internal_type=internal_type,
        internal_id=str(internal_id),
        external_id=external_id,
        last_synced_at=datetime.utcnow(),
    )
    db.add(m)
    return m


# ─── Upserts (one per entity type) ───────────────────────────────────────────


def _upsert_job(db: Session, integration: ExternalIntegration, ext: ExternalJob) -> int:
    mapping = _mapping_for(db, integration.id, "job", ext.external_id)
    job: Optional[Job] = None
    if mapping:
        job = db.query(Job).filter(
            Job.id == int(mapping.internal_id),
            Job.tenant_id == integration.tenant_id,
        ).first()
    if not job:
        # Build a synthetic job_id; the existing pattern is JOB-YYYY-NNN
        # but external imports use the prefix EXT to keep them visually
        # distinct. Race-safe-ish: scoped per provider.
        prefix = f"EXT-{integration.provider.upper()}-"
        # Just use the external id appended; it's already unique per
        # provider.
        new_job_id = f"{prefix}{ext.external_id}"[:64]
        job = Job(
            tenant_id=integration.tenant_id,
            job_id=new_job_id,
            title=ext.title or "(untitled)",
            department=ext.department or "",
            location=ext.location or "",
            seniority="mid",
            skills="[]",
            responsibilities="[]",
            qualifications="[]",
            description=ext.description or "",
            status=("open" if (ext.status or "open").lower() == "open" else "closed"),
            interview_mode="voice",
        )
        db.add(job)
        db.flush()
    else:
        # External system owns these fields; AI / scoring fields stay
        # under HireOps' control.
        job.title = ext.title or job.title
        job.department = ext.department or job.department
        job.location = ext.location or job.location
        job.description = ext.description or job.description
        if ext.status:
            job.status = "open" if ext.status.lower() == "open" else "closed"
        job.updated_at = datetime.utcnow()

    _save_mapping(
        db, tenant_id=integration.tenant_id, integration_id=integration.id,
        internal_type="job", internal_id=job.id, external_id=ext.external_id,
    )
    return job.id


def _upsert_candidate(db: Session, integration: ExternalIntegration, ext: ExternalCandidate) -> int:
    mapping = _mapping_for(db, integration.id, "candidate", ext.external_id)
    cand: Optional[Candidate] = None
    if mapping:
        cand = db.query(Candidate).filter(
            Candidate.id == int(mapping.internal_id),
            Candidate.tenant_id == integration.tenant_id,
        ).first()

    if not cand and ext.email:
        # Fallback: link by email to avoid creating duplicates when the
        # candidate already exists from a prior inbox / upload flow.
        cand = db.query(Candidate).filter(
            Candidate.tenant_id == integration.tenant_id,
            Candidate.email.ilike(ext.email.strip().lower()),
        ).first()

    if not cand:
        placeholder_email = ext.email or f"ext+{integration.id}-{ext.external_id}@imported.local"
        cand = Candidate(
            tenant_id=integration.tenant_id,
            name=ext.name or "(no name)",
            email=placeholder_email,
            phone=ext.phone or "",
            resume_text=ext.resume_text or "",
            resume_filename="",
            cv_version=1,
            source_email_id=None,
            notes=f"Imported from {integration.provider} ({ext.external_id})",
        )
        db.add(cand)
        db.flush()
    else:
        # Update only the fields the external system owns. HireOps owns
        # the profile / tag / fraud fields.
        if ext.name and not cand.name:
            cand.name = ext.name
        if ext.email and not cand.email:
            cand.email = ext.email
        if ext.phone and not cand.phone:
            cand.phone = ext.phone
        cand.updated_at = datetime.utcnow()

    _save_mapping(
        db, tenant_id=integration.tenant_id, integration_id=integration.id,
        internal_type="candidate", internal_id=cand.id, external_id=ext.external_id,
    )
    return cand.id


def _upsert_application(db: Session, integration: ExternalIntegration, ext: ExternalApplication) -> Optional[int]:
    job_mapping = _mapping_for(db, integration.id, "job", ext.external_job_id)
    cand_mapping = _mapping_for(db, integration.id, "candidate", ext.external_candidate_id)
    if not job_mapping or not cand_mapping:
        # Skip applications that reference jobs/candidates we haven't
        # pulled yet; they'll come back next cycle.
        return None
    job_id = int(job_mapping.internal_id)
    cand_id = int(cand_mapping.internal_id)

    mapping = _mapping_for(db, integration.id, "application", ext.external_id)
    app: Optional[Application] = None
    if mapping:
        app = db.query(Application).filter(
            Application.id == int(mapping.internal_id),
            Application.tenant_id == integration.tenant_id,
        ).first()
    if not app:
        # Unique constraint on (candidate_id, job_id) — reuse if exists
        app = db.query(Application).filter(
            Application.candidate_id == cand_id,
            Application.job_id == job_id,
        ).first()
    if not app:
        app = Application(
            tenant_id=integration.tenant_id,
            candidate_id=cand_id,
            job_id=job_id,
            stage=(ext.stage or "matched"),
            resume_score=0,
            resume_score_json=json.dumps({"score": 0, "summary": f"Imported from {integration.provider}"}),
            recommendation="hold",
            ai_next_action=f"Imported from {integration.provider}",
            ai_snippets="{}",
        )
        db.add(app)
        db.flush()
    else:
        if ext.stage:
            app.stage = ext.stage
        app.updated_at = datetime.utcnow()

    _save_mapping(
        db, tenant_id=integration.tenant_id, integration_id=integration.id,
        internal_type="application", internal_id=app.id, external_id=ext.external_id,
    )
    return app.id


# ─── Public entry points ─────────────────────────────────────────────────────


async def sync_one(integration_id: int) -> dict:
    """Run a pull cycle for ONE integration. Returns a summary dict
    suitable for an admin response."""
    db = SessionLocal()
    try:
        integration = db.query(ExternalIntegration).filter(
            ExternalIntegration.id == integration_id
        ).first()
        if not integration:
            raise ValueError(f"Integration {integration_id} not found")
        if not integration.sync_enabled:
            return {"skipped": "sync_disabled"}

        log = IntegrationSyncLog(
            tenant_id=integration.tenant_id,
            integration_id=integration.id,
            started_at=datetime.utcnow(),
            direction="pull",
            status="running",
        )
        db.add(log)
        db.commit()
        db.refresh(log)

        try:
            adapter = get_adapter(integration)
            since = integration.last_synced_at

            jobs = await adapter.list_jobs(since=since)
            for j in jobs:
                _upsert_job(db, integration, j)
            db.commit()

            cands = await adapter.list_candidates(since=since)
            for c in cands:
                _upsert_candidate(db, integration, c)
            db.commit()

            apps = await adapter.list_applications(since=since)
            apps_imported = 0
            for a in apps:
                if _upsert_application(db, integration, a):
                    apps_imported += 1
            db.commit()

            integration.last_synced_at = datetime.utcnow()
            integration.sync_status = "active"
            integration.last_error = ""
            log.status = "success"
            log.finished_at = datetime.utcnow()
            log.records_processed = len(jobs) + len(cands) + apps_imported
            log.payload_summary_json = json.dumps({
                "jobs": len(jobs),
                "candidates": len(cands),
                "applications_imported": apps_imported,
                "applications_skipped": max(0, len(apps) - apps_imported),
            })
            db.commit()
            return {
                "ok": True,
                "jobs": len(jobs),
                "candidates": len(cands),
                "applications": apps_imported,
            }
        except NotImplementedError as e:
            integration.sync_status = "error"
            integration.last_error = str(e)
            log.status = "failed"
            log.finished_at = datetime.utcnow()
            log.error_summary = str(e)
            db.commit()
            raise
        except Exception as e:
            logger.exception("Integration %s sync failed: %s", integration_id, e)
            integration.sync_status = "error"
            integration.last_error = str(e)[:1000]
            log.status = "failed"
            log.finished_at = datetime.utcnow()
            log.error_summary = str(e)[:1000]
            db.commit()
            raise
    finally:
        db.close()


# ─── Worker loop ─────────────────────────────────────────────────────────────


async def _tick() -> None:
    db = SessionLocal()
    try:
        rows = db.query(ExternalIntegration).filter(
            ExternalIntegration.sync_enabled == True,  # noqa: E712
            ExternalIntegration.sync_status.in_(["active", "error"]),
        ).all()
    finally:
        db.close()

    for integration in rows:
        try:
            await sync_one(integration.id)
        except Exception:
            # Errors are already logged + persisted via sync_one
            continue


async def _worker_loop() -> None:
    logger.info("integrations sync worker started (poll every %ss)", POLL_INTERVAL_SECONDS)
    while True:
        try:
            await _tick()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.exception("sync worker tick failed: %s", e)
        await asyncio.sleep(POLL_INTERVAL_SECONDS)


async def start_worker() -> None:
    global _worker_task
    if _worker_task and not _worker_task.done():
        return
    loop = asyncio.get_running_loop()
    _worker_task = loop.create_task(_worker_loop(), name="integrations_sync_worker")


async def stop_worker() -> None:
    global _worker_task
    if _worker_task and not _worker_task.done():
        _worker_task.cancel()
        try:
            await _worker_task
        except asyncio.CancelledError:
            pass
    _worker_task = None
