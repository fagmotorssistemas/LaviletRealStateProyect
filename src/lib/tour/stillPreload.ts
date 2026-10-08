/**
 * Precarga las fotos del showroom sin re-encodear.
 * Como máximo 5 imágenes decodificadas (las más recientes). Al sacar una, se suelta el bitmap.
 */
const hotImages = new Map<string, HTMLImageElement>()
const inflight = new Map<string, Promise<void>>()
const ready = new Set<string>()
const recent: string[] = []
let queue: string[] = []
let running = 0
const CONCURRENCY = 2
const MAX_DECODED = 5

function fileNameOf(url: string) {
  try {
    const path = new URL(url, 'https://local.invalid').pathname
    return decodeURIComponent(path.split('/').pop() || '')
  } catch {
    return url.split('?')[0]?.split('/').pop() || ''
  }
}

/** Una panorámica 360 no se precarga como foto: el visor ya tiene su propia textura. */
export function isPanoramaStillUrl(url: string) {
  const name = fileNameOf(url)
  if (!name) return false
  const base = name.replace(/\.[^.]+$/, '')
  if (/(?:^|[._-])(360|pano|equirect|panorama)(?:[._-]|$)/i.test(base)) return true
  if (/^vista-/i.test(name)) return false
  return /_(?:8192|4096)(?:-r\d+)?\./i.test(name)
}

function releaseUrl(url: string) {
  const img = hotImages.get(url)
  if (img) {
    img.onload = null
    img.onerror = null
    img.src = ''
  }
  hotImages.delete(url)
  ready.delete(url)
  inflight.delete(url)
  const at = recent.indexOf(url)
  if (at >= 0) recent.splice(at, 1)
}

function remember(url: string, img: HTMLImageElement) {
  const at = recent.indexOf(url)
  if (at >= 0) recent.splice(at, 1)
  recent.push(url)
  hotImages.set(url, img)
  while (recent.length > MAX_DECODED) {
    const drop = recent.shift()
    if (!drop || drop === url) continue
    const old = hotImages.get(drop)
    if (old && old !== img) {
      old.onload = null
      old.onerror = null
      old.src = ''
    }
    hotImages.delete(drop)
    ready.delete(drop)
    inflight.delete(drop)
  }
}

export function preloadStill(url: string | null | undefined): Promise<void> {
  if (!url || typeof window === 'undefined' || isPanoramaStillUrl(url)) return Promise.resolve()
  if (ready.has(url) && hotImages.has(url)) {
    remember(url, hotImages.get(url)!)
    return Promise.resolve()
  }
  const existing = inflight.get(url)
  if (existing) return existing

  const task = new Promise<void>((resolve) => {
    const img = new window.Image()
    img.decoding = 'async'
    const finish = () => {
      remember(url, img)
      ready.add(url)
      inflight.delete(url)
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
      releaseUrl(url)
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
    if (!url || ready.has(url) || isPanoramaStillUrl(url)) continue
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
    if (!url || seen.has(url) || ready.has(url) || isPanoramaStillUrl(url)) continue
    seen.add(url)
    next.push(url)
  }
  queue = next
  pump()
}
