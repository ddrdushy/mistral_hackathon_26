"""Legacy super-admin audit helper.

New code should import `services.audit.write_audit` instead. This shim
keeps `record_audit(...)` signature stable so existing super-admin
endpoints don't need to change in one big sweep — Feature 0 of
ENTERPRISE_FEATURES.md broadens the audit log; everything still routes
through the same table.
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import Request
from sqlalchemy.orm import Session

from models import AuditLog, User
from services.audit import write_audit


def record_audit(
    db: Session,
    actor: User,
    action: str,
    target_tenant_id: Optional[int] = None,
    target_user_id: Optional[int] = None,
    payload: Optional[dict[str, Any]] = None,
    request: Optional[Request] = None,
) -> AuditLog:
    """Append an audit log row (super-admin variant).

    Backwards-compatible wrapper around services.audit.write_audit. Sets
    super_admin_user_id automatically when the actor has is_superadmin=True.
    """
    return write_audit(
        db,
        action=action,
        actor=actor,
        target_tenant_id=target_tenant_id,
        target_user_id=target_user_id,
        payload=payload,
        request=request,
    )
