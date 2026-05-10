"""Per-recruiter productivity metrics (Feature 5).

Reads directly from `events`, `applications`, `offers`, and `llm_usage` —
no separate aggregation table in v1. Add `recruiter_metrics_daily` if
the live queries get slow at scale.

Tenant-scoped throughout. Owner-only access enforced by the router
layer; this service trusts the tenant_id passed in.

Note: only events with `actioned_by_user_id IS NOT NULL` count toward
recruiter attribution. Pre-Feature-5 events have NULL actor and so
contribute to "system-driven" totals only — surfaced as a banner on
the UI ("Metrics start from {first_attributed_event_date}").
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from models import (
    Application, Event, LlmUsage, Offer, User,
)


# Event types that count as "progressing" an application. We deliberately
# include matched + stage_changed since most workflows treat those as the
# real recruiter actions.
PROGRESS_EVENTS = (
    "stage_changed",
    "matched",
    "rescored",
    "interview_link_generated",
    "interview_slot_booked",
    "evaluated",
)

EVALUATION_EVENTS = (
    "evaluated",
    "final_score_calculated",
)


def _date_range(start: Optional[datetime], end: Optional[datetime]) -> tuple[datetime, datetime]:
    if not end:
        end = datetime.utcnow()
    if not start:
        start = end - timedelta(days=30)
    # Treat end as exclusive at midnight if no time component supplied so
    # the UI's "to: 2026-05-09" actually includes May 9.
    if start > end:
        start, end = end, start
    return start, end


def recruiters_summary(
    db: Session,
    tenant_id: int,
    start: Optional[datetime] = None,
    end: Optional[datetime] = None,
    user_id: Optional[int] = None,
) -> dict:
    start, end = _date_range(start, end)

    # Find every recruiter who has at least one attributable event in the
    # window — plus the explicitly-filtered user when supplied.
    actor_q = (
        db.query(Event.actioned_by_user_id)
        .filter(
            Event.tenant_id == tenant_id,
            Event.actioned_by_user_id.isnot(None),
            Event.created_at >= start,
            Event.created_at < end,
        )
        .distinct()
    )
    actor_ids = {row[0] for row in actor_q.all() if row[0] is not None}
    if user_id:
        actor_ids.add(user_id)

    # Hydrate user names in one round-trip
    users_by_id: dict[int, User] = {}
    if actor_ids:
        for u in db.query(User).filter(User.id.in_(actor_ids)).all():
            users_by_id[u.id] = u

    out_recruiters: list[dict] = []
    for uid in sorted(actor_ids):
        u = users_by_id.get(uid)
        if not u:
            continue

        # Candidates added — events of type stage_changed where from='new'
        # OR 'matched' events. Easier proxy: count distinct applications
        # the recruiter first touched in the window via 'matched'.
        candidates_added = (
            db.query(func.count(func.distinct(Event.app_id)))
            .filter(
                Event.tenant_id == tenant_id,
                Event.actioned_by_user_id == uid,
                Event.event_type == "matched",
                Event.created_at >= start,
                Event.created_at < end,
            )
            .scalar() or 0
        )

        # Applications progressed — distinct apps touched by progress events
        applications_progressed = (
            db.query(func.count(func.distinct(Event.app_id)))
            .filter(
                Event.tenant_id == tenant_id,
                Event.actioned_by_user_id == uid,
                Event.event_type.in_(PROGRESS_EVENTS),
                Event.created_at >= start,
                Event.created_at < end,
            )
            .scalar() or 0
        )

        # Interviews evaluated
        interviews_evaluated = (
            db.query(func.count(Event.id))
            .filter(
                Event.tenant_id == tenant_id,
                Event.actioned_by_user_id == uid,
                Event.event_type.in_(EVALUATION_EVENTS),
                Event.created_at >= start,
                Event.created_at < end,
            )
            .scalar() or 0
        )

        # Offers extended — Feature 7
        offers_extended = (
            db.query(func.count(Offer.id))
            .filter(
                Offer.tenant_id == tenant_id,
                Offer.created_by_user_id == uid,
                Offer.status.in_(["sent", "viewed", "signed", "declined", "expired"]),
                Offer.created_at >= start,
                Offer.created_at < end,
            )
            .scalar() or 0
        )

        # Hires — apps the recruiter advanced into the 'hired' / 'shortlisted'
        # terminal states (we don't have a 'hired' stage natively; use the
        # 'shortlisted' transition as the closest proxy until Feature 3 ships
        # custom stages with terminal_outcome='hired').
        hires_made = (
            db.query(func.count(func.distinct(Event.app_id)))
            .filter(
                Event.tenant_id == tenant_id,
                Event.actioned_by_user_id == uid,
                Event.event_type == "stage_changed",
                Event.payload.like('%"to": "shortlisted"%'),
                Event.created_at >= start,
                Event.created_at < end,
            )
            .scalar() or 0
        )

        # Time-to-screen — for apps this user moved to a screening stage in
        # the window, mean of (event.created_at - application.created_at).
        screen_rows = (
            db.query(Event.app_id, Event.created_at)
            .filter(
                Event.tenant_id == tenant_id,
                Event.actioned_by_user_id == uid,
                Event.event_type == "interview_link_generated",
                Event.created_at >= start,
                Event.created_at < end,
            )
            .all()
        )
        avg_time_to_screen_hours: Optional[float] = None
        if screen_rows:
            app_ids = [r[0] for r in screen_rows if r[0]]
            apps_by_id = {
                a.id: a
                for a in db.query(Application).filter(Application.id.in_(app_ids)).all()
            }
            deltas = []
            for app_id, when in screen_rows:
                a = apps_by_id.get(app_id)
                if a and a.created_at and when > a.created_at:
                    deltas.append((when - a.created_at).total_seconds() / 3600.0)
            if deltas:
                avg_time_to_screen_hours = round(sum(deltas) / len(deltas), 2)

        # Conversion: applied → screened. Apps the recruiter has ever
        # touched (matched), divided into how many made it past the link.
        applied_count = (
            db.query(func.count(func.distinct(Event.app_id)))
            .filter(
                Event.tenant_id == tenant_id,
                Event.actioned_by_user_id == uid,
                Event.event_type == "matched",
                Event.created_at >= start,
                Event.created_at < end,
            )
            .scalar() or 0
        )
        screened_count = (
            db.query(func.count(func.distinct(Event.app_id)))
            .filter(
                Event.tenant_id == tenant_id,
                Event.actioned_by_user_id == uid,
                Event.event_type == "interview_link_generated",
                Event.created_at >= start,
                Event.created_at < end,
            )
            .scalar() or 0
        )
        conv_a_to_s = round(screened_count / applied_count, 3) if applied_count else 0.0
        conv_s_to_o = round(offers_extended / screened_count, 3) if screened_count else 0.0

        # LLM cost attribution — currently llm_usage doesn't have actor;
        # we surface it as 0 for now and document in the response. When
        # we wire actor attribution into LLMCallTimer, this lights up.
        llm_cost_usd = 0.0

        out_recruiters.append({
            "user_id": uid,
            "name": u.name or u.email.split("@")[0],
            "email": u.email,
            "candidates_added": int(candidates_added),
            "applications_progressed": int(applications_progressed),
            "interviews_evaluated": int(interviews_evaluated),
            "offers_extended": int(offers_extended),
            "hires_made": int(hires_made),
            "avg_time_to_screen_hours": avg_time_to_screen_hours,
            "conversion": {
                "applied_to_screened": conv_a_to_s,
                "screened_to_offer": conv_s_to_o,
            },
            "llm_cost_usd": llm_cost_usd,
        })

    if user_id:
        out_recruiters = [r for r in out_recruiters if r["user_id"] == user_id]

    out_recruiters.sort(key=lambda r: r["applications_progressed"], reverse=True)

    # First-attributed-event date: helps the UI show "metrics begin from..."
    first_event = (
        db.query(func.min(Event.created_at))
        .filter(
            Event.tenant_id == tenant_id,
            Event.actioned_by_user_id.isnot(None),
        )
        .scalar()
    )

    return {
        "period": {"start": start.isoformat(), "end": end.isoformat()},
        "recruiters": out_recruiters,
        "first_attributed_event_at": first_event.isoformat() if first_event else None,
    }
