from __future__ import annotations

import cv2
import numpy as np


def load_image_from_bytes(raw: bytes) -> tuple[np.ndarray, dict]:
    arr = np.frombuffer(raw, dtype=np.uint8)
    image = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Formato de imagen no soportado o archivo corrupto")
    h, w = image.shape[:2]
    if w < 64 or h < 64:
        raise ValueError("Imagen demasiado pequeña")
    if w > 8000 or h > 8000:
        raise ValueError("Imagen demasiado grande en resolución")
    return image, {"width": w, "height": h}


def preprocess(bgr: np.ndarray) -> dict[str, np.ndarray]:
    """Copia de trabajo. No muta la imagen original mostrada al usuario."""
    work = bgr.copy()
    lab = cv2.cvtColor(work, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.2, tileGridSize=(8, 8))
    l2 = clahe.apply(l)
    norm = cv2.cvtColor(cv2.merge([l2, a, b]), cv2.COLOR_LAB2BGR)

    gray = cv2.cvtColor(norm, cv2.COLOR_BGR2GRAY)
    denoised = cv2.bilateralFilter(gray, d=7, sigmaColor=55, sigmaSpace=55)

    # Gradiente morfológico: resalta bordes de muro en CAD y renders
    k = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    morph_grad = cv2.morphologyEx(denoised, cv2.MORPH_GRADIENT, k)

    thr_adapt = cv2.adaptiveThreshold(
        denoised, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY, 31, 4
    )
    thr_adapt_inv = cv2.adaptiveThreshold(
        denoised, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 31, 4
    )
    _, thr_otsu = cv2.threshold(denoised, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    _, thr_otsu_inv = cv2.threshold(denoised, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

    return {
        "bgr": norm,
        "gray": gray,
        "denoised": denoised,
        "morph_grad": morph_grad,
        "thr_adapt": thr_adapt,
        "thr_adapt_inv": thr_adapt_inv,
        "thr_otsu": thr_otsu,
        "thr_otsu_inv": thr_otsu_inv,
    }
