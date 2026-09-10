import type { Apartment, Point } from '@/lib/floor-plan/types'

export const CIRCLE_SEGMENTS = 32

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
