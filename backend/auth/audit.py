"""
Helper for recording super-admin actions to the audit_log table.

Use it from every privileged endpoint:

    record_audit(
        db,
        actor=session.user,
        action="tenant.suspend",
        target_tenant_id=tenant.id,
        request=request,
        payload={"before": {"suspended": False}, "after": {"suspended": True}},
    )
"""
from __future__ import annotations

import json
import logging
from typing import Any, Optional

from fastapi import Request
from sqlalchemy.orm import Session

from models import AuditLog, User

logger = logging.getLogger("hireops.audit")


def _client_ip(request: Optional[Request]) -> Optional[str]:
    if not request:
        return None
    # Trust X-Forwarded-For if behind a reverse proxy (we are, in production)
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else None


def record_audit(
    db: Session,
    actor: User,
    action: str,
    target_tenant_id: Optional[int] = None,
    target_user_id: Optional[int] = None,
    payload: Optional[dict[str, Any]] = None,
    request: Optional[Request] = None,
) -> AuditLog:
    """Append an audit log row. Commits on its own — caller doesn't need to."""
    entry = AuditLog(
        super_admin_user_id=actor.id,
        action_type=action,
        target_tenant_id=target_tenant_id,
        target_user_id=target_user_id,
        payload=json.dumps(payload or {}),
        ip_address=_client_ip(request),
    )
    db.add(entry)
    try:
        db.commit()
    except Exception as e:
        db.rollback()
        logger.warning("Audit write failed: %s", e)
    logger.info(
        "AUDIT user=%s action=%s tenant=%s user_target=%s",
        actor.email, action, target_tenant_id, target_user_id,
    )
    return entry
