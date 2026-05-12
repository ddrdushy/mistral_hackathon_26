"""Tenant-scoped outbound email — sends through the same MailAccount the
tenant connected for inbox sync.

Why this exists: the legacy `smtp_service.send_email` routes through a
single global `gmail_manager` OAuth grant which a) only supports one
inbox per platform and b) breaks completely whenever the DB is reset or
the token expires. After the DB wipe HR couldn't actually deliver any
interview-link / rejection emails — the screening flow was happy to
mark the link `sent` while the candidate never got anything.

This module sends via SMTP using the tenant's existing IMAP credentials:
Gmail's app passwords work for smtp.gmail.com:587, Outlook's for
smtp-mail.outlook.com:587, and so on. No new credentials to collect,
no extra OAuth dance.
"""
from __future__ import annotations

import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

from sqlalchemy.orm import Session

from database import SessionLocal
from models import MailAccount
from services.secrets_crypto import decrypt

logger = logging.getLogger("hireops.tenant_outbound")

# Map an IMAP host to its SMTP counterpart + port + TLS mode. Gmail and
# Outlook are the two we care about right now; anything else (Yahoo, etc.)
# falls back to deriving smtp.<domain>:587/STARTTLS which works for most
# providers.
_SMTP_BY_IMAP_HOST = {
    "imap.gmail.com":         ("smtp.gmail.com",         587, "starttls"),
    "imap.mail.yahoo.com":    ("smtp.mail.yahoo.com",    587, "starttls"),
    "outlook.office365.com":  ("smtp.office365.com",     587, "starttls"),
    "imap-mail.outlook.com":  ("smtp-mail.outlook.com",  587, "starttls"),
    "imap.mail.me.com":       ("smtp.mail.me.com",       587, "starttls"),
    "imap.aol.com":           ("smtp.aol.com",           587, "starttls"),
}


def _smtp_endpoint_for(imap_host: str) -> tuple[str, int, str]:
    h = (imap_host or "").lower().strip()
    if h in _SMTP_BY_IMAP_HOST:
        return _SMTP_BY_IMAP_HOST[h]
    # Heuristic fallback: rewrite imap.* -> smtp.* with STARTTLS on 587.
    if h.startswith("imap."):
        return ("smtp." + h[len("imap."):], 587, "starttls")
    return (h, 587, "starttls")


def _pick_account(db: Session, tenant_id: int) -> Optional[MailAccount]:
    """Return the tenant's preferred outbound account. We just pick the
    most recently updated connected one — for v1 that maps 1:1 to the
    inbox they were already using anyway."""
    return (
        db.query(MailAccount)
        .filter(
            MailAccount.tenant_id == tenant_id,
            MailAccount.status == "connected",
        )
        .order_by(MailAccount.updated_at.desc())
        .first()
    )


def send_via_tenant_mailbox(
    tenant_id: int,
    to_email: str,
    subject: str,
    body_html: str,
    body_text: Optional[str] = None,
    db: Optional[Session] = None,
) -> dict:
    """Send `to_email` from the tenant's connected MailAccount via SMTP.

    Returns {"success": bool, "message": str, "from": str|None}.
    Caller decides what to do with a failure (the screening flow used to
    mark the link "sent" anyway — that's misleading and now changed).
    """
    owned_session = False
    if db is None:
        db = SessionLocal()
        owned_session = True

    try:
        account = _pick_account(db, tenant_id)
        if not account:
            return {
                "success": False,
                "message": (
                    "No connected mailbox for this tenant. Connect a Gmail/Outlook "
                    "account under Settings → Email Integrations before sending."
                ),
                "from": None,
            }

        try:
            password = decrypt(account.secret_encrypted)
        except Exception as e:
            return {
                "success": False,
                "message": f"Could not decrypt mailbox credentials: {e}",
                "from": account.email_address,
            }

        smtp_host, smtp_port, tls_mode = _smtp_endpoint_for(account.imap_host)

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = account.email_address
        msg["To"] = to_email
        if body_text:
            msg.attach(MIMEText(body_text, "plain", "utf-8"))
        msg.attach(MIMEText(body_html, "html", "utf-8"))

        try:
            with smtplib.SMTP(smtp_host, smtp_port, timeout=15) as server:
                if tls_mode == "starttls":
                    server.starttls()
                server.login(account.imap_user or account.email_address, password)
                server.sendmail(account.email_address, [to_email], msg.as_string())
            logger.info(
                "Sent '%s' via %s (tenant %s) to %s",
                subject, smtp_host, tenant_id, to_email,
            )
            return {
                "success": True,
                "message": f"Sent from {account.email_address}",
                "from": account.email_address,
            }
        except smtplib.SMTPAuthenticationError as e:
            return {
                "success": False,
                "message": (
                    f"SMTP auth rejected by {smtp_host}. The mailbox app-password "
                    f"likely needs to be regenerated. ({e.smtp_code})"
                ),
                "from": account.email_address,
            }
        except Exception as e:
            return {
                "success": False,
                "message": f"SMTP send failed ({smtp_host}:{smtp_port}): {e}",
                "from": account.email_address,
            }
    finally:
        if owned_session:
            db.close()
