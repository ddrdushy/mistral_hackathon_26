"""Per-tenant email templates with platform defaults and a small token
substitution engine.

Why this exists: every outbound send used to hard-code its subject +
body inline in the router. Tenants wanted their own branding (logo,
colours, signature) and their own wording. This module owns:

  - The list of template categories (interview_invite, etc.)
  - The platform-default subject + HTML body for each
  - Tenant override lookup (EmailTemplate table)
  - Token substitution ({candidate_first_name} → "Harsha", etc.)
  - Branding-wrapped HTML shell (logo + colour + signature stitched in)

Call sites use `render(tenant, category, **vars)` which returns a
{subject, body_html, body_text} dict ready for the SMTP sender.
"""
from __future__ import annotations

import html as html_mod
import logging
import re
from dataclasses import dataclass
from typing import Optional

from sqlalchemy.orm import Session

from database import SessionLocal
from models import EmailTemplate, Tenant

logger = logging.getLogger("hireops.email_templates")

DEFAULT_PRIMARY_COLOR = "#6366f1"  # indigo-500 — current platform palette
DEFAULT_LOGO_URL = ""              # empty = render company name instead


# ── Category catalogue ────────────────────────────────────────────────────


@dataclass
class TemplateCategory:
    key: str
    label: str
    description: str
    variables: list[str]   # tokens documented for the editor


CATEGORIES: dict[str, TemplateCategory] = {
    "interview_invite": TemplateCategory(
        key="interview_invite",
        label="Interview invitation",
        description="Sent when HR generates an interview link.",
        variables=[
            "candidate_first_name", "candidate_name", "job_title",
            "company_name", "interview_url",
        ],
    ),
    "interview_reschedule": TemplateCategory(
        key="interview_reschedule",
        label="Interview rescheduled",
        description="Sent automatically when the bot detects a reschedule request mid-call.",
        variables=[
            "candidate_first_name", "candidate_name", "job_title",
            "company_name", "interview_url",
        ],
    ),
    "interview_confirmation": TemplateCategory(
        key="interview_confirmation",
        label="Interview confirmed",
        description="Sent after a candidate books a slot (with calendar attachment).",
        variables=[
            "candidate_first_name", "candidate_name", "job_title",
            "company_name", "interview_url", "scheduled_at",
        ],
    ),
    "interview_reminder": TemplateCategory(
        key="interview_reminder",
        label="Interview reminder",
        description="24-hour reminder before a scheduled interview.",
        variables=[
            "candidate_first_name", "candidate_name", "job_title",
            "company_name", "interview_url", "scheduled_at",
        ],
    ),
    "availability_check": TemplateCategory(
        key="availability_check",
        label="Availability check",
        description="Sent during talent-bank bulk outreach to confirm a candidate is open to a role.",
        variables=[
            "candidate_first_name", "candidate_name", "job_title", "company_name",
            "job_location", "job_seniority", "job_employment_type",
            "job_summary", "key_responsibilities_html", "key_skills_html",
            "recruiter_name",
        ],
    ),
    "shortlist_congrats": TemplateCategory(
        key="shortlist_congrats",
        label="Shortlist notification",
        description="Tells the candidate they've been shortlisted and what happens next.",
        variables=[
            "candidate_first_name", "candidate_name", "job_title",
            "company_name", "recruiter_name",
        ],
    ),
    "offer_letter": TemplateCategory(
        key="offer_letter",
        label="Offer letter",
        description="Sent when an offer is generated. Variables include salary, start date, equity.",
        variables=[
            "candidate_first_name", "candidate_name", "job_title", "company_name",
            "salary_amount", "salary_currency", "start_date", "location",
            "employment_type", "bonus_amount", "equity_description",
            "recruiter_name", "signing_url",
        ],
    ),
    "offer_accepted": TemplateCategory(
        key="offer_accepted",
        label="Offer accepted (internal)",
        description="Sent to the recruiter when a candidate signs the offer.",
        variables=[
            "candidate_first_name", "candidate_name", "job_title", "company_name",
            "salary_amount", "salary_currency", "start_date",
        ],
    ),
    "rejection": TemplateCategory(
        key="rejection",
        label="Rejection",
        description="Sent when a candidate is rejected.",
        variables=[
            "candidate_first_name", "candidate_name", "job_title", "company_name",
        ],
    ),
    "generic_email": TemplateCategory(
        key="generic_email",
        label="Generic email (free-form)",
        description="A blank canvas with branding wrapped around it. Use for ad-hoc sends from the candidate timeline.",
        variables=[
            "candidate_first_name", "candidate_name", "job_title", "company_name",
            "recruiter_name",
        ],
    ),
    "in_app_notification": TemplateCategory(
        key="in_app_notification",
        label="In-app notification",
        description="Wording for system notifications surfaced in the bell. Short, single-paragraph copy.",
        variables=[
            "candidate_first_name", "candidate_name", "job_title", "event_summary",
        ],
    ),
}


# ── Platform defaults ─────────────────────────────────────────────────────
# Body is the INNER HTML — the renderer wraps it in the branded shell so
# logo + colour + signature are consistent across categories.


_DEFAULT_INTERVIEW_INVITE_HTML = """
<p>Hi {candidate_first_name},</p>
<p>Thank you for applying for the <strong>{job_title}</strong> position at {company_name}.
We'd like to invite you to a short AI-powered screening interview.</p>
<p>The interview takes about <strong>8–10 minutes</strong>. You'll need a working
microphone and camera in a quiet environment.</p>
<p style="text-align:center;margin:30px 0;">
  <a href="{interview_url}" style="background:{primary_color};color:white;
     padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;
     display:inline-block;">Start your interview</a>
</p>
<p style="color:#64748b;font-size:13px;">
  This link is valid for 72 hours. If the button doesn't work, paste this into
  your browser:<br>
  <span style="font-family:monospace;word-break:break-all;">{interview_url}</span>
</p>
"""

_DEFAULT_RESCHEDULE_HTML = """
<p>Hi {candidate_first_name},</p>
<p>No problem — here is a fresh link for your <strong>{job_title}</strong> screening interview.
You can join whenever it suits you in the next 72 hours.</p>
<p style="text-align:center;margin:30px 0;">
  <a href="{interview_url}" style="background:{primary_color};color:white;
     padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;
     display:inline-block;">Start your interview</a>
</p>
<p style="color:#64748b;font-size:13px;">
  If the button doesn't work, paste this into your browser:<br>
  <span style="font-family:monospace;word-break:break-all;">{interview_url}</span>
</p>
"""

_DEFAULT_AVAILABILITY_HTML = """
<p>Hi {candidate_first_name},</p>
<p>This is {company_name}. We have an opening for <strong>{job_title}</strong>
that looks like a strong match for your background, and I&rsquo;d love to
explore whether the timing works for you.</p>

<table role="presentation" style="width:100%;border-collapse:collapse;
       background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;
       margin:18px 0;">
  <tr><td style="padding:10px 14px;color:#64748b;width:38%;">Role</td>
      <td style="padding:10px 14px;font-weight:600;color:#0f172a;">{job_title}</td></tr>
  <tr><td style="padding:10px 14px;color:#64748b;">Location</td>
      <td style="padding:10px 14px;color:#0f172a;">{job_location}</td></tr>
  <tr><td style="padding:10px 14px;color:#64748b;">Seniority</td>
      <td style="padding:10px 14px;color:#0f172a;">{job_seniority}</td></tr>
  <tr><td style="padding:10px 14px;color:#64748b;">Employment type</td>
      <td style="padding:10px 14px;color:#0f172a;">{job_employment_type}</td></tr>
</table>

<p style="margin-top:18px;"><strong>About the role</strong></p>
<p>{job_summary}</p>

<p style="margin-top:18px;"><strong>What you&rsquo;d do</strong></p>
{key_responsibilities_html}

<p style="margin-top:18px;"><strong>Skills we&rsquo;re looking for</strong></p>
{key_skills_html}

<p style="margin-top:22px;">If this looks interesting, just reply to this
email with:</p>
<ul>
  <li>A few <strong>days &amp; time windows</strong> that work for a short
      screening conversation this week or next,</li>
  <li>Your <strong>current notice period</strong> and earliest start date,</li>
  <li>Your <strong>compensation expectations</strong> (ballpark is fine),</li>
  <li>Any <strong>questions</strong> about the role, team, or work mode.</li>
</ul>

<p>If you&rsquo;re not currently looking, no worries — a one-line reply with
&ldquo;not right now&rdquo; and we&rsquo;ll close the loop. We&rsquo;ll
also keep your profile on file for future roles that fit better.</p>

<p>Looking forward to hearing from you.</p>
"""

_DEFAULT_REJECTION_HTML = """
<p>Dear {candidate_first_name},</p>
<p>Thank you for your interest in the <strong>{job_title}</strong> position at {company_name}
and for taking the time to apply.</p>
<p>After careful review, we have decided to move forward with other candidates
whose experience more closely aligns with the requirements for this particular role.</p>
<p>We encourage you to apply for future openings that match your skills and experience.
We wish you the very best in your career journey.</p>
"""


_DEFAULT_CONFIRMATION_HTML = """
<p>Hi {candidate_first_name},</p>
<p>Your interview for <strong>{job_title}</strong> at {company_name} is confirmed
for <strong>{scheduled_at}</strong>.</p>
<p>A calendar invite is attached to this email — please accept it so the
time blocks on your calendar too.</p>
<p style="text-align:center;margin:30px 0;">
  <a href="{interview_url}" style="background:{primary_color};color:white;
     padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;
     display:inline-block;">Join interview room</a>
</p>
<p style="color:#64748b;font-size:13px;">
  The room opens 5 minutes before the scheduled time. Please use a quiet
  space with a working microphone and camera.
</p>
"""

_DEFAULT_REMINDER_HTML = """
<p>Hi {candidate_first_name},</p>
<p>Just a quick reminder — your interview for <strong>{job_title}</strong> at
{company_name} is tomorrow, <strong>{scheduled_at}</strong>.</p>
<p style="text-align:center;margin:30px 0;">
  <a href="{interview_url}" style="background:{primary_color};color:white;
     padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;
     display:inline-block;">Join interview</a>
</p>
<p style="color:#64748b;font-size:13px;">
  Need to reschedule? Reply to this email and we'll set up a new time.
</p>
"""

_DEFAULT_SHORTLIST_HTML = """
<p>Hi {candidate_first_name},</p>
<p>Great news — you've been shortlisted for the <strong>{job_title}</strong>
role at {company_name}. Thank you for the interview!</p>
<p>{recruiter_name} will follow up shortly with the next step. In the
meantime, let us know if you have any questions about the role, the team,
or the timeline.</p>
"""

_DEFAULT_OFFER_HTML = """
<p>Dear {candidate_first_name},</p>
<p>We're delighted to extend an offer for the <strong>{job_title}</strong> position
at {company_name}.</p>
<table style="width:100%;border-collapse:collapse;margin:20px 0;">
  <tr><td style="padding:6px 0;color:#64748b;width:40%;">Annual salary</td>
      <td style="padding:6px 0;font-weight:600;">{salary_currency} {salary_amount}</td></tr>
  <tr><td style="padding:6px 0;color:#64748b;">Bonus</td>
      <td style="padding:6px 0;font-weight:600;">{bonus_amount}</td></tr>
  <tr><td style="padding:6px 0;color:#64748b;">Equity</td>
      <td style="padding:6px 0;font-weight:600;">{equity_description}</td></tr>
  <tr><td style="padding:6px 0;color:#64748b;">Employment type</td>
      <td style="padding:6px 0;font-weight:600;">{employment_type}</td></tr>
  <tr><td style="padding:6px 0;color:#64748b;">Location</td>
      <td style="padding:6px 0;font-weight:600;">{location}</td></tr>
  <tr><td style="padding:6px 0;color:#64748b;">Start date</td>
      <td style="padding:6px 0;font-weight:600;">{start_date}</td></tr>
</table>
<p style="text-align:center;margin:30px 0;">
  <a href="{signing_url}" style="background:{primary_color};color:white;
     padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;
     display:inline-block;">Review &amp; sign offer</a>
</p>
<p>If anything in the package needs adjusting, reply to this email and
{recruiter_name} will work through it with you.</p>
<p>Welcome to the team!</p>
"""

_DEFAULT_OFFER_ACCEPTED_HTML = """
<p>Hi team,</p>
<p><strong>{candidate_first_name}</strong> has accepted the offer for
<strong>{job_title}</strong>.</p>
<ul>
  <li>Salary: {salary_currency} {salary_amount}</li>
  <li>Start date: <strong>{start_date}</strong></li>
</ul>
<p>Time to kick off the onboarding workflow.</p>
"""

_DEFAULT_GENERIC_HTML = """
<p>Hi {candidate_first_name},</p>
<p>[Your message here. Use the variables on the right to pull in candidate
and job details. The branding wrapper and signature are added automatically.]</p>
"""

_DEFAULT_NOTIFICATION_HTML = """
<p><strong>{candidate_first_name}</strong> — {event_summary} on
<em>{job_title}</em>.</p>
"""


_DEFAULTS: dict[str, dict[str, str]] = {
    "interview_invite": {
        "subject": "Interview Invitation — {job_title} at {company_name}",
        "body_html": _DEFAULT_INTERVIEW_INVITE_HTML,
    },
    "interview_reschedule": {
        "subject": "Your rescheduled interview — {job_title} at {company_name}",
        "body_html": _DEFAULT_RESCHEDULE_HTML,
    },
    "interview_confirmation": {
        "subject": "Confirmed: your interview for {job_title} at {company_name}",
        "body_html": _DEFAULT_CONFIRMATION_HTML,
    },
    "interview_reminder": {
        "subject": "Reminder: your interview tomorrow at {company_name}",
        "body_html": _DEFAULT_REMINDER_HTML,
    },
    "availability_check": {
        "subject": "{job_title} at {company_name} — are you open to chat?",
        "body_html": _DEFAULT_AVAILABILITY_HTML,
    },
    "shortlist_congrats": {
        "subject": "Congratulations — shortlisted for {job_title} at {company_name}",
        "body_html": _DEFAULT_SHORTLIST_HTML,
    },
    "offer_letter": {
        "subject": "Your offer from {company_name} — {job_title}",
        "body_html": _DEFAULT_OFFER_HTML,
    },
    "offer_accepted": {
        "subject": "Offer accepted: {candidate_name} for {job_title}",
        "body_html": _DEFAULT_OFFER_ACCEPTED_HTML,
    },
    "rejection": {
        "subject": "Update on your application — {job_title} at {company_name}",
        "body_html": _DEFAULT_REJECTION_HTML,
    },
    "generic_email": {
        "subject": "{job_title} — {company_name}",
        "body_html": _DEFAULT_GENERIC_HTML,
    },
    "in_app_notification": {
        "subject": "{candidate_first_name}: {event_summary}",
        "body_html": _DEFAULT_NOTIFICATION_HTML,
    },
}


# ── Renderer ──────────────────────────────────────────────────────────────


def _branding(tenant: Optional[Tenant]) -> dict:
    """Resolve effective branding for `tenant`. Each field falls back to
    a platform default when the tenant hasn't set it."""
    if tenant is None:
        return {
            "company_name": "the recruitment team",
            "logo_url": DEFAULT_LOGO_URL,
            "primary_color": DEFAULT_PRIMARY_COLOR,
            "from_name": "HireOps AI",
            "signature_html": "<p>Best regards,<br><strong>HireOps AI</strong></p>",
        }
    name = tenant.name or "the recruitment team"
    signature = (tenant.brand_signature or "").strip()
    if not signature:
        signature = f"<p>Best regards,<br><strong>{html_mod.escape(name)} Recruitment Team</strong></p>"
    elif "<" not in signature:
        # Tenants typing plain text — wrap as <p> with line breaks preserved.
        signature = "<p>" + html_mod.escape(signature).replace("\n", "<br>") + "</p>"
    return {
        "company_name": name,
        "logo_url": (tenant.brand_logo_url or "").strip() or DEFAULT_LOGO_URL,
        "primary_color": (tenant.brand_primary_color or "").strip() or DEFAULT_PRIMARY_COLOR,
        "from_name": (tenant.brand_from_name or "").strip() or name,
        "signature_html": signature,
    }


def _shell(inner_html: str, *, brand: dict, preheader: str = "") -> str:
    """Wrap inner template HTML in the branded shell."""
    logo_block = ""
    if brand["logo_url"]:
        logo_block = (
            f'<img src="{html_mod.escape(brand["logo_url"])}" alt="{html_mod.escape(brand["company_name"])}" '
            f'style="max-height:48px;display:block;margin:0 auto;">'
        )
    else:
        logo_block = (
            f'<div style="color:white;font-size:22px;font-weight:600;">'
            f'{html_mod.escape(brand["company_name"])}</div>'
        )
    return f"""<!doctype html>
<html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">{html_mod.escape(preheader)}</div>
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;
              border:1px solid #e2e8f0;">
    <div style="background:{brand['primary_color']};padding:28px 24px;text-align:center;">
      {logo_block}
    </div>
    <div style="padding:28px;color:#334155;font-size:15px;line-height:1.6;">
      {inner_html}
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
      {brand['signature_html']}
    </div>
  </div>
</body></html>"""


_TOKEN_RE = re.compile(r"\{(\w+)\}")


def _substitute(text: str, ctx: dict) -> str:
    """Replace {token} occurrences from ctx, leaving unknown tokens as-is
    so editor preview clearly shows when something's missing."""
    def _repl(m: re.Match) -> str:
        key = m.group(1)
        v = ctx.get(key)
        return str(v) if v is not None else m.group(0)
    return _TOKEN_RE.sub(_repl, text or "")


def _html_to_text(s: str) -> str:
    """Cheap HTML → text fallback for clients that prefer plain. Strips
    tags, collapses whitespace, decodes entities."""
    out = re.sub(r"<\s*br\s*/?>", "\n", s, flags=re.IGNORECASE)
    out = re.sub(r"</p\s*>", "\n\n", out, flags=re.IGNORECASE)
    out = re.sub(r"<[^>]+>", "", out)
    out = html_mod.unescape(out)
    return re.sub(r"\n{3,}", "\n\n", out).strip()


def get_tenant_template(
    db: Session, tenant_id: int, category: str
) -> Optional[EmailTemplate]:
    return (
        db.query(EmailTemplate)
        .filter(
            EmailTemplate.tenant_id == tenant_id,
            EmailTemplate.category == category,
            EmailTemplate.enabled.is_(True),
        )
        .first()
    )


def get_effective(
    db: Session, tenant_id: int, category: str
) -> dict:
    """Return the subject + body_html the tenant will see, merging
    overrides over platform defaults. Used by the editor on first load."""
    if category not in _DEFAULTS:
        raise KeyError(category)
    base = _DEFAULTS[category]
    row = get_tenant_template(db, tenant_id, category)
    if row:
        return {
            "subject": row.subject,
            "body_html": row.body_html,
            "body_text": row.body_text or "",
            "source": "tenant",
        }
    return {
        "subject": base["subject"],
        "body_html": base["body_html"],
        "body_text": "",
        "source": "platform_default",
    }


def render(
    tenant: Optional[Tenant],
    category: str,
    *,
    db: Optional[Session] = None,
    **vars,
) -> dict:
    """Resolve the template, run token substitution, wrap in the branded
    shell. Returns {subject, body_html, body_text, from_name}.

    `vars` should include the tokens listed under that category's
    `variables`. Unknown tokens are left as literal {token} so the
    sender sees obvious bugs instead of silently shipping empty strings.
    """
    if category not in _DEFAULTS:
        raise KeyError(category)
    brand = _branding(tenant)

    # Resolve subject + inner body. Open a session if the caller didn't
    # pass one — render() is sometimes called from background workers
    # where session lifecycle is tricky.
    owned_db = False
    if db is None and tenant is not None:
        db = SessionLocal()
        owned_db = True
    try:
        if db is not None and tenant is not None:
            row = get_tenant_template(db, tenant.id, category)
        else:
            row = None
        subject_tpl = row.subject if row else _DEFAULTS[category]["subject"]
        body_html_tpl = row.body_html if row else _DEFAULTS[category]["body_html"]
        explicit_text = (row.body_text if row else "") or ""
    finally:
        if owned_db and db is not None:
            db.close()

    ctx = {
        # branding-derived
        "company_name": brand["company_name"],
        "primary_color": brand["primary_color"],
        "logo_url": brand["logo_url"],
        # caller-provided
        **vars,
    }
    # Derive candidate_first_name from candidate_name when only one given.
    if "candidate_name" in vars and "candidate_first_name" not in vars:
        ctx["candidate_first_name"] = str(vars["candidate_name"]).split()[0] if vars["candidate_name"] else ""

    subject = _substitute(subject_tpl, ctx)
    inner = _substitute(body_html_tpl, ctx)
    body_html = _shell(inner, brand=brand, preheader=subject)

    body_text = _substitute(explicit_text, ctx) if explicit_text else _html_to_text(inner)

    return {
        "subject": subject,
        "body_html": body_html,
        "body_text": body_text,
        "from_name": brand["from_name"],
    }
