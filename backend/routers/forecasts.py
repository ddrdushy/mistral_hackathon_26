"""Pipeline forecasting endpoints (Feature 8)."""
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from auth.dependencies import current_session, CurrentSession
from database import get_db
from services.forecast_service import forecast_pipeline

router = APIRouter(prefix="/api/v1/forecasts", tags=["forecasts"])


@router.get("/pipeline")
def get_pipeline_forecast(
    job_id: Optional[int] = Query(default=None),
    window_days: int = Query(default=30, ge=1, le=365),
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Latest cached forecast (recomputes if cache is older than 6h)."""
    try:
        return forecast_pipeline(db, session.tenant.id, job_id, window_days)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


class RecomputeRequest(BaseModel):
    job_id: Optional[int] = None
    window_days: int = Field(default=30, ge=1, le=365)


@router.post("/pipeline/recompute")
def recompute_pipeline_forecast(
    req: RecomputeRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Force a fresh forecast computation, bypassing the cache."""
    # The service caches the latest row, but a forced recompute writes
    # a fresh one. Simplest path: invalidate by deleting newer-than-TTL
    # row, but the service unconditionally writes a new row each call —
    # so we just bypass the TTL check by passing a flag. The cheapest
    # thing is to add a tiny clock-skew nudge via a fresh call; since
    # the cache check is purely time-based, mark the existing cached
    # row as stale by deleting it.
    from models import PipelineForecast
    db.query(PipelineForecast).filter(
        PipelineForecast.tenant_id == session.tenant.id,
        PipelineForecast.job_id == req.job_id,
        PipelineForecast.window_days == req.window_days,
    ).delete(synchronize_session=False)
    db.commit()
    try:
        return forecast_pipeline(db, session.tenant.id, req.job_id, req.window_days)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
