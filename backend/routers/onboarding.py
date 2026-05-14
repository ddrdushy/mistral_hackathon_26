"""Onboarding checklist status.

Returns a list of setup steps for the current tenant so the dashboard
can render a progress checklist (Connect inbox · Create first job · …).
Each row is { id, label, hint, done, href }. Keeps the source of truth
on the server so a new step can be added here without an FE deploy.
"""
from __future__ import annotations

from typing import List, Dict
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from database import get_db
from auth.dependencies import current_session, CurrentSession
from models import (
    MailAccount,
    Job,
    Candidate,
    User,
    TenantIntegration,
)

router = APIRouter(prefix="/api/v1/onboarding", tags=["onboarding"])


@router.get("/status")
def onboarding_status(
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
) -> Dict[str, object]:
    tenant = session.tenant

    # ── Step probes ─────────────────────────────────────────────────────
    profile_done = bool(getattr(tenant, "profile_completed_at", None))

    mailbox_done = (
        db.query(MailAccount)
        .filter(MailAccount.tenant_id == tenant.id, MailAccount.enabled.is_(True))
        .first()
        is not None
    )

    job_done = (
        db.query(Job).filter(Job.tenant_id == tenant.id).first() is not None
    )

    candidate_done = (
        db.query(Candidate).filter(Candidate.tenant_id == tenant.id).first()
        is not None
    )

    # 2+ users = HR invited at least one teammate.
    team_done = (
        db.query(User).filter(User.tenant_id == tenant.id).count() >= 2
    )

    # Twilio connected = WhatsApp/SMS outbound configured.
    twilio_done = (
        db.query(TenantIntegration)
        .filter(
            TenantIntegration.tenant_id == tenant.id,
            TenantIntegration.provider == "twilio",
            TenantIntegration.enabled.is_(True),
        )
        .first()
        is not None
    )

    steps: List[Dict[str, object]] = [
        {
            "id": "profile",
            "label": "Tell us about your organization",
            "hint": "Industry, location, brand colour. Anchors AI prompts so they stop making up companies.",
            "done": profile_done,
            "href": "/settings/organization",
        },
        {
            "id": "inbox",
            "label": "Connect your inbox",
            "hint": "Gmail / Outlook / IMAP. Inbound applications start flowing automatically.",
            "done": mailbox_done,
            "href": "/inbox",
        },
        {
            "id": "job",
            "label": "Create your first job",
            "hint": "JD wizard takes 60 seconds — or paste an existing JD and let AI refine it.",
            "done": job_done,
            "href": "/jobs/new",
        },
        {
            "id": "candidate",
            "label": "Upload a CV to your talent bank",
            "hint": "Seed the bank with past resumes so the AI can match them against new jobs.",
            "done": candidate_done,
            "href": "/talent-bank",
        },
        {
            "id": "twilio",
            "label": "Connect WhatsApp / SMS",
            "hint": "Optional but unlocks WhatsApp outreach, reschedule replies, voice calls.",
            "done": twilio_done,
            "href": "/settings",
        },
        {
            "id": "team",
            "label": "Invite a teammate",
            "hint": "More than a one-person hiring team? Add the rest of your recruiters.",
            "done": team_done,
            "href": "/settings/team",
        },
    ]

    completed = sum(1 for s in steps if s["done"])
    return {
        "steps": steps,
        "completed": completed,
        "total": len(steps),
        "percent": round((completed / len(steps)) * 100) if steps else 0,
    }
