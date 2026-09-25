/**
 * Disparo browser AddToWishlist tras favorito guardado (Pixel + POST outbox).
 * Solo llamar después de save OK; idempotencia server (wishlist:lead:unit) evita duplicados.
 *
 * Dedupe cliente limitada a (leadId|anon)+unitId:
 * - evita doble disparo por rerender/reintento/concurrencia del mismo visitante/lead
 * - no bloquea a otra persona (otro leadId) en el mismo navegador
 */
'use client'

import { hasAdsConsent } from '@/lib/tour/consent'
import { getMetaClickIds } from '@/lib/marketing/metaCookies'
import {
  currentMetaEventSourceUrl,
  isMetaCoreSetupConservative,
} from '@/lib/marketing/metaEventSourceUrl'
import { newMetaEventId, trackMetaPixelEvent } from '@/lib/marketing/metaPixel'
import { homeListingCatalogIdentityParams } from '@/lib/meta/homeListingContent'

const inFlightByKey = new Set<string>()
/** Solo con leadId: evita re-disparo de sesión del mismo lead+unidad. */
const sentSessionByLeadUnit = new Set<string>()

function clientDedupeKey(leadId: string | null | undefined, unitId: string): string {
  const lead = String(leadId || '').trim()
  return `${lead || '_anon'}:${unitId}`
}

export async function captureWishlistAfterSave(opts: {
  unitId?: string | null
  unitNumber?: string | null
  typologyCode?: string | null
  leadId?: string | null
}): Promise<boolean> {
  const unitId = String(opts.unitId || '').trim()
  const leadId = String(opts.leadId || '').trim() || null
  if (!unitId || !hasAdsConsent()) return false

  const key = clientDedupeKey(leadId, unitId)
  if (inFlightByKey.has(key)) return false
  if (leadId && sentSessionByLeadUnit.has(`${leadId}:${unitId}`)) return true

  const storageKey = `lv_meta_wishlist:${key}`
  let eventId = newMetaEventId()
  let eventTime = Math.floor(Date.now() / 1000)
  try {
    const saved = JSON.parse(sessionStorage.getItem(storageKey) || '{}') as { eventId?: string; eventTime?: number }
    if (saved.eventId) eventId = saved.eventId
    if (saved.eventTime) eventTime = saved.eventTime
    sessionStorage.setItem(storageKey, JSON.stringify({ eventId, eventTime }))
  } catch { /* Meta deduplica con la identidad conservada mientras viva esta llamada. */ }
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return false

  inFlightByKey.add(key)

  const conservative = isMetaCoreSetupConservative()
  const unitNumber = String(opts.unitNumber || '').trim()
  const typologyCode = String(opts.typologyCode || '').trim()
  const params =
    homeListingCatalogIdentityParams(unitId, {
      unitNumber,
      includeContentName: !conservative,
    }) || undefined

  const ids = getMetaClickIds()
  try {
    const res = await fetch('/api/meta/wishlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event_id: eventId,
      event_time: eventTime,
      unit_id: unitId,
      unit_number: unitNumber || undefined,
      typology_code: typologyCode || undefined,
      lead_id: leadId || undefined,
      event_source_url: currentMetaEventSourceUrl(),
      fbp: ids.fbp || undefined,
      fbc: ids.fbc || undefined,
      fbclid: ids.fbclid || undefined,
    }),
    keepalive: true,
    })
    if (!res.ok && res.status !== 202) return false
    const json = (await res.json()) as { event_id?: string }
    if (!json.event_id) return false
    // Pixel solo después de que servidor validó contacto, proyecto, unidad y outbox.
    trackMetaPixelEvent('AddToWishlist', params, json.event_id)
    if (leadId) sentSessionByLeadUnit.add(`${leadId}:${unitId}`)
    try { sessionStorage.setItem(storageKey, JSON.stringify({ eventId: json.event_id, eventTime })) } catch { /* ignore */ }
    return true
  } catch {
    return false
  } finally {
    inFlightByKey.delete(key)
  }
}
