from __future__ import annotations

from typing import Any

import numpy as np

from geometry import mask_to_outer_polygon, polygon_metrics, solidity


def _is_corridor_like(region: dict, image_w: int, image_h: int, corridor: dict | None) -> bool:
    bbox = region["bbox"]
    aspect = region["aspect"]
    # Franjas muy delgadas
    if aspect > 6 and bbox["height"] < image_h * 0.12:
        return True
    if aspect < 0.16 and bbox["width"] < image_w * 0.12:
        return True
    if region.get("source") == "party_walls":
        return False
    if corridor and corridor.get("orient") == "h":
        cy = region["center"][1]
        if corridor["y0"] - 4 <= cy <= corridor["y1"] + 4:
            return True
    return False


def _is_core_like(region: dict, image_w: int, image_h: int) -> bool:
    if region.get("source") == "party_walls":
        # En pipeline de medianeras el núcleo ya se excluye por core_end
        return False
    cx = region["center"][0]
    bbox = region["bbox"]
    area_ratio = region["area"] / max(1.0, float(image_w * image_h))
    if area_ratio > 0.045:
        return False
    near_left = cx < image_w * 0.15 or bbox["x"] + bbox["width"] < image_w * 0.14
    compact = 0.5 < region["aspect"] < 2.2
    return bool(near_left and compact and area_ratio < 0.04)


def _is_exterior_like(region: dict, image_w: int, image_h: int) -> bool:
    bbox = region["bbox"]
    area_ratio = region["area"] / max(1.0, float(image_w * image_h))
    touches = (
        bbox["x"] <= 2
        or bbox["y"] <= 2
        or bbox["x"] + bbox["width"] >= image_w - 2
        or bbox["y"] + bbox["height"] >= image_h - 2
    )
    if region.get("source") == "party_walls":
        return False
    if touches and area_ratio > 0.08 and region.get("solidity", 1) < 0.5:
        return True
    if touches and bbox["height"] < image_h * 0.06 and bbox["width"] > image_w * 0.5:
        return True
    if touches and bbox["width"] < image_w * 0.06 and bbox["height"] > image_h * 0.4:
        return True
    return False


def _corner_boost(region: dict, image_w: int, image_h: int) -> float:
    bbox = region["bbox"]
    verts = len(region.get("polygon") or [])
    near_left = bbox["x"] < image_w * 0.12
    near_right = bbox["x"] + bbox["width"] > image_w * 0.88
    near_top = bbox["y"] < image_h * 0.15
    near_bot = bbox["y"] + bbox["height"] > image_h * 0.85
    edges = sum([near_left, near_right, near_top, near_bot])
    if edges >= 2 and verts >= 5:
        return 0.07
    if edges >= 1 and verts >= 6:
        return 0.04
    return 0.0


def detect_apartments(
    processed: dict[str, np.ndarray],
    walls: dict[str, np.ndarray],
    regions: list[dict],
    meta: dict,
    corridor: dict | None = None,
) -> tuple[list[dict], list[dict]]:
    w = int(meta["width"])
    h = int(meta["height"])
    image_area = float(w * h)

    common: list[dict] = []
    candidates: list[dict] = []

    for region in regions:
        kind = "apartment"
        conf = 0.78 if region.get("source") == "party_walls" else 0.7

        if _is_corridor_like(region, w, h, corridor):
            kind = "corridor"
            conf = 0.84
        elif _is_core_like(region, w, h):
            kind = "core"
            conf = 0.8
        elif _is_exterior_like(region, w, h):
            kind = "exterior"
            conf = 0.5
        elif region["area"] < image_area * 0.005:
            kind = "noise"
            conf = 0.3

        conf += _corner_boost(region, w, h)
        if region.get("solidity", 1) >= 0.55 and kind == "apartment":
            conf += 0.03

        item = {
            **region,
            "kind": kind,
            "confidence": float(min(0.97, conf)),
            "needsReview": conf < 0.7,
        }
        if kind == "apartment":
            candidates.append(item)
        elif kind in {"corridor", "core"}:
            common.append(
                {
                    "id": region["id"],
                    "type": kind,
                    "polygon": region["polygon"],
                    "bbox": region["bbox"],
                    "center": region["center"],
                    "confidence": conf,
                }
            )

    # Patrón repetitivo
    if len(candidates) >= 4:
        widths = sorted(c["bbox"]["width"] for c in candidates)
        median_w = widths[len(widths) // 2]
        for c in candidates:
            if abs(c["bbox"]["width"] - median_w) < median_w * 0.45:
                c["confidence"] = min(0.97, float(c["confidence"]) + 0.05)
            c["needsReview"] = float(c["confidence"]) < 0.7

    candidates.sort(key=lambda c: (round(c["center"][1] / max(1, h / 3)), c["center"][0]))

    # Filtrar fragmentos muy chicos respecto a la mediana (over-split de habitaciones)
    if len(candidates) >= 4:
        areas = sorted(float(c["area"]) for c in candidates)
        median_a = areas[len(areas) // 2]
        candidates = [c for c in candidates if float(c["area"]) >= median_a * 0.35]

    apartments: list[dict[str, Any]] = []
    for i, c in enumerate(candidates, start=1):
        poly = c.get("polygon")
        if c.get("mask") is not None:
            rebuilt = mask_to_outer_polygon(c["mask"], epsilon_ratio=0.0024)
            if rebuilt and len(rebuilt) >= 3:
                poly = rebuilt
        if not poly or len(poly) < 3:
            continue
        metrics = polygon_metrics(poly)
        apartments.append(
            {
                "id": f"unit-{i:02d}",
                "polygon": poly,
                "bbox": metrics["bbox"],
                "center": [float(metrics["center"][0]), float(metrics["center"][1])],
                "area": float(metrics["area"]),
                "confidence": float(c.get("confidence", 0.7)),
                "needsReview": bool(c.get("needsReview", False)),
                "vertexCount": len(poly),
                "solidity": float(solidity(poly)),
            }
        )

    return apartments, common
