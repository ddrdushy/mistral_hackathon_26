"""Render each page of the candidate's CV with fraud signals overlaid.

Why this exists: HR was getting a list of fraud "evidence" snippets but
no way to see WHERE on the page each issue lived. With a real PDF
preview + colored bounding boxes, an HR reviewer can decide in seconds
whether a flag is a true adversarial injection or a false positive from
e.g. a styled sidebar.

Pure Python — uses pypdfium2 (Apache-2/BSD, bundles its own PDFium so
no system poppler needed) for rasterising the page, plus Pillow for
drawing rectangles + legend markers.
"""
from __future__ import annotations

import base64
import io
import json
import logging
from dataclasses import dataclass
from typing import List, Optional

logger = logging.getLogger("hireops.fraud_visualizer")

# Render at 1.7× PDF points so the page is readable on a typical
# dashboard column without producing 8 MB PNGs per page. Most CV PDFs
# are A4 → ~595×842 pt → 1011×1431 px at this scale.
RENDER_SCALE = 1.7

# Per-severity colour palette (Tailwind-ish for design consistency).
_SEVERITY_COLORS = {
    "critical": (220, 38, 38, 255),    # red-600
    "high":     (234, 88, 12, 255),    # orange-600
    "medium":   (234, 179, 8, 255),    # yellow-500
    "low":      (37, 99, 235, 255),    # blue-600
}
_FALLBACK_COLOR = (100, 116, 139, 255)  # slate-500
_FILL_ALPHA = 60  # 0-255 — translucent rectangle fill

# Signal types whose evidence carries a `bbox` we can draw. Anything
# else (prompt_injection on the text stream, generic warnings) is
# listed in the sidebar but doesn't get a page overlay.
DRAWABLE_SIGNAL_TYPES = {
    "hidden_text_color",
    "microtext",
    "offpage_text",
    "invisible_unicode",
}


@dataclass
class PageRender:
    page: int
    width_px: int
    height_px: int
    image_b64: str           # PNG, base64-encoded for direct <img src=...> use
    signal_markers: list[dict]  # which signals are drawn on THIS page


def render_annotated_pages(
    pdf_bytes: bytes,
    signals: list[dict],
) -> List[PageRender]:
    """Rasterise each page of `pdf_bytes` at RENDER_SCALE and draw each
    signal's bbox on the page it belongs to. Signals without a usable
    bbox/page (e.g. text-stream prompt_injection hits) are skipped here
    and surfaced separately by the caller.

    `signals` must each look like {signal_type, severity, evidence: {page, bbox: [x0,y0,x1,y1], ...}}
    — i.e. the same shape returned by `GET /applications/{id}/fraud-signals`.
    """
    if not pdf_bytes:
        return []

    try:
        import pypdfium2 as pdfium
        from PIL import Image, ImageDraw, ImageFont
    except ImportError as e:
        logger.warning("fraud_visualizer: missing dependency: %s", e)
        return []

    # Group signals by page so we only loop the PDF once.
    by_page: dict[int, list[dict]] = {}
    for s in signals or []:
        if s.get("signal_type") not in DRAWABLE_SIGNAL_TYPES:
            continue
        ev = s.get("evidence") or {}
        page_num = ev.get("page")
        bbox = ev.get("bbox")
        if not isinstance(page_num, int) or not isinstance(bbox, (list, tuple)) or len(bbox) != 4:
            continue
        by_page.setdefault(page_num, []).append(s)

    try:
        doc = pdfium.PdfDocument(pdf_bytes)
    except Exception as e:
        logger.warning("fraud_visualizer: failed to open PDF: %s", e)
        return []

    out: List[PageRender] = []
    try:
        for idx, page in enumerate(doc, start=1):
            try:
                pil_img = page.render(scale=RENDER_SCALE).to_pil().convert("RGBA")
            except Exception as e:
                logger.warning("fraud_visualizer: render failed for page %s: %s", idx, e)
                continue

            page_signals = by_page.get(idx, [])
            markers: list[dict] = []

            if page_signals:
                overlay = Image.new("RGBA", pil_img.size, (0, 0, 0, 0))
                draw = ImageDraw.Draw(overlay)

                # 1-based marker so HR can map a sidebar item to a page box.
                for i, s in enumerate(page_signals, start=1):
                    ev = s.get("evidence") or {}
                    x0, y0, x1, y1 = ev["bbox"]
                    rect = (
                        x0 * RENDER_SCALE,
                        y0 * RENDER_SCALE,
                        x1 * RENDER_SCALE,
                        y1 * RENDER_SCALE,
                    )
                    color = _SEVERITY_COLORS.get(s.get("severity", "medium"), _FALLBACK_COLOR)
                    fill = (color[0], color[1], color[2], _FILL_ALPHA)
                    draw.rectangle(rect, fill=fill, outline=color, width=3)

                    # Marker pill: number anchored at the rect's top-left.
                    badge = str(i)
                    bx0 = max(0, rect[0] - 2)
                    by0 = max(0, rect[1] - 18)
                    badge_w = 10 + 8 * len(badge)
                    draw.rectangle(
                        (bx0, by0, bx0 + badge_w, by0 + 16),
                        fill=color,
                    )
                    try:
                        font = ImageFont.load_default()
                        draw.text((bx0 + 5, by0 + 2), badge, fill=(255, 255, 255, 255), font=font)
                    except Exception:
                        pass

                    markers.append({
                        "marker": i,
                        "signal_id": s.get("id"),
                        "signal_type": s.get("signal_type"),
                        "severity": s.get("severity"),
                        "bbox_px": [round(v, 2) for v in rect],
                        "evidence_text": (ev.get("text") or ev.get("matched") or "")[:200],
                    })

                pil_img = Image.alpha_composite(pil_img, overlay)

            buf = io.BytesIO()
            pil_img.convert("RGB").save(buf, format="PNG", optimize=True)
            png_b64 = base64.b64encode(buf.getvalue()).decode("ascii")

            out.append(PageRender(
                page=idx,
                width_px=pil_img.size[0],
                height_px=pil_img.size[1],
                image_b64=png_b64,
                signal_markers=markers,
            ))
    finally:
        doc.close()

    return out


def render_to_dicts(pdf_bytes: bytes, signals: list[dict]) -> list[dict]:
    """Convenience wrapper for the FastAPI layer."""
    return [
        {
            "page": p.page,
            "width_px": p.width_px,
            "height_px": p.height_px,
            "image_b64": p.image_b64,
            "signal_markers": p.signal_markers,
        }
        for p in render_annotated_pages(pdf_bytes, signals)
    ]
