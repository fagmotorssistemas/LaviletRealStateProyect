from __future__ import annotations

import re
from typing import Any

import cv2
import numpy as np

# 34-01, 209, 3A, A-12, DEP-3, U-01
LABEL_RE = re.compile(
    r"^(?:"
    r"\d{1,2}[-–]\d{1,3}"
    r"|[A-Z]\-?\d{1,3}"
    r"|\d{1,2}[A-Z]"
    r"|DEP[-_]?\d{1,3}"
    r"|U[-_]?\d{1,3}"
    r"|\d{2,4}"
    r")$",
    re.IGNORECASE,
)


def _normalize_text(text: str) -> str | None:
    cleaned = text.strip().replace(" ", "").replace("–", "-").upper()
    if not cleaned:
        return None
    if LABEL_RE.match(cleaned):
        return cleaned
    # Buscar subcadena útil
    m = re.search(r"(\d{1,2}[-–]\d{1,3}|\d{2,4}|[A-Z]\d{1,3})", cleaned, re.I)
    if m:
        return m.group(1).replace("–", "-").upper()
    return None


def extract_labels(bgr: np.ndarray) -> list[dict[str, Any]]:
    """OCR de etiquetas de depto. Sin Tesseract → []."""
    try:
        import pytesseract
        from pytesseract import Output
    except Exception:
        return []

    try:
        gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
        scale = 2.0 if max(gray.shape) < 1600 else 1.5 if max(gray.shape) < 2200 else 1.0
        if scale != 1.0:
            gray = cv2.resize(gray, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
        # Mejor contraste para números sobre renders
        thr = cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 11)
        data = pytesseract.image_to_data(
            thr,
            output_type=Output.DICT,
            config="--psm 11 -c tessedit_char_whitelist=0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-",
        )
    except Exception:
        return []

    labels: list[dict[str, Any]] = []
    n = len(data.get("text", []))
    for i in range(n):
        raw = str(data["text"][i] or "").strip()
        cleaned = _normalize_text(raw)
        if not cleaned:
            continue
        try:
            conf = float(data["conf"][i]) / 100.0
        except Exception:
            conf = 0.0
        if conf < 0.30:
            continue
        x = int(data["left"][i] / scale)
        y = int(data["top"][i] / scale)
        bw = int(data["width"][i] / scale)
        bh = int(data["height"][i] / scale)
        cx = x + bw / 2
        cy = y + bh / 2
        labels.append(
            {
                "text": cleaned,
                "confidence": round(max(0.0, min(1.0, conf)), 3),
                "bbox": [x, y, bw, bh],
                "center": [cx, cy],
            }
        )

    # Deduplicar
    out: list[dict[str, Any]] = []
    for lab in labels:
        dup = False
        for prev in out:
            if prev["text"] != lab["text"]:
                continue
            pc, lc = prev["center"], lab["center"]
            if abs(pc[0] - lc[0]) < 50 and abs(pc[1] - lc[1]) < 50:
                dup = True
                if lab["confidence"] > prev["confidence"]:
                    prev.update(lab)
                break
        if not dup:
            out.append(lab)
    return out
