/**
 * Zonas de departamentos por piso (polígonos manuales sobre el plano).
 * Persistidos por edificio (no por tipología); el showroom matchea zonas ↔ unidades por número.
 *
 * Las zonas se guardan en % (0–100) y se comparten entre variantes 2D y 3D del mismo piso.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { floorPlanStorageKey } from '@/lib/tour/floorPlanHotspots'
import { TYPOLOGY_ASSETS_BUCKET } from '@/lib/typology-assets'
import type { Apartment, Point } from '@/lib/floor-plan/types'
import { densifyPolygon, normalizeCurves } from '@/lib/floor-plan/geometry'

export type FloorPlanVariant = '2d' | '3d'

export type FloorPlanVariantMedia = {
  imageUrl: string | null
  imageWidth: number
  imageHeight: number
}

/** Ajuste fino del overlay de zonas por variante (p. ej. 3D con otro encuadre). */
export type FloorPlanOverlayAlign = {
  /** Desplazamiento horizontal en puntos porcentuales (−50…50). */
  offsetX: number
  /** Desplazamiento vertical en puntos porcentuales (−50…50). */
  offsetY: number
  /** Escala alrededor del centro (1 = sin cambio). */
  scale: number
}

export const DEFAULT_OVERLAY_ALIGN: FloorPlanOverlayAlign = {
  offsetX: 0,
  offsetY: 0,
  scale: 1,
}

export type FloorPlanZone = {
  id: string
  label: string
  order: number
  /** Polígono en px (de la variante con la que se editó por última vez; preferir pointsPercent). */
  polygon: Point[]
  /** Polígono 0–100 — fuente de verdad compartida 2D/3D. */
  pointsPercent: string
  /**
   * Controles de curva por arista en % (mismo orden que vértices).
   * Token `-` = lado recto. Ej: `- 42.1,10.5 -`.
   */
  curvesPercent?: string
  kind?: 'polygon' | 'circle'
}

export type FloorPlanZonesDoc = {
  floor: number
  typologyCode: string
  /** Compat / showroom: suele ser la 2D si existe. */
  imageUrl: string | null
  imageWidth: number
  imageHeight: number
  variants: Record<FloorPlanVariant, FloorPlanVariantMedia>
  /** Alineación del overlay por variante (no mueve la imagen, solo las zonas). */
  align?: Partial<Record<FloorPlanVariant, FloorPlanOverlayAlign>>
  zones: FloorPlanZone[]
  updatedAt: string
}

const EMPTY_MEDIA: FloorPlanVariantMedia = {
  imageUrl: null,
  imageWidth: 1,
  imageHeight: 1,
}

export function floorPlanZonesPath(typologyCode: string, floor: number) {
  return `${typologyCode}/floor-${floorPlanStorageKey(floor)}-zones.json`
}

export function floorPlanImagePath(
  typologyCode: string,
  floor: number,
  ext = 'webp',
  variant: FloorPlanVariant = '2d',
) {
  const key = floorPlanStorageKey(floor)
  const suffix = variant === '3d' ? 'plan-3d' : 'plan'
  return `${typologyCode}/floor-${key}-${suffix}.${ext}`
}

export type FloorPlanFloorSummary = {
  floor: number
  imageUrl: string | null
  imageUrl2d: string | null
  imageUrl3d: string | null
  zoneCount: number
  updatedAt: string | null
}

const FLOOR_PLAN_IMAGE_EXTS = ['webp', 'jpg', 'jpeg', 'png', 'gif'] as const

function parseMedia(value: unknown): FloorPlanVariantMedia {
  if (!value || typeof value !== 'object') return { ...EMPTY_MEDIA }
  const row = value as Partial<FloorPlanVariantMedia>
  return {
    imageUrl: typeof row.imageUrl === 'string' ? row.imageUrl : null,
    imageWidth: Number.isFinite(Number(row.imageWidth)) ? Number(row.imageWidth) : 1,
    imageHeight: Number.isFinite(Number(row.imageHeight)) ? Number(row.imageHeight) : 1,
  }
}

/** Normaliza docs viejos (una sola imagen) al formato con variantes 2D/3D. */
export function withFloorPlanVariants(doc: FloorPlanZonesDoc): FloorPlanZonesDoc {
  const legacy2d: FloorPlanVariantMedia = doc.imageUrl
    ? {
        imageUrl: doc.imageUrl,
        imageWidth: doc.imageWidth || 1,
        imageHeight: doc.imageHeight || 1,
      }
    : { ...EMPTY_MEDIA }

  const variants: Record<FloorPlanVariant, FloorPlanVariantMedia> = {
    '2d': doc.variants?.['2d']?.imageUrl ? doc.variants['2d'] : legacy2d,
    '3d': doc.variants?.['3d'] ?? { ...EMPTY_MEDIA },
  }

  // Si variants.2d estaba vacío pero legacy tenía imagen, ya quedó en 2d.
  if (!variants['2d'].imageUrl && legacy2d.imageUrl) variants['2d'] = legacy2d

  const preferred = variants['2d'].imageUrl ? variants['2d'] : variants['3d']
  return {
    ...doc,
    variants,
    align: {
      '2d': parseOverlayAlign(doc.align?.['2d']),
      '3d': parseOverlayAlign(doc.align?.['3d']),
    },
    imageUrl: preferred.imageUrl,
    imageWidth: preferred.imageWidth || 1,
    imageHeight: preferred.imageHeight || 1,
  }
}

export function getFloorPlanVariantMedia(
  doc: FloorPlanZonesDoc | null | undefined,
  variant: FloorPlanVariant,
): FloorPlanVariantMedia {
  if (!doc) return { ...EMPTY_MEDIA }
  const normalized = withFloorPlanVariants(doc)
  return normalized.variants[variant] ?? { ...EMPTY_MEDIA }
}

export function parseOverlayAlign(value: unknown): FloorPlanOverlayAlign {
  if (!value || typeof value !== 'object') return { ...DEFAULT_OVERLAY_ALIGN }
  const row = value as Partial<FloorPlanOverlayAlign>
  const offsetX = Number(row.offsetX)
  const offsetY = Number(row.offsetY)
  const scale = Number(row.scale)
  return {
    offsetX: Number.isFinite(offsetX) ? Math.max(-20, Math.min(20, offsetX)) : 0,
    offsetY: Number.isFinite(offsetY) ? Math.max(-20, Math.min(20, offsetY)) : 0,
    scale: Number.isFinite(scale) ? Math.max(0.85, Math.min(1.15, scale)) : 1,
  }
}

export function getFloorPlanOverlayAlign(
  doc: FloorPlanZonesDoc | null | undefined,
  variant: FloorPlanVariant,
): FloorPlanOverlayAlign {
  if (!doc?.align?.[variant]) return { ...DEFAULT_OVERLAY_ALIGN }
  return parseOverlayAlign(doc.align[variant])
}

/** Aplica offset/escala a un polígono en % (para alinear 3D sin re-dibujar). */
export function applyOverlayAlign(
  pointsPercent: string,
  align?: FloorPlanOverlayAlign | null,
): string {
  if (!pointsPercent.trim()) return ''
  const a = parseOverlayAlign(align)
  const identity = a.offsetX === 0 && a.offsetY === 0 && a.scale === 1
  if (identity) return pointsPercent
  return pointsPercent
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [xRaw, yRaw] = pair.split(',').map(Number)
      if (!Number.isFinite(xRaw) || !Number.isFinite(yRaw)) return pair
      const x = 50 + (xRaw - 50) * a.scale + a.offsetX
      const y = 50 + (yRaw - 50) * a.scale + a.offsetY
      return `${Math.min(100, Math.max(0, x)).toFixed(2)},${Math.min(100, Math.max(0, y)).toFixed(2)}`
    })
    .join(' ')
}

export async function uploadFloorPlanImage(
  supabase: SupabaseClient,
  typologyCode: string,
  floor: number,
  buffer: Buffer,
  contentType: string,
  ext = 'webp',
  variant: FloorPlanVariant = '2d',
): Promise<{ path: string; publicUrl: string }> {
  const stale = FLOOR_PLAN_IMAGE_EXTS.filter((item) => item !== ext).map((item) =>
    floorPlanImagePath(typologyCode, floor, item, variant),
  )
  if (stale.length > 0) {
    await supabase.storage.from(TYPOLOGY_ASSETS_BUCKET).remove(stale)
  }

  const path = floorPlanImagePath(typologyCode, floor, ext, variant)
  const { error } = await supabase.storage.from(TYPOLOGY_ASSETS_BUCKET).upload(path, buffer, {
    upsert: true,
    contentType,
    // Cache en CDN/browser; el showroom bustea con ?v=updatedAt al cambiar el doc.
    cacheControl: '86400',
  })
  if (error) throw new Error(error.message || 'No se pudo subir el plano del piso')
  const { data } = supabase.storage.from(TYPOLOGY_ASSETS_BUCKET).getPublicUrl(path)
  return { path, publicUrl: data.publicUrl }
}

export async function deleteFloorPlanImage(
  supabase: SupabaseClient,
  typologyCode: string,
  floor: number,
  variant: FloorPlanVariant = '2d',
): Promise<void> {
  const paths = FLOOR_PLAN_IMAGE_EXTS.map((ext) =>
    floorPlanImagePath(typologyCode, floor, ext, variant),
  )
  await supabase.storage.from(TYPOLOGY_ASSETS_BUCKET).remove(paths)
  const existing = await loadFloorPlanZones(supabase, typologyCode, floor)
  if (!existing) return
  const next = withFloorPlanVariants(existing)
  next.variants[variant] = { ...EMPTY_MEDIA }
  const preferred = next.variants['2d'].imageUrl ? next.variants['2d'] : next.variants['3d']
  await saveFloorPlanZones(supabase, {
    ...next,
    imageUrl: preferred.imageUrl,
    imageWidth: preferred.imageWidth || 1,
    imageHeight: preferred.imageHeight || 1,
  })
}

export async function deleteFloorPlanFloor(
  supabase: SupabaseClient,
  typologyCode: string,
  floor: number,
): Promise<void> {
  await deleteFloorPlanImage(supabase, typologyCode, floor, '2d')
  await deleteFloorPlanImage(supabase, typologyCode, floor, '3d')
  await supabase.storage.from(TYPOLOGY_ASSETS_BUCKET).remove([floorPlanZonesPath(typologyCode, floor)])
}

export async function listFloorPlanFloorSummaries(
  supabase: SupabaseClient,
  typologyCode: string,
  floors: readonly number[],
): Promise<FloorPlanFloorSummary[]> {
  const rows = await Promise.all(
    floors.map(async (floor) => {
      const doc = await loadFloorPlanZones(supabase, typologyCode, floor)
      const normalized = doc ? withFloorPlanVariants(doc) : null
      const imageUrl2d = normalized?.variants['2d'].imageUrl ?? null
      const imageUrl3d = normalized?.variants['3d'].imageUrl ?? null
      return {
        floor,
        imageUrl: imageUrl2d || imageUrl3d,
        imageUrl2d,
        imageUrl3d,
        zoneCount: normalized?.zones.length ?? 0,
        updatedAt: normalized?.updatedAt ?? null,
      } satisfies FloorPlanFloorSummary
    }),
  )
  return rows
}

export function polygonToPercentPoints(
  polygon: Point[],
  width: number,
  height: number,
): string {
  if (!width || !height || polygon.length < 3) return ''
  return polygon
    .map(([x, y]) => {
      const px = Math.min(100, Math.max(0, (x / width) * 100))
      const py = Math.min(100, Math.max(0, (y / height) * 100))
      return `${px.toFixed(2)},${py.toFixed(2)}`
    })
    .join(' ')
}

export function percentPointsToPolygon(
  pointsPercent: string,
  width: number,
  height: number,
): Point[] {
  if (!width || !height || !pointsPercent.trim()) return []
  return pointsPercent
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [px, py] = pair.split(',').map(Number)
      if (!Number.isFinite(px) || !Number.isFinite(py)) return null
      return [
        Math.round((Math.min(100, Math.max(0, px)) / 100) * width),
        Math.round((Math.min(100, Math.max(0, py)) / 100) * height),
      ] as Point
    })
    .filter((p): p is Point => Boolean(p))
}

export function curvesToPercent(
  curves: (Point | null)[] | undefined,
  width: number,
  height: number,
): string {
  if (!curves?.length || !width || !height) return ''
  return curves
    .map((point) => {
      if (!point) return '-'
      const px = Math.min(100, Math.max(0, (point[0] / width) * 100))
      const py = Math.min(100, Math.max(0, (point[1] / height) * 100))
      return `${px.toFixed(2)},${py.toFixed(2)}`
    })
    .join(' ')
}

export function percentCurvesToPoints(
  curvesPercent: string | undefined,
  width: number,
  height: number,
  edgeCount: number,
): (Point | null)[] {
  const empty = Array.from({ length: edgeCount }, () => null as Point | null)
  if (!curvesPercent?.trim() || !width || !height || edgeCount < 1) return empty
  const tokens = curvesPercent.trim().split(/\s+/)
  return Array.from({ length: edgeCount }, (_, i) => {
    const token = tokens[i]
    if (!token || token === '-') return null
    const [px, py] = token.split(',').map(Number)
    if (!Number.isFinite(px) || !Number.isFinite(py)) return null
    return [
      Math.round((Math.min(100, Math.max(0, px)) / 100) * width),
      Math.round((Math.min(100, Math.max(0, py)) / 100) * height),
    ] as Point
  })
}

/** pointsPercent denso (con curvas muestreadas) para el showroom. */
export function zoneDisplayPointsPercent(zone: FloorPlanZone): string {
  if (!zone.curvesPercent?.trim() || !zone.curvesPercent.includes(',')) {
    return zone.pointsPercent
  }
  // Reconstruye en un espacio 0–100 y densifica.
  const verts = percentPointsToPolygon(zone.pointsPercent, 1000, 1000)
  if (verts.length < 3) return zone.pointsPercent
  const curves = percentCurvesToPoints(zone.curvesPercent, 1000, 1000, verts.length)
  if (!curves.some(Boolean)) return zone.pointsPercent
  return polygonToPercentPoints(densifyPolygon(verts, curves), 1000, 1000)
}

export function apartmentsToZones(
  apartments: Apartment[],
  width: number,
  height: number,
): FloorPlanZone[] {
  return apartments.map((item, index) => {
    const curves = normalizeCurves(item.polygon, item.curves)
    const hasCurves = curves.some(Boolean)
    return {
      id: item.id,
      label: item.id,
      order: index,
      polygon: item.polygon,
      pointsPercent: polygonToPercentPoints(item.polygon, width, height),
      curvesPercent: hasCurves ? curvesToPercent(curves, width, height) : undefined,
      kind: item.kind === 'circle' ? 'circle' : 'polygon',
    }
  })
}

/** Reconstruye zonas en px de la imagen actual a partir de % (sirve para pasar 2D ↔ 3D). */
export function zonesToApartments(
  zones: FloorPlanZone[],
  width?: number,
  height?: number,
): Apartment[] {
  return zones.map((zone) => {
    const w = width || 1000
    const h = height || 1000
    const polygon =
      width && height && zone.pointsPercent
        ? percentPointsToPolygon(zone.pointsPercent, width, height)
        : zone.polygon
    const usable = polygon.length >= 3 ? polygon : zone.polygon
    const curves = percentCurvesToPoints(zone.curvesPercent, w, h, usable.length)
    const dense = densifyPolygon(usable, curves)
    const xs = dense.map((p) => p[0])
    const ys = dense.map((p) => p[1])
    const x0 = Math.min(...xs)
    const y0 = Math.min(...ys)
    const x1 = Math.max(...xs)
    const y1 = Math.max(...ys)
    return {
      id: zone.id,
      kind: zone.kind === 'circle' ? 'circle' : 'polygon',
      polygon: usable,
      curves: curves.some(Boolean) ? curves : undefined,
      bbox: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
      center: [(x0 + x1) / 2, (y0 + y1) / 2],
      confidence: 1,
      needsReview: false,
    }
  })
}

export function parseFloorPlanZonesDoc(value: unknown): FloorPlanZonesDoc | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Partial<FloorPlanZonesDoc> & {
    variants?: Partial<Record<FloorPlanVariant, unknown>>
  }
  const floor = Number(row.floor)
  const typologyCode = typeof row.typologyCode === 'string' ? row.typologyCode.trim() : ''
  const imageWidth = Number(row.imageWidth)
  const imageHeight = Number(row.imageHeight)
  if (!typologyCode || !Number.isFinite(floor)) return null
  if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight)) return null
  const zones: FloorPlanZone[] = []
  if (Array.isArray(row.zones)) {
    for (const item of row.zones) {
      if (!item || typeof item !== 'object') continue
      const z = item as Partial<FloorPlanZone>
      const id = typeof z.id === 'string' ? z.id.trim() : ''
      const polygon = Array.isArray(z.polygon)
        ? (z.polygon.filter(
            (p) =>
              Array.isArray(p) &&
              p.length >= 2 &&
              Number.isFinite(Number(p[0])) &&
              Number.isFinite(Number(p[1])),
          ) as Point[])
        : []
      const pointsPercent =
        typeof z.pointsPercent === 'string' && z.pointsPercent.trim()
          ? z.pointsPercent
          : polygonToPercentPoints(polygon, imageWidth, imageHeight)
      const curvesPercent =
        typeof z.curvesPercent === 'string' && z.curvesPercent.trim()
          ? z.curvesPercent.trim()
          : undefined
      if (!id) continue
      if (polygon.length < 3 && percentPointsToPolygon(pointsPercent, imageWidth || 100, imageHeight || 100).length < 3) {
        continue
      }
      zones.push({
        id,
        label: typeof z.label === 'string' && z.label.trim() ? z.label.trim() : id,
        order: Number.isFinite(Number(z.order)) ? Number(z.order) : zones.length,
        polygon:
          polygon.length >= 3
            ? polygon
            : percentPointsToPolygon(pointsPercent, imageWidth || 100, imageHeight || 100),
        kind: z.kind === 'circle' ? 'circle' : 'polygon',
        pointsPercent,
        curvesPercent,
      })
    }
  }

  const rawVariants = row.variants && typeof row.variants === 'object' ? row.variants : null
  const draft: FloorPlanZonesDoc = {
    floor,
    typologyCode,
    imageUrl: typeof row.imageUrl === 'string' ? row.imageUrl : null,
    imageWidth,
    imageHeight,
    variants: {
      '2d': parseMedia(rawVariants?.['2d']),
      '3d': parseMedia(rawVariants?.['3d']),
    },
    align: {
      '2d': parseOverlayAlign(
        row.align && typeof row.align === 'object'
          ? (row.align as Partial<Record<FloorPlanVariant, unknown>>)['2d']
          : null,
      ),
      '3d': parseOverlayAlign(
        row.align && typeof row.align === 'object'
          ? (row.align as Partial<Record<FloorPlanVariant, unknown>>)['3d']
          : null,
      ),
    },
    zones,
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : new Date().toISOString(),
  }
  return withFloorPlanVariants(draft)
}

export async function loadFloorPlanZones(
  supabase: SupabaseClient,
  typologyCode: string,
  floor: number,
): Promise<FloorPlanZonesDoc | null> {
  const path = floorPlanZonesPath(typologyCode, floor)
  const { data, error } = await supabase.storage.from(TYPOLOGY_ASSETS_BUCKET).download(path)
  if (error || !data) return null
  try {
    return parseFloorPlanZonesDoc(JSON.parse(await data.text()))
  } catch {
    return null
  }
}

export async function saveFloorPlanZones(
  supabase: SupabaseClient,
  doc: FloorPlanZonesDoc,
): Promise<FloorPlanZonesDoc> {
  const normalized = withFloorPlanVariants(doc)
  const next: FloorPlanZonesDoc = {
    ...normalized,
    zones: normalized.zones.map((zone, index) => ({
      ...zone,
      order: index,
      pointsPercent:
        zone.pointsPercent ||
        polygonToPercentPoints(zone.polygon, normalized.imageWidth, normalized.imageHeight),
    })),
    updatedAt: new Date().toISOString(),
  }
  const { error } = await supabase.storage.from(TYPOLOGY_ASSETS_BUCKET).upload(
    floorPlanZonesPath(doc.typologyCode, doc.floor),
    JSON.stringify(next),
    // El bucket typology-assets solo admite imágenes; mismo truco que hotspots.
    { upsert: true, contentType: 'image/webp', cacheControl: '300' },
  )
  if (error) throw new Error(error.message || 'No se pudieron guardar las zonas del piso')
  return next
}
