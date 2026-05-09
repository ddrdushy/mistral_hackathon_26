"""Offer letter lifecycle (Feature 7).

Three router prefixes here:
  - /api/v1/offers          : list, get, mutate
  - /api/v1/applications/{id}/offers : create per application
  - /api/v1/offers/sign/... : public signing page (no auth)
"""
import json
import logging
import os
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from auth.dependencies import current_session, CurrentSession
from database import get_db
from models import Application, Candidate, Offer, OfferTemplate
from services.audit import write_audit
from services.offer_service import (
    get_adapter,
    offer_to_response,
    render_offer,
    render_signed_html,
)

logger = logging.getLogger("hireops.offers")

router = APIRouter(prefix="/api/v1/offers", tags=["offers"])
app_offers_router = APIRouter(prefix="/api/v1/applications", tags=["offers"])


# ─── Helpers ─────────────────────────────────────────────────────────────────


def _signing_url(offer: Offer) -> str:
    base = os.getenv("FRONTEND_URL", "").rstrip("/")
    if not offer.esign_signing_token:
        return ""
    if not base:
        return f"/offers/sign/{offer.esign_signing_token}"
    return f"{base}/offers/sign/{offer.esign_signing_token}"


def _ensure_offer(db: Session, offer_id: int, tenant_id: int) -> Offer:
    o = db.query(Offer).filter(
        Offer.id == offer_id,
        Offer.tenant_id == tenant_id,
    ).first()
    if not o:
        raise HTTPException(status_code=404, detail="Offer not found")
    return o


def _resolve_template(db: Session, tenant_id: int, template_id: Optional[int]) -> Optional[OfferTemplate]:
    if template_id is None:
        return None
    return db.query(OfferTemplate).filter(
        OfferTemplate.id == template_id,
        OfferTemplate.tenant_id == tenant_id,
    ).first()


# ─── Create per application ──────────────────────────────────────────────────


class OfferCreateRequest(BaseModel):
    template_id: Optional[int] = None
    salary_amount: Optional[float] = None
    salary_currency: str = "USD"
    bonus_amount: Optional[float] = None
    equity_description: str = ""
    employment_type: str = "full_time"
    start_date: Optional[datetime] = None
    location: str = ""
    custom_fields: dict = Field(default_factory=dict)


@app_offers_router.post("/{application_id}/offers", status_code=201)
def create_offer(
    application_id: int,
    req: OfferCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    app = db.query(Application).filter(
        Application.id == application_id,
        Application.tenant_id == session.tenant.id,
    ).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    template = _resolve_template(db, session.tenant.id, req.template_id)

    offer = Offer(
        tenant_id=session.tenant.id,
        application_id=application_id,
        candidate_id=app.candidate_id,
        template_id=template.id if template else None,
        salary_amount=req.salary_amount,
        salary_currency=(req.salary_currency or "USD").upper(),
        bonus_amount=req.bonus_amount,
        equity_description=req.equity_description,
        employment_type=req.employment_type,
        start_date=req.start_date,
        location=req.location,
        custom_fields_json=json.dumps(req.custom_fields or {}),
        status="draft",
        created_by_user_id=session.user.id if session.user else None,
    )
    # Pre-merge candidate name for {{candidate_name}} support.
    candidate = db.query(Candidate).filter(Candidate.id == app.candidate_id).first()
    custom_with_candidate = {**(req.custom_fields or {})}
    if candidate:
        custom_with_candidate.setdefault("candidate_name", candidate.name)
    if app.job_id:
        from models import Job
        job = db.query(Job).filter(Job.id == app.job_id).first()
        if job:
            custom_with_candidate.setdefault("job_title", job.title)
    offer.custom_fields_json = json.dumps(custom_with_candidate)

    rendered_md, rendered_html = render_offer(offer, template)
    offer.rendered_markdown = rendered_md
    offer.rendered_html = rendered_html

    db.add(offer)
    db.commit()
    db.refresh(offer)

    write_audit(
        db,
        action="offer.create",
        actor=session.user,
        tenant_id=session.tenant.id,
        resource_type="offer",
        resource_id=offer.id,
        payload={"application_id": application_id, "salary": req.salary_amount},
        request=request,
    )
    return offer_to_response(offer, signing_url=_signing_url(offer))


# ─── List / get ──────────────────────────────────────────────────────────────


@router.get("")
def list_offers(
    application_id: Optional[int] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    q = db.query(Offer).filter(Offer.tenant_id == session.tenant.id)
    if application_id is not None:
        q = q.filter(Offer.application_id == application_id)
    if status:
        q = q.filter(Offer.status == status)
    rows = q.order_by(Offer.created_at.desc()).limit(200).all()
    return {"offers": [offer_to_response(o, signing_url=_signing_url(o)) for o in rows]}


@router.get("/{offer_id}")
def get_offer(
    offer_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    o = _ensure_offer(db, offer_id, session.tenant.id)
    return offer_to_response(o, signing_url=_signing_url(o))


@router.get("/{offer_id}/document", response_class=HTMLResponse)
def get_offer_document(
    offer_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Serve the rendered offer HTML — signed copy if available, else
    the draft. HR can browser-print to PDF from this page."""
    o = _ensure_offer(db, offer_id, session.tenant.id)
    html = o.signed_html or o.rendered_html or "<p>No content</p>"
    return HTMLResponse(content=html)


# ─── Mutate (draft only) ─────────────────────────────────────────────────────


class OfferUpdateRequest(BaseModel):
    salary_amount: Optional[float] = None
    salary_currency: Optional[str] = None
    bonus_amount: Optional[float] = None
    equity_description: Optional[str] = None
    employment_type: Optional[str] = None
    start_date: Optional[datetime] = None
    location: Optional[str] = None
    custom_fields: Optional[dict] = None


@router.put("/{offer_id}")
def update_offer(
    offer_id: int,
    req: OfferUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    o = _ensure_offer(db, offer_id, session.tenant.id)
    if o.status not in ("draft", "pending_approval"):
        raise HTTPException(status_code=400, detail=f"Cannot edit a {o.status} offer")

    if req.salary_amount is not None: o.salary_amount = req.salary_amount
    if req.salary_currency is not None: o.salary_currency = req.salary_currency.upper()
    if req.bonus_amount is not None: o.bonus_amount = req.bonus_amount
    if req.equity_description is not None: o.equity_description = req.equity_description
    if req.employment_type is not None: o.employment_type = req.employment_type
    if req.start_date is not None: o.start_date = req.start_date
    if req.location is not None: o.location = req.location
    if req.custom_fields is not None:
        try:
            existing = json.loads(o.custom_fields_json or "{}")
        except Exception:
            existing = {}
        existing.update(req.custom_fields)
        o.custom_fields_json = json.dumps(existing)

    template = _resolve_template(db, session.tenant.id, o.template_id)
    rendered_md, rendered_html = render_offer(o, template)
    o.rendered_markdown = rendered_md
    o.rendered_html = rendered_html
    o.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(o)
    write_audit(
        db, action="offer.update", actor=session.user,
        tenant_id=session.tenant.id, resource_type="offer", resource_id=o.id,
        request=request,
    )
    return offer_to_response(o, signing_url=_signing_url(o))


# ─── Send for signature ──────────────────────────────────────────────────────


@router.post("/{offer_id}/send")
def send_offer(
    offer_id: int,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Generate the signing envelope and mark the offer 'sent'.

    v1: uses the mock e-sign adapter — produces a token-based URL on our
    own domain that the candidate can click to view + sign. Real
    DocuSign/HelloSign adapters slot in via get_adapter(provider).
    """
    o = _ensure_offer(db, offer_id, session.tenant.id)
    if o.status not in ("draft", "approved"):
        raise HTTPException(status_code=400, detail=f"Cannot send a {o.status} offer")

    adapter = get_adapter("mock")
    adapter.create_envelope(o)
    o.status = "sent"
    o.sent_at = datetime.utcnow()
    o.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(o)

    write_audit(
        db, action="offer.send", actor=session.user,
        tenant_id=session.tenant.id, resource_type="offer", resource_id=o.id,
        payload={"signing_url": _signing_url(o), "provider": o.esign_provider},
        severity="warning", request=request,
    )
    return offer_to_response(o, signing_url=_signing_url(o))


# ─── Withdraw ────────────────────────────────────────────────────────────────


@router.post("/{offer_id}/withdraw")
def withdraw_offer(
    offer_id: int,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    o = _ensure_offer(db, offer_id, session.tenant.id)
    if o.status in ("signed", "withdrawn"):
        raise HTTPException(status_code=400, detail=f"Cannot withdraw a {o.status} offer")
    o.status = "withdrawn"
    o.esign_signing_token = ""  # invalidate signing URL
    o.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(o)
    write_audit(
        db, action="offer.withdraw", actor=session.user,
        tenant_id=session.tenant.id, resource_type="offer", resource_id=o.id,
        severity="warning", request=request,
    )
    return offer_to_response(o, signing_url=_signing_url(o))


# ─── Public sign endpoints (no auth) ─────────────────────────────────────────


@router.get("/sign/{token}")
def view_for_sign(token: str, db: Session = Depends(get_db)):
    """Candidate fetches this from the public sign page to render the
    offer. Marks the offer 'viewed' on first fetch."""
    offer = db.query(Offer).filter(Offer.esign_signing_token == token).first()
    if not offer:
        raise HTTPException(status_code=404, detail="Invalid or expired signing link")
    if offer.status not in ("sent", "viewed"):
        raise HTTPException(status_code=400, detail=f"Offer is {offer.status}, cannot be signed")
    if offer.status == "sent":
        offer.status = "viewed"
        offer.viewed_at = datetime.utcnow()
        db.commit()
    return {
        "offer_id": offer.id,
        "html": offer.rendered_html,
        "status": offer.status,
        "candidate_name_hint": "",  # filled below if available
    }


class SignSubmitRequest(BaseModel):
    signature_name: str = Field(..., min_length=2, max_length=200)


@router.post("/sign/{token}")
def submit_signature(token: str, req: SignSubmitRequest, request: Request, db: Session = Depends(get_db)):
    offer = db.query(Offer).filter(Offer.esign_signing_token == token).first()
    if not offer:
        raise HTTPException(status_code=404, detail="Invalid signing link")
    if offer.status not in ("sent", "viewed"):
        raise HTTPException(status_code=400, detail=f"Offer is {offer.status}, cannot be signed")

    fwd = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip() if request else ""
    ip = fwd or (request.client.host if request and request.client else "")

    offer.signature_name = req.signature_name.strip()[:200]
    offer.signature_ip = ip[:64]
    offer.signed_at = datetime.utcnow()
    offer.status = "signed"
    offer.signed_html = render_signed_html(offer)
    offer.esign_signing_token = ""  # one-time use
    offer.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(offer)

    # Audit (no actor — candidate, not a tenant user). Tenant-scoped.
    write_audit(
        db, action="offer.signed", actor=None,
        tenant_id=offer.tenant_id, resource_type="offer", resource_id=offer.id,
        payload={"signature_name": offer.signature_name, "ip": ip},
        severity="critical",
    )
    return {"status": "signed"}


class DeclineRequest(BaseModel):
    reason: str = Field(default="", max_length=2000)


@router.post("/sign/{token}/decline")
def decline(token: str, req: DeclineRequest, db: Session = Depends(get_db)):
    offer = db.query(Offer).filter(Offer.esign_signing_token == token).first()
    if not offer:
        raise HTTPException(status_code=404, detail="Invalid signing link")
    if offer.status not in ("sent", "viewed"):
        raise HTTPException(status_code=400, detail=f"Offer is {offer.status}")
    offer.status = "declined"
    offer.declined_reason = (req.reason or "").strip()
    offer.esign_signing_token = ""
    offer.updated_at = datetime.utcnow()
    db.commit()
    write_audit(
        db, action="offer.declined", actor=None,
        tenant_id=offer.tenant_id, resource_type="offer", resource_id=offer.id,
        payload={"reason": offer.declined_reason}, severity="warning",
    )
    return {"status": "declined"}
