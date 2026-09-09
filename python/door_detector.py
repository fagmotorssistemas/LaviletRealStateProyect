from __future__ import annotations

import cv2
import numpy as np


def seal_door_gaps(walls: np.ndarray, open_space: np.ndarray, corridor: dict | None) -> np.ndarray:
    """
    Cierre ligero de huecos de puerta en medianeras.
    No dilata muros de forma agresiva (eso destruía el interior de los deptos).
    """
    k_h = cv2.getStructuringElement(cv2.MORPH_RECT, (9, 1))
    k_v = cv2.getStructuringElement(cv2.MORPH_RECT, (1, 9))
    k3 = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))

    sealed_walls = cv2.morphologyEx(walls, cv2.MORPH_CLOSE, k_h, iterations=1)
    sealed_walls = cv2.morphologyEx(sealed_walls, cv2.MORPH_CLOSE, k_v, iterations=1)

    sealed_open = cv2.bitwise_not(sealed_walls)
    sealed_open = cv2.morphologyEx(sealed_open, cv2.MORPH_OPEN, k3, iterations=1)

    if corridor is not None:
        sealed_open[corridor["mask"] > 0] = 0

    return sealed_open


def exterior_mask_from_border(open_space: np.ndarray, gray: np.ndarray) -> np.ndarray:
    """
    Marca exterior/acera: flood desde los bordes sobre píxeles no-edificio.
    """
    h, w = open_space.shape
    # Exterior suele ser gris uniforme o muy oscuro/claro continuo desde el borde
    border = np.zeros((h, w), dtype=np.uint8)
    # Candidatos a exterior: open_space cerca del borde O gris homogéneo
    seed_mask = np.zeros((h, w), dtype=np.uint8)
    margin = max(2, min(w, h) // 80)
    seed_mask[:margin, :] = 255
    seed_mask[-margin:, :] = 255
    seed_mask[:, :margin] = 255
    seed_mask[:, -margin:] = 255

    # Flood fill sobre una máscara de "posible exterior"
    # Baja textura + open
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    local_var = cv2.blur((blur.astype(np.float32) - cv2.blur(blur.astype(np.float32), (9, 9))) ** 2, (9, 9))
    low_tex = (local_var < 40).astype(np.uint8) * 255
    walkable = cv2.bitwise_and(open_space, low_tex)

    # Componentes que tocan el borde
    num, labels, stats, _ = cv2.connectedComponentsWithStats(walkable, connectivity=4)
    exterior = np.zeros((h, w), dtype=np.uint8)
    for i in range(1, num):
        x, y, bw, bh, area = stats[i]
        touches = x <= margin or y <= margin or x + bw >= w - margin or y + bh >= h - margin
        if not touches:
            continue
        # Componentes exteriores grandes o anulares
        if area > w * h * 0.02 or (bw > w * 0.6 and bh > h * 0.6):
            exterior[labels == i] = 255
    return exterior
