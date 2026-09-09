from __future__ import annotations

import cv2
import numpy as np


def detect_corridor_band(processed: dict[str, np.ndarray], walls: dict[str, np.ndarray]) -> dict | None:
    """
    Detecta franja de pasillo central (horizontal u ocasionalmente vertical).
    Usa color gris de renders + proyección de espacio abierto.
    """
    bgr = processed["bgr"]
    gray = processed["denoised"]
    h, w = gray.shape
    open_space = walls["open_space"]

    # --- Señal A: gris de pasillo en renders ---
    avg = gray.astype(np.float32)
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    sat = hsv[:, :, 1]
    corridor_color = ((avg >= 145) & (avg <= 215) & (sat <= 40) & (walls["walls"] == 0)).astype(np.uint8)

    row_scores = corridor_color.sum(axis=1).astype(np.float64) / max(1, w)
    # También proyección de open space (pasillo = franja con mucho open y poca altura)
    open_row = (open_space > 0).sum(axis=1).astype(np.float64) / max(1, w)

    # Buscar mejor banda horizontal
    best = None
    for y0 in range(int(h * 0.2), int(h * 0.75)):
        for thickness in (8, 12, 16, 22, 28, 36):
            y1 = min(h - 1, y0 + thickness)
            score_c = float(row_scores[y0:y1].mean())
            score_o = float(open_row[y0:y1].mean())
            # Penalizar si es casi todo el edificio
            score = score_c * 1.4 + score_o * 0.35
            if score_c < 0.08 and score_o < 0.55:
                continue
            if best is None or score > best["score"]:
                best = {"y0": y0, "y1": y1, "score": score, "orient": "h"}

    # --- Señal B: pasillo vertical (menos común) ---
    col_scores = corridor_color.sum(axis=0).astype(np.float64) / max(1, h)
    open_col = (open_space > 0).sum(axis=0).astype(np.float64) / max(1, h)
    for x0 in range(int(w * 0.2), int(w * 0.75)):
        for thickness in (8, 12, 16, 22, 28):
            x1 = min(w - 1, x0 + thickness)
            score_c = float(col_scores[x0:x1].mean())
            score_o = float(open_col[x0:x1].mean())
            score = score_c * 1.4 + score_o * 0.35
            if score_c < 0.08:
                continue
            if best is None or score > best["score"] * 1.05:
                best = {"x0": x0, "x1": x1, "score": score, "orient": "v"}

    if best is None or best["score"] < 0.12:
        return None

    mask = np.zeros((h, w), dtype=np.uint8)
    if best["orient"] == "h":
        # Expandir mientras el score se mantenga
        y0, y1 = best["y0"], best["y1"]
        while y0 > 0 and row_scores[y0] > best["score"] * 0.35:
            y0 -= 1
        while y1 < h - 1 and row_scores[min(y1, h - 1)] > best["score"] * 0.35:
            y1 += 1
        # Limitar grosor máximo relativo
        if y1 - y0 > h * 0.22:
            mid = (best["y0"] + best["y1"]) // 2
            y0, y1 = mid - int(h * 0.04), mid + int(h * 0.04)
        mask[y0:y1, :] = 255
        return {"orient": "h", "y0": int(y0), "y1": int(y1), "mask": mask, "score": best["score"]}

    x0, x1 = best["x0"], best["x1"]
    mask[:, x0:x1] = 255
    return {"orient": "v", "x0": int(x0), "x1": int(x1), "mask": mask, "score": best["score"]}


def paint_corridor_barrier(open_space: np.ndarray, corridor: dict | None) -> np.ndarray:
    if corridor is None:
        return open_space
    out = open_space.copy()
    out[corridor["mask"] > 0] = 0
    return out
