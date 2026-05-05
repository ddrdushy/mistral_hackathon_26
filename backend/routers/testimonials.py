"""Public testimonials endpoint.

Read-only feed used by the marketing landing page. Writes are handled by
the admin router (`/api/v1/admin/testimonials/*`) and gated to superadmins.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import Testimonial

router = APIRouter(prefix="/api/v1/testimonials", tags=["testimonials"])


class TestimonialItem(BaseModel):
    id: int
    quote: str
    author_name: str
    author_role: str
    avatar_url: str
    display_order: int

    class Config:
        from_attributes = True


class TestimonialListResponse(BaseModel):
    testimonials: list[TestimonialItem]


@router.get("", response_model=TestimonialListResponse)
async def list_active(db: Session = Depends(get_db)):
    """Public — returns only active testimonials, ordered for landing display."""
    rows = (
        db.query(Testimonial)
        .filter(Testimonial.is_active.is_(True))
        .order_by(Testimonial.display_order.asc(), Testimonial.id.asc())
        .all()
    )
    return TestimonialListResponse(
        testimonials=[TestimonialItem.model_validate(r) for r in rows]
    )
