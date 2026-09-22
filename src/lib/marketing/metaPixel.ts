import { hasAdsConsent, META_PIXEL_ID, META_PIXEL_SIMULATE } from '@/lib/tour/consent'

declare global {
  interface Window {
    fbq?: FbqFn
    _fbq?: FbqFn
    __lvMetaPixelInitialized?: string
    __lvMetaPixelConsent?: 'grant' | 'revoke'
    /** Solo stub de pruebas unitarias / simulate: cola de llamadas fbq, no tráfico real. */
    __lvMetaPixelLog?: Array<{ at: string; args: unknown[] }>
  }
}

export type FbqFn = ((...args: unknown[]) => void) & {
  callMethod?: (...args: unknown[]) => void
  queue: unknown[]
  loaded?: boolean
  version?: string
  push?: (...args: unknown[]) => void
  /** Si true, no dispara PageView automático en history.pushState (SPA). */
  disablePushState?: boolean
  /** Requerido para emitir más de un PageView manual con disablePushState. */
  allowDuplicatePageViews?: boolean
}

export type MetaBrowserEvent =
  | 'PageView'
  | 'ViewContent'
  | 'Lead'
  | 'Schedule'
  | 'AddToWishlist'

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

/** Consentimiento ads vigente + ruta pública permitida (re-evaluado en cada bootstrap). */
export function canBootstrapMetaPixel(pathname = currentPathname()): boolean {
  if (!META_PIXEL_ID) return false
  if (!hasAdsConsent()) return false
  if (!isMetaPublicPath(pathname)) return false
  return true
}

function pushLog(args: unknown[]) {
  if (typeof window === 'undefined') return
  window.__lvMetaPixelLog = [
    ...(window.__lvMetaPixelLog ?? []),
    { at: new Date().toISOString(), args },
  ]
}

function configureManualSpaPageViews(fbq: FbqFn) {
  // Sin listener pushState: evitamos PageView automático en /simulador (y ob3_plugin-set).
  // Con allowDuplicatePageViews: nuestros PageView manuales en cada ruta pública funcionan.
  fbq.disablePushState = true
  fbq.allowDuplicatePageViews = true
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
  configureManualSpaPageViews(n)
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
  configureManualSpaPageViews(n)
  window.fbq = n
  if (!window._fbq) window._fbq = n
}

function ensureFbeventsScript() {
  if (typeof document === 'undefined') return
  if (META_PIXEL_SIMULATE) return
  const existing = document.querySelector<HTMLScriptElement>('script[data-lv-meta-pixel="1"]')
  if (existing) return
  const script = document.createElement('script')
  script.async = true
  script.src = 'https://connect.facebook.net/en_US/fbevents.js'
  script.dataset.lvMetaPixel = '1'
  script.addEventListener('load', () => {
    if (typeof window.fbq === 'function') configureManualSpaPageViews(window.fbq)
  })
  const first = document.getElementsByTagName('script')[0]
  first?.parentNode?.insertBefore(script, first)
}

function pausePixelFires() {
  if (typeof window === 'undefined') return
  if (typeof window.fbq === 'function') {
    window.fbq('consent', 'revoke')
  }
  window.__lvMetaPixelConsent = 'revoke'
}

/**
 * Bootstrap Pixel solo con consentimiento vigente y ruta permitida.
 * Seguro tras imports async (CookieBanner / revokeAdsConsent): relee cookie + pathname.
 * En /simulador (u otras excluidas) no carga stub/script ni hace init.
 */
export function ensureMetaPixel(pixelId = META_PIXEL_ID): boolean {
  if (typeof window === 'undefined' || !pixelId) return false
  if (!canBootstrapMetaPixel()) return false

  if (META_PIXEL_SIMULATE) {
    installSimulateFbq()
  } else {
    installOfficialStub()
    ensureFbeventsScript()
  }

  if (typeof window.fbq === 'function') {
    configureManualSpaPageViews(window.fbq)
  }

  if (window.__lvMetaPixelInitialized === pixelId) return true

  // Desactiva recolección automática (clicks / metadata) — control manual de eventos.
  window.fbq?.('set', 'autoConfig', false, pixelId)
  window.fbq?.('init', pixelId)
  window.__lvMetaPixelInitialized = pixelId
  return true
}

/**
 * Grant/revoke según docs GDPR de Meta.
 * grant con cookie full en ruta excluida → no carga Pixel (p. ej. aceptar en /simulador).
 * revoke siempre pausa si fbq ya existía (navegación a /simulador con script previo).
 */
export function applyMetaPixelAdsConsent(granted: boolean) {
  if (typeof window === 'undefined' || !META_PIXEL_ID) return
  if (!granted) {
    pausePixelFires()
    return
  }
  // Releer consentimiento y ruta en el momento del import async.
  if (!canBootstrapMetaPixel()) {
    pausePixelFires()
    return
  }
  // Tras revoke por ruta excluida, fbevents a veces no reanuda /tr hasta re-init.
  if (window.__lvMetaPixelConsent === 'revoke') {
    window.__lvMetaPixelInitialized = undefined
  }
  if (!ensureMetaPixel(META_PIXEL_ID)) {
    pausePixelFires()
    return
  }
  window.fbq?.('consent', 'grant')
  window.__lvMetaPixelConsent = 'grant'
}

/**
 * Al cambiar de ruta: en excluidas pausa el Pixel aunque el cookie siga en full;
 * al volver a ruta pública con consent, re-grant + bootstrap si hace falta.
 */
export function syncMetaPixelToRoute(pathname = currentPathname()) {
  if (typeof window === 'undefined' || !META_PIXEL_ID) return
  if (!hasAdsConsent() || !isMetaPublicPath(pathname)) {
    pausePixelFires()
    return
  }
  applyMetaPixelAdsConsent(true)
}

export function trackMetaPixelEvent(
  eventName: MetaBrowserEvent,
  params?: Record<string, unknown>,
  eventId?: string,
) {
  if (typeof window === 'undefined') return
  if (!canBootstrapMetaPixel()) return

  // Evita perder ViewContent/Lead si el evento llega antes del effect de <MetaPixel />.
  if (!ensureMetaPixel(META_PIXEL_ID)) return
  if (typeof window.fbq === 'function') {
    configureManualSpaPageViews(window.fbq)
  }
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
    // Stub unitario: solo registra args de fbq. No es tráfico real a Meta.
    pushLog([...payload])
    console.info('[MetaPixel simulate]', ...payload)
    return id
  }

  const fbq = window.fbq
  if (typeof fbq !== 'function') return
  fbq(...payload)
  return id
}
