"""Tenant-scoped candidate tags (Feature 2 of ENTERPRISE_FEATURES.md).

Tags are manually applied by HR — distinct from `Candidate.profile_skills`
which are auto-extracted by the LLM. Used for filtering on the talent
bank and for bulk operations (apply / remove a tag across N candidates
in one call).
"""
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from auth.dependencies import current_session, CurrentSession
from database import get_db
from models import Tag, CandidateTag, Candidate
from services.audit import write_audit

router = APIRouter(prefix="/api/v1/tags", tags=["tags"])


# Fixed Tailwind-friendly palette — UI renders chips off these keys so a
# tenant can't accidentally pick a colour that clashes with the rest of
# the design system.
ALLOWED_COLORS = [
    "indigo", "blue", "sky", "cyan", "teal", "emerald",
    "lime", "yellow", "amber", "orange", "red", "rose",
    "pink", "fuchsia", "purple", "violet", "slate",
]


def _tag_to_response(t: Tag, candidate_count: Optional[int] = None) -> dict:
    out = {
        "id": t.id,
        "name": t.name,
        "color": t.color or "indigo",
        "created_at": t.created_at.isoformat() if t.created_at else None,
    }
    if candidate_count is not None:
        out["candidate_count"] = candidate_count
    return out


@router.get("")
def list_tags(
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """All tags for the tenant + how many candidates each is attached to."""
    from sqlalchemy import func
    tags = db.query(Tag).filter(
        Tag.tenant_id == session.tenant.id,
    ).order_by(Tag.name.asc()).all()
    counts = dict(
        db.query(CandidateTag.tag_id, func.count(CandidateTag.candidate_id))
        .filter(CandidateTag.tag_id.in_([t.id for t in tags]))
        .group_by(CandidateTag.tag_id)
        .all()
    ) if tags else {}
    return {"tags": [_tag_to_response(t, counts.get(t.id, 0)) for t in tags]}


class TagCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    color: str = Field(default="indigo")


def _normalise_name(raw: str) -> str:
    n = (raw or "").strip().replace("\n", " ").replace("\r", " ")
    if not n or len(n) > 64:
        raise HTTPException(status_code=400, detail="Tag name must be 1-64 chars, no newlines")
    return n


@router.post("", status_code=201)
def create_tag(
    req: TagCreateRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    name = _normalise_name(req.name)
    color = req.color if req.color in ALLOWED_COLORS else "indigo"
    tag = Tag(
        tenant_id=session.tenant.id,
        name=name,
        color=color,
        created_by_user_id=session.user.id if session.user else None,
    )
    db.add(tag)
    try:
        db.commit()
        db.refresh(tag)
    except IntegrityError:
        db.rollback()
        # Race or duplicate — return the existing one so create-on-fly is idempotent.
        existing = db.query(Tag).filter(
            Tag.tenant_id == session.tenant.id,
            Tag.name == name,
        ).first()
        if existing:
            return _tag_to_response(existing, 0)
        raise HTTPException(status_code=409, detail="Tag name already exists")

    write_audit(
        db,
        action="tag.create",
        actor=session.user,
        tenant_id=session.tenant.id,
        resource_type="tag",
        resource_id=tag.id,
        payload={"name": name, "color": color},
        request=request,
    )
    return _tag_to_response(tag, 0)


@router.delete("/{tag_id}")
def delete_tag(
    tag_id: int,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    tag = db.query(Tag).filter(
        Tag.id == tag_id,
        Tag.tenant_id == session.tenant.id,
    ).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")
    name = tag.name
    # Cascade: ON DELETE CASCADE on candidate_tags handles the link rows.
    db.delete(tag)
    db.commit()
    write_audit(
        db,
        action="tag.delete",
        actor=session.user,
        tenant_id=session.tenant.id,
        resource_type="tag",
        resource_id=tag_id,
        payload={"name": name},
        severity="warning",
        request=request,
    )
    return {"deleted": True}


# ─── Per-candidate tag mutations (mounted under /candidates/{id}/tags) ──────


candidate_tags_router = APIRouter(
    prefix="/api/v1/candidates",
    tags=["tags"],
)


class CandidateTagsRequest(BaseModel):
    tag_ids: List[int] = Field(..., min_length=1)


@candidate_tags_router.post("/{candidate_id}/tags")
def add_candidate_tags(
    candidate_id: int,
    req: CandidateTagsRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Attach one or more tags to a candidate. Idempotent — applying an
    already-attached tag is a no-op (no duplicate row, no error)."""
    candidate = db.query(Candidate).filter(
        Candidate.id == candidate_id,
        Candidate.tenant_id == session.tenant.id,
    ).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")

    valid_tag_ids = {
        t.id for t in db.query(Tag.id).filter(
            Tag.tenant_id == session.tenant.id,
            Tag.id.in_(req.tag_ids),
        ).all()
    }
    if not valid_tag_ids:
        raise HTTPException(status_code=400, detail="No valid tag ids for this tenant")

    existing = {
        l.tag_id for l in db.query(CandidateTag.tag_id).filter(
            CandidateTag.candidate_id == candidate_id,
            CandidateTag.tag_id.in_(valid_tag_ids),
        ).all()
    }
    user_id = session.user.id if session.user else None
    added = []
    for tid in valid_tag_ids - existing:
        db.add(CandidateTag(
            candidate_id=candidate_id,
            tag_id=tid,
            applied_by_user_id=user_id,
        ))
        added.append(tid)
    if added:
        db.commit()
        write_audit(
            db,
            action="candidate.tag.add",
            actor=session.user,
            tenant_id=session.tenant.id,
            resource_type="candidate",
            resource_id=candidate_id,
            payload={"tag_ids": sorted(added)},
            request=request,
        )

    return {"added": sorted(added), "already_present": sorted(existing)}


@candidate_tags_router.delete("/{candidate_id}/tags/{tag_id}")
def remove_candidate_tag(
    candidate_id: int,
    tag_id: int,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    candidate = db.query(Candidate).filter(
        Candidate.id == candidate_id,
        Candidate.tenant_id == session.tenant.id,
    ).first()
    if not candidate:
        raise HTTPException(status_code=404, detail="Candidate not found")
    deleted = db.query(CandidateTag).filter(
        CandidateTag.candidate_id == candidate_id,
        CandidateTag.tag_id == tag_id,
    ).delete()
    db.commit()
    if deleted:
        write_audit(
            db,
            action="candidate.tag.remove",
            actor=session.user,
            tenant_id=session.tenant.id,
            resource_type="candidate",
            resource_id=candidate_id,
            payload={"tag_id": tag_id},
            request=request,
        )
    return {"deleted": deleted}


class BulkTagRequest(BaseModel):
    candidate_ids: List[int] = Field(..., min_length=1, max_length=500)
    tag_ids: List[int] = Field(..., min_length=1)
    action: str = Field(..., pattern="^(add|remove)$")


@candidate_tags_router.post("/bulk-tag")
def bulk_tag(
    req: BulkTagRequest,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Add or remove a set of tags across many candidates in one call.

    Tenant-scoped on both candidates AND tags; foreign rows are silently
    filtered out rather than 400ing the whole batch.
    """
    valid_candidate_ids = [
        c.id for c in db.query(Candidate.id).filter(
            Candidate.tenant_id == session.tenant.id,
            Candidate.id.in_(req.candidate_ids),
        ).all()
    ]
    valid_tag_ids = [
        t.id for t in db.query(Tag.id).filter(
            Tag.tenant_id == session.tenant.id,
            Tag.id.in_(req.tag_ids),
        ).all()
    ]
    if not valid_candidate_ids or not valid_tag_ids:
        raise HTTPException(status_code=400, detail="No valid candidates or tags for this tenant")

    if req.action == "add":
        existing_pairs = {
            (l.candidate_id, l.tag_id)
            for l in db.query(CandidateTag.candidate_id, CandidateTag.tag_id).filter(
                CandidateTag.candidate_id.in_(valid_candidate_ids),
                CandidateTag.tag_id.in_(valid_tag_ids),
            ).all()
        }
        user_id = session.user.id if session.user else None
        rows_added = 0
        for cid in valid_candidate_ids:
            for tid in valid_tag_ids:
                if (cid, tid) in existing_pairs:
                    continue
                db.add(CandidateTag(
                    candidate_id=cid,
                    tag_id=tid,
                    applied_by_user_id=user_id,
                ))
                rows_added += 1
        db.commit()
        result = {"action": "add", "rows_added": rows_added}
    else:  # remove
        deleted = db.query(CandidateTag).filter(
            CandidateTag.candidate_id.in_(valid_candidate_ids),
            CandidateTag.tag_id.in_(valid_tag_ids),
        ).delete(synchronize_session="fetch")
        db.commit()
        result = {"action": "remove", "rows_removed": deleted}

    write_audit(
        db,
        action=f"candidate.tag.bulk_{req.action}",
        actor=session.user,
        tenant_id=session.tenant.id,
        resource_type="bulk",
        resource_id=None,
        payload={
            "candidate_count": len(valid_candidate_ids),
            "tag_ids": valid_tag_ids,
            **result,
        },
        request=request,
    )
    return result
