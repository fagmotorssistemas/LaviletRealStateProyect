from __future__ import annotations

from typing import Any

import cv2
import numpy as np


def contour_to_polygon(contour: np.ndarray, epsilon_ratio: float = 0.0035) -> list[list[int]]:
    """
    Aproxima el contorno preservando esquinas / chaflanes.
    epsilon bajo → sigue paredes irregulares (no rectángulo).
    """
    peri = cv2.arcLength(contour, True)
    # Clamp: no colapsar a 4 puntos en unidades grandes
    eps = max(1.2, min(peri * epsilon_ratio, peri * 0.012))
    approx = cv2.approxPolyDP(contour, eps, True)
    pts = approx.reshape(-1, 2)
    if len(pts) < 3:
        pts = contour.reshape(-1, 2)
    return [[int(x), int(y)] for x, y in pts]


def mask_to_outer_polygon(mask: np.ndarray, epsilon_ratio: float = 0.003) -> list[list[int]] | None:
    """Contorno exterior real de una máscara binaria (unidad completa)."""
    if mask is None or mask.size == 0:
        return None
    binary = (mask > 0).astype(np.uint8) * 255
    # Cerrar microagujeros de mobiliario sin redondear el perímetro exterior
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, k, iterations=1)
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return None
    contour = max(contours, key=cv2.contourArea)
    if cv2.contourArea(contour) < 50:
        return None
    return contour_to_polygon(contour, epsilon_ratio=epsilon_ratio)


def union_masks(masks: list[np.ndarray], shape: tuple[int, int]) -> np.ndarray:
    out = np.zeros(shape, dtype=np.uint8)
    for m in masks:
        if m is None:
            continue
        out = cv2.bitwise_or(out, (m > 0).astype(np.uint8) * 255)
    return out


def polygon_metrics(polygon: list[list[int]]) -> dict[str, Any]:
    if len(polygon) < 3:
        return {"area": 0.0, "bbox": {"x": 0, "y": 0, "width": 0, "height": 0}, "center": [0.0, 0.0]}
    arr = np.array(polygon, dtype=np.float32)
    area = float(abs(cv2.contourArea(arr)))
    xs = arr[:, 0]
    ys = arr[:, 1]
    x0, y0, x1, y1 = float(xs.min()), float(ys.min()), float(xs.max()), float(ys.max())
    m = cv2.moments(arr)
    if m["m00"] != 0:
        cx = float(m["m10"] / m["m00"])
        cy = float(m["m01"] / m["m00"])
    else:
        cx = float((x0 + x1) / 2)
        cy = float((y0 + y1) / 2)
    return {
        "area": area,
        "bbox": {"x": int(x0), "y": int(y0), "width": int(x1 - x0), "height": int(y1 - y0)},
        "center": [cx, cy],
    }


def solidity(polygon: list[list[int]]) -> float:
    """Área / área del convex hull. Esquinas chaflanadas siguen altas; blobs raros bajan."""
    if len(polygon) < 3:
        return 0.0
    arr = np.array(polygon, dtype=np.float32)
    area = abs(cv2.contourArea(arr))
    hull = cv2.convexHull(arr)
    hull_area = abs(cv2.contourArea(hull))
    if hull_area <= 1:
        return 0.0
    return float(area / hull_area)


def point_in_polygon(x: float, y: float, polygon: list[list[int]]) -> bool:
    return cv2.pointPolygonTest(np.array(polygon, dtype=np.float32), (x, y), False) >= 0


def attach_ocr_to_apartments(apartments: list[dict], labels: list[dict]) -> list[dict]:
    used: set[int] = set()
    for apt in apartments:
        poly = apt["polygon"]
        center = apt["center"]
        best_i = None
        best_score = -1.0
        for i, lab in enumerate(labels):
            if i in used:
                continue
            bx, by, bw, bh = lab["bbox"]
            lx = bx + bw / 2
            ly = by + bh / 2
            inside = point_in_polygon(lx, ly, poly)
            dist = ((lx - center[0]) ** 2 + (ly - center[1]) ** 2) ** 0.5
            score = (1000.0 if inside else 0.0) + max(0.0, 400.0 - dist) + lab.get("confidence", 0) * 50
            if score > best_score:
                best_score = score
                best_i = i
        if best_i is not None and best_score > 50:
            used.add(best_i)
            lab = labels[best_i]
            apt["id"] = lab["text"]
            apt["labelConfidence"] = lab.get("confidence", 0)
            apt["confidence"] = min(
                0.99,
                float(apt.get("confidence", 0.7)) * 0.55 + float(lab.get("confidence", 0.5)) * 0.45,
            )
            apt["needsReview"] = apt["confidence"] < 0.7

    sorted_apts = sorted(apartments, key=lambda a: (a["center"][1], a["center"][0]))
    n = 1
    for apt in sorted_apts:
        aid = str(apt.get("id", "")).strip()
        if not aid or aid.startswith("unit-") or aid.startswith("r") or aid.startswith("m"):
            apt["id"] = f"unit-{n:02d}"
            n += 1

    seen: set[str] = set()
    for apt in apartments:
        base = str(apt["id"])
        if base not in seen:
            seen.add(base)
            continue
        k = 2
        while f"{base}-{k}" in seen:
            k += 1
        apt["id"] = f"{base}-{k}"
        seen.add(apt["id"])
        apt["needsReview"] = True
    return apartments
