/**
 * Cache en memoria + fetch del plano del edificio para el showroom.
 * Evita refetch al remount y permite precargar imagen sin bajar calidad.
 */
import { FLOOR_PLAN_SCOPE } from '@/lib/tour/floorPlanHotspots'
import {
  getFloorPlanVariantMedia,
  withFloorPlanVariants,
  type FloorPlanZonesDoc,
} from '@/lib/tour/floorPlanZones'

const docCache = new Map<string, FloorPlanZonesDoc | null>()
const inflight = new Map<string, Promise<FloorPlanZonesDoc | null>>()

function cacheKey(typologyCode: string, floor: number) {
  return `${typologyCode}:${floor}`
}

/** Añade ?v=updatedAt para invalidar CDN sin re-encodear. */
export function versionedFloorPlanUrl(url: string | null | undefined, updatedAt?: string | null) {
  if (!url) return null
  if (!updatedAt) return url
  const sep = url.includes('?') ? '&' : '?'
  return `${url}${sep}v=${encodeURIComponent(updatedAt)}`
}

function preloadImage(url: string | null | undefined) {
  if (!url || typeof window === 'undefined') return
  const img = new window.Image()
  img.decoding = 'async'
  img.src = url
}

export async function fetchFloorPlanDoc(
  floor: number,
  typologyCode: string = FLOOR_PLAN_SCOPE,
): Promise<FloorPlanZonesDoc | null> {
  const key = cacheKey(typologyCode, floor)
  if (docCache.has(key)) return docCache.get(key) ?? null

  const pending = inflight.get(key)
  if (pending) return pending

  const request = fetch(
    `/api/tour/floor-plans?typology_code=${encodeURIComponent(typologyCode)}&floor=${floor}`,
  )
    .then(async (res) => {
      if (!res.ok) return null
      const json = (await res.json()) as { doc?: FloorPlanZonesDoc | null }
      return json.doc ? withFloorPlanVariants(json.doc) : null
    })
    .catch(() => null)
    .then((doc) => {
      docCache.set(key, doc)
      inflight.delete(key)
      if (doc) {
        const media2d = getFloorPlanVariantMedia(doc, '2d')
        const media3d = getFloorPlanVariantMedia(doc, '3d')
        preloadImage(versionedFloorPlanUrl(media2d.imageUrl, doc.updatedAt))
        preloadImage(versionedFloorPlanUrl(media3d.imageUrl, doc.updatedAt))
      }
      return doc
    })

  inflight.set(key, request)
  return request
}

/** Precarga un piso y opcionalmente vecinos (mismo layout, sin bajar calidad). */
export function prefetchFloorPlans(floors: number[], typologyCode: string = FLOOR_PLAN_SCOPE) {
  for (const floor of floors) {
    void fetchFloorPlanDoc(floor, typologyCode)
  }
}

export function invalidateFloorPlanCache(floor?: number, typologyCode: string = FLOOR_PLAN_SCOPE) {
  if (floor == null) {
    docCache.clear()
    inflight.clear()
    return
  }
  const key = cacheKey(typologyCode, floor)
  docCache.delete(key)
  inflight.delete(key)
}
