"""Pipeline forecasting — Feature 8.

Predicts expected hires per job (or tenant-wide) within a rolling
window. Uses historical conversion rates from
`application_stage_transitions` over the last 90 days plus average
time-in-stage to score each open application's probability of reaching
a `terminal_outcome='hired'` stage within the window.

Cold-start fallback: a tenant with no transition history gets industry-
default per-stage rates (configurable via `_DEFAULT_STAGE_RATE`). The
forecast still works, just with the documented assumption.

No ML. v1 is deterministic + bootstrap-sampled for the confidence band.
"""
from __future__ import annotations

import json
import logging
import math
import random
from collections import defaultdict
from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from models import (
    Application, ApplicationStageTransition, Job, PipelineForecast,
    PipelineStage, PipelineTemplate,
)

logger = logging.getLogger("hireops.forecast")

# Industry-default conversion rate when we have zero transitions for a
# stage. 30% is a reasonable midpoint across software roles — tenants
# get better numbers once they have ~50 transitions of real data.
_DEFAULT_STAGE_RATE = 0.30

# Default time-in-stage when no history exists. 48 hours = two business
# days; biased toward optimism.
_DEFAULT_STAGE_HOURS = 48.0

# Cache TTL — GETs older than this trigger a recompute.
CACHE_TTL_SECONDS = 6 * 3600

# Lookback for the rates calculation.
HISTORY_LOOKBACK_DAYS = 90


# ─── Template helpers ────────────────────────────────────────────────────────


def _default_template_for_tenant(db: Session, tenant_id: int) -> Optional[PipelineTemplate]:
    return db.query(PipelineTemplate).filter(
        PipelineTemplate.tenant_id == tenant_id,
        PipelineTemplate.is_default == True,  # noqa: E712
    ).first()


def _template_for_job(db: Session, job: Optional[Job]) -> Optional[PipelineTemplate]:
    if not job or not job.pipeline_template_id:
        return None
    return db.query(PipelineTemplate).filter(
        PipelineTemplate.id == job.pipeline_template_id
    ).first()


def _stages_in_order(db: Session, template: PipelineTemplate) -> list[PipelineStage]:
    return db.query(PipelineStage).filter(
        PipelineStage.template_id == template.id
    ).order_by(PipelineStage.order_index.asc()).all()


def _hired_stage(stages: list[PipelineStage]) -> Optional[PipelineStage]:
    for s in stages:
        if s.is_terminal and (s.terminal_outcome or "").lower() == "hired":
            return s
    # Legacy default seeds 'shortlisted' as the 'hired' terminal — match that.
    for s in stages:
        if s.is_terminal and s.key == "shortlisted":
            return s
    return None


def _path_to_hired(stages: list[PipelineStage], current_stage_id: Optional[int]) -> list[PipelineStage]:
    """Walk forward from the current stage to the hired terminal,
    inclusive of any non-terminal stages in between. Returns [] when
    the current stage is already terminal or hired stage doesn't exist."""
    hired = _hired_stage(stages)
    if not hired:
        return []
    ordered = sorted(stages, key=lambda s: s.order_index)
    by_id = {s.id: i for i, s in enumerate(ordered)}
    cur_idx = by_id.get(current_stage_id)
    hired_idx = by_id.get(hired.id)
    if cur_idx is None or hired_idx is None or cur_idx >= hired_idx:
        return []
    # Stages we need to TRAVERSE (inclusive of the hired stage).
    # Note: rate(stage_i → stage_i+1) — we look at every step in between.
    return ordered[cur_idx + 1 : hired_idx + 1]


# ─── Historical rates + times ────────────────────────────────────────────────


def _compute_stage_rates(db: Session, tenant_id: int, template: PipelineTemplate) -> dict[int, float]:
    """For each stage in the template, the fraction of applications
    that, having entered it, eventually moved FORWARD (not to a
    rejected terminal). Falls back to _DEFAULT_STAGE_RATE.

    Implementation: looks at `application_stage_transitions` rows in
    the last HISTORY_LOOKBACK_DAYS where `to_stage_id` belongs to this
    template. count_entered = transitions in. count_advanced = of those
    apps, how many ever transitioned out to a NON-rejected stage.
    """
    cutoff = datetime.utcnow() - timedelta(days=HISTORY_LOOKBACK_DAYS)
    stages = _stages_in_order(db, template)
    stage_ids = {s.id for s in stages}
    rejected_ids = {s.id for s in stages if s.is_terminal and (s.terminal_outcome or "").lower() == "rejected"}

    rows = db.query(
        ApplicationStageTransition.application_id,
        ApplicationStageTransition.to_stage_id,
    ).filter(
        ApplicationStageTransition.tenant_id == tenant_id,
        ApplicationStageTransition.transitioned_at >= cutoff,
        ApplicationStageTransition.to_stage_id.in_(stage_ids),
    ).all()

    entered: dict[int, set[int]] = defaultdict(set)
    for app_id, sid in rows:
        entered[sid].add(app_id)

    # Apps that ever moved OUT of stage s without going to a rejected stage
    advanced_rows = db.query(
        ApplicationStageTransition.application_id,
        ApplicationStageTransition.from_stage_id,
        ApplicationStageTransition.to_stage_id,
    ).filter(
        ApplicationStageTransition.tenant_id == tenant_id,
        ApplicationStageTransition.transitioned_at >= cutoff,
        ApplicationStageTransition.from_stage_id.in_(stage_ids),
    ).all()
    advanced: dict[int, set[int]] = defaultdict(set)
    for app_id, from_sid, to_sid in advanced_rows:
        if to_sid in rejected_ids:
            continue
        if from_sid is not None:
            advanced[from_sid].add(app_id)

    out: dict[int, float] = {}
    for s in stages:
        n = len(entered.get(s.id, ()))
        a = len(advanced.get(s.id, ()))
        if s.is_terminal:
            out[s.id] = 1.0 if (s.terminal_outcome or "").lower() == "hired" else 0.0
        elif n == 0:
            out[s.id] = _DEFAULT_STAGE_RATE
        else:
            # Cap at 1.0; some stages will be skipped (auto-advanced) and
            # double-count would push above.
            out[s.id] = min(1.0, a / n) if n else _DEFAULT_STAGE_RATE
    return out


def _compute_stage_avg_time(db: Session, tenant_id: int, template: PipelineTemplate) -> dict[int, float]:
    """Average hours an application spends in each stage. Uses ordered
    transition pairs: for each app, time spent in stage S =
    transitioned_at(S→next) - transitioned_at(prev→S).
    """
    cutoff = datetime.utcnow() - timedelta(days=HISTORY_LOOKBACK_DAYS)
    stage_ids = {s.id for s in _stages_in_order(db, template)}

    rows = db.query(
        ApplicationStageTransition.application_id,
        ApplicationStageTransition.to_stage_id,
        ApplicationStageTransition.transitioned_at,
    ).filter(
        ApplicationStageTransition.tenant_id == tenant_id,
        ApplicationStageTransition.transitioned_at >= cutoff,
    ).order_by(
        ApplicationStageTransition.application_id.asc(),
        ApplicationStageTransition.transitioned_at.asc(),
    ).all()

    # For each app, walk its transition list and accumulate
    # (current_stage, hours_spent_in_current_stage) pairs.
    per_stage_hours: dict[int, list[float]] = defaultdict(list)
    prev_by_app: dict[int, tuple[int, datetime]] = {}
    for app_id, to_sid, when in rows:
        prev = prev_by_app.get(app_id)
        if prev is not None and to_sid in stage_ids:
            prev_sid, prev_when = prev
            if prev_sid in stage_ids:
                hours = (when - prev_when).total_seconds() / 3600.0
                if 0 < hours < 24 * 60:  # filter extreme outliers (>60 days)
                    per_stage_hours[prev_sid].append(hours)
        prev_by_app[app_id] = (to_sid, when)

    out: dict[int, float] = {}
    for sid in stage_ids:
        vals = per_stage_hours.get(sid)
        if not vals:
            out[sid] = _DEFAULT_STAGE_HOURS
        else:
            vals.sort()
            # Median is more robust than mean for skewed distributions
            mid = len(vals) // 2
            out[sid] = vals[mid] if len(vals) % 2 else (vals[mid - 1] + vals[mid]) / 2
    return out


# ─── Forecast ────────────────────────────────────────────────────────────────


def forecast_pipeline(
    db: Session,
    tenant_id: int,
    job_id: Optional[int],
    window_days: int = 30,
) -> dict:
    """Compute (or read from cache) the expected hires forecast."""
    # Cache lookup
    cached = (
        db.query(PipelineForecast)
        .filter(
            PipelineForecast.tenant_id == tenant_id,
            PipelineForecast.job_id == job_id,
            PipelineForecast.window_days == window_days,
        )
        .order_by(PipelineForecast.run_at.desc())
        .first()
    )
    if cached and (datetime.utcnow() - cached.run_at).total_seconds() < CACHE_TTL_SECONDS:
        return _row_to_dict(cached, cached=True)

    # Resolve template
    template: Optional[PipelineTemplate] = None
    job: Optional[Job] = None
    if job_id:
        job = db.query(Job).filter(Job.id == job_id, Job.tenant_id == tenant_id).first()
        if not job:
            raise ValueError("Job not found for tenant")
        if (job.status or "").lower() == "closed":
            # Closed job — no future hires expected
            return _empty_result(window_days, note="job_closed")
        template = _template_for_job(db, job)
    if not template:
        template = _default_template_for_tenant(db, tenant_id)
    if not template:
        return _empty_result(window_days, note="no_template")

    stages = _stages_in_order(db, template)
    if not stages:
        return _empty_result(window_days, note="no_stages")

    rates = _compute_stage_rates(db, tenant_id, template)
    avg_times = _compute_stage_avg_time(db, tenant_id, template)

    non_terminal_ids = [s.id for s in stages if not s.is_terminal]

    open_q = db.query(Application).filter(
        Application.tenant_id == tenant_id,
        Application.current_stage_id.in_(non_terminal_ids) if non_terminal_ids else False,
    )
    if job_id:
        open_q = open_q.filter(Application.job_id == job_id)
    open_apps = open_q.all()

    total = 0.0
    breakdown: list[dict] = []
    window_hours = window_days * 24
    for app in open_apps:
        path = _path_to_hired(stages, app.current_stage_id)
        if not path:
            continue
        prob_reach = 1.0
        for s in path:
            prob_reach *= rates.get(s.id, _DEFAULT_STAGE_RATE)
        expected_time = sum(avg_times.get(s.id, _DEFAULT_STAGE_HOURS) for s in path)
        if expected_time <= window_hours:
            prob_within = 1.0
        else:
            # Exponential decay past the window
            prob_within = math.exp(-(expected_time - window_hours) / max(window_hours, 1))
        contribution = prob_reach * prob_within
        total += contribution
        breakdown.append({
            "application_id": app.id,
            "current_stage_id": app.current_stage_id,
            "prob": round(contribution, 4),
            "expected_remaining_hours": round(expected_time, 1),
        })

    # Bootstrap confidence band (1000 trials)
    samples = []
    rng = random.Random(0)  # deterministic per call for stable UI
    for _ in range(1000):
        s = sum(1 for b in breakdown if rng.random() < b["prob"])
        samples.append(s)
    samples.sort()
    low = samples[50] if samples else 0
    high = samples[950] if samples else 0

    # Persist
    note = ""
    if not any(rates.get(s.id) != _DEFAULT_STAGE_RATE for s in stages if not s.is_terminal):
        note = "cold_start_defaults"
    row = PipelineForecast(
        tenant_id=tenant_id,
        job_id=job_id,
        window_days=window_days,
        expected_hires=round(total, 2),
        confidence_low=low,
        confidence_high=high,
        open_applications=len(open_apps),
        breakdown_json=json.dumps({
            "breakdown": breakdown[:200],  # cap so the row doesn't blow up
            "stage_rates": {str(k): round(v, 3) for k, v in rates.items()},
            "stage_avg_hours": {str(k): round(v, 1) for k, v in avg_times.items()},
        }),
        notes=note,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _row_to_dict(row, cached=False)


def _row_to_dict(row: PipelineForecast, cached: bool) -> dict:
    try:
        details = json.loads(row.breakdown_json or "{}")
    except Exception:
        details = {}
    return {
        "id": row.id,
        "tenant_id": row.tenant_id,
        "job_id": row.job_id,
        "window_days": row.window_days,
        "run_at": row.run_at.isoformat() if row.run_at else None,
        "expected_hires": float(row.expected_hires or 0.0),
        "confidence_low": float(row.confidence_low or 0.0),
        "confidence_high": float(row.confidence_high or 0.0),
        "open_applications": int(row.open_applications or 0),
        "breakdown": details.get("breakdown", []),
        "stage_rates": details.get("stage_rates", {}),
        "stage_avg_hours": details.get("stage_avg_hours", {}),
        "notes": row.notes or "",
        "cached": cached,
    }


def _empty_result(window_days: int, note: str) -> dict:
    return {
        "id": None,
        "job_id": None,
        "window_days": window_days,
        "run_at": datetime.utcnow().isoformat(),
        "expected_hires": 0.0,
        "confidence_low": 0,
        "confidence_high": 0,
        "open_applications": 0,
        "breakdown": [],
        "stage_rates": {},
        "stage_avg_hours": {},
        "notes": note,
        "cached": False,
    }
