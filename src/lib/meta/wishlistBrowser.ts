/**
 * Disparo browser AddToWishlist tras favorito guardado (Pixel + POST outbox).
 * Solo llamar después de save OK; idempotencia server evita duplicados.
 */
'use client'

import { hasAdsConsent } from '@/lib/tour/consent'
import { getMetaClickIds } from '@/lib/marketing/metaCookies'
import {
  currentMetaEventSourceUrl,
  isMetaCoreSetupConservative,
} from '@/lib/marketing/metaEventSourceUrl'
import { newMetaEventId, trackMetaPixelEvent } from '@/lib/marketing/metaPixel'

export function captureWishlistAfterSave(opts: {
  unitId?: string | null
  unitNumber?: string | null
  typologyCode?: string | null
  leadId?: string | null
}): void {
  const unitId = String(opts.unitId || '').trim()
  if (!unitId || !hasAdsConsent()) return

  const eventId = newMetaEventId()
  if (!/^[0-9a-f-]{36}$/i.test(eventId)) return

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
      lead_id: opts.leadId || undefined,
      event_source_url: currentMetaEventSourceUrl(),
      fbp: ids.fbp || undefined,
      fbc: ids.fbc || undefined,
      fbclid: ids.fbclid || undefined,
    }),
    keepalive: true,
  }).catch(() => {})
}
