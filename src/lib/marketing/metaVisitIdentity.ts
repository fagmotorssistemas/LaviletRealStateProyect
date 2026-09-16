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
} {
  const visitor = (typeof window !== 'undefined' ? getVisitorKey() : '') || 'anon'
  const visitKey = buildUnitVisitKey(visitor, unitId)
  if (typeof window === 'undefined') {
    return { visitKey, eventId: newMetaEventId() }
  }
  const storageKey = `lv_meta_visit:${visitKey}`
  try {
    const existing = sessionStorage.getItem(storageKey)?.trim()
    if (existing && /^[0-9a-f-]{36}$/i.test(existing)) {
      return { visitKey, eventId: existing }
    }
    const eventId = newMetaEventId()
    sessionStorage.setItem(storageKey, eventId)
    return { visitKey, eventId }
  } catch {
    return { visitKey, eventId: newMetaEventId() }
  }
}

/** Alinea sessionStorage al event_id canónico devuelto por el servidor (fila existente). */
export function rememberUnitVisitEventId(unitId: string, eventId: string) {
  if (typeof window === 'undefined') return
  if (!eventId || !/^[0-9a-f-]{36}$/i.test(eventId)) return
  const visitor = getVisitorKey() || 'anon'
  const visitKey = buildUnitVisitKey(visitor, unitId)
  try {
    sessionStorage.setItem(`lv_meta_visit:${visitKey}`, eventId)
  } catch {
    // ignore
  }
}
