import { hasAdsConsent, META_PIXEL_ID, META_PIXEL_SIMULATE } from '@/lib/tour/consent'

declare global {
  interface Window {
    fbq?: FbqFn
    _fbq?: FbqFn
    __lvMetaPixelInitialized?: string
    __lvMetaPixelConsent?: 'grant' | 'revoke'
    __lvMetaPixelLog?: Array<{ at: string; args: unknown[] }>
    __lvMetaPixelNetwork?: Array<{ at: string; url: string; kind: string }>
  }
}

export type FbqFn = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void
  queue: unknown[]
  loaded?: boolean
  version?: string
  push?: (...args: unknown[]) => void
}

export type MetaBrowserEvent = 'PageView' | 'ViewContent' | 'Lead' | 'Schedule'

const EXCLUDED_PREFIXES = [
  '/inmobiliaria',
  '/login',
  '/register',
  '/acceso-pendiente',
  '/cuenta',
  '/api',
  // Simulador de cuota / financiamiento: no PageView ni pixel bajo FS core setup.
  '/simulador',
]

const PUBLIC_PREFIXES = [
  '/',
  '/inicio',
  '/tour',
  '/contacto',
  '/proyectos',
  '/proceso',
  '/nosotros',
  '/ubicanos',
  '/privacidad',
  '/departamento',
]

export function isMetaPublicPath(pathname: string): boolean {
  if (!pathname) return false
  if (EXCLUDED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return false
  }
  if (pathname === '/') return true
  return PUBLIC_PREFIXES.some((p) => p !== '/' && (pathname === p || pathname.startsWith(`${p}/`)))
}

export function isMetaExcludedPath(pathname: string): boolean {
  if (!pathname) return true
  return EXCLUDED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

export function newMetaEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `lv_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

function currentPathname(): string {
  if (typeof window === 'undefined') return ''
  return window.location?.pathname || ''
}

function pushLog(args: unknown[]) {
  if (typeof window === 'undefined') return
  window.__lvMetaPixelLog = [
    ...(window.__lvMetaPixelLog ?? []),
    { at: new Date().toISOString(), args },
  ]
}

function pushNetwork(url: string, kind: string) {
  if (typeof window === 'undefined') return
  window.__lvMetaPixelNetwork = [
    ...(window.__lvMetaPixelNetwork ?? []),
    { at: new Date().toISOString(), url, kind },
  ]
}

function installSimulateFbq() {
  if (typeof window === 'undefined') return
  if (window.fbq) return
  const n = function (...args: unknown[]) {
    pushLog(args)
    console.info('[MetaPixel simulate]', ...args)
  } as FbqFn
  n.queue = []
  n.loaded = true
  n.version = '2.0'
  n.push = n
  window.fbq = n
  window._fbq = n
}

function installOfficialStub() {
  if (typeof window === 'undefined') return
  if (window.fbq) return
  const n = function (...args: unknown[]) {
    const fbq = n as FbqFn
    if (fbq.callMethod) {
      fbq.callMethod(...args)
    } else {
      fbq.queue.push(args)
    }
  } as FbqFn
  n.queue = []
  n.loaded = true
  n.version = '2.0'
  n.push = n
  window.fbq = n
  if (!window._fbq) window._fbq = n
}

function ensureFbeventsScript() {
  if (typeof document === 'undefined') return
  if (META_PIXEL_SIMULATE) {
    pushNetwork('https://connect.facebook.net/en_US/fbevents.js', 'script_skipped_simulate')
    return
  }
  const existing = document.querySelector<HTMLScriptElement>('script[data-lv-meta-pixel="1"]')
  if (existing) return
  const script = document.createElement('script')
  script.async = true
  script.src = 'https://connect.facebook.net/en_US/fbevents.js'
  script.dataset.lvMetaPixel = '1'
  pushNetwork(script.src, 'script')
  const first = document.getElementsByTagName('script')[0]
  first?.parentNode?.insertBefore(script, first)
}

/**
 * Bootstrap Pixel: stub + autoConfig off + init.
 * No carga fbevents sin consentimiento (caller debe verificar ads).
 * ViewContent/Lead pueden llamar esto antes del mount de <MetaPixel />.
 */
export function ensureMetaPixel(pixelId = META_PIXEL_ID) {
  if (typeof window === 'undefined' || !pixelId) return
  if (META_PIXEL_SIMULATE) {
    installSimulateFbq()
  } else {
    installOfficialStub()
    ensureFbeventsScript()
  }

  if (window.__lvMetaPixelInitialized === pixelId) return

  // Desactiva recolección automática (clicks / metadata) — control manual de eventos.
  window.fbq?.('set', 'autoConfig', false, pixelId)
  window.fbq?.('init', pixelId)
  window.__lvMetaPixelInitialized = pixelId
}

/** Grant/revoke según docs GDPR de Meta. Sin consentimiento no se hace init. */
export function applyMetaPixelAdsConsent(granted: boolean) {
  if (typeof window === 'undefined' || !META_PIXEL_ID) return
  if (granted) {
    ensureMetaPixel(META_PIXEL_ID)
    window.fbq?.('consent', 'grant')
    window.__lvMetaPixelConsent = 'grant'
    return
  }
  // Revoke: pausa fires. Si aún no hubo init, no cargar el script.
  if (typeof window.fbq === 'function') {
    window.fbq('consent', 'revoke')
  } else if (META_PIXEL_SIMULATE) {
    installSimulateFbq()
    window.fbq?.('consent', 'revoke')
  }
  window.__lvMetaPixelConsent = 'revoke'
}

export function trackMetaPixelEvent(
  eventName: MetaBrowserEvent,
  params?: Record<string, unknown>,
  eventId?: string,
) {
  if (typeof window === 'undefined') return
  if (!META_PIXEL_ID || !hasAdsConsent()) return
  const pathname = currentPathname()
  if (!isMetaPublicPath(pathname)) return

  // Evita perder ViewContent/Lead si el evento llega antes del effect de <MetaPixel />.
  ensureMetaPixel(META_PIXEL_ID)
  if (window.__lvMetaPixelConsent !== 'grant') {
    window.fbq?.('consent', 'grant')
    window.__lvMetaPixelConsent = 'grant'
  }

  const id = eventId || newMetaEventId()
  const options = { eventID: id }
  const payload =
    params && Object.keys(params).length
      ? (['track', eventName, params, options] as const)
      : (['track', eventName, {}, options] as const)

  if (META_PIXEL_SIMULATE) {
    pushLog([...payload])
    // URL que el Pixel real usaría (solo registro local; no se envía).
    const qs = new URLSearchParams({
      id: META_PIXEL_ID,
      ev: eventName,
      eid: id,
      dl: `${window.location.origin}${pathname}`,
    })
    pushNetwork(`https://www.facebook.com/tr?${qs.toString()}`, 'pixel_tr_simulated')
    console.info('[MetaPixel simulate]', ...payload)
    return id
  }

  const fbq = window.fbq
  if (typeof fbq !== 'function') return
  fbq(...payload)
  return id
}
