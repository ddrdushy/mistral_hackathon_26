"""Symmetric encryption for tenant-scoped secrets (IMAP passwords, OAuth tokens).

The key comes from `INBOX_SECRET_KEY` env var. Any string is accepted — we
hash it to derive a 32-byte Fernet key, so users don't have to generate one.

If `INBOX_SECRET_KEY` is unset, we fall back to a deterministic key derived
from `SECRET_KEY` (or a hard-coded dev string in last resort) and log a
warning. **In production set INBOX_SECRET_KEY to a long random string.**

Rotation: change the env var. Existing rows decrypt with the old key only —
we don't migrate. For now, rotation = re-connect mailboxes.
"""
from __future__ import annotations

import base64
import hashlib
import logging
import os
from typing import Optional

from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger("hireops.secrets_crypto")

_FERNET: Optional[Fernet] = None


def _derive_key() -> bytes:
    raw = (
        os.getenv("INBOX_SECRET_KEY")
        or os.getenv("SECRET_KEY")
        or "hireops-dev-only-DO-NOT-use-in-prod"
    )
    if raw == "hireops-dev-only-DO-NOT-use-in-prod":
        logger.warning(
            "INBOX_SECRET_KEY not set — using insecure dev fallback. "
            "Set INBOX_SECRET_KEY to a long random string for production."
        )
    digest = hashlib.sha256(raw.encode("utf-8")).digest()
    return base64.urlsafe_b64encode(digest)


def _get_fernet() -> Fernet:
    global _FERNET
    if _FERNET is None:
        _FERNET = Fernet(_derive_key())
    return _FERNET


def encrypt(plaintext: str) -> str:
    """Encrypt a string. Returns the URL-safe base64 token. Empty input returns empty."""
    if not plaintext:
        return ""
    return _get_fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt(token: str) -> str:
    """Decrypt a token from `encrypt`. Empty token returns empty.

    Raises ValueError on invalid ciphertext (wrong key or corruption) so callers
    can surface a clear "credentials need to be re-entered" error.
    """
    if not token:
        return ""
    try:
        return _get_fernet().decrypt(token.encode("ascii")).decode("utf-8")
    except InvalidToken as e:
        raise ValueError(
            "Stored credential could not be decrypted (wrong INBOX_SECRET_KEY?)"
        ) from e
