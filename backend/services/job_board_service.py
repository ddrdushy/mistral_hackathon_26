"""Tenant-scoped CRUD for JobBoardAccount + provider catalog.

This is the BYO ("bring your own subscription") path for LinkedIn / Indeed /
JobStreet. Tenants who already pay for those services connect their own
credentials here, encrypted at rest with services.secrets_crypto, and
search/posting runs through their own quota.

Apollo isn't stored here — it's platform-managed via APOLLO_API_KEY and
shows up in the catalog with `platform_managed=True`.
"""
from __future__ import annotations

import json
import logging
from typing import List, Optional

from sqlalchemy.orm import Session

from models import JobBoardAccount
from services import apollo_service
from services.secrets_crypto import decrypt, encrypt

logger = logging.getLogger("hireops.job_boards")


# ─── Provider catalog ─────────────────────────────────────────────────────


PROVIDER_CATALOG = [
    {
        "id": "apollo",
        "name": "Apollo",
        "tagline": "270M+ professional contacts. Default search engine.",
        "auth_method": "api_key",
        "platform_managed": True,
        "byo_enabled": True,
        "capabilities": ["search_candidates"],
        "help_url": "https://app.apollo.io/#/settings/integrations/api",
        "logo_color": "from-violet-500 to-fuchsia-600",
        "status": "active",
    },
    {
        "id": "linkedin",
        "name": "LinkedIn Recruiter",
        "tagline": "Talent search + job posting via Talent Solutions API.",
        "auth_method": "oauth",
        "platform_managed": False,
        "byo_enabled": True,
        "capabilities": ["search_candidates", "post_job", "inbound_apply"],
        "help_url": "https://www.linkedin.com/help/recruiter/answer/a543617",
        "logo_color": "from-sky-600 to-blue-700",
        "status": "coming_soon",
    },
    {
        "id": "indeed",
        "name": "Indeed Sponsored Jobs",
        "tagline": "Job posting + Apply API. Requires Indeed Employer Cloud.",
        "auth_method": "api_key",
        "platform_managed": False,
        "byo_enabled": True,
        "capabilities": ["post_job", "inbound_apply"],
        "help_url": "https://employers.indeed.com/api",
        "logo_color": "from-blue-600 to-indigo-700",
        "status": "coming_soon",
    },
    {
        "id": "jobstreet",
        "name": "JobStreet (SEEK)",
        "tagline": "Asia-Pacific posting + applications. SEEK API key.",
        "auth_method": "api_key",
        "platform_managed": False,
        "byo_enabled": True,
        "capabilities": ["post_job", "inbound_apply"],
        "help_url": "https://developer.seek.com/",
        "logo_color": "from-pink-500 to-rose-600",
        "status": "coming_soon",
    },
]


def get_catalog() -> List[dict]:
    """Public list of supported providers — returned to the frontend gallery."""
    return [
        {
            **p,
            # Apollo platform-managed status reflects whether the env key is set
            "active": (p["platform_managed"] and apollo_service.is_configured())
            if p["id"] == "apollo" else False,
        }
        for p in PROVIDER_CATALOG
    ]


def get_provider(provider_id: str) -> Optional[dict]:
    return next((p for p in PROVIDER_CATALOG if p["id"] == provider_id), None)


# ─── Tenant CRUD ──────────────────────────────────────────────────────────


def list_for_tenant(db: Session, tenant_id: int) -> List[JobBoardAccount]:
    return (
        db.query(JobBoardAccount)
        .filter(JobBoardAccount.tenant_id == tenant_id)
        .order_by(JobBoardAccount.created_at.asc())
        .all()
    )


def get_for_tenant(
    db: Session, tenant_id: int, account_id: int
) -> Optional[JobBoardAccount]:
    return (
        db.query(JobBoardAccount)
        .filter(JobBoardAccount.tenant_id == tenant_id, JobBoardAccount.id == account_id)
        .first()
    )


def create_account(
    db: Session,
    *,
    tenant_id: int,
    provider: str,
    auth_method: str,
    account_label: str,
    secret: str,
    capabilities: List[str],
    external_user_id: str = "",
) -> JobBoardAccount:
    """Persist a new BYO account. The secret is encrypted before write.

    We don't liveprobe the third-party API at creation time (unlike MailAccount
    where IMAP login is cheap) because LinkedIn/Indeed/SEEK all charge per
    API call and the user might be testing creds — first sync will surface
    any auth error.
    """
    p = get_provider(provider)
    if not p:
        raise ValueError(f"Unknown provider '{provider}'")
    if not p["byo_enabled"]:
        raise ValueError(f"Provider '{provider}' does not support BYO credentials")

    existing = (
        db.query(JobBoardAccount)
        .filter(
            JobBoardAccount.tenant_id == tenant_id,
            JobBoardAccount.provider == provider,
            JobBoardAccount.external_user_id == (external_user_id or ""),
        )
        .first()
    )
    if existing:
        raise ValueError(
            f"This {p['name']} account is already connected for the tenant"
        )

    account = JobBoardAccount(
        tenant_id=tenant_id,
        provider=provider,
        auth_method=auth_method,
        account_label=account_label or p["name"],
        external_user_id=external_user_id or "",
        capabilities=json.dumps(capabilities or p["capabilities"]),
        secret_encrypted=encrypt(secret),
        status="connected",
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    return account


def delete_account(db: Session, tenant_id: int, account_id: int) -> bool:
    account = get_for_tenant(db, tenant_id, account_id)
    if not account:
        return False
    db.delete(account)
    db.commit()
    return True


# ─── Serialization ────────────────────────────────────────────────────────


def to_response(account: JobBoardAccount) -> dict:
    """Public-safe representation. Never returns the encrypted secret."""
    try:
        caps = json.loads(account.capabilities) if account.capabilities else []
    except json.JSONDecodeError:
        caps = []
    return {
        "id": account.id,
        "provider": account.provider,
        "auth_method": account.auth_method,
        "account_label": account.account_label,
        "external_user_id": account.external_user_id,
        "capabilities": caps,
        "status": account.status,
        "last_error": account.last_error,
        "last_used_at": account.last_used_at.isoformat() if account.last_used_at else None,
        "created_at": account.created_at.isoformat() if account.created_at else None,
    }


def get_decrypted_secret(account: JobBoardAccount) -> str:
    """For internal adapter use only — never expose over HTTP."""
    return decrypt(account.secret_encrypted)
