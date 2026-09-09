"""
Proveedor de segmentación enchufable.

MVP: OpenCV (implementado en wall/region/apartment detectors).
Futuro: SAM 2 / SAM 2.1 sin cambiar el contrato del frontend.
"""

from __future__ import annotations

from typing import Any, Protocol


class SegmentationProvider(Protocol):
    name: str

    def segment(self, image_bgr: Any, processed: dict, walls: dict) -> list[dict]:
        """Devuelve regiones candidatas con polygon en coords originales."""
        ...


class OpenCVSegmentationProvider:
    name = "opencv"

    def segment(self, image_bgr: Any, processed: dict, walls: dict) -> list[dict]:
        from region_detector import detect_regions

        return detect_regions(processed, walls)


class Sam2SegmentationProvider:
    """Stub: activar cuando haya checkpoint SAM 2 local/remoto."""

    name = "sam2"

    def __init__(self, enabled: bool = False) -> None:
        self.enabled = enabled

    def segment(self, image_bgr: Any, processed: dict, walls: dict) -> list[dict]:
        if not self.enabled:
            return []
        # Placeholder — integrar sam2.predict más adelante
        raise NotImplementedError("SAM 2 aún no está cableado. Usar OpenCV.")


def get_provider(name: str = "opencv") -> SegmentationProvider:
    if name == "sam2":
        return Sam2SegmentationProvider(enabled=False)
    return OpenCVSegmentationProvider()
