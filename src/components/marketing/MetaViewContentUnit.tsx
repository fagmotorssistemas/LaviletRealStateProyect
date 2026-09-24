'use client'

import { useEffect, useRef } from 'react'
import { hasAdsConsent, META_PIXEL_SIMULATE } from '@/lib/tour/consent'
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
import {
  claimViewContentSend,
  shouldSkipViewContent,
} from '@/lib/meta/viewContentFireGate'

type Props = {
  unitId: string
  unitNumber: string
  category?: string | null
  /** Solo emitir cuando la ficha está visible (p. ej. drawer abierto en /tour). */
  enabled?: boolean
}

/**
 * ViewContent al consultar ficha real.
 * Identidad = visitante + unidad (no global por unitId).
 * Si el consentimiento llega en la página actual, emite sin duplicar la misma visita.
 * No se dispara por abrir el formulario de Lead ni por re-renders sin cambio de visita.
 */
export function MetaViewContentUnit({
  unitId,
  unitNumber,
  category,
  enabled = true,
}: Props) {
  const firedVisitKey = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const emit = () => {
      if (!enabled || !unitId || !hasAdsConsent()) return

      const { visitKey, eventId, eventTime } = getOrCreateUnitVisitIdentity(unitId)
      if (shouldSkipViewContent(firedVisitKey.current, visitKey)) return

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
      void (async () => {
        let ids = getMetaClickIds()
        // Con Pixel simulado no hay fbevents.js: no esperar _fbp.
        // Con Pixel real, un único reintento acotado; el evento sale igual sin fbp.
        if (!ids.fbp && !META_PIXEL_SIMULATE) {
          await new Promise((r) => setTimeout(r, 400))
          if (cancelled) return
          ids = getMetaClickIds()
        }
        // Solo marcar fired tras la espera: cerrar ficha cancela sin bloquear reintento
        // (mismo event_id en sessionStorage ⇒ dedupe Meta, sin duplicar outbox).
        if (!claimViewContentSend(firedVisitKey, visitKey, cancelled)) return

        void fetch('/api/meta/enqueue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event_name: 'ViewContent',
            visit_key: visitKey,
            event_id: eventId,
            event_time: eventTime,
            unit_id: unitId,
            lv_internal_subtype: 'detalle_unidad',
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
              if (data.event_id) {
                rememberUnitVisitEventId(unitId, data.event_id)
                trackMetaPixelEvent('ViewContent', params, data.event_id)
              }
            } catch {
              // ignore
            }
          })
          .catch(() => { firedVisitKey.current = null })
      })()
    }

    emit()
    window.addEventListener('lv-consent-changed', emit)
    return () => {
      cancelled = true
      window.removeEventListener('lv-consent-changed', emit)
    }
  }, [unitId, unitNumber, category, enabled])

  return null
}
