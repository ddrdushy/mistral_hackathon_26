"""Platform-level secrets stored in the DB and merged into os.environ at startup.

The platform owner provides Mistral + ElevenLabs (and pays for usage); tenants
share these credentials and are billed via Stripe with a margin. Keys live in
the `settings` table with tenant_id IS NULL (global). DB value takes precedence
over .env; on startup we push DB values into os.environ so existing read sites
(os.getenv(...), the mistralai SDK's internal env reads) keep working unchanged.
"""
from __future__ import annotations

import os
from typing import Dict, List, Optional

from database import SessionLocal
from models import Setting

# Keys that the superadmin can manage from the UI. DATABASE_URL is intentionally
# NOT here — it bootstraps the DB itself and must stay in the env file.
GLOBAL_SECRET_KEYS: List[str] = [
    "MISTRAL_API_KEY",
    "ELEVENLABS_API_KEY",
    "ELEVENLABS_WEBHOOK_SECRET",
]


def _read_db_value(db, key: str) -> Optional[str]:
    row = (
        db.query(Setting)
        .filter(Setting.tenant_id.is_(None), Setting.key == key)
        .first()
    )
    return row.value if row and row.value else None


def get_global_secret(key: str) -> str:
    """DB first (tenant_id IS NULL), then os.environ. Empty string if missing."""
    db = SessionLocal()
    try:
        v = _read_db_value(db, key)
        if v:
            return v
    finally:
        db.close()
    return os.environ.get(key, "")


def set_global_secret(key: str, value: str) -> None:
    """Upsert a global secret and immediately reflect it in os.environ."""
    if key not in GLOBAL_SECRET_KEYS:
        raise ValueError(f"{key} is not a manageable global secret")
    db = SessionLocal()
    try:
        row = (
            db.query(Setting)
            .filter(Setting.tenant_id.is_(None), Setting.key == key)
            .first()
        )
        if row:
            row.value = value
        else:
            db.add(Setting(tenant_id=None, key=key, value=value))
        db.commit()
    finally:
        db.close()
    if value:
        os.environ[key] = value
    else:
        os.environ.pop(key, None)


def clear_global_secret(key: str) -> None:
    """Delete the DB override; os.environ falls back to whatever the .env had at startup."""
    if key not in GLOBAL_SECRET_KEYS:
        raise ValueError(f"{key} is not a manageable global secret")
    db = SessionLocal()
    try:
        db.query(Setting).filter(
            Setting.tenant_id.is_(None), Setting.key == key
        ).delete()
        db.commit()
    finally:
        db.close()
    # Re-apply env-file value if any (kept in _ENV_FILE_BASELINE), else unset.
    baseline = _ENV_FILE_BASELINE.get(key, "")
    if baseline:
        os.environ[key] = baseline
    else:
        os.environ.pop(key, None)


# Snapshot of os.environ values at process start, BEFORE we merge DB overrides.
# Used by clear_global_secret() to revert to the file value when an override is
# deleted. Populated by apply_db_secrets_to_env().
_ENV_FILE_BASELINE: Dict[str, str] = {}


def apply_db_secrets_to_env() -> Dict[str, str]:
    """Snapshot the .env baseline, then push DB values into os.environ.

    Call once at startup, before any router/agent module is imported. Returns
    a dict of {key: source} where source is "db", "env", or "unset" — useful
    for boot logs.

    Tolerates a missing `settings` table on first boot — init_db() will create
    it shortly after, and the next startup will pick up any DB overrides.
    """
    sources: Dict[str, str] = {}
    for key in GLOBAL_SECRET_KEYS:
        _ENV_FILE_BASELINE[key] = os.environ.get(key, "")

    try:
        db = SessionLocal()
    except Exception:
        # DB unreachable — fall back to env-only.
        return {k: ("env" if _ENV_FILE_BASELINE.get(k) else "unset") for k in GLOBAL_SECRET_KEYS}

    try:
        for key in GLOBAL_SECRET_KEYS:
            try:
                db_val = _read_db_value(db, key)
            except Exception:
                # Table doesn't exist yet (first boot before init_db ran).
                db.rollback()
                db_val = None
            if db_val:
                os.environ[key] = db_val
                sources[key] = "db"
            elif _ENV_FILE_BASELINE.get(key):
                sources[key] = "env"
            else:
                sources[key] = "unset"
    finally:
        db.close()
    return sources


def list_secret_status() -> List[dict]:
    """For the admin UI: per-key {source, has_value, masked_value, last_updated}."""
    out: List[dict] = []
    db = SessionLocal()
    try:
        rows = {
            r.key: r
            for r in db.query(Setting).filter(Setting.tenant_id.is_(None)).all()
        }
        for key in GLOBAL_SECRET_KEYS:
            row = rows.get(key)
            db_val = row.value if row and row.value else ""
            env_val = _ENV_FILE_BASELINE.get(key) or os.environ.get(key, "")
            effective = db_val or env_val
            if db_val:
                source = "db"
            elif env_val:
                source = "env"
            else:
                source = "unset"
            out.append({
                "key": key,
                "source": source,
                "has_value": bool(effective),
                "masked_value": _mask(effective),
                "updated_at": row.updated_at.isoformat() if (row and row.updated_at) else None,
            })
    finally:
        db.close()
    return out


def _mask(value: str) -> str:
    """Show first 4 + last 4 chars, hide the rest. Empty stays empty."""
    if not value:
        return ""
    if len(value) <= 8:
        return "•" * len(value)
    return f"{value[:4]}{'•' * 8}{value[-4:]}"
