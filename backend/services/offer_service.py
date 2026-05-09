"""Offer letter rendering + e-sign mock (Feature 7).

v1 keeps things simple:
  - Render Markdown → HTML server-side (no heavy PDF dep). Browsers can
    print-to-PDF; the signed copy embeds a signature footer.
  - Mock e-sign provider produces a token-based signing URL on our own
    domain. DocuSign/HelloSign adapters drop in via the same interface
    later — schema already supports the columns they need.

Merge tags use Python str.format-style {{key}} substitutions. Unknown
keys render as {{?key?}} so a typo is visible in the rendered output
rather than silently leaving the placeholder text.
"""
from __future__ import annotations

import html as _html
import json
import logging
import re
import secrets
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy.orm import Session

from models import Offer, OfferTemplate

logger = logging.getLogger("hireops.offer_service")


# ─── Merge / render ──────────────────────────────────────────────────────────


_MERGE_TAG_RE = re.compile(r"{{\s*([a-zA-Z0-9_]+)\s*}}")


def render_merge(template_text: str, fields: dict[str, Any]) -> str:
    """Substitute {{key}} placeholders. Missing keys render as {{?key?}}
    so HR can spot mismatches between the template and the form fields."""
    if not template_text:
        return ""

    def replace(m: re.Match) -> str:
        key = m.group(1)
        val = fields.get(key)
        if val is None or val == "":
            return f"{{{{?{key}?}}}}"
        if isinstance(val, datetime):
            return val.strftime("%B %d, %Y")
        return str(val)

    return _MERGE_TAG_RE.sub(replace, template_text)


def markdown_to_html(md: str) -> str:
    """Tiny Markdown → HTML for offer letters. Good enough for paragraphs,
    headings, lists, bold/italic — we don't accept user HTML so XSS is
    closed off. For richer rendering, wire `markdown` or `mistune` here.
    """
    if not md:
        return ""

    # Escape first, then apply our own markup transforms.
    text = _html.escape(md)

    # Headings (H1 H2 H3)
    text = re.sub(r"^### (.*)$", r"<h3>\1</h3>", text, flags=re.MULTILINE)
    text = re.sub(r"^## (.*)$", r"<h2>\1</h2>", text, flags=re.MULTILINE)
    text = re.sub(r"^# (.*)$", r"<h1>\1</h1>", text, flags=re.MULTILINE)

    # Bold / italic
    text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<em>\1</em>", text)

    # Bulleted lists (a single block of consecutive `- ` lines)
    def _ul(match: re.Match) -> str:
        items = re.findall(r"^- (.+)$", match.group(0), flags=re.MULTILINE)
        return "<ul>" + "".join(f"<li>{i}</li>" for i in items) + "</ul>"
    text = re.sub(r"(?:^- .+(?:\n|$))+", _ul, text, flags=re.MULTILINE)

    # Paragraphs: split on blank lines, wrap each in <p> unless it's
    # already a block element.
    blocks = re.split(r"\n\s*\n", text)
    parts: list[str] = []
    for b in blocks:
        b = b.strip()
        if not b:
            continue
        if b.startswith("<h") or b.startswith("<ul") or b.startswith("<ol") or b.startswith("<p"):
            parts.append(b)
        else:
            parts.append(f"<p>{b.replace(chr(10), '<br>')}</p>")
    return "\n".join(parts)


def wrap_html_document(body: str, title: str = "Offer Letter") -> str:
    """Wrap body HTML in a print-friendly full document. The rendered
    HTML doubles as the offer 'PDF' — Cmd-P → Save as PDF in any browser.
    """
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{_html.escape(title)}</title>
<style>
  body {{
    font-family: 'Georgia', 'Times New Roman', serif;
    color: #1e293b;
    line-height: 1.6;
    max-width: 740px;
    margin: 48px auto;
    padding: 0 32px;
    font-size: 14px;
  }}
  h1 {{ font-size: 22px; font-weight: 700; margin: 0 0 12px; }}
  h2 {{ font-size: 18px; font-weight: 700; margin: 24px 0 8px; }}
  h3 {{ font-size: 15px; font-weight: 700; margin: 18px 0 6px; text-transform: uppercase; letter-spacing: 0.06em; color: #475569; }}
  p {{ margin: 0 0 14px; }}
  ul {{ margin: 0 0 14px; padding-left: 24px; }}
  li {{ margin-bottom: 4px; }}
  hr.signature-divider {{ border: none; border-top: 1px solid #cbd5e1; margin: 48px 0 16px; }}
  .signature-block {{
    margin-top: 24px;
    padding: 16px;
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    font-family: 'system-ui', sans-serif;
    font-size: 13px;
  }}
  .signature-block .label {{
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #64748b;
    margin-bottom: 4px;
  }}
  .signature-block .name {{
    font-family: 'Caveat', 'Brush Script MT', cursive;
    font-size: 24px;
    color: #0f172a;
  }}
  @media print {{
    body {{ margin: 0; }}
    .signature-block {{ break-inside: avoid; }}
  }}
</style>
</head>
<body>
{body}
</body>
</html>"""


def render_offer(offer: Offer, template: Optional[OfferTemplate]) -> tuple[str, str]:
    """Build (rendered_markdown, rendered_html) using merge tags from the
    offer's structured fields plus any custom_fields_json overrides."""
    fields: dict[str, Any] = {
        "candidate_name": "",
        "salary_amount": offer.salary_amount or "",
        "salary_currency": offer.salary_currency or "USD",
        "salary": _format_salary(offer.salary_amount, offer.salary_currency),
        "bonus_amount": offer.bonus_amount or "",
        "bonus": _format_salary(offer.bonus_amount, offer.salary_currency),
        "equity": offer.equity_description or "",
        "employment_type": (offer.employment_type or "").replace("_", " ").title(),
        "start_date": offer.start_date.strftime("%B %d, %Y") if offer.start_date else "",
        "location": offer.location or "",
    }
    try:
        custom = json.loads(offer.custom_fields_json or "{}")
        if isinstance(custom, dict):
            fields.update(custom)
    except Exception:
        pass

    body_md = (template.body_markdown if template else "") or _DEFAULT_TEMPLATE
    rendered_md = render_merge(body_md, fields)
    body_html = markdown_to_html(rendered_md)
    full_html = wrap_html_document(body_html, title="Offer Letter")
    return rendered_md, full_html


def render_signed_html(offer: Offer) -> str:
    """The offer's HTML with a signature footer block. Stored on the
    offer at sign time so it's reproducible after the fact."""
    body_html = markdown_to_html(offer.rendered_markdown or "")
    sig_block = (
        '<hr class="signature-divider">'
        '<div class="signature-block">'
        '<div class="label">Electronically signed by</div>'
        f'<div class="name">{_html.escape(offer.signature_name or "Candidate")}</div>'
        '<div class="label" style="margin-top:12px;">Date</div>'
        f'<div>{(offer.signed_at or datetime.utcnow()).strftime("%B %d, %Y · %H:%M UTC")}</div>'
        + (
            f'<div class="label" style="margin-top:12px;">IP address</div>'
            f'<div>{_html.escape(offer.signature_ip)}</div>'
            if offer.signature_ip else ""
        )
        + "</div>"
    )
    return wrap_html_document(body_html + sig_block, title="Signed Offer Letter")


def _format_salary(amount: Optional[float], currency: Optional[str]) -> str:
    if amount is None:
        return ""
    sym = {"USD": "$", "EUR": "€", "GBP": "£", "INR": "₹", "SGD": "S$"}.get(
        (currency or "USD").upper(), (currency or "USD").upper() + " "
    )
    try:
        return f"{sym}{float(amount):,.0f}"
    except Exception:
        return f"{amount} {currency or ''}"


_DEFAULT_TEMPLATE = """# Offer of Employment

Dear {{candidate_name}},

We are delighted to offer you the position of **{{job_title}}** at our company. The terms of this offer are outlined below.

## Compensation

- **Base salary:** {{salary}} per year
- **Bonus:** {{bonus}}
- **Equity:** {{equity}}

## Role details

- **Employment type:** {{employment_type}}
- **Start date:** {{start_date}}
- **Location:** {{location}}

## Acceptance

This offer is contingent on successful completion of background checks and reference verification. Please review and sign below to indicate your acceptance.

We look forward to welcoming you to the team.

Sincerely,
The Hiring Team
"""


# ─── E-sign (mock provider) ──────────────────────────────────────────────────


class MockESignAdapter:
    """In-app signing flow. Generates a token-based URL the candidate
    opens to view + sign the offer. No external provider needed."""

    name = "mock"

    @staticmethod
    def create_envelope(offer: Offer) -> dict:
        token = secrets.token_urlsafe(24)
        offer.esign_provider = "mock"
        offer.esign_envelope_id = f"mock-{token[:8]}"
        offer.esign_signing_token = token
        return {
            "envelope_id": offer.esign_envelope_id,
            "signing_token": token,
        }

    @staticmethod
    def signing_url(offer: Offer, frontend_base: str) -> str:
        if not offer.esign_signing_token:
            return ""
        base = (frontend_base or "").rstrip("/")
        return f"{base}/offers/sign/{offer.esign_signing_token}" if base else f"/offers/sign/{offer.esign_signing_token}"


def get_adapter(provider: str = "mock"):
    """Pluggable e-sign adapter lookup. v1 only ships the mock adapter;
    DocuSign/HelloSign drop in here later."""
    return MockESignAdapter


# ─── Persistence helpers ─────────────────────────────────────────────────────


def offer_to_response(offer: Offer, *, signing_url: str = "") -> dict:
    try:
        custom = json.loads(offer.custom_fields_json or "{}")
    except Exception:
        custom = {}
    return {
        "id": offer.id,
        "application_id": offer.application_id,
        "candidate_id": offer.candidate_id,
        "template_id": offer.template_id,
        "salary_amount": offer.salary_amount,
        "salary_currency": offer.salary_currency or "USD",
        "bonus_amount": offer.bonus_amount,
        "equity_description": offer.equity_description or "",
        "employment_type": offer.employment_type or "full_time",
        "start_date": offer.start_date.isoformat() if offer.start_date else None,
        "location": offer.location or "",
        "custom_fields": custom,
        "status": offer.status,
        "esign_provider": offer.esign_provider or "mock",
        "esign_envelope_id": offer.esign_envelope_id or "",
        "signing_url": signing_url,
        "signature_name": offer.signature_name or "",
        "sent_at": offer.sent_at.isoformat() if offer.sent_at else None,
        "viewed_at": offer.viewed_at.isoformat() if offer.viewed_at else None,
        "signed_at": offer.signed_at.isoformat() if offer.signed_at else None,
        "expires_at": offer.expires_at.isoformat() if offer.expires_at else None,
        "declined_reason": offer.declined_reason or "",
        "created_at": offer.created_at.isoformat() if offer.created_at else None,
        "updated_at": offer.updated_at.isoformat() if offer.updated_at else None,
    }


def template_to_response(t: OfferTemplate) -> dict:
    try:
        fields = json.loads(t.fields_json or "[]")
    except Exception:
        fields = []
    try:
        approvers = json.loads(t.approval_chain_user_ids_json or "[]")
    except Exception:
        approvers = []
    return {
        "id": t.id,
        "name": t.name,
        "body_markdown": t.body_markdown or "",
        "fields": fields,
        "requires_approval": bool(t.requires_approval),
        "approval_chain_user_ids": approvers,
        "is_default": bool(t.is_default),
        "created_at": t.created_at.isoformat() if t.created_at else None,
        "updated_at": t.updated_at.isoformat() if t.updated_at else None,
    }


def default_template_body() -> str:
    """Exposed so the UI can pre-fill new template editors with a useful
    starting point instead of an empty textarea."""
    return _DEFAULT_TEMPLATE
