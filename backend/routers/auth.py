"""
Auth endpoints: signup, login, logout, me, verify-email, forgot/reset-password.
"""
from __future__ import annotations

import os
import re
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response, Request, status
from pydantic import BaseModel, EmailStr, Field
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from app_limiter import limiter
from database import get_db
from models import (
    User, Tenant, EmailVerification, PasswordReset,
)


def _ip_key(request: Request) -> str:
    return f"ip:{get_remote_address(request)}"


def _check_ip_rate(request: Request, limit_string: str, scope: str) -> None:
    """Manual per-IP rate-limit check. We use this instead of @limiter.limit
    because the decorator mangles FastAPI's body inference for Pydantic models.
    """
    from limits import parse
    item = parse(limit_string)
    key = _ip_key(request) + ":" + scope
    if not limiter.limiter.hit(item, key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Too many requests. Try again in a minute.",
        )
from auth.security import (
    hash_password, verify_password, issue_jwt, new_token, COOKIE_NAME, JWT_TTL_DAYS,
)
from auth.email_service import send_verification_email, send_password_reset_email
from auth.dependencies import current_session, CurrentSession

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


# ── Request / response models ─────────────────────────────────────────────


class SignupRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(min_length=1, max_length=100)
    company_name: str = Field(min_length=1, max_length=120)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    token: str
    password: str = Field(min_length=8, max_length=128)


class VerifyEmailRequest(BaseModel):
    token: str


class ProfileUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, max_length=200)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1, max_length=200)
    new_password: str = Field(..., min_length=8, max_length=200)


class TenantResponse(BaseModel):
    id: int
    slug: str
    name: str
    plan: str
    industry: Optional[str] = None
    headquarters: Optional[str] = None
    company_size: Optional[str] = None
    website: Optional[str] = None
    about: Optional[str] = None
    default_work_mode: Optional[str] = None
    default_currency: Optional[str] = None
    profile_completed: bool = False

    @classmethod
    def model_validate(cls, obj, **kwargs):  # type: ignore[override]
        # Derive profile_completed from the datetime column.
        if hasattr(obj, "profile_completed_at"):
            return super().model_validate({
                "id": obj.id,
                "slug": obj.slug,
                "name": obj.name,
                "plan": obj.plan,
                "industry": obj.industry,
                "headquarters": obj.headquarters,
                "company_size": obj.company_size,
                "website": obj.website,
                "about": obj.about,
                "default_work_mode": obj.default_work_mode,
                "default_currency": obj.default_currency,
                "profile_completed": obj.profile_completed_at is not None,
            }, **kwargs)
        return super().model_validate(obj, **kwargs)

    class Config:
        from_attributes = True


class UserResponse(BaseModel):
    id: int
    email: str
    name: str
    role: str
    is_superadmin: bool
    email_verified: bool

    class Config:
        from_attributes = True


class MeResponse(BaseModel):
    user: UserResponse
    tenant: TenantResponse


# ── Helpers ────────────────────────────────────────────────────────────────


def _frontend_url() -> str:
    return os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")


def _set_session_cookie(response: Response, token: str) -> None:
    secure = os.getenv("COOKIE_SECURE", "false").lower() == "true"
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=JWT_TTL_DAYS * 24 * 60 * 60,
        httponly=True,
        samesite="lax",
        secure=secure,
        path="/",
    )


def _clear_session_cookie(response: Response) -> None:
    response.delete_cookie(key=COOKIE_NAME, path="/")


_SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slugify(name: str) -> str:
    s = _SLUG_RE.sub("-", name.lower()).strip("-")
    return s or "tenant"


def _unique_slug(db: Session, base: str) -> str:
    slug = _slugify(base)
    candidate = slug
    n = 1
    while db.query(Tenant).filter(Tenant.slug == candidate).first():
        n += 1
        candidate = f"{slug}-{n}"
    return candidate


def _user_to_response(user: User) -> UserResponse:
    return UserResponse(
        id=user.id,
        email=user.email,
        name=user.name or "",
        role=user.role,
        is_superadmin=bool(user.is_superadmin),
        email_verified=user.email_verified_at is not None,
    )


# ── Endpoints ─────────────────────────────────────────────────────────────


@router.post("/signup")
def signup(req: SignupRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    _check_ip_rate(request, "10/hour", "signup")
    """Create a new tenant + owner user, send verification email, return logged-in session.

    The user is logged in immediately (cookie set) but `email_verified` is false until
    they click the link in the email. Some endpoints can require verification later.
    """
    existing = db.query(User).filter(User.email == req.email.lower()).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account with this email already exists",
        )

    # Create tenant
    tenant = Tenant(
        slug=_unique_slug(db, req.company_name),
        name=req.company_name.strip(),
        plan="free",
    )
    db.add(tenant)
    db.flush()  # get tenant.id without committing

    # Create owner user
    # If this email is in SUPERADMIN_EMAILS, promote on creation so the
    # platform-admin shell is reachable on first login (no backend restart needed).
    superadmin_emails = {
        e.strip().lower()
        for e in os.getenv("SUPERADMIN_EMAILS", "").split(",")
        if e.strip()
    }
    is_super = req.email.lower() in superadmin_emails

    user = User(
        tenant_id=tenant.id,
        email=req.email.lower(),
        password_hash=hash_password(req.password),
        name=req.name.strip(),
        role="owner",
        is_superadmin=is_super,
    )
    db.add(user)
    db.flush()

    # Email verification
    token = new_token()
    db.add(EmailVerification(
        user_id=user.id,
        token=token,
        expires_at=datetime.utcnow() + timedelta(hours=24),
    ))
    db.commit()
    db.refresh(user)
    db.refresh(tenant)

    verify_url = f"{_frontend_url()}/verify-email?token={token}"
    send_verification_email(user.email, user.name, verify_url)

    jwt_token = issue_jwt(user.id, tenant.id)
    _set_session_cookie(response, jwt_token)

    return MeResponse(
        user=_user_to_response(user),
        tenant=TenantResponse.model_validate(tenant),
    )


@router.post("/login")
def login(req: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    _check_ip_rate(request, "10/minute", "login")
    user = db.query(User).filter(User.email == req.email.lower()).first()
    if not user or not verify_password(req.password, user.password_hash):
        # Same response for "user not found" and "wrong password" so attackers
        # can't enumerate registered emails.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    tenant = db.query(Tenant).filter(Tenant.id == user.tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=500, detail="Tenant missing")
    if tenant.suspended:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account suspended. Contact support.",
        )

    user.last_login_at = datetime.utcnow()
    db.commit()
    db.refresh(user)

    jwt_token = issue_jwt(user.id, tenant.id)
    _set_session_cookie(response, jwt_token)
    return MeResponse(
        user=_user_to_response(user),
        tenant=TenantResponse.model_validate(tenant),
    )


@router.post("/logout")
def logout(response: Response):
    _clear_session_cookie(response)
    return {"ok": True}


@router.get("/me", response_model=MeResponse)
def me(session: CurrentSession = Depends(current_session)):
    return MeResponse(
        user=_user_to_response(session.user),
        tenant=TenantResponse.model_validate(session.tenant),
    )


@router.patch("/me")
def update_my_profile(
    req: ProfileUpdateRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Per-user profile edit. Email is intentionally NOT editable here —
    changing email requires a re-verify flow we haven't built yet."""
    user = db.query(User).filter(User.id == session.user.id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if req.name is not None:
        user.name = req.name.strip()[:200]
    user.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(user)
    return MeResponse(
        user=_user_to_response(user),
        tenant=TenantResponse.model_validate(session.tenant),
    )


@router.post("/me/change-password")
def change_password(
    req: ChangePasswordRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    """Authenticated password change. Verifies the current password
    before saving the new hash to prevent session-hijack escalation."""
    from auth.security import hash_password, verify_password
    user = db.query(User).filter(User.id == session.user.id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not verify_password(req.current_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    if req.current_password == req.new_password:
        raise HTTPException(
            status_code=400,
            detail="New password must differ from the current one",
        )
    user.password_hash = hash_password(req.new_password)
    user.updated_at = datetime.utcnow()
    db.commit()
    return {"ok": True}


@router.post("/verify-email")
def verify_email(req: VerifyEmailRequest, db: Session = Depends(get_db)):
    record = db.query(EmailVerification).filter(EmailVerification.token == req.token).first()
    if not record:
        raise HTTPException(status_code=400, detail="Invalid verification link")
    if record.used_at:
        raise HTTPException(status_code=400, detail="Verification link already used")
    if record.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Verification link expired")

    user = db.query(User).filter(User.id == record.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.email_verified_at = datetime.utcnow()
    record.used_at = datetime.utcnow()
    db.commit()
    return {"ok": True, "email": user.email}


@router.post("/resend-verification")
def resend_verification(
    session: CurrentSession = Depends(current_session),
    db: Session = Depends(get_db),
):
    if session.user.email_verified_at:
        return {"ok": True, "already_verified": True}

    token = new_token()
    db.add(EmailVerification(
        user_id=session.user.id,
        token=token,
        expires_at=datetime.utcnow() + timedelta(hours=24),
    ))
    db.commit()

    verify_url = f"{_frontend_url()}/verify-email?token={token}"
    send_verification_email(session.user.email, session.user.name, verify_url)
    return {"ok": True}


@router.post("/forgot-password")
def forgot_password(req: ForgotPasswordRequest, request: Request, db: Session = Depends(get_db)):
    _check_ip_rate(request, "3/minute", "forgot")
    """Always returns 200 — never reveals whether an email is registered."""
    user = db.query(User).filter(User.email == req.email.lower()).first()
    if user:
        token = new_token()
        db.add(PasswordReset(
            user_id=user.id,
            token=token,
            expires_at=datetime.utcnow() + timedelta(hours=1),
        ))
        db.commit()
        reset_url = f"{_frontend_url()}/reset-password?token={token}"
        send_password_reset_email(user.email, user.name, reset_url)
    return {"ok": True}


@router.post("/reset-password")
def reset_password(req: ResetPasswordRequest, db: Session = Depends(get_db)):
    record = db.query(PasswordReset).filter(PasswordReset.token == req.token).first()
    if not record:
        raise HTTPException(status_code=400, detail="Invalid reset link")
    if record.used_at:
        raise HTTPException(status_code=400, detail="Reset link already used")
    if record.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Reset link expired")

    user = db.query(User).filter(User.id == record.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user.password_hash = hash_password(req.password)
    record.used_at = datetime.utcnow()
    db.commit()
    return {"ok": True}
