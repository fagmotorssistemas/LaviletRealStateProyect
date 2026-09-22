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

const inFlightByKey = new Set<string>()
/** Solo con leadId: evita re-disparo de sesión del mismo lead+unidad. */
const sentSessionByLeadUnit = new Set<string>()

function clientDedupeKey(leadId: string | null | undefined, unitId: string): string {
  const lead = String(leadId || '').trim()
  return `${lead || '_anon'}:${unitId}`
}

export function captureWishlistAfterSave(opts: {
  unitId?: string | null
  unitNumber?: string | null
  typologyCode?: string | null
  leadId?: string | null
}): void {
  const unitId = String(opts.unitId || '').trim()
  const leadId = String(opts.leadId || '').trim() || null
  if (!unitId || !hasAdsConsent()) return

  const key = clientDedupeKey(leadId, unitId)
  if (inFlightByKey.has(key)) return
  if (leadId && sentSessionByLeadUnit.has(`${leadId}:${unitId}`)) return

  const eventId = newMetaEventId()
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return

  inFlightByKey.add(key)

  const conservative = isMetaCoreSetupConservative()
  const unitNumber = String(opts.unitNumber || '').trim()
  const typologyCode = String(opts.typologyCode || '').trim()
  const params = conservative
    ? undefined
    : {
        content_ids: [unitId],
        content_name: unitNumber ? `Unidad ${unitNumber}` : undefined,
        content_category: typologyCode || 'unit',
      }

  // Mismo event_name + event_id que CAPI (dedupe Pixel/servidor).
  trackMetaPixelEvent('AddToWishlist', params, eventId)

  const ids = getMetaClickIds()
  void fetch('/api/meta/wishlist', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event_id: eventId,
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
    .then((res) => {
      if ((res.ok || res.status === 202) && leadId) {
        sentSessionByLeadUnit.add(`${leadId}:${unitId}`)
      }
    })
    .catch(() => {})
    .finally(() => {
      inFlightByKey.delete(key)
    })
}
