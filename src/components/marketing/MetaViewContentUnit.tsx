'use client'

import { useEffect, useRef } from 'react'
import { hasAdsConsent } from '@/lib/tour/consent'
import { getMetaClickIds } from '@/lib/marketing/metaCookies'
import { getOrCreateUnitVisitIdentity } from '@/lib/marketing/metaVisitIdentity'
import { trackMetaPixelEvent } from '@/lib/marketing/metaPixel'

type Props = {
  unitId: string
  unitNumber: string
  category?: string | null
}

/**
 * ViewContent al consultar ficha real.
 * Identidad = visitante + unidad (no global por unitId).
 * Si el consentimiento llega en la página actual, emite sin duplicar la misma visita.
 */
export function MetaViewContentUnit({ unitId, unitNumber, category }: Props) {
  const firedVisitKey = useRef<string | null>(null)

  useEffect(() => {
    const emit = () => {
      if (!unitId || !hasAdsConsent()) return

      const { visitKey, eventId } = getOrCreateUnitVisitIdentity(unitId)
      if (firedVisitKey.current === visitKey) return
      firedVisitKey.current = visitKey

      const params = {
        content_ids: [unitId],
        content_name: `Unidad ${unitNumber}`,
        content_category: category || 'unit',
      }
      trackMetaPixelEvent('ViewContent', params, eventId)

      const ids = getMetaClickIds()
      void fetch('/api/meta/enqueue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event_name: 'ViewContent',
          visit_key: visitKey,
          event_id: eventId,
          unit_id: unitId,
          content_ids: [unitId],
          content_name: `Unidad ${unitNumber}`,
          content_category: category || 'unit',
          event_source_url: window.location.href.split('#')[0],
          fbp: ids.fbp || undefined,
          fbc: ids.fbc || undefined,
          fbclid: ids.fbclid || undefined,
        }),
        keepalive: true,
      }).catch(() => {})
    }

    emit()
    window.addEventListener('lv-consent-changed', emit)
    return () => window.removeEventListener('lv-consent-changed', emit)
  }, [unitId, unitNumber, category])

  return null
}
