"""Pipeline templates — Feature 3.

Each tenant has at least one auto-seeded "Default" template (legacy
7-stage flow). Tenants can clone it, customise stages, and assign new
jobs to a custom template.
"""
import re
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from auth.dependencies import current_session, CurrentSession
from database import get_db
from models import (
    Application, Job, PipelineStage, PipelineTemplate,
)
from services.audit import write_audit

router = APIRouter(prefix="/api/v1/pipeline-templates", tags=["pipelines"])

VALID_OUTCOMES = {"", "hired", "rejected", "withdrawn"}
MAX_STAGES = 24


def _slugify(s: str) -> str:
    s = (s or "").strip().lower()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    s = re.sub(r"_+", "_", s).strip("_")
    return s[:64] or "stage"


def _seq(db: Session, tenant_id: int, tmpl_id: int) -> PipelineTemplate:
    t = db.query(PipelineTemplate).filter(
        PipelineTemplate.id == tmpl_id,
        PipelineTemplate.tenant_id == tenant_id,
    ).first()
    if not t:
        raise HTTPException(status_code=404, detail="Pipeline template not found")
    return t


def _stage_to_response(s: PipelineStage) -> dict:
    return {
        "id": s.id,
        "template_id": s.template_id,
        "key": s.key,
        "label": s.label,
        "order_index": s.order_index,
        "is_terminal": bool(s.is_terminal),
        "terminal_outcome": s.terminal_outcome or "",
        "auto_advance_threshold": s.auto_advance_threshold,
        "color": s.color or "slate",
    }


def _template_to_response(t: PipelineTemplate, db: Session, with_stages: bool = False, with_usage: bool = False) -> dict:
    out = {
        "id": t.id,
        "name": t.name,
        "description": t.description or "",
        "is_default": bool(t.is_default),
        "is_system": bool(t.is_system),
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
    }
    if with_stages:
        stages = db.query(PipelineStage).filter(
            PipelineStage.template_id == t.id
        ).order_by(PipelineStage.order_index.asc()).all()
        out["stages"] = [_stage_to_response(s) for s in stages]
    if with_usage:
        out["jobs_using"] = db.query(Job).filter(Job.pipeline_template_id == t.id).count()
    return out


# ─── Templates CRUD ─────────────────────────────────────────────────────────


class StagePayload(BaseModel):
    key: Optional[str] = None  # auto-derived from label if missing
    label: str = Field(..., min_length=1, max_length=128)
    is_terminal: bool = False
    terminal_outcome: str = ""
    auto_advance_threshold: Optional[int] = Field(default=None, ge=0, le=100)
    color: str = "slate"

    @field_validator("terminal_outcome")
    @classmethod
    def _validate_outcome(cls, v: str) -> str:
        v = (v or "").strip().lower()
        return v if v in VALID_OUTCOMES else ""


class TemplateCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    description: str = ""
    is_default: bool = False
    stages: List[StagePayload] = Field(default_factory=list)


class TemplateUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=128)
    description: Optional[str] = None
    is_default: Optional[bool] = None


@router.get("")
def list_templates(
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    rows = db.query(PipelineTemplate).filter(
        PipelineTemplate.tenant_id == session.tenant.id,
    ).order_by(
        PipelineTemplate.is_default.desc(),
        PipelineTemplate.name.asc(),
    ).all()
    return {
        "templates": [
            _template_to_response(t, db, with_usage=True) for t in rows
        ]
    }


@router.post("", status_code=201)
def create_template(
    req: TemplateCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    if req.is_default:
        # Only one default per tenant
        db.query(PipelineTemplate).filter(
            PipelineTemplate.tenant_id == session.tenant.id,
            PipelineTemplate.is_default == True,  # noqa: E712
        ).update({PipelineTemplate.is_default: False})

    t = PipelineTemplate(
        tenant_id=session.tenant.id,
        name=req.name.strip(),
        description=req.description.strip(),
        is_default=req.is_default,
        is_system=False,
    )
    db.add(t)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Template name already exists")

    used_keys: set[str] = set()
    for idx, s in enumerate(req.stages):
        key = (s.key or _slugify(s.label))
        # Disambiguate duplicate keys
        base = key
        n = 1
        while key in used_keys:
            n += 1
            key = f"{base}_{n}"
        used_keys.add(key)
        db.add(PipelineStage(
            template_id=t.id,
            key=key,
            label=s.label.strip(),
            order_index=idx,
            is_terminal=s.is_terminal,
            terminal_outcome=s.terminal_outcome,
            auto_advance_threshold=s.auto_advance_threshold,
            color=s.color,
        ))

    db.commit()
    db.refresh(t)
    write_audit(
        db, action="pipeline_template.create", actor=session.user,
        tenant_id=session.tenant.id, resource_type="pipeline_template",
        resource_id=t.id, payload={"name": t.name, "stages": len(req.stages)},
        request=request,
    )
    return _template_to_response(t, db, with_stages=True)


@router.get("/{template_id}")
def get_template(
    template_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    t = _seq(db, session.tenant.id, template_id)
    return _template_to_response(t, db, with_stages=True, with_usage=True)


@router.put("/{template_id}")
def update_template(
    template_id: int,
    req: TemplateUpdateRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    t = _seq(db, session.tenant.id, template_id)
    fields = req.model_dump(exclude_unset=True)
    if fields.get("is_default") is True and not t.is_default:
        db.query(PipelineTemplate).filter(
            PipelineTemplate.tenant_id == session.tenant.id,
            PipelineTemplate.is_default == True,  # noqa: E712
        ).update({PipelineTemplate.is_default: False})
    for k, v in fields.items():
        if k in ("name", "description") and v is not None:
            v = v.strip()
        setattr(t, k, v)
    try:
        db.commit()
        db.refresh(t)
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Template name already exists")
    write_audit(
        db, action="pipeline_template.update", actor=session.user,
        tenant_id=session.tenant.id, resource_type="pipeline_template",
        resource_id=t.id, request=request,
    )
    return _template_to_response(t, db, with_stages=True, with_usage=True)


@router.delete("/{template_id}")
def delete_template(
    template_id: int,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    t = _seq(db, session.tenant.id, template_id)
    if t.is_system:
        raise HTTPException(status_code=400, detail="System template cannot be deleted")
    in_use = db.query(Job).filter(Job.pipeline_template_id == template_id).count()
    if in_use > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Template is in use by {in_use} job(s). Reassign them first.",
        )
    if t.is_default:
        raise HTTPException(
            status_code=400,
            detail="Default template cannot be deleted. Mark another as default first.",
        )
    name = t.name
    db.delete(t)
    db.commit()
    write_audit(
        db, action="pipeline_template.delete", actor=session.user,
        tenant_id=session.tenant.id, resource_type="pipeline_template",
        resource_id=template_id, payload={"name": name},
        severity="warning", request=request,
    )
    return {"deleted": True}


@router.post("/{template_id}/clone")
def clone_template(
    template_id: int,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    src = _seq(db, session.tenant.id, template_id)
    base_name = f"{src.name} (copy)"
    name = base_name
    n = 1
    while db.query(PipelineTemplate).filter(
        PipelineTemplate.tenant_id == session.tenant.id,
        PipelineTemplate.name == name,
    ).first():
        n += 1
        name = f"{base_name} {n}"

    new_t = PipelineTemplate(
        tenant_id=session.tenant.id,
        name=name,
        description=src.description,
        is_default=False,
        is_system=False,
    )
    db.add(new_t)
    db.flush()

    src_stages = db.query(PipelineStage).filter(
        PipelineStage.template_id == src.id
    ).order_by(PipelineStage.order_index.asc()).all()
    for s in src_stages:
        db.add(PipelineStage(
            template_id=new_t.id,
            key=s.key,
            label=s.label,
            order_index=s.order_index,
            is_terminal=s.is_terminal,
            terminal_outcome=s.terminal_outcome,
            auto_advance_threshold=s.auto_advance_threshold,
            color=s.color,
        ))
    db.commit()
    db.refresh(new_t)
    write_audit(
        db, action="pipeline_template.clone", actor=session.user,
        tenant_id=session.tenant.id, resource_type="pipeline_template",
        resource_id=new_t.id, payload={"source": src.id, "name": name},
        request=request,
    )
    return _template_to_response(new_t, db, with_stages=True)


# ─── Stages CRUD ─────────────────────────────────────────────────────────────


class StageUpdateRequest(BaseModel):
    label: Optional[str] = Field(default=None, min_length=1, max_length=128)
    key: Optional[str] = Field(default=None, min_length=1, max_length=64)
    is_terminal: Optional[bool] = None
    terminal_outcome: Optional[str] = None
    auto_advance_threshold: Optional[int] = Field(default=None, ge=0, le=100)
    color: Optional[str] = None


@router.post("/{template_id}/stages", status_code=201)
def create_stage(
    template_id: int,
    req: StagePayload,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    t = _seq(db, session.tenant.id, template_id)
    existing = db.query(PipelineStage).filter(PipelineStage.template_id == t.id).count()
    if existing >= MAX_STAGES:
        raise HTTPException(status_code=400, detail=f"Maximum {MAX_STAGES} stages per template")

    used_keys = {s.key for s in db.query(PipelineStage).filter(PipelineStage.template_id == t.id).all()}
    key = req.key or _slugify(req.label)
    base = key
    n = 1
    while key in used_keys:
        n += 1
        key = f"{base}_{n}"

    stage = PipelineStage(
        template_id=t.id,
        key=key,
        label=req.label.strip(),
        order_index=existing,
        is_terminal=req.is_terminal,
        terminal_outcome=req.terminal_outcome,
        auto_advance_threshold=req.auto_advance_threshold,
        color=req.color,
    )
    db.add(stage)
    db.commit()
    db.refresh(stage)
    return _stage_to_response(stage)


@router.put("/{template_id}/stages/{stage_id}")
def update_stage(
    template_id: int,
    stage_id: int,
    req: StageUpdateRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    _seq(db, session.tenant.id, template_id)
    s = db.query(PipelineStage).filter(
        PipelineStage.id == stage_id,
        PipelineStage.template_id == template_id,
    ).first()
    if not s:
        raise HTTPException(status_code=404, detail="Stage not found")

    fields = req.model_dump(exclude_unset=True)
    if "label" in fields and fields["label"]:
        s.label = fields["label"].strip()
    if "key" in fields and fields["key"]:
        new_key = _slugify(fields["key"])
        if new_key != s.key:
            taken = db.query(PipelineStage).filter(
                PipelineStage.template_id == template_id,
                PipelineStage.key == new_key,
                PipelineStage.id != s.id,
            ).first()
            if taken:
                raise HTTPException(status_code=409, detail=f"Key '{new_key}' already in use")
            s.key = new_key
    if "is_terminal" in fields:
        s.is_terminal = bool(fields["is_terminal"])
    if "terminal_outcome" in fields:
        outcome = (fields["terminal_outcome"] or "").lower().strip()
        s.terminal_outcome = outcome if outcome in VALID_OUTCOMES else ""
    if "auto_advance_threshold" in fields:
        s.auto_advance_threshold = fields["auto_advance_threshold"]
    if "color" in fields:
        s.color = fields["color"] or "slate"

    db.commit()
    db.refresh(s)
    return _stage_to_response(s)


@router.delete("/{template_id}/stages/{stage_id}")
def delete_stage(
    template_id: int,
    stage_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    _seq(db, session.tenant.id, template_id)
    s = db.query(PipelineStage).filter(
        PipelineStage.id == stage_id,
        PipelineStage.template_id == template_id,
    ).first()
    if not s:
        raise HTTPException(status_code=404, detail="Stage not found")

    in_use = db.query(Application).filter(Application.current_stage_id == stage_id).count()
    if in_use > 0:
        raise HTTPException(
            status_code=400,
            detail=f"Stage is in use by {in_use} application(s). Move them first.",
        )

    db.delete(s)
    survivors = db.query(PipelineStage).filter(
        PipelineStage.template_id == template_id,
    ).order_by(PipelineStage.order_index.asc()).all()
    for i, st in enumerate(survivors):
        st.order_index = i
    db.commit()
    return {"deleted": True}


class ReorderRequest(BaseModel):
    stage_ids: List[int] = Field(..., min_length=1)


@router.post("/{template_id}/stages/reorder")
def reorder_stages(
    template_id: int,
    req: ReorderRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    _seq(db, session.tenant.id, template_id)
    stages = db.query(PipelineStage).filter(PipelineStage.template_id == template_id).all()
    by_id = {s.id: s for s in stages}
    valid = [sid for sid in req.stage_ids if sid in by_id]
    if not valid:
        raise HTTPException(status_code=400, detail="No valid stage ids")
    for i, sid in enumerate(valid):
        by_id[sid].order_index = i
    next_idx = len(valid)
    for s in stages:
        if s.id not in valid:
            s.order_index = next_idx
            next_idx += 1
    db.commit()
    return {"reordered": len(valid)}
