"""
Shared slowapi Limiter — extracted to its own module to avoid circular
imports (main.py imports from routers, routers need the limiter to decorate
endpoints).

`key_func` returns one string per identity. We default to per-tenant when
authenticated, falling back to per-IP. Endpoints can override `key_func` —
e.g. auth endpoints rate-limit by IP since the user isn't authenticated yet.
"""
from __future__ import annotations

from fastapi import Request
from slowapi import Limiter
from slowapi.util import get_remote_address


def _key(request: Request) -> str:
    cookie_token = request.cookies.get("hireops_session")
    if cookie_token:
        try:
            from auth.security import decode_jwt
            payload = decode_jwt(cookie_token)
            if payload:
                return f"tenant:{payload.get('tid')}"
        except Exception:
            pass
    return f"ip:{get_remote_address(request)}"


limiter = Limiter(
    key_func=_key,
    default_limits=["600/minute"],
    storage_uri="memory://",
)
