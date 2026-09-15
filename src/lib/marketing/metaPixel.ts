import { hasAdsConsent, META_PIXEL_ID } from '@/lib/tour/consent'

export type MetaBrowserEvent = 'PageView' | 'ViewContent' | 'Lead' | 'Schedule'

const EXCLUDED_PREFIXES = [
  '/inmobiliaria',
  '/login',
  '/register',
  '/acceso-pendiente',
  '/cuenta',
  '/api',
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
  '/simulador',
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
  const fbq = window.fbq
  if (typeof fbq !== 'function') return
  const id = eventId || newMetaEventId()
  const options = { eventID: id }
  if (params && Object.keys(params).length) {
    fbq('track', eventName, params, options)
  } else {
    fbq('track', eventName, {}, options)
  }
  return id
}
