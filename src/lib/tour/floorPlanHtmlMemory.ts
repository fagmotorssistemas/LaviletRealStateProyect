/**
 * Cache en memoria del HTML de plano ya inyectado (proceso Node).
 * Debe invalidarse al subir/borrar un HTML 3D.
 */
type HtmlCacheEntry = { html: string; etag: string }

const htmlMemoryCache = new Map<string, HtmlCacheEntry>()

export function floorPlanHtmlMemoryKey(typologyCode: string, floor: number, version: string) {
  // bridgeRev: subir al cambiar el script inyectado.
  return `${typologyCode}:${floor}:${version}:bridge7`
}

export function getFloorPlanHtmlMemory(key: string) {
  return htmlMemoryCache.get(key) ?? null
}

export function setFloorPlanHtmlMemory(key: string, entry: HtmlCacheEntry) {
  htmlMemoryCache.set(key, entry)
  if (htmlMemoryCache.size > 40) {
    const first = htmlMemoryCache.keys().next().value
    if (first) htmlMemoryCache.delete(first)
  }
}

/** Borra entradas de un piso (todas las versiones, incluido `latest` legado). */
export function invalidateFloorPlanHtmlMemory(typologyCode: string, floor: number) {
  const prefix = `${typologyCode}:${floor}:`
  for (const key of [...htmlMemoryCache.keys()]) {
    if (key.startsWith(prefix)) htmlMemoryCache.delete(key)
  }
}
