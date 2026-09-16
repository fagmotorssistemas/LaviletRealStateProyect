'use client'

import { useEffect, useRef } from 'react'
import { hasAdsConsent } from '@/lib/tour/consent'
import { getMetaClickIds } from '@/lib/marketing/metaCookies'
import {
  getOrCreateUnitVisitIdentity,
  rememberUnitVisitEventId,
} from '@/lib/marketing/metaVisitIdentity'
import {
  currentMetaEventSourceUrl,
  isMetaCoreSetupConservative,
} from '@/lib/marketing/metaEventSourceUrl'
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

      // Core Setup: sin parámetros de contenido en Pixel/CAPI.
      // Simulación Preview: no carga fbevents.js; sanear URL propia ≠ URL de fbevents.
      const conservative = isMetaCoreSetupConservative()
      const params = conservative
        ? undefined
        : {
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
          ...(conservative
            ? {}
            : {
                content_ids: [unitId],
                content_name: `Unidad ${unitNumber}`,
                content_category: category || 'unit',
              }),
          event_source_url: currentMetaEventSourceUrl(),
          fbp: ids.fbp || undefined,
          fbc: ids.fbc || undefined,
          fbclid: ids.fbclid || undefined,
        }),
        keepalive: true,
      })
        .then(async (res) => {
          if (!res.ok && res.status !== 202) return
          try {
            const data = (await res.json()) as { event_id?: string }
            if (data.event_id) rememberUnitVisitEventId(unitId, data.event_id)
          } catch {
            // ignore
          }
        })
        .catch(() => {})
    }

    emit()
    window.addEventListener('lv-consent-changed', emit)
    return () => window.removeEventListener('lv-consent-changed', emit)
  }, [unitId, unitNumber, category])

  return null
}
