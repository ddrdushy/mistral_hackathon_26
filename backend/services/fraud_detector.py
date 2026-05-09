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

                # 1. White-on-white / colour-too-close-to-white text
                if color is not None and _color_distance(color, _WHITE) < 0.10:
                    signals.append(FraudSignal(
                        signal_type="hidden_text_color",
                        severity="critical",
                        evidence={
                            "text": text[:240],
                            "font_color": _rgb_to_hex(color),
                            "bg_color": "#FFFFFF",
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
