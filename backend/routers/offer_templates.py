"""Offer letter templates (Feature 7)."""
import json
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from auth.dependencies import current_session, CurrentSession
from database import get_db
from models import OfferTemplate
from services.audit import write_audit
from services.offer_service import template_to_response, default_template_body

router = APIRouter(prefix="/api/v1/offer-templates", tags=["offers"])


class TemplateField(BaseModel):
    key: str
    label: str
    type: str = "text"  # text | currency | date | number | select
    required: bool = False
    options: Optional[List[str]] = None


class TemplateCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    body_markdown: str = Field(default="", max_length=20000)
    fields: List[TemplateField] = Field(default_factory=list)
    requires_approval: bool = False
    approval_chain_user_ids: List[int] = Field(default_factory=list)
    is_default: bool = False


class TemplateUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=128)
    body_markdown: Optional[str] = Field(default=None, max_length=20000)
    fields: Optional[List[TemplateField]] = None
    requires_approval: Optional[bool] = None
    approval_chain_user_ids: Optional[List[int]] = None
    is_default: Optional[bool] = None


@router.get("")
def list_templates(
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    rows = db.query(OfferTemplate).filter(
        OfferTemplate.tenant_id == session.tenant.id,
    ).order_by(OfferTemplate.is_default.desc(), OfferTemplate.name.asc()).all()
    return {"templates": [template_to_response(t) for t in rows]}


@router.get("/default-body")
def default_body(_: CurrentSession = Depends(current_session)):
    """Return a starter markdown body so HR doesn't begin from a blank page."""
    return {"body_markdown": default_template_body()}


@router.post("", status_code=201)
def create_template(
    req: TemplateCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    if req.is_default:
        # Only one default per tenant — flip the previous default off.
        db.query(OfferTemplate).filter(
            OfferTemplate.tenant_id == session.tenant.id,
            OfferTemplate.is_default == True,  # noqa: E712
        ).update({OfferTemplate.is_default: False})

    t = OfferTemplate(
        tenant_id=session.tenant.id,
        name=req.name.strip(),
        body_markdown=req.body_markdown,
        fields_json=json.dumps([f.model_dump() for f in req.fields]),
        requires_approval=req.requires_approval,
        approval_chain_user_ids_json=json.dumps(req.approval_chain_user_ids),
        is_default=req.is_default,
        created_by_user_id=session.user.id if session.user else None,
    )
    db.add(t)
    try:
        db.commit()
        db.refresh(t)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Template name already exists")

    write_audit(
        db,
        action="offer_template.create",
        actor=session.user,
        tenant_id=session.tenant.id,
        resource_type="offer_template",
        resource_id=t.id,
        payload={"name": t.name},
        request=request,
    )
    return template_to_response(t)


@router.get("/{template_id}")
def get_template(
    template_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    t = db.query(OfferTemplate).filter(
        OfferTemplate.id == template_id,
        OfferTemplate.tenant_id == session.tenant.id,
    ).first()
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    return template_to_response(t)


@router.put("/{template_id}")
def update_template(
    template_id: int,
    req: TemplateUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    t = db.query(OfferTemplate).filter(
        OfferTemplate.id == template_id,
        OfferTemplate.tenant_id == session.tenant.id,
    ).first()
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")

    if req.is_default is True and not t.is_default:
        db.query(OfferTemplate).filter(
            OfferTemplate.tenant_id == session.tenant.id,
            OfferTemplate.is_default == True,  # noqa: E712
        ).update({OfferTemplate.is_default: False})

    if req.name is not None:
        t.name = req.name.strip()
    if req.body_markdown is not None:
        t.body_markdown = req.body_markdown
    if req.fields is not None:
        t.fields_json = json.dumps([f.model_dump() for f in req.fields])
    if req.requires_approval is not None:
        t.requires_approval = req.requires_approval
    if req.approval_chain_user_ids is not None:
        t.approval_chain_user_ids_json = json.dumps(req.approval_chain_user_ids)
    if req.is_default is not None:
        t.is_default = req.is_default

    try:
        db.commit()
        db.refresh(t)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Template name already exists")

    write_audit(
        db,
        action="offer_template.update",
        actor=session.user,
        tenant_id=session.tenant.id,
        resource_type="offer_template",
        resource_id=t.id,
        request=request,
    )
    return template_to_response(t)


@router.delete("/{template_id}")
def delete_template(
    template_id: int,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    t = db.query(OfferTemplate).filter(
        OfferTemplate.id == template_id,
        OfferTemplate.tenant_id == session.tenant.id,
    ).first()
    if not t:
        raise HTTPException(status_code=404, detail="Template not found")
    name = t.name
    db.delete(t)
    db.commit()
    write_audit(
        db,
        action="offer_template.delete",
        actor=session.user,
        tenant_id=session.tenant.id,
        resource_type="offer_template",
        resource_id=template_id,
        payload={"name": name},
        severity="warning",
        request=request,
    )
    return {"deleted": True}
