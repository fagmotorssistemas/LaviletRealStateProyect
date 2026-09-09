/**
 * Zonas de departamentos por piso (polígonos manuales sobre el plano).
 * Persistidos en storage junto a tipologías.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { TYPOLOGY_ASSETS_BUCKET } from '@/lib/typology-assets'
import type { Apartment, Point } from '@/lib/floor-plan/types'

export type FloorPlanZone = {
  id: string
  label: string
  order: number
  /** Polígono en px de la imagen */
  polygon: Point[]
  /** Polígono 0–100 para el showroom SVG */
  pointsPercent: string
}

export type FloorPlanZonesDoc = {
  floor: number
  typologyCode: string
  imageUrl: string | null
  imageWidth: number
  imageHeight: number
  zones: FloorPlanZone[]
  updatedAt: string
}

export function floorPlanZonesPath(typologyCode: string, floor: number) {
  return `${typologyCode}/floor-${floor}-zones.json`
}

export function floorPlanImagePath(typologyCode: string, floor: number, ext = 'webp') {
  return `${typologyCode}/floor-${floor}-plan.${ext}`
}

export type FloorPlanFloorSummary = {
  floor: number
  imageUrl: string | null
  zoneCount: number
  updatedAt: string | null
}

const FLOOR_PLAN_IMAGE_EXTS = ['webp', 'jpg', 'jpeg', 'png', 'gif'] as const

export async function uploadFloorPlanImage(
  supabase: SupabaseClient,
  typologyCode: string,
  floor: number,
  buffer: Buffer,
  contentType: string,
  ext = 'webp',
): Promise<{ path: string; publicUrl: string }> {
  // Limpia otras extensiones del mismo piso para no dejar basura.
  const stale = FLOOR_PLAN_IMAGE_EXTS.filter((item) => item !== ext).map((item) =>
    floorPlanImagePath(typologyCode, floor, item),
  )
  if (stale.length > 0) {
    await supabase.storage.from(TYPOLOGY_ASSETS_BUCKET).remove(stale)
  }

  const path = floorPlanImagePath(typologyCode, floor, ext)
  const { error } = await supabase.storage.from(TYPOLOGY_ASSETS_BUCKET).upload(path, buffer, {
    upsert: true,
    contentType,
    cacheControl: '0',
  })
  if (error) throw new Error(error.message || 'No se pudo subir el plano del piso')
  const { data } = supabase.storage.from(TYPOLOGY_ASSETS_BUCKET).getPublicUrl(path)
  const publicUrl = `${data.publicUrl}${data.publicUrl.includes('?') ? '&' : '?'}v=${Date.now()}`
  return { path, publicUrl }
}

export async function deleteFloorPlanImage(
  supabase: SupabaseClient,
  typologyCode: string,
  floor: number,
): Promise<void> {
  const paths = FLOOR_PLAN_IMAGE_EXTS.map((ext) => floorPlanImagePath(typologyCode, floor, ext))
  await supabase.storage.from(TYPOLOGY_ASSETS_BUCKET).remove(paths)
  const existing = await loadFloorPlanZones(supabase, typologyCode, floor)
  if (!existing) return
  await saveFloorPlanZones(supabase, {
    ...existing,
    imageUrl: null,
  })
}

export async function deleteFloorPlanFloor(
  supabase: SupabaseClient,
  typologyCode: string,
  floor: number,
): Promise<void> {
  await deleteFloorPlanImage(supabase, typologyCode, floor)
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
      return {
        floor,
        imageUrl: doc?.imageUrl ?? null,
        zoneCount: doc?.zones.length ?? 0,
        updatedAt: doc?.updatedAt ?? null,
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

export function apartmentsToZones(
  apartments: Apartment[],
  width: number,
  height: number,
): FloorPlanZone[] {
  return apartments.map((item, index) => ({
    id: item.id,
    label: item.id,
    order: index,
    polygon: item.polygon,
    pointsPercent: polygonToPercentPoints(item.polygon, width, height),
  }))
}

export function zonesToApartments(zones: FloorPlanZone[]): Apartment[] {
  return zones.map((zone) => {
    const xs = zone.polygon.map((p) => p[0])
    const ys = zone.polygon.map((p) => p[1])
    const x0 = Math.min(...xs)
    const y0 = Math.min(...ys)
    const x1 = Math.max(...xs)
    const y1 = Math.max(...ys)
    return {
      id: zone.id,
      polygon: zone.polygon,
      bbox: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
      center: [(x0 + x1) / 2, (y0 + y1) / 2],
      confidence: 1,
      needsReview: false,
    }
  })
}

export function parseFloorPlanZonesDoc(value: unknown): FloorPlanZonesDoc | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Partial<FloorPlanZonesDoc>
  const floor = Number(row.floor)
  const typologyCode = typeof row.typologyCode === 'string' ? row.typologyCode.trim() : ''
  const imageWidth = Number(row.imageWidth)
  const imageHeight = Number(row.imageHeight)
  if (!typologyCode || !Number.isFinite(floor) || floor < 1) return null
  if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight)) return null
  const zones: FloorPlanZone[] = []
  if (Array.isArray(row.zones)) {
    for (const item of row.zones) {
      if (!item || typeof item !== 'object') continue
      const z = item as Partial<FloorPlanZone>
      const id = typeof z.id === 'string' ? z.id.trim() : ''
      const polygon = Array.isArray(z.polygon)
        ? (z.polygon.filter(
            (p) => Array.isArray(p) && p.length >= 2 && Number.isFinite(Number(p[0])) && Number.isFinite(Number(p[1])),
          ) as Point[])
        : []
      if (!id || polygon.length < 3) continue
      zones.push({
        id,
        label: typeof z.label === 'string' && z.label.trim() ? z.label.trim() : id,
        order: Number.isFinite(Number(z.order)) ? Number(z.order) : zones.length,
        polygon,
        pointsPercent:
          typeof z.pointsPercent === 'string' && z.pointsPercent.trim()
            ? z.pointsPercent
            : polygonToPercentPoints(polygon, imageWidth, imageHeight),
      })
    }
  }
  return {
    floor,
    typologyCode,
    imageUrl: typeof row.imageUrl === 'string' ? row.imageUrl : null,
    imageWidth,
    imageHeight,
    zones,
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : new Date().toISOString(),
  }
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
  const next: FloorPlanZonesDoc = {
    ...doc,
    zones: doc.zones.map((zone, index) => ({
      ...zone,
      order: index,
      pointsPercent:
        zone.pointsPercent ||
        polygonToPercentPoints(zone.polygon, doc.imageWidth, doc.imageHeight),
    })),
    updatedAt: new Date().toISOString(),
  }
  const { error } = await supabase.storage.from(TYPOLOGY_ASSETS_BUCKET).upload(
    floorPlanZonesPath(doc.typologyCode, doc.floor),
    JSON.stringify(next),
    { upsert: true, contentType: 'application/json', cacheControl: '0' },
  )
  if (error) throw new Error(error.message || 'No se pudieron guardar las zonas del piso')
  return next
}
