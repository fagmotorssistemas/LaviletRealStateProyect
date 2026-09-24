import { getVisitorKey } from '@/lib/tour/visitorTracking'
import { newMetaEventId } from '@/lib/marketing/metaPixel'
import { buildUnitVisitKey } from '@/lib/meta/enqueueGuards'

export { buildUnitVisitKey } from '@/lib/meta/enqueueGuards'

/**
 * Identidad de visita ViewContent: visitante (lv_vid) + unidad.
 * - Dos visitantes ⇒ dos claves ⇒ dos eventos.
 * - Reintento de la misma visita (mismo sessionStorage) ⇒ mismo event_id.
 * - Las cookies solas NO conservan event_id; vive en sessionStorage.
 */
export function getOrCreateUnitVisitIdentity(unitId: string): {
  visitKey: string
  eventId: string
  eventTime: number
} {
  const visitor = (typeof window !== 'undefined' ? getVisitorKey() : '') || 'anon'
  const visitKey = buildUnitVisitKey(visitor, unitId)
  if (typeof window === 'undefined') {
    return { visitKey, eventId: newMetaEventId(), eventTime: Math.floor(Date.now() / 1000) }
  }
  const storageKey = `lv_meta_visit:${visitKey}`
  try {
    const existing = sessionStorage.getItem(storageKey)?.trim()
    if (existing) {
      try {
        const saved = JSON.parse(existing) as { eventId?: string; eventTime?: number }
        if (saved.eventId && /^[0-9a-f-]{36}$/i.test(saved.eventId)) {
          return { visitKey, eventId: saved.eventId, eventTime: saved.eventTime || Math.floor(Date.now() / 1000) }
        }
      } catch {
        if (/^[0-9a-f-]{36}$/i.test(existing)) {
          return { visitKey, eventId: existing, eventTime: Math.floor(Date.now() / 1000) }
        }
      }
    }
    const eventId = newMetaEventId()
    const eventTime = Math.floor(Date.now() / 1000)
    sessionStorage.setItem(storageKey, JSON.stringify({ eventId, eventTime }))
    return { visitKey, eventId, eventTime }
  } catch {
    return { visitKey, eventId: newMetaEventId(), eventTime: Math.floor(Date.now() / 1000) }
  }
}

/** Alinea sessionStorage al event_id canónico devuelto por el servidor (fila existente). */
export function rememberUnitVisitEventId(unitId: string, eventId: string) {
  if (typeof window === 'undefined') return
  if (!eventId || !/^[0-9a-f-]{36}$/i.test(eventId)) return
  const visitor = getVisitorKey() || 'anon'
  const visitKey = buildUnitVisitKey(visitor, unitId)
  try {
    const key = `lv_meta_visit:${visitKey}`
    let eventTime = Math.floor(Date.now() / 1000)
    try {
      const previous = JSON.parse(sessionStorage.getItem(key) || '{}') as { eventTime?: number }
      if (previous.eventTime) eventTime = previous.eventTime
    } catch { /* legacy UUID */ }
    sessionStorage.setItem(key, JSON.stringify({ eventId, eventTime }))
  } catch {
    // ignore
  }
}
