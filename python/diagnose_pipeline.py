"""Diagnóstico opencv-v3 (unidades completas)."""

from __future__ import annotations

import json
from pathlib import Path

import cv2
import numpy as np

from corridor_detector import detect_corridor_band
from door_detector import exterior_mask_from_border
from image_processor import preprocess
from ocr import extract_labels
from unit_segmenter import segment_units
from wall_detector import detect_walls

ROOT = Path(__file__).resolve().parents[1]
OUT = Path(__file__).resolve().parent / "_debug"
OUT.mkdir(exist_ok=True)


def run_one(name: str, bgr: np.ndarray) -> dict:
    h, w = bgr.shape[:2]
    meta = {"width": w, "height": h}
    processed = preprocess(bgr)
    walls = detect_walls(processed)
    corridor = detect_corridor_band(processed, walls)
    open_space = walls["open_space"].copy()
    if corridor is not None:
        open_space[corridor["mask"] > 0] = 0
    exterior = exterior_mask_from_border(open_space, processed["denoised"])
    labels = extract_labels(bgr)
    apartments, common = segment_units(processed, walls, corridor, exterior, labels, meta)

    overlay = bgr.copy()
    colors = [
        (60, 60, 220),
        (60, 180, 80),
        (220, 140, 40),
        (200, 60, 200),
        (40, 200, 200),
        (80, 120, 230),
        (180, 100, 40),
        (120, 200, 140),
        (40, 90, 200),
        (90, 200, 90),
    ]
    for i, apt in enumerate(apartments):
        pts = np.array(apt["polygon"], dtype=np.int32)
        color = colors[i % len(colors)]
        layer = overlay.copy()
        cv2.fillPoly(layer, [pts], color)
        cv2.addWeighted(layer, 0.28, overlay, 0.72, 0, overlay)
        cv2.polylines(overlay, [pts], True, color, 2, cv2.LINE_AA)
        cx, cy = map(int, apt["center"])
        cv2.putText(overlay, apt["id"], (cx - 24, cy), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (20, 20, 20), 2, cv2.LINE_AA)
        cv2.putText(overlay, apt["id"], (cx - 24, cy), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1, cv2.LINE_AA)

    cv2.imwrite(str(OUT / f"{name}_overlay.png"), overlay)
    cv2.imwrite(str(OUT / f"{name}_walls.png"), walls["walls"])

    verts = [len(a["polygon"]) for a in apartments]
    summary = {
        "name": name,
        "size": [w, h],
        "pipeline": "opencv-v3-unit-seed",
        "wallMode": walls.get("mode"),
        "labels": len(labels),
        "apartments": len(apartments),
        "common": len(common),
        "ids": [a["id"] for a in apartments],
        "areas": [int(a["area"]) for a in apartments],
        "vertexCounts": verts,
        "avgVertices": round(sum(verts) / len(verts), 1) if verts else 0,
        "rectLike": sum(1 for v in verts if v <= 4),
        "needsReview": sum(1 for a in apartments if a.get("needsReview")),
    }
    (OUT / f"{name}_summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))
    return summary


def make_cad_like(bgr: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    inv = 255 - gray
    edges = cv2.Canny(gray, 60, 150)
    cad = cv2.cvtColor(inv, cv2.COLOR_GRAY2BGR)
    cad[edges > 0] = (20, 20, 20)
    return cad


def main() -> None:
    src = ROOT / "public" / "plano-piso.jpg"
    bgr = cv2.imread(str(src))
    run_one("v3_render", bgr)
    run_one("v3_cad", make_cad_like(bgr))
    print(f"\nDebug -> {OUT}")


if __name__ == "__main__":
    main()
