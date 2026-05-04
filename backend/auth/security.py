"""
Auth primitives: password hashing (argon2) and JWT issuance/verification.
"""
from __future__ import annotations

import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, InvalidHash

# Argon2 with sensible defaults (memory cost ~64MB, time cost 3, parallelism 4)
_hasher = PasswordHasher()


def hash_password(plain: str) -> str:
    return _hasher.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _hasher.verify(hashed, plain)
    except (VerifyMismatchError, InvalidHash):
        return False


# ── JWT ────────────────────────────────────────────────────────────────────

JWT_ALGORITHM = "HS256"
JWT_TTL_DAYS = 7
COOKIE_NAME = "hireops_session"


def _jwt_secret() -> str:
    """Lazily resolve the secret so import-time doesn't crash if env var missing."""
    secret = os.getenv("JWT_SECRET")
    if not secret:
        # Auto-generate a per-process secret so dev doesn't break, but warn loudly
        # so prod runs always have a fixed secret across restarts.
        secret = os.environ.setdefault("JWT_SECRET", secrets.token_hex(32))
        print(
            "[auth] WARNING: JWT_SECRET not set; generated ephemeral secret. "
            "Sessions will be invalidated on restart. Set JWT_SECRET in .env for prod."
        )
    return secret


def issue_jwt(user_id: int, tenant_id: int, ttl_days: int = JWT_TTL_DAYS) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(user_id),
        "tid": tenant_id,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(days=ttl_days)).timestamp()),
    }
    return jwt.encode(payload, _jwt_secret(), algorithm=JWT_ALGORITHM)


def decode_jwt(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, _jwt_secret(), algorithms=[JWT_ALGORITHM])
    except jwt.PyJWTError:
        return None


# ── Single-use tokens (email verification, password reset) ─────────────────


def new_token(nbytes: int = 32) -> str:
    """URL-safe random token for email verify / password reset links."""
    return secrets.token_urlsafe(nbytes)
