"""
Tenant team management: list members, invite, remove.

All endpoints scoped to the caller's tenant. Owner-only for mutations
(invite, remove). Members can list.
"""
from __future__ import annotations

import os
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from database import get_db
from models import User, Tenant, TenantInvite
from auth.security import (
    hash_password, issue_jwt, new_token, COOKIE_NAME, JWT_TTL_DAYS,
)
from auth.email_service import send_transactional, _wrap_html
from auth.dependencies import current_session, require_owner, CurrentSession

router = APIRouter(prefix="/api/v1/team", tags=["team"])


# ── Models ─────────────────────────────────────────────────────────────────


class MemberResponse(BaseModel):
    id: int
    email: str
    name: str
    role: str
    email_verified: bool
    created_at: datetime
    last_login_at: datetime | None


class InviteRequest(BaseModel):
    email: EmailStr
    role: str = "member"  # only "member" allowed for v1


class InviteResponse(BaseModel):
    id: int
    email: str
    role: str
    expires_at: datetime
    accepted_at: datetime | None
    created_at: datetime


class AcceptInviteRequest(BaseModel):
    token: str
    name: str
    password: str


class AcceptInvitePeekResponse(BaseModel):
    valid: bool
    email: str | None
    tenant_name: str | None
    inviter_name: str | None
    error: str | None


# ── Helpers ────────────────────────────────────────────────────────────────


def _frontend_url() -> str:
    return os.getenv("FRONTEND_URL", "http://localhost:3000").rstrip("/")


def _send_invite_email(invite: TenantInvite, tenant: Tenant, inviter: User):
    accept_url = f"{_frontend_url()}/accept-invite?token={invite.token}"
    subject = f"You're invited to join {tenant.name} on HireOps AI"
    body_text = (
        f"Hi,\n\n"
        f"{inviter.name or inviter.email} invited you to join {tenant.name} "
        f"on HireOps AI. Click the link below to accept and create your account:\n\n"
        f"{accept_url}\n\n"
        f"This invite expires in 7 days.\n"
    )
    body_html = _wrap_html(
        f"""
        <p style="margin:0 0 12px 0;color:#0f172a;font-size:15px;">Hi,</p>
        <p style="margin:0 0 18px 0;color:#475569;font-size:14px;line-height:1.55;">
            <strong>{inviter.name or inviter.email}</strong> invited you to join
            <strong>{tenant.name}</strong> on HireOps AI.
        </p>
        <div style="text-align:center;margin:24px 0;">
            <a href="{accept_url}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px;">
                Accept invite
            </a>
        </div>
        <p style="margin:0;color:#475569;font-size:12px;word-break:break-all;">
            <a href="{accept_url}" style="color:#4f46e5;">{accept_url}</a>
        </p>
        <p style="margin:24px 0 0 0;color:#94a3b8;font-size:12px;">
            This invite expires in 7 days.
        </p>
        """,
        preheader=f"Join {tenant.name} on HireOps AI",
    )
    send_transactional(invite.email, subject, body_text, body_html)


# ── Endpoints ─────────────────────────────────────────────────────────────


class OrganizationProfile(BaseModel):
    """Organization fields editable by the tenant owner. All optional —
    onboarding is encouraged but not blocking."""
    name: str | None = None
    industry: str | None = None
    headquarters: str | None = None
    company_size: str | None = None
    website: str | None = None
    about: str | None = None
    default_work_mode: str | None = None
    default_currency: str | None = None
    # Branding — applied to every outbound email (logo / colour /
    # display name / signature). Optional; defaults kick in when empty.
    brand_logo_url: str | None = None
    brand_primary_color: str | None = None
    brand_from_name: str | None = None
    brand_signature: str | None = None


@router.get("/organization")
def get_organization(
    session: CurrentSession = Depends(current_session),
):
    """Read the current tenant's organization profile."""
    t = session.tenant
    return {
        "id": t.id,
        "name": t.name,
        "slug": t.slug,
        "industry": t.industry,
        "headquarters": t.headquarters,
        "company_size": t.company_size,
        "website": t.website,
        "about": t.about,
        "default_work_mode": t.default_work_mode,
        "default_currency": t.default_currency,
        "brand_logo_url": t.brand_logo_url,
        "brand_primary_color": t.brand_primary_color,
        "brand_from_name": t.brand_from_name,
        "brand_signature": t.brand_signature,
        "profile_completed": t.profile_completed_at is not None,
        "profile_completed_at": (
            t.profile_completed_at.isoformat() if t.profile_completed_at else None
        ),
    }


@router.put("/organization")
def update_organization(
    body: OrganizationProfile,
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_owner),
):
    """Update the tenant's org profile. Owner-only. Stamps profile_completed_at
    the first time required fields are populated, so the onboarding banner
    can dismiss itself."""
    from services.audit import write_audit

    tenant = db.query(Tenant).filter(Tenant.id == session.tenant.id).first()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    changes: dict[str, dict] = {}
    for field in (
        "name", "industry", "headquarters", "company_size",
        "website", "about", "default_work_mode", "default_currency",
        "brand_logo_url", "brand_primary_color",
        "brand_from_name", "brand_signature",
    ):
        new = getattr(body, field)
        if new is None:
            continue
        new = new.strip() if isinstance(new, str) else new
        old = getattr(tenant, field)
        if old != new:
            changes[field] = {"before": old, "after": new}
            setattr(tenant, field, new or None)

    # Profile is "complete" once industry + headquarters are set — those
    # are the two fields the JD generator can't fake convincingly.
    if tenant.profile_completed_at is None and tenant.industry and tenant.headquarters:
        tenant.profile_completed_at = datetime.utcnow()
        changes["profile_completed_at"] = {"before": None, "after": tenant.profile_completed_at.isoformat()}

    if changes:
        db.commit()
        db.refresh(tenant)
        write_audit(
            db,
            action="tenant.organization.update",
            actor=session.user,
            tenant_id=tenant.id,
            payload={"changes": changes},
            severity="info",
            request=request,
        )

    return {
        "id": tenant.id,
        "name": tenant.name,
        "slug": tenant.slug,
        "industry": tenant.industry,
        "headquarters": tenant.headquarters,
        "company_size": tenant.company_size,
        "website": tenant.website,
        "about": tenant.about,
        "default_work_mode": tenant.default_work_mode,
        "default_currency": tenant.default_currency,
        "brand_logo_url": tenant.brand_logo_url,
        "brand_primary_color": tenant.brand_primary_color,
        "brand_from_name": tenant.brand_from_name,
        "brand_signature": tenant.brand_signature,
        "profile_completed": tenant.profile_completed_at is not None,
        "profile_completed_at": (
            tenant.profile_completed_at.isoformat() if tenant.profile_completed_at else None
        ),
    }


@router.post("/clear-demo")
def clear_demo_data(
    request: Request,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_owner),
):
    """Owner action: remove all demo jobs/candidates/applications added at signup."""
    from services.demo_seed import clear_demo
    from services.audit import write_audit

    result = clear_demo(db, session.tenant)
    if result.get("cleared"):
        write_audit(
            db,
            action="tenant.clear_demo",
            actor=session.user,
            tenant_id=session.tenant.id,
            payload=result,
            severity="warning",
            request=request,
        )
    return result


@router.get("/members")
def list_members(
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    members = (
        db.query(User)
        .filter(User.tenant_id == session.tenant.id)
        .order_by(User.created_at.asc())
        .all()
    )
    return {
        "members": [
            MemberResponse(
                id=u.id,
                email=u.email,
                name=u.name or "",
                role=u.role,
                email_verified=u.email_verified_at is not None,
                created_at=u.created_at,
                last_login_at=u.last_login_at,
            )
            for u in members
        ]
    }


@router.delete("/members/{user_id}")
def remove_member(
    user_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_owner),
):
    if user_id == session.user.id:
        raise HTTPException(status_code=400, detail="You can't remove yourself")
    user = db.query(User).filter(
        User.id == user_id,
        User.tenant_id == session.tenant.id,
    ).first()
    if not user:
        raise HTTPException(status_code=404, detail="Member not found")
    if user.role == "owner":
        raise HTTPException(status_code=400, detail="Cannot remove the owner")
    db.delete(user)
    db.commit()
    return {"ok": True}


@router.get("/invites")
def list_invites(
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(current_session),
):
    invites = (
        db.query(TenantInvite)
        .filter(
            TenantInvite.tenant_id == session.tenant.id,
            TenantInvite.accepted_at.is_(None),
            TenantInvite.revoked_at.is_(None),
        )
        .order_by(TenantInvite.created_at.desc())
        .all()
    )
    return {
        "invites": [
            InviteResponse(
                id=i.id, email=i.email, role=i.role,
                expires_at=i.expires_at, accepted_at=i.accepted_at,
                created_at=i.created_at,
            )
            for i in invites
        ]
    }


@router.post("/invites", response_model=InviteResponse)
def create_invite(
    req: InviteRequest,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_owner),
):
    email = req.email.lower()

    # If they already have an account, refuse
    existing_user = db.query(User).filter(User.email == email).first()
    if existing_user:
        if existing_user.tenant_id == session.tenant.id:
            raise HTTPException(status_code=409, detail="User is already a team member")
        raise HTTPException(
            status_code=409,
            detail="This email belongs to a user in another workspace",
        )

    # Revoke any existing pending invite for this email in this tenant
    db.query(TenantInvite).filter(
        TenantInvite.tenant_id == session.tenant.id,
        TenantInvite.email == email,
        TenantInvite.accepted_at.is_(None),
        TenantInvite.revoked_at.is_(None),
    ).update({"revoked_at": datetime.utcnow()}, synchronize_session="fetch")

    invite = TenantInvite(
        tenant_id=session.tenant.id,
        invited_by_user_id=session.user.id,
        email=email,
        role="member",  # owner role can't be invited; only signup creates owners
        token=new_token(),
        expires_at=datetime.utcnow() + timedelta(days=7),
    )
    db.add(invite)
    db.commit()
    db.refresh(invite)

    _send_invite_email(invite, session.tenant, session.user)

    return InviteResponse(
        id=invite.id, email=invite.email, role=invite.role,
        expires_at=invite.expires_at, accepted_at=invite.accepted_at,
        created_at=invite.created_at,
    )


@router.delete("/invites/{invite_id}")
def revoke_invite(
    invite_id: int,
    db: Session = Depends(get_db),
    session: CurrentSession = Depends(require_owner),
):
    invite = db.query(TenantInvite).filter(
        TenantInvite.id == invite_id,
        TenantInvite.tenant_id == session.tenant.id,
    ).first()
    if not invite:
        raise HTTPException(status_code=404, detail="Invite not found")
    if invite.accepted_at:
        raise HTTPException(status_code=400, detail="Invite already accepted")
    invite.revoked_at = datetime.utcnow()
    db.commit()
    return {"ok": True}


# ── Public invite-acceptance endpoints ────────────────────────────────────


public_router = APIRouter(prefix="/api/v1/auth", tags=["auth"])


@public_router.get("/invite/{token}", response_model=AcceptInvitePeekResponse)
def peek_invite(token: str, db: Session = Depends(get_db)):
    """Public: load invite details before showing the accept form."""
    invite = db.query(TenantInvite).filter(TenantInvite.token == token).first()
    if not invite:
        return AcceptInvitePeekResponse(
            valid=False, email=None, tenant_name=None, inviter_name=None,
            error="Invalid invite link.",
        )
    if invite.accepted_at:
        return AcceptInvitePeekResponse(
            valid=False, email=invite.email, tenant_name=None, inviter_name=None,
            error="This invite has already been accepted.",
        )
    if invite.revoked_at:
        return AcceptInvitePeekResponse(
            valid=False, email=invite.email, tenant_name=None, inviter_name=None,
            error="This invite was revoked.",
        )
    if invite.expires_at < datetime.utcnow():
        return AcceptInvitePeekResponse(
            valid=False, email=invite.email, tenant_name=None, inviter_name=None,
            error="This invite has expired.",
        )

    tenant = db.query(Tenant).filter(Tenant.id == invite.tenant_id).first()
    inviter = db.query(User).filter(User.id == invite.invited_by_user_id).first()
    return AcceptInvitePeekResponse(
        valid=True,
        email=invite.email,
        tenant_name=tenant.name if tenant else None,
        inviter_name=(inviter.name or inviter.email) if inviter else None,
        error=None,
    )


@public_router.post("/accept-invite")
def accept_invite(req: AcceptInviteRequest, response: Response, db: Session = Depends(get_db)):
    invite = db.query(TenantInvite).filter(TenantInvite.token == req.token).first()
    if not invite:
        raise HTTPException(status_code=400, detail="Invalid invite link")
    if invite.accepted_at:
        raise HTTPException(status_code=400, detail="Invite already accepted")
    if invite.revoked_at:
        raise HTTPException(status_code=400, detail="Invite was revoked")
    if invite.expires_at < datetime.utcnow():
        raise HTTPException(status_code=400, detail="Invite expired")
    if len(req.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be 8+ characters")

    # Refuse if email is now taken (e.g. user signed up between invite and accept)
    if db.query(User).filter(User.email == invite.email).first():
        raise HTTPException(
            status_code=409,
            detail="An account already exists for this email — please sign in instead",
        )

    user = User(
        tenant_id=invite.tenant_id,
        email=invite.email,
        password_hash=hash_password(req.password),
        name=req.name.strip(),
        role=invite.role,  # "member"
        email_verified_at=datetime.utcnow(),  # invited users skip email verification
    )
    db.add(user)
    invite.accepted_at = datetime.utcnow()
    db.commit()
    db.refresh(user)

    secure = os.getenv("COOKIE_SECURE", "false").lower() == "true"
    token = issue_jwt(user.id, invite.tenant_id)
    response.set_cookie(
        key=COOKIE_NAME, value=token,
        max_age=JWT_TTL_DAYS * 24 * 60 * 60,
        httponly=True, samesite="lax", secure=secure, path="/",
    )
    tenant = db.query(Tenant).filter(Tenant.id == invite.tenant_id).first()
    return {
        "ok": True,
        "user": {"id": user.id, "email": user.email, "name": user.name, "role": user.role},
        "tenant": {"id": tenant.id, "slug": tenant.slug, "name": tenant.name, "plan": tenant.plan},
    }
