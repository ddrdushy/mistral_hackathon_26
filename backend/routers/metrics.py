"""Public marketing metrics — read-only, no auth, used by the landing page.

Aggregates across all tenants. We don't expose anything tenant-identifying
or anything a competitor could weaponise — just the platform-wide totals
that make the hero stats feel real.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from database import get_db
from models import Application, QaSession

router = APIRouter(prefix="/api/v1/metrics", tags=["metrics"])


@router.get("/public")
async def public_metrics(db: Session = Depends(get_db)):
    apps_processed = db.query(func.count(Application.id)).scalar() or 0
    avg_score_raw = (
        db.query(func.avg(Application.resume_score))
        .filter(Application.resume_score.isnot(None))
        .scalar()
    )
    avg_score = round(float(avg_score_raw)) if avg_score_raw is not None else None
    interviews_completed = (
        db.query(func.count(QaSession.id))
        .filter(QaSession.completed_at.isnot(None))
        .scalar()
        or 0
    )
    return {
        "apps_processed": apps_processed,
        "avg_score": avg_score,
        "interviews_completed": interviews_completed,
    }
