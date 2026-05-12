"""Tenant-owner facing audit log.

Tenant owners see actions performed by their own team only. Super-admin
actions targeting this tenant are deliberately excluded — they're
internal platform operations and tenants found them noisy/confusing.

The cross-tenant super-admin endpoint lives in routers/admin.py.
"""
from typing import Optional

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from auth.dependencies import current_session, CurrentSession, require_owner
from database import get_db
from models import AuditLog, User
from services.audit import to_response

router = APIRouter(prefix="/api/v1/audit-log", tags=["audit"])


@router.get("")
def list_my_audit_log(
    action: Optional[str] = None,
    severity: Optional[str] = None,
    resource_type: Optional[str] = None,
    page: int = 1,
    per_page: int = 50,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_owner),
):
    """Audit entries written by this tenant's own team. Platform-admin
    operations are filtered out."""
    tid = session.tenant.id

    query = db.query(AuditLog).filter(
        AuditLog.tenant_id == tid,
        AuditLog.super_admin_user_id.is_(None),
    )
    if action:
        query = query.filter(AuditLog.action_type.ilike(f"{action}%"))
    if severity:
        query = query.filter(AuditLog.severity == severity)
    if resource_type:
        query = query.filter(AuditLog.resource_type == resource_type)

    total = query.count()
    page = max(page, 1)
    per_page = max(min(per_page, 200), 1)
    rows = (
        query.order_by(AuditLog.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )

    # Hydrate missing actor_email from User table for older rows that
    # didn't snapshot the email.
    needs_email = [r.actor_user_id for r in rows if r.actor_user_id and not r.actor_email]
    if not needs_email:
        # Also try super_admin_user_id for legacy rows
        needs_email = [r.super_admin_user_id for r in rows if r.super_admin_user_id and not r.actor_email]
    email_map: dict[int, str] = {}
    if needs_email:
        for u in db.query(User.id, User.email).filter(User.id.in_(needs_email)).all():
            email_map[u.id] = u.email

    out = []
    for r in rows:
        item = to_response(r)
        if not item["actor_email"]:
            uid = r.actor_user_id or r.super_admin_user_id
            if uid and uid in email_map:
                item["actor_email"] = email_map[uid]
        out.append(item)

    return {
        "entries": out,
        "total": total,
        "page": page,
        "per_page": per_page,
    }
