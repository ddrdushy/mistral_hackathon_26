"""Calendar integration endpoints.

Per-user OAuth (Google for now), free/busy lookup, and a "suggest
interview slots" helper that the candidate detail page uses to pick
times that won't clash with the recruiter's existing meetings.

Operationally: GOOGLE_OAUTH_CLIENT_ID + GOOGLE_OAUTH_CLIENT_SECRET need
to be set in the backend .env, and the redirect URI
`<base>/api/v1/calendar/google/callback` must be added to the Google
Cloud OAuth client.
"""
from __future__ import annotations

import logging
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from auth.dependencies import current_session, CurrentSession
from database import get_db
from models import UserCalendarConnection
from services import calendar_service
from services.secrets_crypto import encrypt, decrypt

logger = logging.getLogger("hireops.calendar")

router = APIRouter(prefix="/api/v1/calendar", tags=["calendar"])


# ── Helpers ──────────────────────────────────────────────────────────────


def _get_connection(db: Session, user_id: int) -> Optional[UserCalendarConnection]:
    return (
        db.query(UserCalendarConnection)
        .filter(UserCalendarConnection.user_id == user_id)
        .order_by(UserCalendarConnection.id.desc())
        .first()
    )


def _ensure_fresh_access_token(db: Session, conn: UserCalendarConnection) -> str:
    """Return a non-expired access token for this connection, refreshing
    via Google if necessary."""
    now = datetime.utcnow()
    if (
        conn.access_token_encrypted
        and conn.access_token_expires_at
        and conn.access_token_expires_at > now + timedelta(seconds=60)
    ):
        return decrypt(conn.access_token_encrypted)

    refresh_token = decrypt(conn.refresh_token_encrypted)
    tokens = calendar_service.refresh_access_token(refresh_token)
    access = tokens["access_token"]
    expires_in = int(tokens.get("expires_in", 3500))
    conn.access_token_encrypted = encrypt(access)
    conn.access_token_expires_at = now + timedelta(seconds=expires_in)
    conn.last_refreshed_at = now
    db.commit()
    return access


# ── Endpoints ────────────────────────────────────────────────────────────


@router.get("/google/start")
def start_oauth(
    session: CurrentSession = Depends(current_session),
):
    """Kick off the Google Calendar OAuth flow. Returns a JSON
    {url, state} the frontend redirects the user to."""
    if not calendar_service.is_configured():
        raise HTTPException(
            status_code=503,
            detail=calendar_service.configuration_hint(),
        )

    # State carries the user_id signed-ish so the callback can find the
    # owner without a session cookie (Google redirects don't carry our
    # cookie when the user lands back). We use a HMAC-keyed format:
    #   user_id:nonce:hmac(user_id, nonce, jwt_secret)
    import hmac, hashlib
    from auth.security import _jwt_secret  # internal helper
    nonce = secrets.token_urlsafe(16)
    payload = f"{session.user.id}:{nonce}"
    sig = hmac.new(_jwt_secret().encode(), payload.encode(), hashlib.sha256).hexdigest()[:24]
    state = f"{payload}:{sig}"

    url = calendar_service.build_authorize_url(state)
    return {"url": url, "state": state}


@router.get("/google/callback")
def oauth_callback(
    code: str = Query(...),
    state: str = Query(...),
    db: Session = Depends(get_db),
):
    """Google bounces here after consent. Exchange the code → tokens,
    look up the user via signed state, store encrypted, redirect back
    to settings."""
    import hmac, hashlib, os
    from auth.security import _jwt_secret
    from models import User

    parts = state.split(":")
    if len(parts) != 3:
        raise HTTPException(status_code=400, detail="Invalid state")
    user_id_s, nonce, sig = parts
    expected = hmac.new(
        _jwt_secret().encode(), f"{user_id_s}:{nonce}".encode(), hashlib.sha256
    ).hexdigest()[:24]
    if not hmac.compare_digest(sig, expected):
        raise HTTPException(status_code=400, detail="State signature invalid")
    try:
        user_id = int(user_id_s)
    except ValueError:
        raise HTTPException(status_code=400, detail="Bad user_id in state")

    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    try:
        tokens = calendar_service.exchange_code(code)
    except Exception as e:
        logger.exception("calendar exchange failed: %s", e)
        raise HTTPException(status_code=502, detail=f"Google token exchange failed: {e}")

    refresh_token = tokens.get("refresh_token")
    access_token = tokens.get("access_token")
    expires_in = int(tokens.get("expires_in", 3500))
    if not refresh_token:
        # If the user has previously connected and revoked, Google can
        # decline to issue a fresh refresh_token without prompt=consent.
        # We pass that flag in build_authorize_url, but cover the edge.
        raise HTTPException(
            status_code=400,
            detail=(
                "Google did not return a refresh token. Revoke this app's "
                "access at myaccount.google.com/permissions and try again."
            ),
        )

    try:
        info = calendar_service.fetch_userinfo(access_token)
        email_address = (info.get("email") or "").lower()
    except Exception:
        email_address = ""

    # Upsert: only one calendar connection per user for now.
    existing = (
        db.query(UserCalendarConnection)
        .filter(UserCalendarConnection.user_id == user.id)
        .first()
    )
    if existing:
        existing.refresh_token_encrypted = encrypt(refresh_token)
        existing.access_token_encrypted = encrypt(access_token) if access_token else ""
        existing.access_token_expires_at = (
            datetime.utcnow() + timedelta(seconds=expires_in)
        )
        existing.email_address = email_address or existing.email_address
        existing.scopes = tokens.get("scope", "")
        existing.connected_at = datetime.utcnow()
        existing.last_refreshed_at = datetime.utcnow()
    else:
        db.add(UserCalendarConnection(
            user_id=user.id,
            tenant_id=user.tenant_id,
            provider="google",
            email_address=email_address or user.email,
            refresh_token_encrypted=encrypt(refresh_token),
            access_token_encrypted=encrypt(access_token) if access_token else "",
            access_token_expires_at=datetime.utcnow() + timedelta(seconds=expires_in),
            scopes=tokens.get("scope", ""),
            connected_at=datetime.utcnow(),
            last_refreshed_at=datetime.utcnow(),
        ))
    db.commit()

    frontend = os.getenv("FRONTEND_URL", "").rstrip("/")
    return RedirectResponse(url=f"{frontend}/settings/calendar?connected=1", status_code=302)


@router.get("/me")
def get_my_connection(
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Status of the current user's calendar connection."""
    conn = _get_connection(db, session.user.id)
    return {
        "configured": calendar_service.is_configured(),
        "connected": bool(conn),
        "email_address": conn.email_address if conn else None,
        "connected_at": conn.connected_at.isoformat() if conn and conn.connected_at else None,
        "last_refreshed_at": (
            conn.last_refreshed_at.isoformat() if conn and conn.last_refreshed_at else None
        ),
        "provider": conn.provider if conn else None,
    }


@router.delete("/me")
def disconnect(
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Disconnect the user's calendar. We just delete the row — Google
    keeps the consent until the user revokes it via myaccount.google.com,
    but our integration stops querying it."""
    conn = _get_connection(db, session.user.id)
    if not conn:
        return {"ok": True, "already_disconnected": True}
    db.delete(conn)
    db.commit()
    return {"ok": True}


@router.get("/slots")
def suggest_interview_slots(
    duration_minutes: int = Query(30, ge=15, le=120),
    days_ahead: int = Query(5, ge=1, le=14),
    start_hour: int = Query(9, ge=0, le=23),
    end_hour: int = Query(17, ge=1, le=24),
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Suggest interview time slots that don't clash with the
    recruiter's existing meetings. Returns ISO-formatted UTC strings.
    Falls back to "any business-hour slot" if the user hasn't connected
    a calendar yet."""
    conn = _get_connection(db, session.user.id)
    busy: list[dict] = []
    if conn:
        try:
            access = _ensure_fresh_access_token(db, conn)
            now = datetime.now(timezone.utc)
            busy = calendar_service.free_busy(
                access,
                time_min=now,
                time_max=now + timedelta(days=days_ahead),
            )
        except Exception as e:
            logger.warning("free_busy fetch failed: %s", e)
            busy = []

    slots = calendar_service.suggest_slots(
        busy,
        duration_minutes=duration_minutes,
        days_ahead=days_ahead,
        start_hour=start_hour,
        end_hour=end_hour,
    )
    return {
        "duration_minutes": duration_minutes,
        "days_ahead": days_ahead,
        "calendar_connected": bool(conn),
        "calendar_email": conn.email_address if conn else None,
        "busy_intervals": busy,
        "slots": slots,
    }
