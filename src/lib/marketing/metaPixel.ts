import { hasAdsConsent, META_PIXEL_ID, META_PIXEL_SIMULATE } from '@/lib/tour/consent'

declare global {
  interface Window {
    __lvMetaPixelLog?: Array<{ at: string; args: unknown[] }>
  }
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

export function newMetaEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `lv_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

export function trackMetaPixelEvent(
  eventName: MetaBrowserEvent,
  params?: Record<string, unknown>,
  eventId?: string,
) {
  if (typeof window === 'undefined') return
  if (!META_PIXEL_ID || !hasAdsConsent()) return
  const id = eventId || newMetaEventId()
  const options = { eventID: id }
  if (META_PIXEL_SIMULATE) {
    const entry = {
      at: new Date().toISOString(),
      args: params && Object.keys(params).length
        ? ['track', eventName, params, options]
        : ['track', eventName, {}, options],
    }
    window.__lvMetaPixelLog = [...(window.__lvMetaPixelLog ?? []), entry]
    console.info('[MetaPixel simulate]', ...entry.args)
    return id
  }
  const fbq = window.fbq
  if (typeof fbq !== 'function') return
  if (params && Object.keys(params).length) {
    fbq('track', eventName, params, options)
  } else {
    fbq('track', eventName, {}, options)
  }
  return id
}
