"""Audit log helper — every privileged action goes through this.

Implements Feature 0 of ENTERPRISE_FEATURES.md. Single function
`write_audit()` that handles both super-admin actions (existing super-
admin endpoints) and tenant-level actions (offer.send, candidate.tag.add,
integration.connect, …). Append-only: no UPDATE / DELETE paths.

The legacy `auth/audit.py:record_audit()` is kept as a thin shim around
this so we don't have to migrate every call site at once.
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
    fwd = request.headers.get("x-forwarded-for", "")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else None


def _user_agent(request: Optional[Request]) -> Optional[str]:
    if not request:
        return None
    ua = request.headers.get("user-agent")
    return ua[:500] if ua else None


def write_audit(
    db: Session,
    *,
    action: str,
    actor: Optional[User] = None,
    tenant_id: Optional[int] = None,
    resource_type: Optional[str] = None,
    resource_id: Optional[Any] = None,
    target_tenant_id: Optional[int] = None,
    target_user_id: Optional[int] = None,
    payload: Optional[dict[str, Any]] = None,
    severity: str = "info",
    request: Optional[Request] = None,
) -> AuditLog:
    """Append a row to audit_log. Commits on its own.

    - `actor` — the user performing the action; nullable for platform
      actions (e.g. background jobs).
    - `tenant_id` — owning tenant for tenant-scoped actions; for super-
      admin actions targeting a tenant, prefer `target_tenant_id` (the
      actor is a superadmin in their own org context).
    - `resource_type` / `resource_id` — generic pointer; preferred over
      `target_tenant_id` / `target_user_id` for new feature code.
    - `payload` — JSON-serialised dict, typically {before, after, reason}.
    - `severity` — info | warning | critical. Used for filtering.

    Inferred:
      - actor_user_id, actor_email from `actor`
      - super_admin_user_id (legacy column) when actor.is_superadmin
      - ip_address, actor_user_agent from `request`
    """
    actor_user_id = actor.id if actor else None
    actor_email = (actor.email if actor else None)
    super_admin_user_id = (
        actor.id if actor and getattr(actor, "is_superadmin", False) else None
    )
    if resource_id is not None:
        resource_id = str(resource_id)
    if severity not in ("info", "warning", "critical"):
        severity = "info"

    entry = AuditLog(
        tenant_id=tenant_id,
        actor_user_id=actor_user_id,
        actor_email=actor_email,
        actor_user_agent=_user_agent(request),
        super_admin_user_id=super_admin_user_id,
        action_type=action,
        resource_type=resource_type,
        resource_id=resource_id,
        target_tenant_id=target_tenant_id,
        target_user_id=target_user_id,
        payload=json.dumps(payload or {}),
        severity=severity,
        ip_address=_client_ip(request),
    )
    db.add(entry)
    try:
        db.commit()
    except Exception as e:
        db.rollback()
        logger.warning("Audit write failed: %s", e)
    logger.info(
        "AUDIT actor=%s action=%s severity=%s tenant=%s resource=%s/%s",
        actor_email or "system", action, severity,
        tenant_id or target_tenant_id,
        resource_type, resource_id,
    )
    return entry


def to_response(row: AuditLog) -> dict:
    try:
        payload = json.loads(row.payload) if row.payload else {}
    except Exception:
        payload = {}
    return {
        "id": row.id,
        "action_type": row.action_type,
        "severity": row.severity or "info",
        "tenant_id": row.tenant_id,
        "actor_user_id": row.actor_user_id,
        "actor_email": row.actor_email,
        "resource_type": row.resource_type,
        "resource_id": row.resource_id,
        "target_tenant_id": row.target_tenant_id,
        "target_user_id": row.target_user_id,
        "payload": payload,
        "ip_address": row.ip_address,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }
