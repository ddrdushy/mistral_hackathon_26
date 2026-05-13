"""Twilio adapter — WhatsApp + SMS message sending for tenant integrations.

Auth tokens are stored encrypted in TenantIntegration.secret_encrypted; we
decrypt only at send time. Calls Twilio's REST API directly via httpx so
we don't pull in the full twilio SDK for what amounts to one POST per
message.

Voice calling (ElevenLabs agent dialing the candidate) lives in a separate
service in Phase 3 — keep this file focused on text messaging.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass
from typing import Optional

import httpx
from sqlalchemy.orm import Session

from models import TenantIntegration
from services.secrets_crypto import decrypt

logger = logging.getLogger("hireops.twilio")

PROVIDER = "twilio"
TWILIO_API_BASE = "https://api.twilio.com/2010-04-01"


@dataclass
class TwilioConfig:
    account_sid: str
    auth_token: str
    whatsapp_from: str = ""        # e.g. +14155238886 (sandbox) or your sender
    sms_from: str = ""             # optional separate SMS number
    enabled: bool = True


class TwilioConfigError(Exception):
    """Raised when the tenant's Twilio integration is missing or malformed."""


def load_config(db: Session, tenant_id: int) -> TwilioConfig:
    row = db.query(TenantIntegration).filter(
        TenantIntegration.tenant_id == tenant_id,
        TenantIntegration.provider == PROVIDER,
    ).first()
    if not row:
        raise TwilioConfigError("Twilio not configured for this tenant")
    if not row.enabled:
        raise TwilioConfigError("Twilio integration is disabled")
    try:
        cfg = json.loads(row.config_json or "{}")
    except Exception as e:
        raise TwilioConfigError(f"Twilio config malformed: {e}")
    sid = (cfg.get("account_sid") or "").strip()
    if not sid:
        raise TwilioConfigError("Twilio account_sid missing")
    try:
        token = decrypt(row.secret_encrypted) if row.secret_encrypted else ""
    except Exception as e:
        raise TwilioConfigError(f"Could not decrypt Twilio auth token: {e}")
    if not token:
        raise TwilioConfigError("Twilio auth_token missing")
    return TwilioConfig(
        account_sid=sid,
        auth_token=token,
        whatsapp_from=(cfg.get("whatsapp_from") or "").strip(),
        sms_from=(cfg.get("sms_from") or "").strip(),
        enabled=bool(row.enabled),
    )


def _normalize_whatsapp(addr: str) -> str:
    """Make sure the address is prefixed with whatsapp: per Twilio's API."""
    a = (addr or "").strip()
    if not a:
        return a
    if a.startswith("whatsapp:"):
        return a
    return f"whatsapp:{a}"


def send_whatsapp(
    config: TwilioConfig,
    to: str,
    body: str,
    timeout_s: float = 15.0,
) -> dict:
    """Send a WhatsApp message via Twilio. Raises on non-2xx."""
    if not config.whatsapp_from:
        raise TwilioConfigError("Twilio whatsapp_from not configured")
    if not to or not body:
        raise ValueError("to and body are required")

    url = f"{TWILIO_API_BASE}/Accounts/{config.account_sid}/Messages.json"
    data = {
        "From": _normalize_whatsapp(config.whatsapp_from),
        "To": _normalize_whatsapp(to),
        "Body": body[:1600],  # Twilio caps WhatsApp at 1600 chars
    }
    try:
        with httpx.Client(timeout=timeout_s) as c:
            res = c.post(url, data=data, auth=(config.account_sid, config.auth_token))
    except httpx.RequestError as e:
        raise RuntimeError(f"Twilio request failed: {e}")
    if res.status_code >= 400:
        try:
            err_body = res.json()
        except Exception:
            err_body = {"message": res.text}
        raise RuntimeError(
            f"Twilio API {res.status_code}: {err_body.get('message') or err_body}"
        )
    return res.json()


def send_sms(
    config: TwilioConfig,
    to: str,
    body: str,
    timeout_s: float = 15.0,
) -> dict:
    """Send a plain SMS via Twilio. Same auth as WhatsApp; uses sms_from
    instead of whatsapp:from. Falls back to whatsapp_from if sms_from is
    blank — most tenants only configure one number."""
    sender = config.sms_from or config.whatsapp_from
    if not sender:
        raise TwilioConfigError("Twilio sms_from / whatsapp_from not configured")
    if not to or not body:
        raise ValueError("to and body are required")
    url = f"{TWILIO_API_BASE}/Accounts/{config.account_sid}/Messages.json"
    data = {
        "From": sender,
        "To": to,
        "Body": body[:1600],
    }
    try:
        with httpx.Client(timeout=timeout_s) as c:
            res = c.post(url, data=data, auth=(config.account_sid, config.auth_token))
    except httpx.RequestError as e:
        raise RuntimeError(f"Twilio request failed: {e}")
    if res.status_code >= 400:
        try:
            err_body = res.json()
        except Exception:
            err_body = {"message": res.text}
        raise RuntimeError(
            f"Twilio API {res.status_code}: {err_body.get('message') or err_body}"
        )
    return res.json()


def send_test_message(config: TwilioConfig, to: str) -> dict:
    """Tenant-pressed Test button. Sends a fixed body so the tenant can verify
    that creds + the WhatsApp sender pairing work."""
    return send_whatsapp(
        config,
        to,
        "✅ HireOps AI test — your Twilio WhatsApp integration is working.",
    )


# ─── Persistence helpers used by the integrations router ─────────────────────


_TWILIO_SID_RE = re.compile(r"^AC[0-9a-fA-F]{32}$")
_E164_RE = re.compile(r"^\+[1-9]\d{6,14}$")


def _validate_account_sid(sid: str) -> str:
    """Twilio Account SIDs are exactly `AC` + 32 hex chars (34 total).

    Reject placeholders like `ACxxxxxxxx…` (the literal placeholder text
    from the settings UI input) and obvious typos before we try to use
    them as basic-auth usernames — otherwise the user only learns it's
    wrong after a `401 Authentication Error - invalid username` from
    Twilio (the exact UX we just hit).
    """
    sid = (sid or "").strip()
    if not sid:
        raise TwilioConfigError("Account SID is required")
    if not _TWILIO_SID_RE.match(sid):
        raise TwilioConfigError(
            "Account SID looks invalid — it must start with 'AC' and be "
            "followed by exactly 32 hexadecimal characters (you can copy it "
            "from twilio.com/console)."
        )
    return sid


def _normalise_phone(raw: str, *, field: str, required: bool = False) -> str:
    """Coerce a phone number into strict E.164 (`+` then 7–15 digits).

    Twilio's REST API only accepts E.164. We strip whitespace and common
    formatting chars, then insist on the leading `+`. Empty string is
    allowed when ``required`` is False (SMS-from is optional).
    """
    cleaned = re.sub(r"[\s\-()]", "", (raw or "").strip())
    if not cleaned:
        if required:
            raise TwilioConfigError(f"{field} is required (E.164 format, e.g. +14155551234)")
        return ""
    if not cleaned.startswith("+"):
        # Numbers without a + can't be unambiguously routed by Twilio.
        # Reject rather than silently prepending a country code we'd be
        # guessing at.
        raise TwilioConfigError(
            f"{field} must start with '+' and a country code (E.164 format, "
            f"e.g. +14155551234). Got: {raw!r}"
        )
    if not _E164_RE.match(cleaned):
        raise TwilioConfigError(
            f"{field} doesn't look like a valid international phone number. "
            f"Expected: +CCXXXXXXXXXX (country code + 6–14 digits)."
        )
    return cleaned


def upsert_config(
    db: Session,
    tenant_id: int,
    account_sid: str,
    auth_token: Optional[str],
    whatsapp_from: str = "",
    sms_from: str = "",
    enabled: bool = True,
) -> TenantIntegration:
    """Save or update the tenant's Twilio integration. Empty auth_token means
    'keep the existing one' so the UI can submit the form without resending
    the secret on every save.

    Validates the Account SID format and normalises phone numbers to
    E.164 before persisting — both are common sources of 401/400 errors
    from Twilio that we want to surface as friendly field-level messages
    instead of a generic API rejection.
    """
    from services.secrets_crypto import encrypt
    sid = _validate_account_sid(account_sid)
    wa_from = _normalise_phone(whatsapp_from, field="WhatsApp from")
    sms_f = _normalise_phone(sms_from, field="SMS from")
    row = db.query(TenantIntegration).filter(
        TenantIntegration.tenant_id == tenant_id,
        TenantIntegration.provider == PROVIDER,
    ).first()
    cfg = {
        "account_sid": sid,
        "whatsapp_from": wa_from,
        "sms_from": sms_f,
    }
    if row:
        row.config_json = json.dumps(cfg)
        if auth_token:
            row.secret_encrypted = encrypt(auth_token)
        row.enabled = enabled
        row.last_error = ""
    else:
        row = TenantIntegration(
            tenant_id=tenant_id,
            provider=PROVIDER,
            enabled=enabled,
            config_json=json.dumps(cfg),
            secret_encrypted=encrypt(auth_token or ""),
        )
        db.add(row)
    db.commit()
    db.refresh(row)
    return row


def to_response(row: TenantIntegration) -> dict:
    """Public-safe representation. Never returns the auth token, but does
    flag whether one is set so the UI can render 'configured' state."""
    try:
        cfg = json.loads(row.config_json or "{}")
    except Exception:
        cfg = {}
    return {
        "id": row.id,
        "provider": row.provider,
        "enabled": bool(row.enabled),
        "account_sid": cfg.get("account_sid", ""),
        "whatsapp_from": cfg.get("whatsapp_from", ""),
        "sms_from": cfg.get("sms_from", ""),
        "auth_token_set": bool(row.secret_encrypted),
        "last_error": row.last_error or "",
        "last_used_at": row.last_used_at.isoformat() if row.last_used_at else None,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }
