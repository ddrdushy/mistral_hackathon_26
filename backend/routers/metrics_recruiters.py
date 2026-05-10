"""Recruiter productivity metrics router (Feature 5).

Owner-only — recruiter-level data routinely contains email addresses
and per-person performance, so a regular member shouldn't see it.
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from auth.dependencies import require_owner, CurrentSession
from database import get_db
from services.recruiter_metrics import recruiters_summary

router = APIRouter(prefix="/api/v1/metrics/recruiters", tags=["metrics"])


def _parse_iso(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        # Accept date-only or full ISO datetime
        if len(s) == 10:
            return datetime.fromisoformat(s)
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


@router.get("")
def list_recruiters(
    start: Optional[str] = Query(default=None),
    end: Optional[str] = Query(default=None),
    user_id: Optional[int] = Query(default=None),
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_owner),
):
    return recruiters_summary(
        db,
        tenant_id=session.tenant.id,
        start=_parse_iso(start),
        end=_parse_iso(end),
        user_id=user_id,
    )


@router.get("/leaderboard")
def leaderboard(
    period: str = Query(default="month", pattern="^(week|month|quarter)$"),
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_owner),
):
    """Convenience wrapper around the recruiters summary with a preset
    window. UI defaults to 'month'; week/quarter are alternatives."""
    from datetime import timedelta
    days = {"week": 7, "month": 30, "quarter": 90}[period]
    end = datetime.utcnow()
    start = end - timedelta(days=days)
    return recruiters_summary(
        db,
        tenant_id=session.tenant.id,
        start=start,
        end=end,
    )
