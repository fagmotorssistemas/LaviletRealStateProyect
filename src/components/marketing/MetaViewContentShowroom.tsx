'use client'

import { useEffect, useRef } from 'react'
import { hasAdsConsent, META_PIXEL_SIMULATE } from '@/lib/tour/consent'
import { getMetaClickIds } from '@/lib/marketing/metaCookies'
import { currentMetaEventSourceUrl } from '@/lib/marketing/metaEventSourceUrl'
import { trackMetaPixelEvent } from '@/lib/marketing/metaPixel'
import { getVisitorKey } from '@/lib/tour/visitorTracking'
import { newMetaEventId } from '@/lib/marketing/metaPixel'
import { buildShowroomGeneralVisitKey } from '@/lib/meta/metaMeasurementContract'
import {
  claimViewContentSend,
  shouldSkipViewContent,
} from '@/lib/meta/viewContentFireGate'

type Props = {
  /** Showroom 360 realmente listo (p. ej. ReadyEvent del viewer). */
  ready: boolean
}

/**
 * ViewContent subtipo interno showroom_general: una vez por sesión de visitante
 * cuando el showroom está visible y cargado. No sustituye detalle_unidad.
 */
export function MetaViewContentShowroom({ ready }: Props) {
  const firedVisitKey = useRef<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const emit = () => {
      if (!ready || !hasAdsConsent()) return
      const visitor = getVisitorKey() || ''
      if (!visitor) return

      const visitKey = buildShowroomGeneralVisitKey(visitor)
      if (shouldSkipViewContent(firedVisitKey.current, visitKey)) return

      let eventId = newMetaEventId()
      let eventTime = Math.floor(Date.now() / 1000)
      if (typeof window !== 'undefined') {
        try {
          const storageKey = `lv_meta_visit:${visitKey}`
          const existing = sessionStorage.getItem(storageKey)?.trim()
          if (existing) {
            try {
              const saved = JSON.parse(existing) as { eventId?: string; eventTime?: number }
              if (saved.eventId) eventId = saved.eventId
              if (saved.eventTime) eventTime = saved.eventTime
            } catch { if (/^[0-9a-f-]{36}$/i.test(existing)) eventId = existing }
          }
          sessionStorage.setItem(storageKey, JSON.stringify({ eventId, eventTime }))
        } catch {
          /* ignore */
        }
      }

      // showroom_general: nunca content_* (no inventar listing del catálogo).
      void (async () => {
        let ids = getMetaClickIds()
        if (!ids.fbp && !META_PIXEL_SIMULATE) {
          await new Promise((r) => setTimeout(r, 400))
          if (cancelled) return
          ids = getMetaClickIds()
        }
        if (!claimViewContentSend(firedVisitKey, visitKey, cancelled)) return

        void fetch('/api/meta/enqueue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event_name: 'ViewContent',
            visit_key: visitKey,
            event_id: eventId,
            event_time: eventTime,
            lv_internal_subtype: 'showroom_general',
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
              const json = (await res.json()) as { event_id?: string }
              if (json.event_id && typeof window !== 'undefined') {
                sessionStorage.setItem(`lv_meta_visit:${visitKey}`, JSON.stringify({ eventId: json.event_id, eventTime }))
                trackMetaPixelEvent('ViewContent', undefined, json.event_id)
              }
            } catch {
              /* ignore */
            }
          })
          .catch(() => { firedVisitKey.current = null })
      })()
    }

    emit()
    return () => {
      cancelled = true
    }
  }, [ready])

  return null
}
