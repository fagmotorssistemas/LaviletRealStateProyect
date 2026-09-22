import 'server-only'
import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { enqueueMetaEvent, isMetaCapiConfigured, type EnqueueMetaEventInput } from '@/lib/meta/capiServer'
import { resolveDeliveryLane } from '@/lib/meta/deliveryLane'
import {
  isPurchaseMetaSendEnabled,
  isPurchaseSaleEligibleForDelivery,
  type MetaCaptureEventName,
} from '@/lib/meta/metaMeasurementContract'

export type LocalOutboxRow = {
  id: string
  idempotency_key: string
  event_id: string
  event_name: MetaCaptureEventName
  event_time: number
  payload: Record<string, unknown>
  status: string
  delivery_lane: 'test' | 'live'
  lead_id: string | null
  visitor_key: string | null
  ads_consent_required: boolean
}

/** Único estado que flush local / drain Nest deben consumir. */
export const OUTBOX_FLUSHABLE_STATUS = 'pending' as const

/** Persistencia de revisión Schedule web: fuera de la cola activa. */
export const OUTBOX_REVIEW_HOLD_STATUS = 'review_hold' as const

/** Retención (p. ej. WhatsApp Schedule bloqueado por Meta BM). */
export const OUTBOX_NEEDS_REVIEW_STATUS = 'needs_review' as const

export function isOutboxStatusFlushable(status: string | null | undefined): boolean {
  return String(status || '') === OUTBOX_FLUSHABLE_STATUS
}

/** @deprecated Usar resolveDeliveryLane — exportado para tests existentes. */
function intendedLane(): 'test' | 'live' {
  return resolveDeliveryLane()
}

/**
 * Persistencia local atómica por idempotency_key.
 * inserted=true ⇒ conversión nueva (disparar Pixel con event_id).
 * Por defecto status=pending (cola activa). Schedule de revisión debe usar review_hold.
 */
export async function persistMetaConversion(
  admin: SupabaseClient,
  input: {
    eventName: MetaCaptureEventName
    idempotencyKey: string
    eventId?: string
    eventTime?: number
    payload: Record<string, unknown>
    leadId?: string | null
    visitorKey?: string | null
    adsConsentRequired?: boolean
    /** pending = cola activa; review_hold / needs_review = excluidos de flush/drain. */
    status?:
      | typeof OUTBOX_FLUSHABLE_STATUS
      | typeof OUTBOX_REVIEW_HOLD_STATUS
      | typeof OUTBOX_NEEDS_REVIEW_STATUS
    lastError?: string | null
  },
): Promise<{ inserted: boolean; eventId: string; rowId: string | null; status: string }> {
  const eventId = input.eventId && /^[0-9a-f-]{36}$/i.test(input.eventId) ? input.eventId : randomUUID()
  const eventTime = input.eventTime || Math.floor(Date.now() / 1000)
  const status = input.status || OUTBOX_FLUSHABLE_STATUS

  const { data: existing } = await admin
    .from('meta_capi_outbox')
    .select('id, event_id, status')
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle()

  if (existing?.event_id) {
    // Si el visitante se identificó después, enlazar lead_id sin reescribir payload.
    if (input.leadId && existing.id) {
      await admin
        .from('meta_capi_outbox')
        .update({ lead_id: input.leadId, updated_at: new Date().toISOString() })
        .eq('id', existing.id)
        .is('lead_id', null)
    }
    return {
      inserted: false,
      eventId: existing.event_id,
      rowId: existing.id,
      status: existing.status || status,
    }
  }

  const { data, error } = await admin
    .from('meta_capi_outbox')
    .insert({
      idempotency_key: input.idempotencyKey,
      event_id: eventId,
      event_name: input.eventName,
      event_time: eventTime,
      payload: input.payload,
      status,
      delivery_lane: intendedLane(),
      lead_id: input.leadId || null,
      visitor_key: input.visitorKey || null,
      ads_consent_required: input.adsConsentRequired !== false,
      last_error: input.lastError ?? null,
    })
    .select('id, event_id, status')
    .single()

  if (error) {
    // Carrera: otro request insertó la misma clave
    if (error.code === '23505') {
      const { data: again } = await admin
        .from('meta_capi_outbox')
        .select('id, event_id, status')
        .eq('idempotency_key', input.idempotencyKey)
        .maybeSingle()
      if (again?.event_id) {
        return {
          inserted: false,
          eventId: again.event_id,
          rowId: again.id,
          status: again.status || status,
        }
      }
    }
    throw error
  }

  return { inserted: true, eventId: data.event_id, rowId: data.id, status: data.status || status }
}

export async function cancelPendingMetaOutbox(
  admin: SupabaseClient,
  opts: { leadId?: string | null; visitorKey?: string | null },
): Promise<number> {
  // pending + holds: al revocar consent no deben sobrevivir para un flush futuro.
  const statuses = [
    OUTBOX_FLUSHABLE_STATUS,
    OUTBOX_REVIEW_HOLD_STATUS,
    OUTBOX_NEEDS_REVIEW_STATUS,
  ] as const
  let cancelled = 0

  for (const status of statuses) {
    let q = admin
      .from('meta_capi_outbox')
      .update({
        status: 'cancelled',
        updated_at: new Date().toISOString(),
        last_error: 'ads_consent_revoked',
      })
      .eq('status', status)
      .eq('ads_consent_required', true)

    if (opts.leadId) q = q.eq('lead_id', opts.leadId)
    else if (opts.visitorKey) q = q.eq('visitor_key', opts.visitorKey)
    else return cancelled

    const { data, error } = await q.select('id')
    if (error) {
      console.error('[meta-outbox] cancel', error.message)
      continue
    }
    cancelled += data?.length ?? 0
  }
  return cancelled
}

export async function setLeadAdsConsent(
  admin: SupabaseClient,
  leadId: string,
  consent: boolean,
) {
  await admin
    .from('leads')
    .update({
      meta_ads_consent: consent,
      meta_ads_consent_at: new Date().toISOString(),
    })
    .eq('id', leadId)
}

export async function getLeadAdsConsent(
  admin: SupabaseClient,
  leadId: string,
): Promise<boolean | null> {
  const { data } = await admin
    .from('leads')
    .select('meta_ads_consent')
    .eq('id', leadId)
    .maybeSingle()
  if (!data || data.meta_ads_consent == null) return null
  return Boolean(data.meta_ads_consent)
}

function sanitizeFlushError(raw: string): string {
  return raw
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/x-internal-secret["']?\s*[:=]\s*["']?[^"'\s]+/gi, 'x-internal-secret:[redacted]')
    .slice(0, 180)
}

/** Reenvía pendientes locales a lavilet-meta-capi. No lanza. */
export async function flushLocalMetaOutbox(
  admin: SupabaseClient,
  limitOrOpts: number | { limit?: number; eventIds?: string[] } = 20,
): Promise<{ forwarded: number; failed: number; skipped: number }> {
  const opts =
    typeof limitOrOpts === 'number' ? { limit: limitOrOpts } : limitOrOpts || {}
  const limit = opts.limit ?? 20
  const eventIds = opts.eventIds?.filter((id) => /^[0-9a-f-]{36}$/i.test(id)) || []

  const lane = intendedLane()
  const configured = isMetaCapiConfigured()

  if (!configured) {
    console.error('[meta-outbox] flush skipped not_configured', {
      lane,
      event_ids: eventIds.slice(0, 5),
    })
    if (eventIds.length) {
      await admin
        .from('meta_capi_outbox')
        .update({
          last_error: 'not_configured',
          updated_at: new Date().toISOString(),
        })
        .eq('status', 'pending')
        .eq('delivery_lane', lane)
        .in('event_id', eventIds)
    }
    return { forwarded: 0, failed: eventIds.length ? eventIds.length : 0, skipped: 0 }
  }

  let q = admin
    .from('meta_capi_outbox')
    .select('*')
    .eq('status', 'pending')
    .eq('delivery_lane', lane)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (eventIds.length) {
    q = admin
      .from('meta_capi_outbox')
      .select('*')
      .eq('status', 'pending')
      .eq('delivery_lane', lane)
      .in('event_id', eventIds)
      .order('created_at', { ascending: true })
      .limit(Math.max(limit, eventIds.length))
  }

  const { data: rows, error } = await q

  if (error) {
    console.error('[meta-outbox] flush query', {
      lane,
      error: sanitizeFlushError(error.message),
    })
    return { forwarded: 0, failed: 0, skipped: 0 }
  }

  if (!rows?.length) {
    console.info('[meta-outbox] flush empty', { lane, event_ids: eventIds.slice(0, 5) })
    return { forwarded: 0, failed: 0, skipped: 0 }
  }

  let forwarded = 0
  let failed = 0
  let skipped = 0

  for (const row of rows as LocalOutboxRow[]) {
    // Defensa en profundidad: nunca reenviar review_hold u otros no flushables.
    if (!isOutboxStatusFlushable(row.status)) {
      skipped += 1
      console.info('[meta-outbox] flush skip non_flushable', {
        event_id: row.event_id,
        status: row.status,
      })
      continue
    }

    // Purchase: solo flush con delivery ON; review_hold histórico nunca se toca aquí
    // (solo status=pending llega a este loop).
    if (row.event_name === 'Purchase' && !isPurchaseMetaSendEnabled()) {
      skipped += 1
      console.info('[meta-outbox] flush skip purchase_delivery_inactive', {
        event_id: row.event_id,
        status: row.status,
      })
      continue
    }
    if (row.event_name === 'Purchase') {
      const p = row.payload as {
        registered_at?: string
        sale_at?: string
      } | null
      const reg =
        typeof p?.registered_at === 'string' ? String(p.registered_at) : null
      const saleAt = typeof p?.sale_at === 'string' ? String(p.sale_at) : null
      if (
        !isPurchaseSaleEligibleForDelivery({
          registeredAt: reg,
          commercialConfirmedAt: saleAt,
        })
      ) {
        skipped += 1
        console.info('[meta-outbox] flush skip purchase_before_cutover', {
          event_id: row.event_id,
        })
        continue
      }
    }

    if (row.ads_consent_required) {
      if (row.lead_id) {
        const consent = await getLeadAdsConsent(admin, row.lead_id)
        if (consent === false) {
          await admin
            .from('meta_capi_outbox')
            .update({
              status: 'cancelled',
              last_error: 'ads_consent_revoked',
              updated_at: new Date().toISOString(),
            })
            .eq('id', row.id)
          skipped += 1
          console.info('[meta-outbox] flush cancel', {
            event_id: row.event_id,
            reason: 'ads_consent_revoked',
          })
          continue
        }
      }
    }

    const payload = row.payload || {}
    const input: EnqueueMetaEventInput = {
      eventName: row.event_name as EnqueueMetaEventInput['eventName'],
      idempotencyKey: row.idempotency_key,
      eventId: row.event_id,
      eventTime: row.event_time,
      actionSource: (payload.action_source as EnqueueMetaEventInput['actionSource']) || 'website',
      eventSourceUrl: typeof payload.event_source_url === 'string' ? payload.event_source_url : undefined,
      phone: typeof payload.phone === 'string' ? payload.phone : undefined,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      fullName: typeof payload.full_name === 'string' ? payload.full_name : undefined,
      city: typeof payload.city === 'string' ? payload.city : undefined,
      country: typeof payload.country === 'string' ? payload.country : undefined,
      externalId:
        typeof payload.external_id === 'string'
          ? payload.external_id
          : row.lead_id || undefined,
      fbp: typeof payload.fbp === 'string' ? payload.fbp : undefined,
      fbc: typeof payload.fbc === 'string' ? payload.fbc : undefined,
      fbclid: typeof payload.fbclid === 'string' ? payload.fbclid : undefined,
      contentIds: Array.isArray(payload.content_ids)
        ? payload.content_ids.filter((v): v is string => typeof v === 'string')
        : undefined,
      contentName: typeof payload.content_name === 'string' ? payload.content_name : undefined,
      contentCategory: typeof payload.content_category === 'string' ? payload.content_category : undefined,
      lvInternalSubtype:
        typeof payload.lv_internal_subtype === 'string'
          ? payload.lv_internal_subtype
          : undefined,
      unitId: typeof payload.unit_id === 'string' ? payload.unit_id : undefined,
      saleId: typeof payload.sale_id === 'string' ? payload.sale_id : undefined,
      tenantId: typeof payload.tenant_id === 'string' ? payload.tenant_id : undefined,
      projectId: typeof payload.project_id === 'string' ? payload.project_id : undefined,
      registeredAt:
        typeof payload.registered_at === 'string' ? payload.registered_at : undefined,
      saleAt: typeof payload.sale_at === 'string' ? payload.sale_at : undefined,
      value:
        typeof payload.value === 'number'
          ? payload.value
          : typeof payload.value === 'string' && Number.isFinite(Number(payload.value))
            ? Number(payload.value)
            : undefined,
      currency: typeof payload.currency === 'string' ? payload.currency : undefined,
      adsConsent: true,
      includeRequestContext: false,
      deliveryLane: row.delivery_lane,
      visitorKey: row.visitor_key,
      leadId: row.lead_id,
    }

    if (typeof payload.messaging_channel === 'string' && payload.messaging_channel === 'whatsapp') {
      input.messagingChannel = 'whatsapp'
    }
    if (typeof payload.ctwa_clid === 'string') input.ctwaClid = payload.ctwa_clid
    if (typeof payload.whatsapp_business_account_id === 'string') {
      input.whatsappBusinessAccountId = payload.whatsapp_business_account_id
    }
    if (typeof payload.messaging_dataset_id === 'string') {
      input.messagingDatasetId = payload.messaging_dataset_id
    }

    // IP/UA ya van en payload si se capturaron al persistir
    if (typeof payload.client_ip_address === 'string') {
      input.clientIpAddress = payload.client_ip_address
    }
    if (typeof payload.client_user_agent === 'string') {
      input.clientUserAgent = payload.client_user_agent
    }

    console.info('[meta-outbox] flush attempt', {
      event_id: row.event_id,
      lane: row.delivery_lane,
      event_name: row.event_name,
    })

    const result = await enqueueMetaEvent(input)
    if (result.ok) {
      await admin
        .from('meta_capi_outbox')
        .update({
          status: 'forwarded',
          forwarded_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          last_error: null,
        })
        .eq('id', row.id)
      forwarded += 1
      console.info('[meta-outbox] flush ok', {
        event_id: row.event_id,
        http_status: result.status ?? 202,
      })
    } else if (result.skipped === 'no_ads_consent') {
      await admin
        .from('meta_capi_outbox')
        .update({
          status: 'cancelled',
          last_error: 'no_ads_consent',
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
      skipped += 1
      console.info('[meta-outbox] flush cancel', {
        event_id: row.event_id,
        reason: 'no_ads_consent',
      })
    } else {
      const errCode = result.skipped || `http_${result.status || 0}`
      await admin
        .from('meta_capi_outbox')
        .update({
          last_error: sanitizeFlushError(errCode),
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
      failed += 1
      console.error('[meta-outbox] flush fail', {
        event_id: row.event_id,
        http_status: result.status ?? null,
        error: sanitizeFlushError(errCode),
      })
    }
  }

  return { forwarded, failed, skipped }
}
