"""
FastAPI dependencies for resolving the current user + tenant from the JWT cookie.

`current_user_and_tenant` is the workhorse — apply it to every router handler
that touches tenant-scoped data.
"""
from __future__ import annotations

from dataclasses import dataclass
from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy.orm import Session

from database import get_db
from models import User, Tenant
from auth.security import COOKIE_NAME, decode_jwt


@dataclass
class CurrentSession:
    user: User
    tenant: Tenant


def _resolve_session(token: str | None, db: Session) -> CurrentSession | None:
    if not token:
        return None
    payload = decode_jwt(token)
    if not payload:
        return None
    try:
        user_id = int(payload.get("sub", 0))
    except (TypeError, ValueError):
        return None
    if not user_id:
        return None
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        return None
    if user.disabled_at is not None:
        return None
    tenant = db.query(Tenant).filter(Tenant.id == user.tenant_id).first()
    if not tenant:
        return None
    if tenant.suspended:
        return None
    if tenant.deleted_at is not None:
        return None
    return CurrentSession(user=user, tenant=tenant)


async def current_session(
    hireops_session: str | None = Cookie(default=None, alias=COOKIE_NAME),
    db: Session = Depends(get_db),
) -> CurrentSession:
    """Required: caller must be logged in. Raises 401 otherwise.

    Async on purpose: a sync dependency runs in FastAPI's threadpool, which
    means contextvars set inside it don't propagate to the async endpoint
    body. That broke per-tenant LLM usage tracking — `record_llm_usage()`
    saw an empty `_active_tenant` and wrote rows with tenant_id=NULL.
    """
    s = _resolve_session(hireops_session, db)
    if not s:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    from billing.cost_guard import set_active_tenant, set_active_user
    set_active_tenant(s.tenant.id)
    set_active_user(s.user.id)
    return s


def optional_session(
    hireops_session: str | None = Cookie(default=None, alias=COOKIE_NAME),
    db: Session = Depends(get_db),
) -> CurrentSession | None:
    """Optional: callers can be anon (e.g. public interview-link endpoints)."""
    return _resolve_session(hireops_session, db)


def require_superadmin(
    session: CurrentSession = Depends(current_session),
) -> CurrentSession:
    if not session.user.is_superadmin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Superadmin only",
        )
    return session


def require_owner(
    session: CurrentSession = Depends(current_session),
) -> CurrentSession:
    """Tenant-level owner — can manage billing, invite team members."""
    if session.user.role != "owner" and not session.user.is_superadmin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tenant owner only",
        )
    return session
