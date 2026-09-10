import type { Apartment, Point } from '@/lib/floor-plan/types'

export const CIRCLE_SEGMENTS = 32
const CURVE_SAMPLES = 10

export function circlePolygon(cx: number, cy: number, radius: number, segments = CIRCLE_SEGMENTS): Point[] {
  const r = Math.max(4, radius)
  const pts: Point[] = []
  for (let i = 0; i < segments; i++) {
    const a = (Math.PI * 2 * i) / segments
    pts.push([Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r)])
  }
  return pts
}

export function apartmentFromCircle(
  id: string,
  cx: number,
  cy: number,
  radius: number,
): Apartment {
  const polygon = circlePolygon(cx, cy, radius)
  const r = Math.max(4, radius)
  return {
    id,
    kind: 'circle',
    polygon,
    bbox: { x: cx - r, y: cy - r, width: r * 2, height: r * 2 },
    center: [cx, cy],
    confidence: 1,
    needsReview: true,
  }
}

export function rebuildCircleApartment(apartment: Apartment, cx: number, cy: number, radius: number): Apartment {
  const next = apartmentFromCircle(apartment.id, cx, cy, radius)
  return {
    ...next,
    id: apartment.id,
    confidence: apartment.confidence,
    needsReview: false,
  }
}

export function circleRadiusFromApartment(apartment: Apartment): number {
  if (apartment.bbox.width > 0 || apartment.bbox.height > 0) {
    return Math.max(apartment.bbox.width, apartment.bbox.height) / 2
  }
  if (apartment.polygon.length < 2) return 40
  const [cx, cy] = apartment.center
  return Math.max(
    4,
    ...apartment.polygon.map(([x, y]) => Math.hypot(x - cx, y - cy)),
  )
}

export function edgeMidpoint(a: Point, b: Point): Point {
  return [Math.round((a[0] + b[0]) / 2), Math.round((a[1] + b[1]) / 2)]
}

export function normalizeCurves(polygon: Point[], curves?: (Point | null)[]): (Point | null)[] {
  return Array.from({ length: polygon.length }, (_, i) => curves?.[i] ?? null)
}

export function quadraticPoint(a: Point, control: Point, b: Point, t: number): Point {
  const u = 1 - t
  return [
    Math.round(u * u * a[0] + 2 * u * t * control[0] + t * t * b[0]),
    Math.round(u * u * a[1] + 2 * u * t * control[1] + t * t * b[1]),
  ]
}

/** Expande vértices + curvas a un polígono denso (showroom / hit-test). */
export function densifyPolygon(polygon: Point[], curves?: (Point | null)[], samples = CURVE_SAMPLES): Point[] {
  if (polygon.length < 2) return polygon
  const controls = normalizeCurves(polygon, curves)
  const out: Point[] = []
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i]
    const b = polygon[(i + 1) % polygon.length]
    out.push(a)
    const control = controls[i]
    if (!control) continue
    for (let s = 1; s < samples; s++) {
      out.push(quadraticPoint(a, control, b, s / samples))
    }
  }
  return out
}

/** Path SVG cerrado con L/Q según curvas. */
export function polygonToSvgPath(polygon: Point[], curves?: (Point | null)[]): string {
  if (polygon.length < 3) return ''
  const controls = normalizeCurves(polygon, curves)
  let d = `M ${polygon[0][0]} ${polygon[0][1]}`
  for (let i = 0; i < polygon.length; i++) {
    const b = polygon[(i + 1) % polygon.length]
    const control = controls[i]
    if (control) {
      d += ` Q ${control[0]} ${control[1]} ${b[0]} ${b[1]}`
    } else {
      d += ` L ${b[0]} ${b[1]}`
    }
  }
  return `${d} Z`
}

export function applyPolygonMeta(polygon: Point[], curves?: (Point | null)[]) {
  const dense = densifyPolygon(polygon, curves)
  const xs = dense.map((p) => p[0])
  const ys = dense.map((p) => p[1])
  const x0 = Math.min(...xs)
  const y0 = Math.min(...ys)
  const x1 = Math.max(...xs)
  const y1 = Math.max(...ys)
  return {
    polygon,
    curves: normalizeCurves(polygon, curves),
    bbox: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
    center: [(x0 + x1) / 2, (y0 + y1) / 2] as [number, number],
  }
}
