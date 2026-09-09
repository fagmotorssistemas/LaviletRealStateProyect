"""
Segmentación de UNIDADES inmobiliarias completas (no habitaciones).

Causa del bug (v2):
  Cortes verticales + flood parcial / contours de habitaciones
  → un depto se partía en sala, dormitorio, baño, etc.

Pipeline v3:
  barreras (paredes dilatadas + corredor + exterior)
  → reconectar SOLO puertas internas (MORPH_CLOSE)
  → si hay pasillo: bahías entre medianeras = 1 depto completo
  → OCR asigna ID por seed dentro del polígono
  → contorno exterior único (approxPolyDP)
"""

from __future__ import annotations

from typing import Any

import cv2
import numpy as np

from geometry import mask_to_outer_polygon, point_in_polygon, polygon_metrics, solidity
from region_detector import party_wall_cuts, select_unit_edges


def build_barrier_mask(
    walls: np.ndarray,
    corridor: dict | None,
    exterior: np.ndarray | None,
    wall_dilate: int = 1,
) -> np.ndarray:
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (max(1, wall_dilate) * 2 + 1, max(1, wall_dilate) * 2 + 1))
    barrier = cv2.dilate(walls, k, iterations=1) if wall_dilate > 0 else walls.copy()
    if corridor is not None and corridor.get("mask") is not None:
        ck = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        barrier = cv2.bitwise_or(barrier, cv2.dilate(corridor["mask"], ck, iterations=2))
    if exterior is not None:
        barrier = cv2.bitwise_or(barrier, exterior)
    return barrier


def build_walkable(barrier: np.ndarray) -> np.ndarray:
    walkable = cv2.bitwise_not(barrier)
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    return cv2.morphologyEx(walkable, cv2.MORPH_OPEN, k, iterations=1)


def detect_core_mask(walls: np.ndarray, corridor: dict | None, w: int, h: int) -> np.ndarray:
    """Núcleo común izquierdo (escaleras / ascensores) — no pertenece a deptos."""
    mask = np.zeros((h, w), dtype=np.uint8)
    left = walls[:, : max(40, w // 7)] > 0
    col = left.mean(axis=0)
    cut = int(w * 0.08)
    for x in range(8, len(col)):
        if col[x] < 0.12 and x > w * 0.05:
            cut = x + 4
            break
    cut = min(cut, w // 6)
    mask[:, :cut] = 255
    return mask


def fill_bay_unit(
    walls: np.ndarray,
    corridor_mask: np.ndarray | None,
    exterior: np.ndarray | None,
    core: np.ndarray | None,
    x0: int,
    x1: int,
    y0: int,
    y1: int,
    door_close: int,
) -> np.ndarray | None:
    """
    UNA unidad = bahía entre medianeras, siguiendo muros exteriores.

    - Medianeras / pasillo / exterior / núcleo = fronteras duras.
    - Muros internos se unen con MORPH_CLOSE (habitaciones → un solo depto).
    - El contorno final sigue la huella real, no un rectángulo abstracto.
    """
    h, w = walls.shape
    x0, x1 = max(0, x0), min(w, x1)
    y0, y1 = max(0, y0), min(h, y1)
    if x1 - x0 < 28 or y1 - y0 < 28:
        return None

    mx = max(4, (x1 - x0) // 60)

    # Espacio abierto (muebles cuentan como interior)
    open_sp = np.zeros((h, w), dtype=np.uint8)
    open_sp[walls == 0] = 255
    if corridor_mask is not None:
        open_sp[corridor_mask > 0] = 0
    if exterior is not None:
        # Empujar acera hacia adentro para no pintar vereda
        k5 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        open_sp[cv2.dilate(exterior, k5, iterations=2) > 0] = 0
    if core is not None:
        open_sp[core > 0] = 0

    # Sellar medianeras ANTES del close (evita fusionar vecinos)
    open_sp[:, max(0, x0) : min(w, x0 + mx)] = 0
    open_sp[:, max(0, x1 - mx) : min(w, x1)] = 0
    open_sp[:y0, :] = 0
    open_sp[y1:, :] = 0

    close_px = max(door_close, 23)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (close_px, close_px))
    merged = cv2.morphologyEx(open_sp, cv2.MORPH_CLOSE, k, iterations=3)

    # Clip duro a bahía
    merged[:, : x0 + mx] = 0
    merged[:, x1 - mx :] = 0
    merged[:y0, :] = 0
    merged[y1:, :] = 0
    if corridor_mask is not None:
        merged[corridor_mask > 0] = 0
    if core is not None:
        merged[core > 0] = 0

    # Semilla
    sx = (x0 + x1) // 2
    sy = (y0 + y1) // 2
    if merged[sy, sx] == 0:
        found = False
        for r in range(2, max(x1 - x0, y1 - y0) // 2, 2):
            for dy in range(-r, r + 1, 2):
                for dx in range(-r, r + 1, 2):
                    yy, xx = sy + dy, sx + dx
                    if 0 <= yy < h and 0 <= xx < w and merged[yy, xx] > 0:
                        sx, sy = xx, yy
                        found = True
                        break
                if found:
                    break
            if found:
                break
        if not found:
            return None

    num, labels, stats, _ = cv2.connectedComponentsWithStats(merged, connectivity=4)
    if num <= 1:
        return None
    lab = int(labels[sy, sx])
    if lab == 0:
        return None

    filled = (labels == lab).astype(np.uint8) * 255
    bay_area = (x1 - x0) * (y1 - y0)
    area = int(cv2.countNonZero(filled))
    if area < bay_area * 0.12:
        return None

    # Si el close no unió habitaciones (área chica), usar huella completa de la bahía
    if area < bay_area * 0.38:
        footprint = np.zeros((h, w), dtype=np.uint8)
        footprint[y0:y1, x0 + mx : x1 - mx] = 255
        if corridor_mask is not None:
            footprint[corridor_mask > 0] = 0
        if core is not None:
            footprint[core > 0] = 0
        if exterior is not None:
            k5 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
            footprint[cv2.dilate(exterior, k5, iterations=2) > 0] = 0
        # Preferir forma de muros si aporta más cobertura
        union = cv2.bitwise_or(filled, footprint)
        union[:, : x0 + mx] = 0
        union[:, x1 - mx :] = 0
        filled = union

    # Contorno exterior sólido (sin huecos de muebles)
    contours, _ = cv2.findContours(filled, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
    if not contours:
        return None
    solid = np.zeros_like(filled)
    cv2.drawContours(solid, [max(contours, key=cv2.contourArea)], -1, 255, thickness=-1)
    solid[:, : x0 + mx] = 0
    solid[:, x1 - mx :] = 0
    if corridor_mask is not None:
        solid[corridor_mask > 0] = 0
    if core is not None:
        solid[core > 0] = 0
    if exterior is not None:
        k5 = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        solid[cv2.dilate(exterior, k5, iterations=1) > 0] = 0

    if cv2.countNonZero(solid) < bay_area * 0.10:
        return None
    return solid


def units_from_corridor_bays(
    walls: np.ndarray,
    corridor: dict,
    exterior: np.ndarray | None,
    door_close: int,
) -> list[dict]:
    h, w = walls.shape
    cmask = corridor.get("mask")
    core = detect_core_mask(walls, corridor, w, h)
    bands: list[tuple[int, int, str]] = []
    if corridor["orient"] == "h":
        bands.append((1, max(2, corridor["y0"] - 1), "n"))
        bands.append((min(h - 2, corridor["y1"] + 1), h - 1, "s"))
    else:
        bands.append((1, h - 1, "a"))

    units: list[dict] = []
    for y0, y1, prefix in bands:
        if y1 - y0 < 30:
            continue
        cuts = party_wall_cuts(walls, y0, y1, thr=0.34)
        edges = select_unit_edges(cuts, w, max_units=5)
        local = 0
        for i in range(len(edges) - 1):
            xa, xb = edges[i], edges[i + 1]
            if xb - xa < w * 0.05:
                continue
            mask = fill_bay_unit(walls, cmask, exterior, core, xa, xb, y0, y1, door_close)
            if mask is None:
                continue
            # epsilon bajo → sigue fachadas / terrazas (no colapsar a rectángulo)
            poly = mask_to_outer_polygon(mask, epsilon_ratio=0.0018)
            if not poly or len(poly) < 3:
                continue
            m = polygon_metrics(poly)
            if m["area"] < w * h * 0.008:
                continue
            local += 1
            cx, cy = m["center"]
            units.append(
                {
                    "id": f"{prefix}{local}",
                    "polygon": poly,
                    "bbox": m["bbox"],
                    "center": [float(cx), float(cy)],
                    "area": float(m["area"]),
                    "mask": mask,
                    "seed": [int(cx), int(cy)],
                    "source": "bay",
                    "confidence": 0.84,
                }
            )
    return units


def component_at_seed(linked: np.ndarray, seed: tuple[int, int]) -> np.ndarray | None:
    h, w = linked.shape
    sx, sy = int(seed[0]), int(seed[1])
    if not (0 <= sx < w and 0 <= sy < h):
        return None
    if linked[sy, sx] == 0:
        found = None
        for r in range(1, 36):
            y0, y1 = max(0, sy - r), min(h, sy + r + 1)
            x0, x1 = max(0, sx - r), min(w, sx + r + 1)
            ys, xs = np.where(linked[y0:y1, x0:x1] > 0)
            if len(xs):
                # closest
                best = None
                best_d = 1e18
                for x, y in zip(xs, ys):
                    d = (x + x0 - sx) ** 2 + (y + y0 - sy) ** 2
                    if d < best_d:
                        best_d = d
                        best = (int(x + x0), int(y + y0))
                found = best
                break
        if found is None:
            return None
        sx, sy = found

    fill = linked.copy()
    mm = np.zeros((h + 2, w + 2), np.uint8)
    cv2.floodFill(fill, mm, (sx, sy), 128, flags=4 | (255 << 8))
    unit = (fill == 128).astype(np.uint8) * 255
    if cv2.countNonZero(unit) < 100:
        return None
    # Fill outer contour for clean marco
    contours, _ = cv2.findContours(unit, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    filled = np.zeros_like(unit)
    cv2.drawContours(filled, [max(contours, key=cv2.contourArea)], -1, 255, -1)
    return filled


def label_center(lab: dict) -> tuple[int, int]:
    if lab.get("center"):
        return int(lab["center"][0]), int(lab["center"][1])
    bx, by, bw, bh = lab["bbox"]
    return int(bx + bw / 2), int(by + bh / 2)


def assign_ocr_ids(units: list[dict], labels: list[dict]) -> list[dict]:
    used: set[int] = set()
    for unit in units:
        poly = unit["polygon"]
        best_i = None
        best_score = -1.0
        for i, lab in enumerate(labels):
            if i in used:
                continue
            cx, cy = label_center(lab)
            inside = point_in_polygon(cx, cy, poly)
            dist = abs(cx - unit["center"][0]) + abs(cy - unit["center"][1])
            score = (1000.0 if inside else 0.0) + max(0.0, 500.0 - dist) + float(lab.get("confidence", 0)) * 40
            if score > best_score:
                best_score = score
                best_i = i
        if best_i is not None and best_score >= 80:
            used.add(best_i)
            lab = labels[best_i]
            unit["id"] = str(lab["text"])
            unit["ocrConfidence"] = float(lab.get("confidence", 0))
            unit["seed"] = list(label_center(lab))
            unit["confidence"] = min(0.98, 0.75 + float(lab.get("confidence", 0.5)) * 0.2)
            unit["needsReview"] = False
        else:
            unit["confidence"] = float(unit.get("confidence", 0.72))
            unit["needsReview"] = unit["confidence"] < 0.7
    return units


def validate_units(units: list[dict], corridor: dict | None, image_area: float) -> list[dict]:
    out = []
    for unit in units:
        reasons = []
        conf = float(unit.get("confidence", 0.75))
        area = float(unit["area"])
        if area < image_area * 0.005:
            reasons.append("too_small")
            conf -= 0.2
        if area > image_area * 0.32:
            reasons.append("too_large")
            conf -= 0.15
        sol = solidity(unit["polygon"])
        if sol < 0.4:
            reasons.append("fragmented")
            conf -= 0.1
        if corridor is not None and unit.get("mask") is not None and corridor.get("mask") is not None:
            inv = cv2.countNonZero(cv2.bitwise_and(unit["mask"], corridor["mask"]))
            if inv > area * 0.06:
                reasons.append("corridor_invasion")
                conf -= 0.15
        seed = unit.get("seed")
        if seed and not point_in_polygon(seed[0], seed[1], unit["polygon"]):
            reasons.append("seed_outside")
            conf -= 0.08
        unit["confidence"] = float(max(0.25, min(0.98, conf)))
        unit["needsReview"] = bool(reasons) or unit["confidence"] < 0.7
        unit["validation"] = reasons
        unit["solidity"] = sol
        unit["vertexCount"] = len(unit["polygon"])
        out.append(unit)
    return out


def segment_units(
    processed: dict[str, np.ndarray],
    walls: dict[str, np.ndarray],
    corridor: dict | None,
    exterior: np.ndarray | None,
    labels: list[dict],
    meta: dict,
    wall_dilate: int = 1,
    door_close_px: int = 17,
) -> tuple[list[dict], list[dict]]:
    h, w = walls["walls"].shape
    image_area = float(w * h)

    barrier = build_barrier_mask(walls["walls"], corridor, exterior, wall_dilate=wall_dilate)
    walkable = build_walkable(barrier)

    units: list[dict] = []

    # Camino A (preferido con pasillo): 1 bahía = 1 depto completo
    if corridor is not None and corridor.get("score", 0) >= 0.12:
        units = units_from_corridor_bays(walls["walls"], corridor, exterior, door_close_px)

    # Camino B: seeds OCR → flood sobre walkable reconectado
    if labels:
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (door_close_px, door_close_px))
        linked = cv2.morphologyEx(walkable, cv2.MORPH_CLOSE, k, iterations=2)
        linked[barrier > 0] = 0

        if len(units) >= 3:
            units = assign_ocr_ids(units, labels)
        else:
            # Construir desde seeds
            seed_units = []
            for lab in labels:
                seed = label_center(lab)
                mask = component_at_seed(linked, seed)
                if mask is None:
                    continue
                poly = mask_to_outer_polygon(mask, epsilon_ratio=0.0022)
                if not poly:
                    continue
                m = polygon_metrics(poly)
                if m["area"] < image_area * 0.005:
                    continue
                seed_units.append(
                    {
                        "id": str(lab["text"]),
                        "polygon": poly,
                        "bbox": m["bbox"],
                        "center": m["center"],
                        "area": float(m["area"]),
                        "mask": mask,
                        "seed": [seed[0], seed[1]],
                        "ocrConfidence": float(lab.get("confidence", 0)),
                        "confidence": min(0.98, 0.7 + float(lab.get("confidence", 0.5)) * 0.25),
                        "source": "ocr_seed",
                    }
                )
            if len(seed_units) >= len(units):
                units = seed_units

    if not units:
        # Último recurso: componentes grandes ya unidos
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (door_close_px, door_close_px))
        linked = cv2.morphologyEx(walkable, cv2.MORPH_CLOSE, k, iterations=2)
        linked[barrier > 0] = 0
        num, labels_cc, stats, centroids = cv2.connectedComponentsWithStats(linked, connectivity=4)
        for i in range(1, num):
            area = float(stats[i, cv2.CC_STAT_AREA])
            if area < image_area * 0.008 or area > image_area * 0.35:
                continue
            mask = (labels_cc == i).astype(np.uint8) * 255
            poly = mask_to_outer_polygon(mask, epsilon_ratio=0.0024)
            if not poly:
                continue
            m = polygon_metrics(poly)
            units.append(
                {
                    "id": f"unit-{len(units) + 1:02d}",
                    "polygon": poly,
                    "bbox": m["bbox"],
                    "center": m["center"],
                    "area": float(m["area"]),
                    "mask": mask,
                    "seed": [int(centroids[i][0]), int(centroids[i][1])],
                    "confidence": 0.65,
                    "source": "component",
                }
            )

    if labels and units and units[0].get("source") == "bay":
        units = assign_ocr_ids(units, labels)

    units = validate_units(units, corridor, image_area)

    # Descartar fragmentos (habitaciones sueltas) vs unidades completas
    if len(units) >= 4:
        areas = sorted(float(u["area"]) for u in units)
        median_a = areas[len(areas) // 2]
        units = [u for u in units if float(u["area"]) >= median_a * 0.42]

    units.sort(key=lambda u: (u["center"][1], u["center"][0]))

    # IDs sintéticos faltantes
    n = 1
    seen: set[str] = set()
    apartments: list[dict[str, Any]] = []
    for u in units:
        aid = str(u.get("id") or "")
        if not aid or aid.startswith("n") or aid.startswith("s") or aid.startswith("a"):
            # keep bay ids only if no OCR; else unit-XX
            if not labels:
                aid = f"unit-{n:02d}"
                n += 1
            elif aid.startswith(("n", "s", "a")):
                aid = f"unit-{n:02d}"
                n += 1
        base = aid
        kdup = 2
        while aid in seen:
            aid = f"{base}-{kdup}"
            kdup += 1
        seen.add(aid)
        apartments.append(
            {
                "id": aid,
                "polygon": u["polygon"],
                "bbox": u["bbox"],
                "center": [float(u["center"][0]), float(u["center"][1])],
                "area": float(u["area"]),
                "confidence": float(u.get("confidence", 0.7)),
                "needsReview": bool(u.get("needsReview", False)),
                "vertexCount": int(u.get("vertexCount") or len(u["polygon"])),
                "solidity": float(u.get("solidity") or solidity(u["polygon"])),
                "seed": u.get("seed"),
            }
        )

    common: list[dict] = []
    if corridor is not None and corridor.get("mask") is not None:
        cpoly = mask_to_outer_polygon(corridor["mask"], epsilon_ratio=0.012)
        if cpoly:
            m = polygon_metrics(cpoly)
            common.append(
                {
                    "id": "corridor",
                    "type": "corridor",
                    "polygon": cpoly,
                    "bbox": m["bbox"],
                    "center": m["center"],
                    "confidence": 0.88,
                }
            )

    return apartments, common
