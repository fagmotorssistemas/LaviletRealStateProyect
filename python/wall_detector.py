from __future__ import annotations

import cv2
import numpy as np


def _hough_lines_mask(edges: np.ndarray, w: int, h: int) -> np.ndarray:
    mask = np.zeros((h, w), dtype=np.uint8)
    min_len = max(18, min(w, h) // 55)
    lines = cv2.HoughLinesP(
        edges,
        rho=1,
        theta=np.pi / 180,
        threshold=max(35, min(w, h) // 45),
        minLineLength=min_len,
        maxLineGap=14,
    )
    if lines is None:
        return mask
    for raw in lines:
        vals = np.asarray(raw).reshape(-1)
        if vals.size < 4:
            continue
        x1, y1, x2, y2 = map(int, vals[:4])
        # Grosor 2: muro estructural; no rellenar habitaciones
        cv2.line(mask, (x1, y1), (x2, y2), 255, 2)
    return mask


def _bright_wall_mask(bgr: np.ndarray) -> np.ndarray:
    """Paredes blancas/gris-claras de renders 3D."""
    hsv = cv2.cvtColor(bgr, cv2.COLOR_BGR2HSV)
    bright = cv2.inRange(hsv, (0, 0, 168), (180, 60, 255))
    # Refinar: solo zonas con alto valor y baja saturación
    return bright


def _dark_wall_mask(gray: np.ndarray) -> np.ndarray:
    """Paredes oscuras típicas de CAD / planos técnicos."""
    # Percentil bajo = tinta de muro
    thr = int(np.percentile(gray, 18))
    dark = (gray <= max(40, min( thr, 90))).astype(np.uint8) * 255
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
    dark = cv2.morphologyEx(dark, cv2.MORPH_OPEN, k, iterations=1)
    return dark


def detect_walls(processed: dict[str, np.ndarray]) -> dict[str, np.ndarray]:
    """
    Máscara de paredes robusta a render 3D y CAD.
    Combina: Canny multi-umbral, morfología, Hough, paredes claras/oscuras.
    """
    gray = processed["denoised"]
    bgr = processed["bgr"]
    h, w = gray.shape

    v = float(np.median(gray))
    edges1 = cv2.Canny(gray, int(max(0, 0.5 * v)), int(min(255, 1.2 * v)), L2gradient=True)
    edges2 = cv2.Canny(gray, int(max(0, 0.3 * v)), int(min(255, 1.5 * v)), L2gradient=True)
    edges_g = cv2.Canny(processed["morph_grad"], 40, 120, L2gradient=True)
    edges = cv2.bitwise_or(edges1, cv2.bitwise_or(edges2, edges_g))

    bright = _bright_wall_mask(bgr)
    dark = _dark_wall_mask(gray)
    lines_mask = _hough_lines_mask(edges, w, h)

    bright_ratio = float(np.count_nonzero(bright)) / (w * h)
    dark_ratio = float(np.count_nonzero(dark)) / (w * h)
    k3 = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    k5 = cv2.getStructuringElement(cv2.MORPH_RECT, (5, 5))
    # Quitar blobs de mobiliario blanco (pequeños) sin perder muros largos
    bright_clean = cv2.morphologyEx(bright, cv2.MORPH_OPEN, k5, iterations=1)
    bright_clean = cv2.bitwise_or(bright_clean, cv2.bitwise_and(bright, lines_mask))

    if bright_ratio > 0.04 and bright_ratio >= dark_ratio * 0.7:
        tone_walls = bright_clean
        mode = "render"
    else:
        dark_clean = cv2.morphologyEx(dark, cv2.MORPH_OPEN, k3, iterations=1)
        tone_walls = dark_clean
        mode = "cad"

    if mode == "render":
        # CRÍTICO: no meter Canny crudo (muebles/suelo) o el "interior"
        # se parte en habitaciones y el fill no une el departamento.
        # Muros estructurales = blanco arquitectónico + líneas Hough largas.
        structural = cv2.bitwise_or(bright_clean, lines_mask)
        # Solo bordes que coinciden con tono de muro (evita texturas)
        edge_on_wall = cv2.bitwise_and(edges, cv2.dilate(bright_clean, k5, iterations=1))
        structural = cv2.bitwise_or(structural, edge_on_wall)
        walls = cv2.morphologyEx(structural, cv2.MORPH_CLOSE, k5, iterations=2)
        walls = cv2.morphologyEx(walls, cv2.MORPH_OPEN, k3, iterations=1)
        # Engrosar ligeramente para cerrar grietas (barrera de flood)
        walls = cv2.dilate(walls, k3, iterations=1)
    else:
        wallish = cv2.bitwise_or(edges, tone_walls)
        wallish = cv2.bitwise_or(wallish, lines_mask)
        walls = cv2.morphologyEx(wallish, cv2.MORPH_CLOSE, k5, iterations=1)
        walls = cv2.morphologyEx(walls, cv2.MORPH_CLOSE, k3, iterations=1)
        walls = cv2.morphologyEx(walls, cv2.MORPH_OPEN, k3, iterations=1)

    open_space = cv2.bitwise_not(walls)
    open_space = cv2.morphologyEx(open_space, cv2.MORPH_OPEN, k3, iterations=1)

    return {
        "edges": edges,
        "walls": walls,
        "open_space": open_space,
        "lines": lines_mask,
        "bright_walls": bright,
        "dark_walls": dark,
        "mode": mode,
    }
