"""Resume fraud detector — Feature 1 of ENTERPRISE_FEATURES.md.

Catches the common adversarial CV patterns:
  - hidden_text_color  : font colour ~= page bg (white-on-white injection)
  - microtext          : font size <4pt (visually invisible at normal zoom)
  - offpage_text       : text positioned outside the page bbox
  - prompt_injection   : prose patterns telling the LLM to override its rules

PDF parsing uses pdfplumber (MIT licence) — pymupdf is AGPL and was
flagged in the spec. python-docx covers .docx. Anything else (.txt,
.tex) only gets the prompt-injection scan since structural attributes
don't apply.

Each signal carries an evidence dict so HR can see the exact snippet
that triggered the flag. Severity feeds Application.fraud_score:
critical=40, high=20, medium=10, low=5 — summed and capped at 100.
"""
from __future__ import annotations

import io
import json
import logging
import re
from dataclasses import dataclass, asdict
from typing import List, Optional, Tuple

logger = logging.getLogger("hireops.fraud_detector")

SignalSeverity = str  # "low" | "medium" | "high" | "critical"
SignalType = str  # see module docstring

_SEVERITY_WEIGHTS = {"critical": 40, "high": 20, "medium": 10, "low": 5}


@dataclass
class FraudSignal:
    signal_type: SignalType
    severity: SignalSeverity
    evidence: dict


# ─── Public API ──────────────────────────────────────────────────────────────


def detect_fraud(filename: str, file_bytes: bytes) -> List[FraudSignal]:
    """Dispatch to the right detector for the file type. Always also runs
    the prompt-injection scan over the extracted text."""
    if not file_bytes:
        return []
    name = (filename or "").lower()
    signals: List[FraudSignal] = []
    extracted_text = ""

    try:
        if name.endswith(".pdf"):
            signals, extracted_text = _detect_in_pdf(file_bytes)
        elif name.endswith((".docx", ".doc")):
            signals, extracted_text = _detect_in_docx(file_bytes)
        else:
            # txt / tex / unknown — best-effort decode for text scan.
            extracted_text = _safe_decode(file_bytes)
    except Exception as e:
        logger.warning("Structural fraud detection failed for %s: %s", filename, e)
        # Don't fail the upload over a parser hiccup; fall through to
        # prompt-injection scan on whatever text we already have.

    if extracted_text:
        signals.extend(_scan_prompt_injection(extracted_text))
        signals.extend(_scan_invisible_unicode(extracted_text))

    return _dedupe(signals)


def compute_fraud_score(signals: List[FraudSignal]) -> int:
    """0-100; higher = more suspicious. Capped at 100."""
    return min(100, sum(_SEVERITY_WEIGHTS.get(s.severity, 0) for s in signals))


def to_evidence_json(signal: FraudSignal) -> str:
    return json.dumps(signal.evidence, default=str)


def signal_to_dict(signal: FraudSignal) -> dict:
    return {
        "signal_type": signal.signal_type,
        "severity": signal.severity,
        "evidence": signal.evidence,
    }


# ─── PDF ─────────────────────────────────────────────────────────────────────


def _detect_in_pdf(pdf_bytes: bytes) -> Tuple[List[FraudSignal], str]:
    try:
        import pdfplumber  # MIT
    except ImportError:
        logger.warning("pdfplumber not installed — skipping structural PDF scan")
        # Best-effort text extraction so the prompt-injection scan still runs.
        return [], _pypdf_fallback_text(pdf_bytes)

    signals: List[FraudSignal] = []
    text_parts: list[str] = []

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page_num, page in enumerate(pdf.pages, start=1):
            page_text = page.extract_text() or ""
            text_parts.append(page_text)

            page_w = page.width
            page_h = page.height

            # Collect filled background rectangles so we can tell "white text
            # on a dark sidebar" (legit — many LinkedIn / Enhancv templates
            # do this) from "white text on the default white page" (which is
            # the classic hidden-injection trick).
            bg_rects = _collect_filled_rects(page)

            # pdfplumber gives per-character attributes including non_stroking_color
            # (font colour) and size + bbox. We aggregate consecutive characters
            # with matching style into "runs" so evidence snippets are readable.
            chars = getattr(page, "chars", []) or []
            for run in _group_chars_into_runs(chars):
                text = run["text"].strip()
                if not text:
                    continue
                color = run["color"]
                size = run["size"]
                bbox = run["bbox"]  # x0, y0, x1, y1

                # 1. White-on-white / colour-too-close-to-white text.
                # Only flag when the actual surrounding background is also
                # near-white. A white-text run sitting inside a dark filled
                # rectangle is perfectly visible and legitimate.
                if color is not None and _color_distance(color, _WHITE) < 0.10:
                    effective_bg = _effective_background_color(bbox, bg_rects)
                    if _color_distance(color, effective_bg) < 0.15:
                        signals.append(FraudSignal(
                            signal_type="hidden_text_color",
                            severity="critical",
                            evidence={
                                "text": text[:240],
                                "font_color": _rgb_to_hex(color),
                                "bg_color": _rgb_to_hex(effective_bg),
                                "page": page_num,
                                "bbox": list(bbox),
                            },
                        ))

                # 2. Microtext (<4pt is invisible at 100% zoom on most monitors)
                if size is not None and size < 4.0 and len(text) >= 8:
                    signals.append(FraudSignal(
                        signal_type="microtext",
                        severity="high",
                        evidence={
                            "text": text[:240],
                            "font_size": round(float(size), 2),
                            "page": page_num,
                            "bbox": list(bbox),
                        },
                    ))

                # 3. Off-page text (positioned outside the page bbox)
                if (
                    bbox[2] < 0 or bbox[0] > page_w
                    or bbox[3] < 0 or bbox[1] > page_h
                ):
                    signals.append(FraudSignal(
                        signal_type="offpage_text",
                        severity="high",
                        evidence={
                            "text": text[:240],
                            "bbox": list(bbox),
                            "page_width": page_w,
                            "page_height": page_h,
                            "page": page_num,
                        },
                    ))

    return signals, "\n".join(text_parts)


def _collect_filled_rects(page) -> list[dict]:
    """Return all filled rectangles on the page with their fill colour.

    pdfplumber exposes both `rects` (vector rectangles) and the broader
    `figures`/`curves` set. For background detection we want the larger
    filled boxes (LinkedIn sidebars, header banners, callout cards).
    Tiny rects (icons, bullets) are filtered out.
    """
    out: list[dict] = []
    candidates = list(getattr(page, "rects", []) or [])
    # Some PDFs render the sidebar as a wide vector path rather than a
    # true rect; pdfplumber surfaces those under `curves`. Include any
    # large filled curve too.
    candidates.extend(getattr(page, "curves", []) or [])

    for r in candidates:
        # Skip purely-stroked outlines — those don't paint the area.
        if not r.get("fill", False) and r.get("non_stroking_color") is None:
            continue
        try:
            x0 = float(r.get("x0", 0))
            x1 = float(r.get("x1", 0))
            top = float(r.get("top", 0))
            bottom = float(r.get("bottom", 0))
            w = max(0.0, x1 - x0)
            h = max(0.0, bottom - top)
        except (TypeError, ValueError):
            continue
        # Ignore stamps smaller than ~10x10 pt; those are icons, not bg.
        if w < 10 or h < 10:
            continue

        color = _normalise_pdfplumber_color(r.get("non_stroking_color"))
        if color is None:
            continue
        out.append({
            "bbox": (x0, top, x1, bottom),
            "area": w * h,
            "color": color,
        })

    # Larger rectangles painted first should be "below" later ones in the
    # z-order. pdfplumber preserves draw order — keep it as-is.
    return out


def _effective_background_color(
    text_bbox: tuple[float, float, float, float],
    bg_rects: list[dict],
) -> Tuple[float, float, float]:
    """Find the smallest rect that fully contains the text bbox and return
    its fill colour. Defaults to white (the page canvas) when nothing
    underlays the text — that's the implicit Acrobat background."""
    tx0, ty0, tx1, ty1 = text_bbox
    containing = []
    for r in bg_rects:
        rx0, ry0, rx1, ry1 = r["bbox"]
        if rx0 <= tx0 and ry0 <= ty0 and rx1 >= tx1 and ry1 >= ty1:
            containing.append(r)
    if not containing:
        return _WHITE
    # Use the smallest containing rect — that's the most-local background
    # the text sits on top of.
    smallest = min(containing, key=lambda r: r["area"])
    return smallest["color"]


def _group_chars_into_runs(chars: list[dict]) -> list[dict]:
    """Collapse adjacent same-style chars into runs so evidence snippets
    are human-readable and don't fire one signal per character.

    pdfplumber char dict keys: text, size, fontname, x0, x1, top, bottom,
    non_stroking_color (the fill colour, normalised 0-1 tuple OR int).
    """
    runs: list[dict] = []
    current: Optional[dict] = None
    for ch in chars:
        text = ch.get("text", "")
        if not text:
            continue
        color = _normalise_pdfplumber_color(ch.get("non_stroking_color"))
        size = ch.get("size")
        bbox = (ch["x0"], ch["top"], ch["x1"], ch["bottom"])
        key = (round(size or 0, 2), _rgb_to_hex(color) if color else None)

        if (
            current
            and current["key"] == key
            and bbox[1] <= current["bbox"][3] + 2  # same line-ish
            and bbox[0] - current["bbox"][2] < 5   # adjacent x
        ):
            current["text"] += text
            current["bbox"] = (
                min(current["bbox"][0], bbox[0]),
                min(current["bbox"][1], bbox[1]),
                max(current["bbox"][2], bbox[2]),
                max(current["bbox"][3], bbox[3]),
            )
        else:
            if current and current["text"].strip():
                runs.append(current)
            current = {
                "text": text,
                "size": size,
                "color": color,
                "bbox": bbox,
                "key": key,
            }
    if current and current["text"].strip():
        runs.append(current)
    return runs


def _normalise_pdfplumber_color(raw) -> Optional[Tuple[float, float, float]]:
    """pdfplumber colours can be: None, scalar grey [0..1], 3-tuple RGB
    [0..1], 4-tuple CMYK. Normalise to RGB-tuple in [0..1] or None."""
    if raw is None:
        return None
    if isinstance(raw, (int, float)):
        v = max(0.0, min(1.0, float(raw)))
        return (v, v, v)
    if isinstance(raw, (list, tuple)):
        if len(raw) == 1:
            v = max(0.0, min(1.0, float(raw[0])))
            return (v, v, v)
        if len(raw) >= 3:
            try:
                return tuple(max(0.0, min(1.0, float(x))) for x in raw[:3])  # type: ignore[return-value]
            except (TypeError, ValueError):
                return None
    return None


_WHITE = (1.0, 1.0, 1.0)


def _color_distance(a: Tuple[float, float, float], b: Tuple[float, float, float]) -> float:
    """Euclidean distance in 0..1 RGB space. Range ~ 0..1.732."""
    return ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2) ** 0.5


def _rgb_to_hex(c: Tuple[float, float, float]) -> str:
    r, g, b = (int(round(x * 255)) for x in c)
    return f"#{r:02X}{g:02X}{b:02X}"


def _pypdf_fallback_text(pdf_bytes: bytes) -> str:
    try:
        from PyPDF2 import PdfReader
        reader = PdfReader(io.BytesIO(pdf_bytes))
        return "\n".join((p.extract_text() or "") for p in reader.pages)
    except Exception:
        return ""


# ─── DOCX ────────────────────────────────────────────────────────────────────


def _detect_in_docx(docx_bytes: bytes) -> Tuple[List[FraudSignal], str]:
    try:
        from docx import Document
    except ImportError:
        return [], _safe_decode(docx_bytes)

    signals: List[FraudSignal] = []
    text_parts: list[str] = []
    doc = Document(io.BytesIO(docx_bytes))

    for para in doc.paragraphs:
        text_parts.append(para.text)
        for run in para.runs:
            text = run.text.strip()
            if not text:
                continue

            # Colour: docx exposes RGBColor with .rgb attribute. Default
            # bg assumption is white (theme bg detection is out of scope
            # for v1; flagged in spec).
            color_hex: Optional[str] = None
            try:
                color = run.font.color.rgb if run.font.color else None
                if color:
                    color_hex = str(color).upper()
                    if color_hex.startswith("0X"):
                        color_hex = color_hex[2:]
            except Exception:
                color_hex = None

            if color_hex and color_hex in {"FFFFFF", "FFFFFE", "FEFEFE", "FFFEFE"}:
                signals.append(FraudSignal(
                    signal_type="hidden_text_color",
                    severity="critical",
                    evidence={
                        "text": text[:240],
                        "font_color": f"#{color_hex}",
                        "bg_color": "#FFFFFF",
                    },
                ))

            # Microtext
            try:
                if run.font.size and run.font.size.pt < 4.0 and len(text) >= 8:
                    signals.append(FraudSignal(
                        signal_type="microtext",
                        severity="high",
                        evidence={
                            "text": text[:240],
                            "font_size": float(run.font.size.pt),
                        },
                    ))
            except Exception:
                pass

    return signals, "\n".join(text_parts)


# ─── Prompt injection ────────────────────────────────────────────────────────


_INJECTION_PATTERNS = [
    (r"ignore\s+(the\s+|all\s+|previous\s+|prior\s+|above\s+)?(instructions|rules|prompts|system\s+prompt)", "critical"),
    (r"disregard\s+(the\s+|any\s+|all\s+|previous\s+)(instructions|prompt|rules)", "critical"),
    (r"you\s+are\s+now\s+(a\s+|an\s+)?(recruiter|hiring\s+manager|hr|admin|assistant)", "critical"),
    (r"(rate|score|grade|return)\s+(this\s+|the\s+)?candidate\s+(100|10/10|highest|perfect|a\s+10)", "critical"),
    (r"system\s*[:>]\s*", "high"),
    (r"</?\s*(prompt|system|instruction|admin)\s*>", "critical"),
    (r"the\s+(above|previous)\s+(text|instructions|content)\s+is\s+(false|wrong|invalid|a\s+test)", "high"),
    (r"output\s*[:=]\s*\{[^}]*recommendation[^}]*\}", "critical"),
    (r"\[?\s*assistant\s*\]?\s*[:>]", "medium"),
    (r"hidden\s+(message|instruction|prompt)\s+(to|for)\s+(the\s+)?(recruiter|hr|llm|ai|model)", "critical"),
]


# Invisible / zero-width Unicode characters. None of these have any
# legitimate use in a resume — they're injection vehicles (hidden
# instructions, watermark removal, fingerprinting). A few legit
# characters that DO appear in valid CVs (regular space, NBSP  ,
# tab) are excluded.
_INVISIBLE_CODEPOINTS = {
    "​": "zero-width space",
    "‌": "zero-width non-joiner",
    "‍": "zero-width joiner",
    "⁠": "word joiner",
    "﻿": "byte-order mark / zero-width no-break",
    "‪": "left-to-right embedding",
    "‫": "right-to-left embedding",
    "‬": "pop directional formatting",
    "‭": "left-to-right override",
    "‮": "right-to-left override",
    "᠎": "Mongolian vowel separator",
    "͏": "combining grapheme joiner",
}


def _scan_invisible_unicode(text: str) -> List[FraudSignal]:
    """Flag zero-width / direction-override characters that the LLM
    will still 'read' but a human reviewing the PDF can't see.

    Most LLMs treat these characters as semantically meaningful tokens,
    which lets an attacker smuggle instructions that look like an
    innocuous bullet point to a human reviewer.
    """
    if not text:
        return []
    findings: dict[str, dict] = {}
    for i, ch in enumerate(text):
        if ch in _INVISIBLE_CODEPOINTS:
            label = _INVISIBLE_CODEPOINTS[ch]
            entry = findings.setdefault(label, {"count": 0, "codepoint": f"U+{ord(ch):04X}", "first_idx": i})
            entry["count"] += 1
    if not findings:
        return []
    return [
        FraudSignal(
            signal_type="invisible_unicode",
            # Multiple invisible chars in one document is a strong signal.
            severity="high" if sum(f["count"] for f in findings.values()) >= 5 else "medium",
            evidence={
                "characters_found": [
                    {"name": k, "codepoint": v["codepoint"], "count": v["count"]}
                    for k, v in findings.items()
                ],
                "total_count": sum(f["count"] for f in findings.values()),
            },
        )
    ]


def _scan_prompt_injection(text: str) -> List[FraudSignal]:
    if not text:
        return []
    signals: List[FraudSignal] = []
    seen: set[str] = set()  # dedupe identical matches
    for pattern, severity in _INJECTION_PATTERNS:
        for m in re.finditer(pattern, text, re.IGNORECASE):
            matched = m.group(0).strip()
            key = matched.lower()
            if key in seen:
                continue
            seen.add(key)
            start = max(0, m.start() - 60)
            end = min(len(text), m.end() + 60)
            signals.append(FraudSignal(
                signal_type="prompt_injection",
                severity=severity,
                evidence={
                    "matched": matched[:160],
                    "snippet": text[start:end].replace("\n", " "),
                },
            ))
    return signals


# ─── Helpers ─────────────────────────────────────────────────────────────────


def _safe_decode(b: bytes) -> str:
    for enc in ("utf-8", "latin-1"):
        try:
            return b.decode(enc)
        except Exception:
            continue
    return ""


def _dedupe(signals: List[FraudSignal]) -> List[FraudSignal]:
    """Drop near-identical signals so HR sees one row per real issue."""
    out: list[FraudSignal] = []
    seen: set[str] = set()
    for s in signals:
        key = f"{s.signal_type}|{json.dumps(s.evidence, sort_keys=True, default=str)[:200]}"
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
    return out
