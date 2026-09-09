from __future__ import annotations

import cv2
import numpy as np

from geometry import mask_to_outer_polygon, polygon_metrics, solidity


def party_wall_cuts(walls: np.ndarray, y0: int, y1: int, thr: float = 0.30) -> list[int]:
    """Columnas donde el muro atraviesa la franja (medianeras entre deptos)."""
    h, w = walls.shape
    y0 = max(0, y0)
    y1 = min(h, y1)
    rows = max(1, y1 - y0)
    band = walls[y0:y1, :] > 0
    score = band.mean(axis=0).astype(np.float64)

    mid = rows // 2
    top = band[:mid].mean(axis=0) if mid > 0 else score
    bot = band[mid:].mean(axis=0) if mid < rows else score
    span = ((top > 0.12) & (bot > 0.12)).astype(np.float64)
    score = score * (0.5 + 1.0 * span)

    kernel = np.ones(5) / 5.0
    smooth = np.convolve(score, kernel, mode="same")

    peaks: list[tuple[int, float]] = []
    for x in range(4, w - 4):
        if smooth[x] < thr:
            continue
        if smooth[x] >= smooth[x - 1] and smooth[x] >= smooth[x + 1]:
            peaks.append((x, float(smooth[x])))

    clusters: list[dict] = []
    for x, v in peaks:
        if not clusters or x - clusters[-1]["xs"][-1] > max(16, w // 60):
            clusters.append({"xs": [x], "vs": [v]})
        else:
            clusters[-1]["xs"].append(x)
            clusters[-1]["vs"].append(v)

    centers: list[tuple[int, float]] = []
    for c in clusters:
        wsum = sum(c["vs"]) or 1.0
        cx = int(round(sum(x * v for x, v in zip(c["xs"], c["vs"])) / wsum))
        centers.append((cx, max(c["vs"])))

    min_gap = max(70, w // 12)
    filtered: list[tuple[int, float]] = []
    for cx, v in centers:
        if not filtered or cx - filtered[-1][0] >= min_gap:
            filtered.append((cx, v))
        elif v > filtered[-1][1]:
            filtered[-1] = (cx, v)
    return [c[0] for c in filtered]


def estimate_unit_count(inner_cuts: list[int], left: int, right: int) -> int:
    span = max(1, right - left)
    if len(inner_cuts) < 1:
        return 3
    gaps = [
        inner_cuts[0] - left,
        *[inner_cuts[i] - inner_cuts[i - 1] for i in range(1, len(inner_cuts))],
        right - inner_cuts[-1],
    ]
    med = sorted(gaps)[len(gaps) // 2]
    n = int(round(span / max(med, span / 8)))
    return max(3, min(8, n))


def select_unit_edges(cuts: list[int], w: int, max_units: int = 8) -> list[int]:
    """Snap dinámico a medianeras (sin N hardcodeado)."""
    if not cuts:
        return [int(w * 0.12), w - 2]

    core_cands = [c for c in cuts if w * 0.08 < c < w * 0.2]
    core_end = max(core_cands) if core_cands else int(w * 0.13)

    right_cands = [c for c in cuts if c > w * 0.88]
    right = max(right_cands) if right_cands else (w - 2)

    inner = [c for c in cuts if core_end + 25 < c < right - 25]
    if not inner:
        return [core_end, right]

    n_units = min(max_units, estimate_unit_count(inner, core_end, right))
    span = right - core_end
    ideal = span / n_units
    expected = [core_end + ideal * (i + 1) for i in range(n_units - 1)]

    used: set[int] = set()
    snapped: list[int] = []
    for ex in expected:
        best = None
        best_score = -1.0
        max_dist = ideal * 0.5
        for c in inner:
            if c in used:
                continue
            d = abs(c - ex)
            if d > max_dist:
                continue
            score = 1.0 - d / max_dist
            if score > best_score:
                best_score = score
                best = c
        snapped.append(int(round(ex)) if best is None else best)
        if best is not None:
            used.add(best)

    return [core_end, *snapped, right]


def flood_bay(open_space: np.ndarray, x0: int, x1: int, y0: int, y1: int) -> np.ndarray | None:
    """Une habitaciones dentro de la bahía y devuelve máscara del depto completo."""
    h, w = open_space.shape
    x0, x1 = max(0, x0), min(w, x1)
    y0, y1 = max(0, y0), min(h, y1)
    if x1 - x0 < 24 or y1 - y0 < 24:
        return None

    bay = np.zeros((h, w), dtype=np.uint8)
    pad_x = max(2, (x1 - x0) // 90)
    pad_y = 2
    bay[y0 + pad_y : y1 - pad_y, x0 + pad_x : x1 - pad_x] = open_space[
        y0 + pad_y : y1 - pad_y, x0 + pad_x : x1 - pad_x
    ]

    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    linked = cv2.morphologyEx(bay, cv2.MORPH_CLOSE, k, iterations=2)
    linked[:, : x0 + pad_x] = 0
    linked[:, x1 - pad_x :] = 0
    linked[: y0 + pad_y, :] = 0
    linked[y1 - pad_y :, :] = 0

    num, labels, stats, _ = cv2.connectedComponentsWithStats(linked, connectivity=4)
    if num <= 1:
        return None

    bay_area = (x1 - x0) * (y1 - y0)
    areas = [(int(stats[i, cv2.CC_STAT_AREA]), i) for i in range(1, num)]
    areas.sort(reverse=True)
    main_area = areas[0][0]
    if main_area < bay_area * 0.05:
        return None

    keep = np.zeros((h, w), dtype=np.uint8)
    for area, i in areas:
        if area < main_area * 0.12 and area < bay_area * 0.04:
            continue
        keep[labels == i] = 255

    if cv2.countNonZero(keep) < bay_area * 0.06:
        return None
    return keep


def regions_from_party_walls(
    open_space: np.ndarray,
    walls: np.ndarray,
    corridor: dict,
    exterior: np.ndarray | None = None,
) -> list[dict]:
    h, w = open_space.shape
    work = open_space.copy()
    if exterior is not None:
        work[exterior > 0] = 0
    work[corridor["mask"] > 0] = 0

    bands: list[tuple[int, int, str]] = []
    if corridor["orient"] == "h":
        bands.append((2, max(3, corridor["y0"] - 1), "n"))
        bands.append((min(h - 2, corridor["y1"] + 1), h - 2, "s"))
    else:
        bands.append((2, h - 2, "all"))

    regions: list[dict] = []
    for y0, y1, prefix in bands:
        if y1 - y0 < 25:
            continue
        cuts = party_wall_cuts(walls, y0, y1, thr=0.28)
        edges = select_unit_edges(cuts, w, max_units=8)
        local = 0
        for i in range(len(edges) - 1):
            xa, xb = edges[i], edges[i + 1]
            if xb - xa < w * 0.04:
                continue
            mask = flood_bay(work, xa, xb, y0, y1)
            if mask is None:
                continue
            poly = mask_to_outer_polygon(mask, epsilon_ratio=0.0024)
            if not poly or len(poly) < 3:
                continue
            metrics = polygon_metrics(poly)
            if metrics["area"] < w * h * 0.0035:
                continue
            local += 1
            bbox = metrics["bbox"]
            regions.append(
                {
                    "id": f"{prefix}{local}",
                    "polygon": poly,
                    "bbox": bbox,
                    "center": metrics["center"],
                    "area": metrics["area"],
                    "aspect": bbox["width"] / max(1, bbox["height"]),
                    "solidity": solidity(poly),
                    "mask": mask,
                    "source": "party_walls",
                }
            )
    return regions


def regions_from_components(
    sealed_open: np.ndarray,
    exterior: np.ndarray | None = None,
) -> list[dict]:
    h, w = sealed_open.shape
    work = sealed_open.copy()
    if exterior is not None:
        work[exterior > 0] = 0

    k = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    sealed = cv2.erode(work, k, iterations=1)
    num, labels, stats, centroids = cv2.connectedComponentsWithStats(sealed, connectivity=4)
    image_area = float(w * h)
    regions: list[dict] = []
    for i in range(1, num):
        area = float(stats[i, cv2.CC_STAT_AREA])
        if area < image_area * 0.004 or area > image_area * 0.35:
            continue
        mask = (labels == i).astype(np.uint8) * 255
        mask = cv2.dilate(mask, k, iterations=1)
        mask = cv2.bitwise_and(mask, work)
        poly = mask_to_outer_polygon(mask, epsilon_ratio=0.0028)
        if not poly:
            continue
        metrics = polygon_metrics(poly)
        x = int(stats[i, cv2.CC_STAT_LEFT])
        y = int(stats[i, cv2.CC_STAT_TOP])
        bw = int(stats[i, cv2.CC_STAT_WIDTH])
        bh = int(stats[i, cv2.CC_STAT_HEIGHT])
        regions.append(
            {
                "id": f"r{i}",
                "polygon": poly,
                "bbox": {"x": x, "y": y, "width": bw, "height": bh},
                "center": [float(centroids[i][0]), float(centroids[i][1])],
                "area": metrics["area"],
                "aspect": bw / max(1, bh),
                "solidity": solidity(poly),
                "mask": mask,
                "source": "components",
            }
        )
    return regions


def detect_regions(
    processed: dict[str, np.ndarray],
    walls: dict[str, np.ndarray],
    sealed_open: np.ndarray,
    exterior: np.ndarray | None = None,
    corridor: dict | None = None,
) -> list[dict]:
    # Para medianeras: usar open ligero (solo pasillo/exterior bloqueados)
    light = walls["open_space"].copy()
    if corridor is not None:
        light[corridor["mask"] > 0] = 0
    if exterior is not None:
        light[exterior > 0] = 0

    if corridor is not None and corridor.get("score", 0) >= 0.15:
        regs = regions_from_party_walls(light, walls["walls"], corridor, None)
        if len(regs) >= 3:
            return regs
    return regions_from_components(sealed_open, exterior)
