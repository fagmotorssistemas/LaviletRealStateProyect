/**
 * Cache en memoria + fetch del plano del edificio para el showroom.
 * Evita refetch al remount y permite precargar imagen/HTML sin bajar calidad.
 */
import { FLOOR_PLAN_SCOPE } from '@/lib/tour/floorPlanHotspots'
import {
  floorPlanVariantHasMedia,
  getFloorPlanVariantMedia,
  withFloorPlanVariants,
  type FloorPlanVariant,
  type FloorPlanZonesDoc,
} from '@/lib/tour/floorPlanZones'

const docCache = new Map<string, FloorPlanZonesDoc | null>()
const docCacheAt = new Map<string, number>()
const inflight = new Map<string, Promise<FloorPlanZonesDoc | null>>()
const imageReady = new Map<string, Promise<void>>()
const imageComplete = new Set<string>()
/** Image() vivos: mantienen decode en memoria del browser para swap instantáneo. */
const hotImages = new Map<string, HTMLImageElement>()
const htmlReady = new Map<string, Promise<void>>()
const htmlComplete = new Set<string>()
/** Cache de doc en showroom: largo; el CRM invalida al subir. */
const DOC_CACHE_TTL_MS = 10 * 60_000

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

export function isFloorPlanHtmlReady(url: string | null | undefined): boolean {
  return Boolean(url && htmlComplete.has(url))
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
      imageReady.delete(url)
      imageComplete.delete(url)
      resolve()
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

/**
 * Precarga el HTML 3D en el cache HTTP del browser (misma calidad).
 * El iframe luego reutiliza la respuesta ya bajada.
 */
export function preloadFloorPlanHtml(url: string | null | undefined): Promise<void> {
  if (!url || typeof window === 'undefined') return Promise.resolve()
  if (htmlComplete.has(url)) return Promise.resolve()
  const existing = htmlReady.get(url)
  if (existing) return existing

  const task = fetch(url, {
    credentials: 'same-origin',
    cache: 'force-cache',
  })
    .then(async (res) => {
      if (!res.ok) return
      await res.arrayBuffer()
      htmlComplete.add(url)
    })
    .catch(() => undefined)
    .then(() => undefined)

  htmlReady.set(url, task)
  return task
}

export function preferredFloorVariant(doc: FloorPlanZonesDoc): FloorPlanVariant {
  if (floorPlanVariantHasMedia(doc.variants?.['3d'])) return '3d'
  if (floorPlanVariantHasMedia(doc.variants?.['2d'])) return '2d'
  return '3d'
}

export function planDocMediaUrl(
  doc: FloorPlanZonesDoc | null | undefined,
  variant?: FloorPlanVariant,
  opts?: { floor?: number; typologyCode?: string },
): { url: string | null; kind: 'image' | 'html' } {
  if (!doc) return { url: null, kind: 'image' }
  const v = variant ?? preferredFloorVariant(doc)
  const media = getFloorPlanVariantMedia(doc, v)
  if (media.htmlUrl) {
    const floor = opts?.floor ?? doc.floor
    const typologyCode = opts?.typologyCode ?? doc.typologyCode ?? FLOOR_PLAN_SCOPE
    // Proxy: Storage no sirve HTML ejecutable (text/plain + CSP sandbox).
    const proxy = `/api/tour/floor-plan-html?typology_code=${encodeURIComponent(typologyCode)}&floor=${floor}&v=${encodeURIComponent(doc.updatedAt || '')}`
    return { url: proxy, kind: 'html' }
  }
  if (media.imageUrl) {
    return { url: versionedFloorPlanUrl(media.imageUrl, doc.updatedAt), kind: 'image' }
  }
  const alt = getFloorPlanVariantMedia(doc, v === '2d' ? '3d' : '2d')
  if (alt.htmlUrl) {
    const floor = opts?.floor ?? doc.floor
    const typologyCode = opts?.typologyCode ?? doc.typologyCode ?? FLOOR_PLAN_SCOPE
    const proxy = `/api/tour/floor-plan-html?typology_code=${encodeURIComponent(typologyCode)}&floor=${floor}&v=${encodeURIComponent(doc.updatedAt || '')}`
    return { url: proxy, kind: 'html' }
  }
  return {
    url: versionedFloorPlanUrl(alt.imageUrl || doc.imageUrl, doc.updatedAt),
    kind: 'image',
  }
}

/** @deprecated Prefer planDocMediaUrl — mantiene compat con callers de imagen. */
export function planDocImageUrl(
  doc: FloorPlanZonesDoc | null | undefined,
  variant?: FloorPlanVariant,
): string | null {
  const media = planDocMediaUrl(doc, variant)
  return media.kind === 'image' ? media.url : null
}

export type ReadyFloorView = {
  floor: number
  doc: FloorPlanZonesDoc
  variant: FloorPlanVariant
  url: string
  kind: 'image' | 'html'
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
  const media = planDocMediaUrl(doc, v)
  if (!media.url) return null
  if (media.kind === 'image' && !isFloorPlanImageReady(media.url)) return null
  if (media.kind === 'html' && !isFloorPlanHtmlReady(media.url)) return null
  return { floor, doc, variant: v, url: media.url, kind: media.kind }
}

/** Doc en cache + URL aunque la media aún no haya terminado. */
export function getCachedFloorView(
  floor: number,
  variant?: FloorPlanVariant,
  typologyCode: string = FLOOR_PLAN_SCOPE,
): ReadyFloorView | null {
  const doc = getCachedFloorPlanDoc(floor, typologyCode)
  if (doc === undefined || !doc) return null
  const v = variant ?? preferredFloorVariant(doc)
  const media = planDocMediaUrl(doc, v)
  if (!media.url) return null
  return { floor, doc, variant: v, url: media.url, kind: media.kind }
}

async function warmDocMedia(doc: FloorPlanZonesDoc | null) {
  if (!doc) return
  const primary = preferredFloorVariant(doc)
  const primaryMedia = planDocMediaUrl(doc, primary)
  if (primaryMedia.kind === 'html') {
    await preloadFloorPlanHtml(primaryMedia.url)
  } else {
    await preloadFloorPlanImage(primaryMedia.url)
  }
  const secondary = primary === '2d' ? '3d' : '2d'
  const secondaryMedia = planDocMediaUrl(doc, secondary)
  if (secondaryMedia.kind === 'html') void preloadFloorPlanHtml(secondaryMedia.url)
  else if (secondaryMedia.kind === 'image') void preloadFloorPlanImage(secondaryMedia.url)
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
  const cachedAt = docCacheAt.get(key) ?? 0
  if (docCache.has(key) && Date.now() - cachedAt < DOC_CACHE_TTL_MS) {
    const cached = docCache.get(key) ?? null
    void warmDocMedia(cached)
    return cached
  }

  const pending = inflight.get(key)
  if (pending) return pending

  const request = fetch(
    `/api/tour/floor-plans?typology_code=${encodeURIComponent(typologyCode)}&floor=${floor}`,
    { cache: 'default' },
  )
    .then(async (res) => {
      if (!res.ok) return null
      const json = (await res.json()) as { doc?: FloorPlanZonesDoc | null }
      return json.doc ? withFloorPlanVariants(json.doc) : null
    })
    .catch(() => null)
    .then((doc) => {
      docCache.set(key, doc)
      docCacheAt.set(key, Date.now())
      inflight.delete(key)
      void warmDocMedia(doc)
      return doc
    })

  inflight.set(key, request)
  return request
}

/**
 * Doc + media lista para pintar (sin flash negro).
 */
export async function fetchFloorPlanReady(
  floor: number,
  typologyCode: string = FLOOR_PLAN_SCOPE,
): Promise<ReadyFloorView | null> {
  const doc = await fetchFloorPlanDoc(floor, typologyCode)
  if (!doc) return null
  const variant = preferredFloorVariant(doc)
  const media = planDocMediaUrl(doc, variant)
  if (!media.url) return { floor, doc, variant, url: '', kind: 'image' }
  if (media.kind === 'image') await preloadFloorPlanImage(media.url)
  else await preloadFloorPlanHtml(media.url)
  return { floor, doc, variant, url: media.url, kind: media.kind }
}

/** Precarga JSON (+ media en background) de varios pisos. */
export function prefetchFloorPlans(floors: number[], typologyCode: string = FLOOR_PLAN_SCOPE) {
  for (const floor of floors) {
    void fetchFloorPlanDoc(floor, typologyCode)
  }
}

/**
 * Calienta pisos en paralelo (prioridad primero).
 * Precarga HTML/imagen en HTTP cache; no monta WebGL.
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

  // Más paralelismo en los primeros (activo + vecinos); el resto sigue en cola.
  const concurrency = Math.min(6, Math.max(3, order.length))
  let index = 0
  const workers = Array.from({ length: Math.min(concurrency, order.length || 1) }, async () => {
    while (index < order.length) {
      const floor = order[index]
      index += 1
      await fetchFloorPlanReady(floor, typologyCode)
    }
  })
  return Promise.all(workers).then(() => undefined)
}

export function invalidateFloorPlanCache(floor?: number, typologyCode: string = FLOOR_PLAN_SCOPE) {
  if (floor == null) {
    docCache.clear()
    docCacheAt.clear()
    inflight.clear()
    imageReady.clear()
    imageComplete.clear()
    hotImages.clear()
    htmlReady.clear()
    htmlComplete.clear()
    return
  }
  const key = cacheKey(typologyCode, floor)
  docCache.delete(key)
  docCacheAt.delete(key)
  inflight.delete(key)

  // Limpiar HTML precacheado de este piso (URLs con floor=N en el proxy).
  const floorMarker = `floor=${floor}`
  const typologyMarker = `typology_code=${encodeURIComponent(typologyCode)}`
  for (const url of [...htmlComplete]) {
    if (url.includes(floorMarker) && url.includes(typologyMarker)) {
      htmlComplete.delete(url)
      htmlReady.delete(url)
    }
  }
  for (const url of [...htmlReady.keys()]) {
    if (url.includes(floorMarker) && url.includes(typologyMarker)) {
      htmlReady.delete(url)
    }
  }
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
      docCacheAt.set(key, Date.now())
      inflight.delete(key)
      void warmDocMedia(doc)
      return doc
    })
  inflight.set(key, request)
  return request
}
