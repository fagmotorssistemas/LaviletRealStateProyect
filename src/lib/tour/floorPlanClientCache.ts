/**
 * Cache en memoria + fetch del plano del edificio para el showroom.
 * Evita refetch al remount y permite precargar imagen sin bajar calidad.
 */
import { FLOOR_PLAN_SCOPE } from '@/lib/tour/floorPlanHotspots'
import {
  getFloorPlanVariantMedia,
  withFloorPlanVariants,
  type FloorPlanVariant,
  type FloorPlanZonesDoc,
} from '@/lib/tour/floorPlanZones'

const docCache = new Map<string, FloorPlanZonesDoc | null>()
const inflight = new Map<string, Promise<FloorPlanZonesDoc | null>>()
const imageReady = new Map<string, Promise<void>>()
const imageComplete = new Set<string>()
/** Image() vivos: mantienen decode en memoria del browser para swap instantáneo. */
const hotImages = new Map<string, HTMLImageElement>()

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

export function isFloorPlanImageReady(url: string | null | undefined): boolean {
  return Boolean(url && imageComplete.has(url))
}

/** Precarga en el browser; mantiene la Image en memoria para cambio de piso instantáneo. */
export function preloadFloorPlanImage(url: string | null | undefined): Promise<void> {
  if (!url || typeof window === 'undefined') return Promise.resolve()
  if (imageComplete.has(url) && hotImages.has(url)) return Promise.resolve()
  const existing = imageReady.get(url)
  if (existing) return existing

  const task = new Promise<void>((resolve) => {
    let settled = false
    const done = () => {
      if (settled) return
      settled = true
      imageComplete.add(url)
      resolve()
    }
    // Planos grandes: no bloquear el showroom si decode tarda.
    const timeoutId = window.setTimeout(done, 4000)
    const img = new window.Image()
    hotImages.set(url, img)
    img.decoding = 'async'
    img.onload = () => {
      if (typeof img.decode === 'function') {
        void img
          .decode()
          .catch(() => undefined)
          .finally(() => {
            window.clearTimeout(timeoutId)
            done()
          })
      } else {
        window.clearTimeout(timeoutId)
        done()
      }
    }
    img.onerror = () => {
      window.clearTimeout(timeoutId)
      hotImages.delete(url)
      done()
    }
    img.src = url
    if (img.complete && img.naturalWidth > 0) {
      window.clearTimeout(timeoutId)
      done()
    }
  })
  imageReady.set(url, task)
  return task
}

export function preferredFloorVariant(doc: FloorPlanZonesDoc): FloorPlanVariant {
  if (doc.variants?.['2d']?.imageUrl) return '2d'
  if (doc.variants?.['3d']?.imageUrl) return '3d'
  return '2d'
}

export function planDocImageUrl(
  doc: FloorPlanZonesDoc | null | undefined,
  variant?: FloorPlanVariant,
): string | null {
  if (!doc) return null
  const v = variant ?? preferredFloorVariant(doc)
  const media = getFloorPlanVariantMedia(doc, v)
  const alt = getFloorPlanVariantMedia(doc, v === '2d' ? '3d' : '2d')
  return versionedFloorPlanUrl(media.imageUrl || alt.imageUrl || doc.imageUrl, doc.updatedAt)
}

export type ReadyFloorView = {
  floor: number
  doc: FloorPlanZonesDoc
  variant: FloorPlanVariant
  url: string
}

/** Vista lista para pintar YA (sync). null si aún no está en cache caliente. */
export function getReadyFloorView(
  floor: number,
  variant?: FloorPlanVariant,
  typologyCode: string = FLOOR_PLAN_SCOPE,
): ReadyFloorView | null {
  const doc = getCachedFloorPlanDoc(floor, typologyCode)
  if (doc === undefined || !doc) return null
  const v = variant ?? preferredFloorVariant(doc)
  const url = planDocImageUrl(doc, v)
  if (!url || !isFloorPlanImageReady(url)) return null
  return { floor, doc, variant: v, url }
}

/** Doc en cache + URL aunque la imagen aún no haya terminado decode. */
export function getCachedFloorView(
  floor: number,
  variant?: FloorPlanVariant,
  typologyCode: string = FLOOR_PLAN_SCOPE,
): ReadyFloorView | null {
  const doc = getCachedFloorPlanDoc(floor, typologyCode)
  if (doc === undefined || !doc) return null
  const v = variant ?? preferredFloorVariant(doc)
  const url = planDocImageUrl(doc, v)
  if (!url) return null
  return { floor, doc, variant: v, url }
}

async function warmDocImages(doc: FloorPlanZonesDoc | null) {
  if (!doc) return
  const primary = preferredFloorVariant(doc)
  await preloadFloorPlanImage(planDocImageUrl(doc, primary))
  const secondary = primary === '2d' ? '3d' : '2d'
  void preloadFloorPlanImage(planDocImageUrl(doc, secondary))
}

/** Lectura síncrona del cache (undefined = aún no pedido). */
export function getCachedFloorPlanDoc(
  floor: number,
  typologyCode: string = FLOOR_PLAN_SCOPE,
): FloorPlanZonesDoc | null | undefined {
  const key = cacheKey(typologyCode, floor)
  if (!docCache.has(key)) return undefined
  return docCache.get(key) ?? null
}

export async function fetchFloorPlanDoc(
  floor: number,
  typologyCode: string = FLOOR_PLAN_SCOPE,
): Promise<FloorPlanZonesDoc | null> {
  const key = cacheKey(typologyCode, floor)
  if (docCache.has(key)) {
    const cached = docCache.get(key) ?? null
    void warmDocImages(cached)
    return cached
  }

  const pending = inflight.get(key)
  if (pending) return pending

  const request = fetch(
    `/api/tour/floor-plans?typology_code=${encodeURIComponent(typologyCode)}&floor=${floor}`,
    { cache: 'force-cache' },
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
      void warmDocImages(doc)
      return doc
    })

  inflight.set(key, request)
  return request
}

/**
 * Doc + imagen lista para pintar (sin flash negro).
 */
export async function fetchFloorPlanReady(
  floor: number,
  typologyCode: string = FLOOR_PLAN_SCOPE,
): Promise<ReadyFloorView | null> {
  const doc = await fetchFloorPlanDoc(floor, typologyCode)
  if (!doc) return null
  const variant = preferredFloorVariant(doc)
  const url = planDocImageUrl(doc, variant)
  if (!url) return { floor, doc, variant, url: '' }
  await preloadFloorPlanImage(url)
  return { floor, doc, variant, url }
}

/** Precarga JSON (+ imagen en background) de varios pisos. */
export function prefetchFloorPlans(floors: number[], typologyCode: string = FLOOR_PLAN_SCOPE) {
  for (const floor of floors) {
    void fetchFloorPlanDoc(floor, typologyCode)
  }
}

/**
 * Calienta pisos en orden: primero prioridad, luego el resto.
 * Mantiene Images decodificadas para que el swap sea instantáneo.
 */
export function warmFloorPlans(
  floors: number[],
  priority: number[] = [],
  typologyCode: string = FLOOR_PLAN_SCOPE,
) {
  const seen = new Set<number>()
  const order = [...priority, ...floors].filter((floor) => {
    if (seen.has(floor)) return false
    seen.add(floor)
    return true
  })

  let chain = Promise.resolve()
  for (const floor of order) {
    chain = chain.then(() =>
      fetchFloorPlanReady(floor, typologyCode).then(() => undefined),
    )
  }
  return chain
}

export function invalidateFloorPlanCache(floor?: number, typologyCode: string = FLOOR_PLAN_SCOPE) {
  if (floor == null) {
    docCache.clear()
    inflight.clear()
    imageReady.clear()
    imageComplete.clear()
    hotImages.clear()
    return
  }
  const key = cacheKey(typologyCode, floor)
  docCache.delete(key)
  inflight.delete(key)
}

/** Fuerza refetch de un piso (p. ej. URL de imagen cambiada en storage). */
export function refetchFloorPlanDoc(
  floor: number,
  typologyCode: string = FLOOR_PLAN_SCOPE,
): Promise<FloorPlanZonesDoc | null> {
  invalidateFloorPlanCache(floor, typologyCode)
  const key = cacheKey(typologyCode, floor)
  const request = fetch(
    `/api/tour/floor-plans?typology_code=${encodeURIComponent(typologyCode)}&floor=${floor}&_ts=${Date.now()}`,
    { cache: 'no-store' },
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
      void warmDocImages(doc)
      return doc
    })
  inflight.set(key, request)
  return request
}
