"""Mode-aware Stripe configuration.

Two parallel credential sets live in the `settings` table (tenant_id IS
NULL) — one for sandbox (test mode), one for prod (live mode). A single
`stripe.mode` row decides which set the app currently uses. Super-admin
flips it from the UI.

Falls back to env (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
STRIPE_STARTER_PRICE_ID, STRIPE_PRO_PRICE_ID) when no DB value for the
active mode is set — keeps existing dev/CI flows working unchanged.

Keys layout in `settings`:
  stripe.mode                          : "sandbox" | "prod"
  stripe.sandbox.secret_key            : sk_test_…
  stripe.sandbox.publishable_key       : pk_test_…
  stripe.sandbox.webhook_secret        : whsec_…
  stripe.sandbox.starter_price_id      : price_…
  stripe.sandbox.pro_price_id          : price_…
  stripe.prod.secret_key               : sk_live_…
  stripe.prod.publishable_key          : pk_live_…
  stripe.prod.webhook_secret           : whsec_…
  stripe.prod.starter_price_id         : price_…
  stripe.prod.pro_price_id             : price_…
"""
from __future__ import annotations

import logging
import os
import time
from typing import Literal, Optional

from database import SessionLocal
from models import Setting

logger = logging.getLogger("hireops.stripe_config")

StripeMode = Literal["sandbox", "prod"]

DEFAULT_MODE: StripeMode = "sandbox"
KEY_NAMES = (
    "secret_key",
    "publishable_key",
    "webhook_secret",
    "starter_price_id",
    "pro_price_id",
)

# Per-mode env fallbacks. When a mode-specific DB row is empty, these env
# vars are tried in order. Keeps single-set deploys working.
_ENV_FALLBACK = {
    "secret_key": "STRIPE_SECRET_KEY",
    "publishable_key": "STRIPE_PUBLISHABLE_KEY",
    "webhook_secret": "STRIPE_WEBHOOK_SECRET",
    "starter_price_id": "STRIPE_STARTER_PRICE_ID",
    "pro_price_id": "STRIPE_PRO_PRICE_ID",
}


# 30-second cache so reads on the hot path don't hit the DB every call.
_cache: dict = {}
_cache_ts: float = 0.0
_CACHE_TTL = 30.0


def invalidate_cache() -> None:
    global _cache_ts
    _cache_ts = 0.0


def _settings_key(mode: StripeMode, name: str) -> str:
    return f"stripe.{mode}.{name}"


def _read_setting(db, key: str) -> Optional[str]:
    row = (
        db.query(Setting)
        .filter(Setting.tenant_id.is_(None), Setting.key == key)
        .first()
    )
    return row.value if row and row.value else None


def _write_setting(db, key: str, value: Optional[str]) -> None:
    row = (
        db.query(Setting)
        .filter(Setting.tenant_id.is_(None), Setting.key == key)
        .first()
    )
    if value is None or value == "":
        if row:
            db.delete(row)
        return
    if row:
        row.value = value
    else:
        db.add(Setting(tenant_id=None, key=key, value=value))


def _load_all() -> dict:
    """Read both modes' credentials + active mode in one DB round-trip,
    cache the result."""
    global _cache, _cache_ts
    now = time.time()
    if (now - _cache_ts) < _CACHE_TTL and _cache:
        return _cache

    out: dict = {
        "mode": DEFAULT_MODE,
        "sandbox": {},
        "prod": {},
    }
    try:
        db = SessionLocal()
    except Exception:
        return out
    try:
        rows = (
            db.query(Setting)
            .filter(
                Setting.tenant_id.is_(None),
                Setting.key.like("stripe.%"),
            )
            .all()
        )
        for r in rows:
            if r.key == "stripe.mode":
                if r.value in ("sandbox", "prod"):
                    out["mode"] = r.value
                continue
            for mode in ("sandbox", "prod"):
                prefix = f"stripe.{mode}."
                if r.key.startswith(prefix):
                    name = r.key[len(prefix):]
                    if name in KEY_NAMES:
                        out[mode][name] = r.value or ""
    except Exception as e:
        logger.warning("stripe_config load failed: %s", e)
    finally:
        db.close()

    _cache = out
    _cache_ts = now
    return out


def get_mode() -> StripeMode:
    return _load_all().get("mode", DEFAULT_MODE)  # type: ignore[return-value]


def set_mode(mode: StripeMode) -> None:
    if mode not in ("sandbox", "prod"):
        raise ValueError(f"Invalid stripe mode: {mode}")
    db = SessionLocal()
    try:
        row = (
            db.query(Setting)
            .filter(Setting.tenant_id.is_(None), Setting.key == "stripe.mode")
            .first()
        )
        if row:
            row.value = mode
        else:
            db.add(Setting(tenant_id=None, key="stripe.mode", value=mode))
        db.commit()
    finally:
        db.close()
    invalidate_cache()


def get_value(name: str, mode: Optional[StripeMode] = None) -> str:
    """Resolve a credential value for the active (or specified) mode.
    Falls through to the corresponding env var when DB row is empty."""
    if name not in KEY_NAMES:
        raise KeyError(f"Unknown Stripe config key: {name}")
    cfg = _load_all()
    actual_mode = mode or cfg["mode"]
    db_val = (cfg.get(actual_mode) or {}).get(name) or ""
    if db_val:
        return db_val
    return os.getenv(_ENV_FALLBACK[name], "") or ""


def set_credentials(mode: StripeMode, **values: Optional[str]) -> None:
    """Upsert (or clear, on empty/None) one or more credentials for a mode.

    Pass `value=""` to delete a single key without touching the others.
    """
    if mode not in ("sandbox", "prod"):
        raise ValueError(f"Invalid stripe mode: {mode}")
    unknown = set(values.keys()) - set(KEY_NAMES)
    if unknown:
        raise ValueError(f"Unknown stripe keys: {sorted(unknown)}")
    db = SessionLocal()
    try:
        for name, val in values.items():
            _write_setting(db, _settings_key(mode, name), val)
        db.commit()
    finally:
        db.close()
    invalidate_cache()


def clear_credentials(mode: StripeMode) -> None:
    """Wipe every key for a mode."""
    set_credentials(mode, **{name: "" for name in KEY_NAMES})


# ─── UI helpers ──────────────────────────────────────────────────────────────


def _mask(v: str) -> str:
    if not v:
        return ""
    if len(v) <= 8:
        return "•" * len(v)
    return f"{v[:4]}{'•' * 6}{v[-4:]}"


def status_summary() -> dict:
    """Returns a dict suitable for the super-admin UI:
      {
        mode: "sandbox" | "prod",
        sandbox: { secret_key: "sk_t…XXXX" | "", ... },
        prod:    { ... },
        env_fallbacks_present: { secret_key: bool, ... }
      }
    Never returns the raw secret values — only masked.
    """
    cfg = _load_all()
    out: dict = {
        "mode": cfg["mode"],
        "sandbox": {},
        "prod": {},
        "env_fallbacks_present": {},
    }
    for mode in ("sandbox", "prod"):
        for name in KEY_NAMES:
            v = (cfg.get(mode) or {}).get(name) or ""
            # price ids and publishable keys are not secrets — show in full
            if name in ("starter_price_id", "pro_price_id", "publishable_key"):
                out[mode][name] = v
            else:
                out[mode][name] = _mask(v) if v else ""
            out[mode][f"{name}_set"] = bool(v)
    for name in KEY_NAMES:
        out["env_fallbacks_present"][name] = bool(os.getenv(_ENV_FALLBACK[name]))
    return out
