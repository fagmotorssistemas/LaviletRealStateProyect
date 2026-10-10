/** Zoom 1 es la foto a pantalla completa. Por debajo, se abre hasta que toca los bordes. */
export function fitStill(box: { w: number; h: number }, aspect: number, zoom: number) {
  if (box.w < 8 || box.h < 8 || aspect <= 0) return null
  const boxAspect = box.w / box.h
  const coverH = boxAspect > aspect ? box.w / aspect : box.h
  const containH = boxAspect > aspect ? box.h : box.w / aspect
  const minZoom = coverH > 0 ? containH / coverH : 1
  const clamped = Math.min(1, Math.max(minZoom, zoom))
  const span = Math.max(0.0001, 1 - minZoom)
  const height = clamped >= 1 ? coverH : containH + (coverH - containH) * ((clamped - minZoom) / span)
  return {
    minZoom: Math.min(1, minZoom),
    style: {
      width: height * aspect,
      height,
      maxWidth: 'none' as const,
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
    },
  }
}

