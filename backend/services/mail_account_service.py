"""Tenant-scoped CRUD for MailAccount + IMAP connect/test/sync.

This is the multi-tenant replacement for the old process-global `_inbox_config`
in routers/inbox.py. Each tenant can register any number of inboxes; their IMAP
credentials are encrypted at rest with services.secrets_crypto.
"""
from __future__ import annotations

import imaplib
import logging
import poplib
from datetime import datetime
from typing import List, Optional

from sqlalchemy.orm import Session

from models import Email, MailAccount
from services.email_service import fetch_imap_emails, sync_imap_emails
from services.secrets_crypto import encrypt, decrypt

logger = logging.getLogger("hireops.mail_accounts")


# ─── Read ──────────────────────────────────────────────────────────────────


def list_for_tenant(db: Session, tenant_id: int) -> List[MailAccount]:
    return (
        db.query(MailAccount)
        .filter(MailAccount.tenant_id == tenant_id)
        .order_by(MailAccount.created_at.asc())
        .all()
    )


def get_for_tenant(db: Session, tenant_id: int, account_id: int) -> Optional[MailAccount]:
    return (
        db.query(MailAccount)
        .filter(MailAccount.tenant_id == tenant_id, MailAccount.id == account_id)
        .first()
    )


# ─── Create / Test ─────────────────────────────────────────────────────────


def test_imap_connection(host: str, port: int, ssl: bool, user: str, password: str) -> None:
    """Open + log in + select INBOX, then close. Raises on failure with a
    user-friendly message we can surface in the API response."""
    try:
        if ssl:
            mail = imaplib.IMAP4_SSL(host, port)
        else:
            mail = imaplib.IMAP4(host, port)
    except Exception as e:
        raise ValueError(f"Could not reach {host}:{port} — {e}") from e

    try:
        mail.login(user, password)
    except imaplib.IMAP4.error as e:
        raise ValueError(
            f"Login rejected by {host}. Double-check the email and app password. "
            f"({e})"
        ) from e
    try:
        status, _ = mail.select("INBOX")
        if status != "OK":
            raise ValueError(f"Could not open INBOX on {host}")
    finally:
        try:
            mail.logout()
        except Exception:
            pass


def test_pop3_connection(host: str, port: int, ssl: bool, user: str, password: str) -> None:
    try:
        if ssl:
            mail = poplib.POP3_SSL(host, port, timeout=15)
        else:
            mail = poplib.POP3(host, port, timeout=15)
    except Exception as e:
        raise ValueError(f"Could not reach {host}:{port} — {e}") from e

    try:
        mail.user(user)
        mail.pass_(password)
        mail.stat()  # smoke test — fetches mailbox stats
    except poplib.error_proto as e:
        raise ValueError(f"POP3 login rejected by {host}: {e}") from e
    finally:
        try:
            mail.quit()
        except Exception:
            pass


def create_account(
    db: Session,
    tenant_id: int,
    provider: str,
    auth_method: str,
    email_address: str,
    imap_host: str,
    imap_port: int,
    imap_ssl: bool,
    imap_user: str,
    secret: str,
    test_first: bool = True,
) -> MailAccount:
    """Validate + persist a new tenant mailbox. Encrypts the password.

    Raises ValueError on duplicate or connection-test failure.
    """
    email_address = email_address.strip().lower()
    imap_user = (imap_user or email_address).strip()

    existing = (
        db.query(MailAccount)
        .filter(
            MailAccount.tenant_id == tenant_id,
            MailAccount.email_address == email_address,
        )
        .first()
    )
    if existing:
        raise ValueError(f"{email_address} is already connected to this tenant")

    if test_first:
        if auth_method == "pop3_password":
            test_pop3_connection(imap_host, imap_port, imap_ssl, imap_user, secret)
        else:
            test_imap_connection(imap_host, imap_port, imap_ssl, imap_user, secret)

    account = MailAccount(
        tenant_id=tenant_id,
        provider=provider,
        auth_method=auth_method,
        email_address=email_address,
        imap_host=imap_host.strip(),
        imap_port=imap_port,
        imap_ssl=imap_ssl,
        imap_user=imap_user,
        secret_encrypted=encrypt(secret),
        status="connected",
        last_error=None,
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


# ─── Sync ──────────────────────────────────────────────────────────────────


def sync_account(
    db: Session, account: MailAccount, limit: int = 50
) -> List[Email]:
    """Pull new mail from a single account + tag rows with the tenant_id.
    Updates the account's status / last_error / last_sync_at fields."""
    try:
        password = decrypt(account.secret_encrypted)
    except ValueError as e:
        account.status = "error"
        account.last_error = str(e)
        db.commit()
        raise

    try:
        # NOTE: We use the existing IMAP fetcher for both IMAP and POP3-style
        # accounts since most "POP3" providers also expose IMAP and Gmail/Yahoo
        # IMAP works fine here. True POP3-only support can be added later if a
        # tenant actually picks the POP3 tile.
        fetched = fetch_imap_emails(
            host=account.imap_host,
            port=account.imap_port,
            user=account.imap_user,
            password=password,
            ssl=account.imap_ssl,
            limit=limit,
        )
    except Exception as e:
        account.status = "error"
        account.last_error = f"Fetch failed: {e}"
        account.last_sync_at = datetime.utcnow()
        db.commit()
        raise

    new_emails = sync_imap_emails(db, fetched)
    for em in new_emails:
        if em.tenant_id is None:
            em.tenant_id = account.tenant_id

    account.status = "connected"
    account.last_error = None
    account.last_sync_at = datetime.utcnow()
    account.last_synced_count = len(new_emails)
    db.commit()
    for em in new_emails:
        db.refresh(em)
    logger.info(
        "Synced %d new emails from %s for tenant %s",
        len(new_emails), account.email_address, account.tenant_id,
    )
    return new_emails


def sync_all_for_tenant(
    db: Session, tenant_id: int, limit_per_account: int = 50
) -> dict:
    """Run sync on every account for a tenant. Returns a per-account summary
    so the UI can render a live status table."""
    results = []
    accounts = list_for_tenant(db, tenant_id)
    total = 0
    for acc in accounts:
        try:
            emails = sync_account(db, acc, limit=limit_per_account)
            results.append({
                "account_id": acc.id,
                "email": acc.email_address,
                "synced_count": len(emails),
                "status": "ok",
            })
            total += len(emails)
        except Exception as e:
            results.append({
                "account_id": acc.id,
                "email": acc.email_address,
                "synced_count": 0,
                "status": "error",
                "error": str(e),
            })
    return {"total_synced": total, "accounts": results}


# ─── Serialization ─────────────────────────────────────────────────────────


def to_response(account: MailAccount) -> dict:
    """Public-safe representation. NEVER returns the encrypted secret."""
    return {
        "id": account.id,
        "provider": account.provider,
        "auth_method": account.auth_method,
        "email_address": account.email_address,
        "imap_host": account.imap_host,
        "imap_port": account.imap_port,
        "imap_ssl": account.imap_ssl,
        "status": account.status,
        "listener_enabled": bool(getattr(account, "listener_enabled", True)),
        "last_error": account.last_error,
        "last_sync_at": account.last_sync_at.isoformat() if account.last_sync_at else None,
        "last_synced_count": account.last_synced_count,
        "created_at": account.created_at.isoformat() if account.created_at else None,
    }
