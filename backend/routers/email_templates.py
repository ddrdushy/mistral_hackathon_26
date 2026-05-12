"""Email-template CRUD per tenant + branding update + render preview.

UI flow:
  - GET  /api/v1/email-templates           → list of categories + current
                                              subject/body + source
  - GET  /api/v1/email-templates/{cat}     → single category detail
  - PUT  /api/v1/email-templates/{cat}     → upsert tenant override
  - DELETE /api/v1/email-templates/{cat}   → revert to platform default
  - POST /api/v1/email-templates/{cat}/preview → render with sample
                                                  context, returns
                                                  ready-to-display HTML

Branding edit lives on the existing /api/v1/team/organization endpoint
(tenant fields), so the template editor just consumes that read path
for the live preview.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from auth.dependencies import current_session, CurrentSession, require_owner
from database import get_db
from models import EmailTemplate
from services import email_templates as tmpl

logger = logging.getLogger("hireops.email_templates_router")

router = APIRouter(prefix="/api/v1/email-templates", tags=["email-templates"])


# ── Schemas ──────────────────────────────────────────────────────────────


class TemplateCategoryInfo(BaseModel):
    key: str
    label: str
    description: str
    variables: list[str]
    source: str  # "platform_default" | "tenant"
    subject: str
    body_html: str
    body_text: str = ""
    updated_at: Optional[str] = None


class TemplateUpsertRequest(BaseModel):
    subject: str = Field(..., min_length=1, max_length=300)
    body_html: str = Field(..., min_length=1, max_length=40000)
    body_text: str = Field(default="", max_length=20000)


class TemplatePreviewRequest(BaseModel):
    subject: str = Field(..., max_length=300)
    body_html: str = Field(..., max_length=40000)
    # Custom variable overrides — empty uses example values per token.
    variables: dict[str, str] = Field(default_factory=dict)


# ── Helpers ──────────────────────────────────────────────────────────────


_BASE_SAMPLE = {
    "candidate_name": "Harsha Sundaram",
    "candidate_first_name": "Harsha",
    "job_title": "Senior Data Engineer",
    "recruiter_name": "Dushyanth Ramalingam",
}


_SAMPLE_VARS: dict[str, dict[str, str]] = {
    "interview_invite": {
        **_BASE_SAMPLE,
        "interview_url": "https://hireops.symprio.com/interview/sample-token",
    },
    "interview_reschedule": {
        **_BASE_SAMPLE,
        "interview_url": "https://hireops.symprio.com/interview/sample-token-v2",
    },
    "interview_confirmation": {
        **_BASE_SAMPLE,
        "interview_url": "https://hireops.symprio.com/interview/sample-token",
        "scheduled_at": "Tuesday, 14 May at 10:00 (UTC)",
    },
    "interview_reminder": {
        **_BASE_SAMPLE,
        "interview_url": "https://hireops.symprio.com/interview/sample-token",
        "scheduled_at": "Tuesday, 14 May at 10:00 (UTC)",
    },
    "availability_check": {**_BASE_SAMPLE},
    "shortlist_congrats": {**_BASE_SAMPLE},
    "offer_letter": {
        **_BASE_SAMPLE,
        "salary_amount": "85,000",
        "salary_currency": "USD",
        "bonus_amount": "10% target performance bonus",
        "equity_description": "0.05% over 4 years, 1-year cliff",
        "employment_type": "Full-time",
        "location": "Kuala Lumpur, Malaysia",
        "start_date": "1 June 2026",
        "signing_url": "https://hireops.symprio.com/offers/sign/sample-token",
    },
    "offer_accepted": {
        **_BASE_SAMPLE,
        "salary_amount": "85,000",
        "salary_currency": "USD",
        "start_date": "1 June 2026",
    },
    "rejection": {**_BASE_SAMPLE},
    "generic_email": {**_BASE_SAMPLE},
    "in_app_notification": {
        **_BASE_SAMPLE,
        "event_summary": "completed their interview with a 78/100 score",
    },
}


def _category_info(db: Session, tenant_id: int, cat_key: str) -> TemplateCategoryInfo:
    cat = tmpl.CATEGORIES[cat_key]
    effective = tmpl.get_effective(db, tenant_id, cat_key)
    row = tmpl.get_tenant_template(db, tenant_id, cat_key)
    return TemplateCategoryInfo(
        key=cat.key,
        label=cat.label,
        description=cat.description,
        variables=cat.variables,
        source=effective["source"],
        subject=effective["subject"],
        body_html=effective["body_html"],
        body_text=effective.get("body_text", ""),
        updated_at=row.updated_at.isoformat() if row and row.updated_at else None,
    )


# ── Endpoints ────────────────────────────────────────────────────────────


@router.get("", response_model=list[TemplateCategoryInfo])
def list_templates(
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """All categories with the tenant's current effective subject/body
    (merged with platform defaults). Used by the editor list view."""
    return [
        _category_info(db, session.tenant.id, key)
        for key in tmpl.CATEGORIES.keys()
    ]


@router.get("/{category}", response_model=TemplateCategoryInfo)
def get_template(
    category: str,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    if category not in tmpl.CATEGORIES:
        raise HTTPException(status_code=404, detail=f"Unknown template category '{category}'")
    return _category_info(db, session.tenant.id, category)


@router.put("/{category}", response_model=TemplateCategoryInfo)
def upsert_template(
    category: str,
    body: TemplateUpsertRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_owner),
):
    """Owner-only: save a tenant-specific override for `category`. The
    save doesn't enforce that all category variables are referenced —
    HR may legitimately omit tokens, and the renderer leaves unknowns
    as literal text so they're caught immediately."""
    if category not in tmpl.CATEGORIES:
        raise HTTPException(status_code=404, detail=f"Unknown template category '{category}'")
    from services.audit import write_audit

    row = (
        db.query(EmailTemplate)
        .filter(
            EmailTemplate.tenant_id == session.tenant.id,
            EmailTemplate.category == category,
        )
        .first()
    )
    if row:
        row.subject = body.subject
        row.body_html = body.body_html
        row.body_text = body.body_text
        row.enabled = True
        row.updated_at = datetime.utcnow()
    else:
        row = EmailTemplate(
            tenant_id=session.tenant.id,
            category=category,
            subject=body.subject,
            body_html=body.body_html,
            body_text=body.body_text,
            enabled=True,
        )
        db.add(row)
    db.commit()
    db.refresh(row)

    write_audit(
        db,
        action="email_template.update",
        actor=session.user,
        tenant_id=session.tenant.id,
        resource_type="email_template",
        resource_id=category,
        payload={"category": category},
        severity="info",
        request=request,
    )
    return _category_info(db, session.tenant.id, category)


@router.delete("/{category}", response_model=TemplateCategoryInfo)
def reset_template(
    category: str,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_owner),
):
    """Revert this category back to the platform default."""
    if category not in tmpl.CATEGORIES:
        raise HTTPException(status_code=404, detail=f"Unknown template category '{category}'")
    from services.audit import write_audit

    row = (
        db.query(EmailTemplate)
        .filter(
            EmailTemplate.tenant_id == session.tenant.id,
            EmailTemplate.category == category,
        )
        .first()
    )
    if row:
        db.delete(row)
        db.commit()
        write_audit(
            db,
            action="email_template.reset",
            actor=session.user,
            tenant_id=session.tenant.id,
            resource_type="email_template",
            resource_id=category,
            payload={"category": category},
            severity="info",
            request=request,
        )
    return _category_info(db, session.tenant.id, category)


@router.post("/{category}/preview")
def preview_template(
    category: str,
    body: TemplatePreviewRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Render `subject` + `body_html` against sample variables (or the
    overrides in body.variables) and return the branded HTML for an
    iframe preview in the editor. Does NOT persist."""
    if category not in tmpl.CATEGORIES:
        raise HTTPException(status_code=404, detail=f"Unknown template category '{category}'")
    # Build sample context: defaults per category overridden by anything
    # the caller passes in.
    sample = dict(_SAMPLE_VARS.get(category, {}))
    sample["company_name"] = session.tenant.name or "your workspace"
    sample.update({k: v for k, v in (body.variables or {}).items() if v})

    # Temporarily swap the row in-memory by passing the editor's bodies
    # straight into the renderer. Simpler than persisting.
    from services.email_templates import (
        _branding, _shell, _substitute, _html_to_text,
    )
    brand = _branding(session.tenant)
    ctx = {
        "company_name": brand["company_name"],
        "primary_color": brand["primary_color"],
        "logo_url": brand["logo_url"],
        **sample,
    }
    if "candidate_name" in ctx and "candidate_first_name" not in ctx:
        ctx["candidate_first_name"] = str(ctx["candidate_name"]).split()[0] if ctx["candidate_name"] else ""

    subject = _substitute(body.subject, ctx)
    inner = _substitute(body.body_html, ctx)
    return {
        "subject": subject,
        "body_html": _shell(inner, brand=brand, preheader=subject),
        "body_text": _html_to_text(inner),
        "from_name": brand["from_name"],
    }
