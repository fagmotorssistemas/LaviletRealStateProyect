/**
 * Precarga las fotos del showroom sin re-encodear.
 * La Image queda viva para que el cambio de vista salga de memoria.
 */
const hotImages = new Map<string, HTMLImageElement>()
const inflight = new Map<string, Promise<void>>()
const ready = new Set<string>()
let queue: string[] = []
let running = 0
const CONCURRENCY = 2

export function preloadStill(url: string | null | undefined): Promise<void> {
  if (!url || typeof window === 'undefined') return Promise.resolve()
  if (ready.has(url) && hotImages.has(url)) return Promise.resolve()
  const existing = inflight.get(url)
  if (existing) return existing

  const task = new Promise<void>((resolve) => {
    const img = new window.Image()
    hotImages.set(url, img)
    img.decoding = 'async'
    const finish = () => {
      ready.add(url)
      resolve()
    }
    img.onload = () => {
      if (typeof img.decode === 'function') {
        void img.decode().catch(() => undefined).finally(finish)
      } else {
        finish()
      }
    }
    img.onerror = () => {
      hotImages.delete(url)
      inflight.delete(url)
      resolve()
    }
    img.src = url
    if (img.complete && img.naturalWidth > 0) finish()
  })
  inflight.set(url, task)
  return task
}

function pump() {
  while (running < CONCURRENCY && queue.length > 0) {
    const url = queue.shift()
    if (!url || ready.has(url)) continue
    running += 1
    void preloadStill(url).finally(() => {
      running -= 1
      pump()
    })
  }
}

/** Encola fotos. `priority` se baja primero; la cola anterior se reemplaza. */
export function warmStills(
  urls: Array<string | null | undefined>,
  priority: Array<string | null | undefined> = [],
) {
  const seen = new Set<string>()
  const next: string[] = []
  for (const url of [...priority, ...urls]) {
    if (!url || seen.has(url) || ready.has(url)) continue
    seen.add(url)
    next.push(url)
  }
  queue = next
  pump()
}
