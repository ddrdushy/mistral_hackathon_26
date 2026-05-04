"""
Transactional email via local Postfix (or any SMTP server).

In dev, if SMTP_HOST is unset or unreachable, falls back to logging the email
to stdout so you can copy the verification/reset URL during local testing.
"""
from __future__ import annotations

import logging
import os
import smtplib
import socket
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from typing import Optional

logger = logging.getLogger("hireops.auth.email")

DEFAULT_FROM = os.getenv("SMTP_FROM", "noreply@hireops.symprio.com")
SMTP_HOST = os.getenv("SMTP_HOST", "localhost")
SMTP_PORT = int(os.getenv("SMTP_PORT", "25"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")
SMTP_USE_TLS = os.getenv("SMTP_USE_TLS", "false").lower() == "true"


def send_transactional(
    to: str,
    subject: str,
    body_text: str,
    body_html: Optional[str] = None,
    from_email: Optional[str] = None,
) -> bool:
    """Send a transactional email via SMTP. Returns True on success.

    On failure, logs the email content so dev/CI can still see what would have been sent.
    """
    sender = from_email or DEFAULT_FROM

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = to
    msg.attach(MIMEText(body_text, "plain", "utf-8"))
    if body_html:
        msg.attach(MIMEText(body_html, "html", "utf-8"))

    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10) as server:
            if SMTP_USE_TLS:
                server.starttls()
            if SMTP_USER:
                server.login(SMTP_USER, SMTP_PASS)
            server.sendmail(sender, [to], msg.as_string())
        logger.info("Sent %s to %s", subject, to)
        return True
    except (smtplib.SMTPException, socket.error, OSError) as e:
        logger.warning(
            "SMTP send failed (%s) — falling back to log. To: %s | Subject: %s",
            e, to, subject,
        )
        # Print to stdout for dev visibility — never to a file (no leaks).
        print(f"\n=== [DEV FALLBACK EMAIL — SMTP failed: {e}] ===")
        print(f"To: {to}")
        print(f"Subject: {subject}")
        print()
        print(body_text)
        print("=== end email ===\n")
        return False


# ── Templates ───────────────────────────────────────────────────────────────


def _wrap_html(body_inner: str, preheader: str = "") -> str:
    return f"""\
<!DOCTYPE html>
<html><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif;background:#f8fafc;padding:20px;margin:0;">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:24px 28px;">
    <h1 style="color:#fff;margin:0;font-size:18px;letter-spacing:0.4px;">HireOps AI</h1>
  </div>
  <div style="padding:28px;">
    {body_inner}
  </div>
  <div style="padding:14px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;">
    <p style="margin:0;font-size:11px;color:#94a3b8;">
      This email was sent from HireOps AI. If you didn't request it, you can safely ignore it.
    </p>
  </div>
</div>
<div style="display:none;max-height:0;overflow:hidden;color:transparent;">{preheader}</div>
</body></html>"""


def send_verification_email(to: str, name: str, verify_url: str) -> bool:
    subject = "Verify your email — HireOps AI"
    body_text = (
        f"Hi {name or 'there'},\n\n"
        f"Welcome to HireOps AI. Please verify your email address to activate your account:\n\n"
        f"{verify_url}\n\n"
        f"This link expires in 24 hours.\n\n"
        f"If you didn't sign up, you can ignore this email."
    )
    body_html = _wrap_html(
        f"""
        <p style="margin:0 0 12px 0;color:#0f172a;font-size:15px;">
            Hi {name or 'there'},
        </p>
        <p style="margin:0 0 18px 0;color:#475569;font-size:14px;line-height:1.55;">
            Welcome to HireOps AI. Click the button below to verify your email and activate your account.
        </p>
        <div style="text-align:center;margin:24px 0;">
            <a href="{verify_url}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px;">
                Verify email
            </a>
        </div>
        <p style="margin:0 0 8px 0;color:#94a3b8;font-size:12px;">
            Or paste this link into your browser:
        </p>
        <p style="margin:0;color:#475569;font-size:12px;word-break:break-all;">
            <a href="{verify_url}" style="color:#4f46e5;">{verify_url}</a>
        </p>
        <p style="margin:24px 0 0 0;color:#94a3b8;font-size:12px;">
            This link expires in 24 hours.
        </p>
        """,
        preheader="Verify your email to activate your HireOps AI account.",
    )
    return send_transactional(to, subject, body_text, body_html)


def send_password_reset_email(to: str, name: str, reset_url: str) -> bool:
    subject = "Reset your password — HireOps AI"
    body_text = (
        f"Hi {name or 'there'},\n\n"
        f"We received a request to reset your HireOps AI password. Click the link below:\n\n"
        f"{reset_url}\n\n"
        f"This link expires in 1 hour.\n\n"
        f"If you didn't request a reset, you can safely ignore this email — your password won't change."
    )
    body_html = _wrap_html(
        f"""
        <p style="margin:0 0 12px 0;color:#0f172a;font-size:15px;">
            Hi {name or 'there'},
        </p>
        <p style="margin:0 0 18px 0;color:#475569;font-size:14px;line-height:1.55;">
            We received a request to reset your HireOps AI password. Click the button below to set a new one.
        </p>
        <div style="text-align:center;margin:24px 0;">
            <a href="{reset_url}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:14px;">
                Reset password
            </a>
        </div>
        <p style="margin:0 0 8px 0;color:#94a3b8;font-size:12px;">
            Or paste this link into your browser:
        </p>
        <p style="margin:0;color:#475569;font-size:12px;word-break:break-all;">
            <a href="{reset_url}" style="color:#4f46e5;">{reset_url}</a>
        </p>
        <p style="margin:24px 0 0 0;color:#94a3b8;font-size:12px;">
            This link expires in 1 hour. If you didn't request this, ignore the email — your password won't change.
        </p>
        """,
        preheader="Reset your HireOps AI password.",
    )
    return send_transactional(to, subject, body_text, body_html)
