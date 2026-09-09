"""
Servicio de análisis de planos — pipeline opencv-v3 (unidades completas).

OCR seed → barreras (paredes/corredor) → flood → contorno exterior único.
"""

from __future__ import annotations

import traceback
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from corridor_detector import detect_corridor_band
from door_detector import exterior_mask_from_border
from image_processor import load_image_from_bytes, preprocess
from ocr import extract_labels
from unit_segmenter import segment_units
from wall_detector import detect_walls

app = FastAPI(title="La Vilet Plan Analyzer", version="0.3.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_BYTES = 25 * 1024 * 1024

# Parámetros ajustables (env / query futuros)
WALL_DILATE = 1
DOOR_CLOSE_PX = 17


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "pipeline": "opencv-v3-unit-seed",
        "params": {"wall_dilate": WALL_DILATE, "door_close_px": DOOR_CLOSE_PX},
    }


@app.post("/analyze")
async def analyze(image: UploadFile = File(...)) -> JSONResponse:
    raw = await image.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Imagen vacía")
    if len(raw) > MAX_BYTES:
        raise HTTPException(status_code=400, detail="Imagen demasiado grande (máx 25MB)")

    try:
        original, meta = load_image_from_bytes(raw)
        processed = preprocess(original)
        walls = detect_walls(processed)
        corridor = detect_corridor_band(processed, walls)

        # Exterior desde open space (sin sellar puertas agresivamente)
        open_space = walls["open_space"].copy()
        if corridor is not None:
            open_space[corridor["mask"] > 0] = 0
        exterior = exterior_mask_from_border(open_space, processed["denoised"])

        # OCR primero → seeds
        labels = extract_labels(original)

        apartments, common_areas = segment_units(
            processed,
            walls,
            corridor,
            exterior,
            labels,
            meta,
            wall_dilate=WALL_DILATE,
            door_close_px=DOOR_CLOSE_PX,
        )

        corridor_meta = None
        if corridor is not None:
            corridor_meta = {
                "orient": corridor["orient"],
                "score": round(float(corridor.get("score", 0)), 3),
            }
            if corridor["orient"] == "h":
                corridor_meta["y0"] = corridor["y0"]
                corridor_meta["y1"] = corridor["y1"]
            else:
                corridor_meta["x0"] = corridor["x0"]
                corridor_meta["x1"] = corridor["x1"]

        payload: dict[str, Any] = {
            "success": True,
            "image": {"width": int(meta["width"]), "height": int(meta["height"])},
            "apartments": apartments,
            "commonAreas": common_areas,
            "labels": labels,
            "meta": {
                "pipeline": "opencv-v3-unit-seed",
                "segmentationProvider": "opencv",
                "wallMode": walls.get("mode"),
                "corridor": corridor_meta,
                "labelCount": len(labels),
                "params": {"wall_dilate": WALL_DILATE, "door_close_px": DOOR_CLOSE_PX},
            },
        }
        return JSONResponse(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error de procesamiento: {exc}") from exc
