"""
Plan definitions + quota enforcement.

Plans are static config — three tiers with hard quotas. Stripe price IDs are
env-driven (different IDs per environment). The free plan has no Stripe
subscription; signup creates a tenant on the free plan immediately.

Quotas are enforced at creation time via `check_quota(...)`, which raises
HTTPException 402 (Payment Required) when over limit. The frontend surfaces
this as "upgrade to add more".
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Literal

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from models import Tenant, Job, Candidate, Application, InterviewLink

PlanName = Literal["free", "starter", "pro"]

# Sentinel value: an `allowed_agents` set containing this token means
# "all agents allowed, no gating". Used by the Pro plan.
ALL_AGENTS = "*"

# The full catalogue of agent names. Match the strings passed to
# LLMCallTimer / log_usage in each agent module. Used by:
#   - the gate to validate plan config at boot
#   - the UI to render which agents are locked vs unlocked
ALL_KNOWN_AGENTS: list[str] = [
    "email_classifier",          # inbox triage — included in every plan
    "resume_scorer",             # resume → score
    "profile_extractor",         # talent-bank tagging
    "interview_question_generator",  # AI-suggest interview questions
    "voice_screener",            # ElevenLabs voice screening
    "qa_interview_generate",     # Q&A round-set generator
    "qa_interview_score_technical",  # Q&A free-form scorer
    "interview_evaluator",       # post-interview scoring
    "hiring_report",             # final hiring report
    "talent_search",             # external sourcing (Apollo etc.)
    "job_generator",             # job-description auto-fill
]


@dataclass
class Plan:
    name: PlanName
    display_name: str
    price_monthly_usd: int  # 0 for free, used for display only
    stripe_price_id: str | None  # Stripe Price ID (env-driven). None for free.
    max_jobs: int  # -1 for unlimited
    max_candidates: int
    max_interviews_per_month: int
    daily_llm_budget_usd: float  # hard cap on Mistral spend per UTC day; -1 = unlimited
    features: list[str] = field(default_factory=list)
    # Agent-level gating. A set of agent_name strings, or {"*"} for all.
    # Plans started with no gating (Pro behaviour); free trial gating was
    # added so we can offer email-classifier-only trials and unlock the
    # rest on payment.
    allowed_agents: set[str] = field(default_factory=lambda: {ALL_AGENTS})


# Resolved at import time. Override the *_PRICE_ID env vars in production.
PLANS: dict[PlanName, Plan] = {
    "free": Plan(
        name="free",
        display_name="Free",
        price_monthly_usd=0,
        stripe_price_id=None,
        max_jobs=5,
        max_candidates=25,
        max_interviews_per_month=10,
        daily_llm_budget_usd=float(os.getenv("FREE_DAILY_LLM_BUDGET", "0.50")),
        features=[
            "5 active jobs",
            "25 candidates",
            "Inbox triage (email classifier)",
            "Upgrade to unlock scoring, interviews, voice",
        ],
        # TRIAL: free plan is the demo — only the inbox classifier is
        # available so prospects can see auto-triage without us paying
        # for resume scoring + voice. Everything else returns 402 with
        # an "Upgrade" prompt.
        allowed_agents={"email_classifier"},
    ),
    "starter": Plan(
        name="starter",
        display_name="Starter",
        price_monthly_usd=int(os.getenv("STARTER_PRICE_USD", "49")),
        stripe_price_id=os.getenv("STRIPE_STARTER_PRICE_ID") or None,
        max_jobs=25,
        max_candidates=250,
        max_interviews_per_month=100,
        daily_llm_budget_usd=float(os.getenv("STARTER_DAILY_LLM_BUDGET", "5.00")),
        features=[
            "25 active jobs",
            "250 candidates",
            "Resume scoring + auto-pipeline",
            "Talent-bank profile tagging",
            "Custom interview questions",
            "Branded interview emails",
            "Priority support",
        ],
        # Starter unlocks the full auto-pipeline (classify → score →
        # match → talent-bank tag) but stops short of the expensive
        # voice/Q&A interview agents.
        allowed_agents={
            "email_classifier",
            "resume_scorer",
            "profile_extractor",
            "interview_question_generator",
            "job_generator",
            "talent_search",
            "hiring_report",
        },
    ),
    "pro": Plan(
        name="pro",
        display_name="Pro",
        price_monthly_usd=int(os.getenv("PRO_PRICE_USD", "199")),
        stripe_price_id=os.getenv("STRIPE_PRO_PRICE_ID") or None,
        max_jobs=-1,
        max_candidates=-1,
        max_interviews_per_month=-1,
        daily_llm_budget_usd=float(os.getenv("PRO_DAILY_LLM_BUDGET", "50.00")),
        features=[
            "Unlimited jobs",
            "Unlimited candidates",
            "Unlimited interviews",
            "Voice screening (ElevenLabs)",
            "Q&A interview rounds",
            "Team seats",
            "SSO + audit logs (coming)",
        ],
        allowed_agents={ALL_AGENTS},
    ),
}


def get_plan(name: str) -> Plan:
    """Resolve a plan by name. DB-stored overrides (set via super-admin)
    are layered on top of the static defaults so the platform owner can
    edit prices/limits without redeploying."""
    base = PLANS.get(name, PLANS["free"])
    overrides = _load_plan_overrides().get(base.name)
    if not overrides:
        return base
    # Build a Plan with overrides merged. Don't mutate PLANS.
    return Plan(
        name=base.name,
        display_name=overrides.get("display_name") or base.display_name,
        price_monthly_usd=int(overrides.get("price_monthly_usd")) if overrides.get("price_monthly_usd") is not None else base.price_monthly_usd,
        stripe_price_id=overrides.get("stripe_price_id") if overrides.get("stripe_price_id") is not None else base.stripe_price_id,
        max_jobs=int(overrides.get("max_jobs")) if overrides.get("max_jobs") is not None else base.max_jobs,
        max_candidates=int(overrides.get("max_candidates")) if overrides.get("max_candidates") is not None else base.max_candidates,
        max_interviews_per_month=int(overrides.get("max_interviews_per_month")) if overrides.get("max_interviews_per_month") is not None else base.max_interviews_per_month,
        daily_llm_budget_usd=float(overrides.get("daily_llm_budget_usd")) if overrides.get("daily_llm_budget_usd") is not None else base.daily_llm_budget_usd,
        features=overrides.get("features") if overrides.get("features") is not None else base.features,
        allowed_agents=set(overrides.get("allowed_agents")) if overrides.get("allowed_agents") is not None else base.allowed_agents,
    )


# ── DB-stored plan overrides (super-admin editable) ──────────────────────


_OVERRIDES_CACHE: dict[str, dict] = {}
_OVERRIDES_TS: float = 0.0
_OVERRIDES_TTL_SECONDS = 30


def _load_plan_overrides() -> dict[str, dict]:
    """Read overrides from the `settings` table. Cached for 30s so we don't
    run a query on every gate_agent call. Settings keys look like
    `plan_override.{plan_name}` and store JSON of the override dict."""
    global _OVERRIDES_CACHE, _OVERRIDES_TS
    import time
    import json as _json
    now = time.time()
    if (now - _OVERRIDES_TS) < _OVERRIDES_TTL_SECONDS and _OVERRIDES_CACHE:
        return _OVERRIDES_CACHE
    try:
        from database import SessionLocal
        from models import Setting
        db = SessionLocal()
        try:
            rows = db.query(Setting).filter(
                Setting.tenant_id.is_(None),
                Setting.key.like("plan_override.%"),
            ).all()
            out: dict[str, dict] = {}
            for r in rows:
                pname = r.key.replace("plan_override.", "", 1)
                try:
                    out[pname] = _json.loads(r.value or "{}")
                except Exception:
                    out[pname] = {}
            _OVERRIDES_CACHE = out
            _OVERRIDES_TS = now
            return out
        finally:
            db.close()
    except Exception:
        return _OVERRIDES_CACHE


def invalidate_plan_overrides_cache() -> None:
    """Called from the super-admin endpoint after a plan override is
    written, so the change takes effect immediately instead of waiting
    for the TTL."""
    global _OVERRIDES_TS
    _OVERRIDES_TS = 0.0


def effective_quota(tenant: Tenant, attr: str) -> int:
    """Tenant-level overrides win over plan defaults. -1 = unlimited."""
    plan = get_plan(tenant.plan)
    override = getattr(tenant, attr, None)
    if override is not None:
        return override
    return getattr(plan, attr)


# ── Usage counters ─────────────────────────────────────────────────────────


def count_jobs(db: Session, tenant: Tenant) -> int:
    return db.query(Job).filter(
        Job.tenant_id == tenant.id,
        Job.status != "closed",  # closed jobs don't count toward quota
    ).count()


def count_candidates(db: Session, tenant: Tenant) -> int:
    return db.query(Candidate).filter(Candidate.tenant_id == tenant.id).count()


def count_interviews_this_month(db: Session, tenant: Tenant) -> int:
    """Count interview links generated in the current calendar month."""
    from datetime import datetime
    start_of_month = datetime.utcnow().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return db.query(InterviewLink).filter(
        InterviewLink.tenant_id == tenant.id,
        InterviewLink.created_at >= start_of_month,
    ).count()


# ── Agent-level gating ────────────────────────────────────────────────────


def _tenant_overrides(tenant: Tenant) -> tuple[set[str], set[str]]:
    """Return (added_agents, removed_agents) for a tenant. Empty sets if
    the tenant has no overrides or the JSON is malformed."""
    if not tenant or not getattr(tenant, "agent_overrides_json", None):
        return set(), set()
    import json as _json
    try:
        data = _json.loads(tenant.agent_overrides_json)
    except Exception:
        return set(), set()
    add = {str(a) for a in (data.get("add") or [])}
    remove = {str(a) for a in (data.get("remove") or [])}
    return add, remove


def is_agent_allowed(tenant: Tenant, agent_name: str) -> bool:
    """Pure check — does this tenant's plan (plus per-tenant overrides)
    allow this agent?

    Order of precedence:
      1. tenant.agent_overrides.remove → blocked, even on Pro
      2. tenant.agent_overrides.add    → allowed, even on Free
      3. plan default
    """
    add, remove = _tenant_overrides(tenant)
    if agent_name in remove:
        return False
    if agent_name in add:
        return True
    plan = get_plan(tenant.plan if tenant else "free")
    if ALL_AGENTS in plan.allowed_agents:
        return True
    return agent_name in plan.allowed_agents


def gate_agent(tenant: Tenant, agent_name: str) -> None:
    """Raise 402 PaymentRequired if the tenant's plan doesn't include
    this agent. Call BEFORE making the LLM request so we don't burn
    tokens on a call we're going to refuse anyway.

    Example:
        gate_agent(session.tenant, "resume_scorer")
        result = await score_resume(...)
    """
    if is_agent_allowed(tenant, agent_name):
        return
    plan = get_plan(tenant.plan if tenant else "free")
    raise HTTPException(
        status_code=status.HTTP_402_PAYMENT_REQUIRED,
        detail=(
            f"The '{agent_name}' agent is not available on the {plan.display_name} plan. "
            f"Upgrade to unlock it."
        ),
    )


def locked_agents_for(tenant: Tenant) -> list[str]:
    """Sorted list of known agents NOT included for the tenant after
    applying overrides. Drives the Settings UI 'Locked' badges."""
    return sorted([a for a in ALL_KNOWN_AGENTS if not is_agent_allowed(tenant, a)])


def unlocked_agents_for(tenant: Tenant) -> list[str]:
    """Sorted list of agents this tenant CAN currently use, with
    per-tenant overrides applied."""
    return sorted([a for a in ALL_KNOWN_AGENTS if is_agent_allowed(tenant, a)])


# ── Quota enforcement ─────────────────────────────────────────────────────


def check_quota(db: Session, tenant: Tenant, resource: Literal["jobs", "candidates", "interviews"]):
    """Raise 402 Payment Required if the tenant is at quota for `resource`.
    Call this BEFORE creating a new resource of that type.
    """
    if resource == "jobs":
        limit = effective_quota(tenant, "max_jobs")
        if limit < 0:
            return  # unlimited
        used = count_jobs(db, tenant)
        if used >= limit:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail=(
                    f"Job quota reached ({used}/{limit}) on the {tenant.plan} plan. "
                    f"Upgrade to add more."
                ),
            )
    elif resource == "candidates":
        limit = effective_quota(tenant, "max_candidates")
        if limit < 0:
            return
        used = count_candidates(db, tenant)
        if used >= limit:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail=(
                    f"Candidate quota reached ({used}/{limit}) on the {tenant.plan} plan. "
                    f"Upgrade to add more."
                ),
            )
    elif resource == "interviews":
        limit = effective_quota(tenant, "max_interviews_per_month")
        if limit < 0:
            return
        used = count_interviews_this_month(db, tenant)
        if used >= limit:
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail=(
                    f"Interview quota reached ({used}/{limit}) this month on the {tenant.plan} plan. "
                    f"Upgrade for more."
                ),
            )


def usage_summary(db: Session, tenant: Tenant) -> dict:
    """Snapshot of current usage vs limits, for the billing UI."""
    jobs_used = count_jobs(db, tenant)
    candidates_used = count_candidates(db, tenant)
    interviews_used = count_interviews_this_month(db, tenant)
    return {
        "jobs": {
            "used": jobs_used,
            "limit": effective_quota(tenant, "max_jobs"),
        },
        "candidates": {
            "used": candidates_used,
            "limit": effective_quota(tenant, "max_candidates"),
        },
        "interviews_this_month": {
            "used": interviews_used,
            "limit": effective_quota(tenant, "max_interviews_per_month"),
        },
    }
