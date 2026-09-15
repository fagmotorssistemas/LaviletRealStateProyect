import 'server-only'
import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { enqueueMetaEvent, isMetaCapiConfigured, type EnqueueMetaEventInput } from '@/lib/meta/capiServer'

export type LocalOutboxRow = {
  id: string
  idempotency_key: string
  event_id: string
  event_name: 'ViewContent' | 'Lead' | 'Schedule'
  event_time: number
  payload: Record<string, unknown>
  status: string
  delivery_lane: 'test' | 'live'
  lead_id: string | null
  visitor_key: string | null
  ads_consent_required: boolean
}

function intendedLane(): 'test' | 'live' {
  // Lane fijada en origen; Nest solo entrega la que coincida con META_MODE.
  const explicit = process.env.META_CAPI_DELIVERY_LANE?.trim().toLowerCase()
  if (explicit === 'test' || explicit === 'live') return explicit
  const mode = process.env.META_MODE?.trim().toLowerCase()
  return mode === 'test' ? 'test' : 'live'
}

/**
 * Persistencia local atómica por idempotency_key.
 * inserted=true ⇒ conversión nueva (disparar Pixel con event_id).
 */
export async function persistMetaConversion(
  admin: SupabaseClient,
  input: {
    eventName: 'ViewContent' | 'Lead' | 'Schedule'
    idempotencyKey: string
    eventId?: string
    eventTime?: number
    payload: Record<string, unknown>
    leadId?: string | null
    visitorKey?: string | null
    adsConsentRequired?: boolean
  },
): Promise<{ inserted: boolean; eventId: string; rowId: string | null }> {
  const eventId = input.eventId && /^[0-9a-f-]{36}$/i.test(input.eventId) ? input.eventId : randomUUID()
  const eventTime = input.eventTime || Math.floor(Date.now() / 1000)

  const { data: existing } = await admin
    .from('meta_capi_outbox')
    .select('id, event_id')
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle()

  if (existing?.event_id) {
    return { inserted: false, eventId: existing.event_id, rowId: existing.id }
  }

  const { data, error } = await admin
    .from('meta_capi_outbox')
    .insert({
      idempotency_key: input.idempotencyKey,
      event_id: eventId,
      event_name: input.eventName,
      event_time: eventTime,
      payload: input.payload,
      status: 'pending',
      delivery_lane: intendedLane(),
      lead_id: input.leadId || null,
      visitor_key: input.visitorKey || null,
      ads_consent_required: input.adsConsentRequired !== false,
    })
    .select('id, event_id')
    .single()

  if (error) {
    // Carrera: otro request insertó la misma clave
    if (error.code === '23505') {
      const { data: again } = await admin
        .from('meta_capi_outbox')
        .select('id, event_id')
        .eq('idempotency_key', input.idempotencyKey)
        .maybeSingle()
      if (again?.event_id) {
        return { inserted: false, eventId: again.event_id, rowId: again.id }
      }
    }
    throw error
  }

  return { inserted: true, eventId: data.event_id, rowId: data.id }
}

export async function cancelPendingMetaOutbox(
  admin: SupabaseClient,
  opts: { leadId?: string | null; visitorKey?: string | null },
): Promise<number> {
  let q = admin
    .from('meta_capi_outbox')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString(),
      last_error: 'ads_consent_revoked',
    })
    .eq('status', 'pending')
    .eq('ads_consent_required', true)

  if (opts.leadId) q = q.eq('lead_id', opts.leadId)
  else if (opts.visitorKey) q = q.eq('visitor_key', opts.visitorKey)
  else {
    // Sin ámbito: cancelar todos los pendientes que requieren consent (retirada global del visitante actual se pasa visitorKey)
    return 0
  }

  const { data, error } = await q.select('id')
  if (error) {
    console.error('[meta-outbox] cancel', error.message)
    return 0
  }
  return data?.length ?? 0
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

/** Reenvía pendientes locales a lavilet-meta-capi. No lanza. */
export async function flushLocalMetaOutbox(
  admin: SupabaseClient,
  limit = 20,
): Promise<{ forwarded: number; failed: number; skipped: number }> {
  if (!isMetaCapiConfigured()) return { forwarded: 0, failed: 0, skipped: 0 }

  const lane = intendedLane()
  const { data: rows, error } = await admin
    .from('meta_capi_outbox')
    .select('*')
    .eq('status', 'pending')
    .eq('delivery_lane', lane)
    .order('created_at', { ascending: true })
    .limit(limit)

  if (error || !rows?.length) return { forwarded: 0, failed: 0, skipped: 0 }

  let forwarded = 0
  let failed = 0
  let skipped = 0

  for (const row of rows as LocalOutboxRow[]) {
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
          continue
        }
      }
    }

    const payload = row.payload || {}
    const input: EnqueueMetaEventInput = {
      eventName: row.event_name,
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
      adsConsent: true,
      includeRequestContext: false,
      deliveryLane: row.delivery_lane,
      visitorKey: row.visitor_key,
      leadId: row.lead_id,
    }

    // IP/UA ya van en payload si se capturaron al persistir
    if (typeof payload.client_ip_address === 'string') {
      input.clientIpAddress = payload.client_ip_address
    }
    if (typeof payload.client_user_agent === 'string') {
      input.clientUserAgent = payload.client_user_agent
    }

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
    } else {
      await admin
        .from('meta_capi_outbox')
        .update({
          last_error: result.skipped || `http_${result.status || 0}`,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
      failed += 1
    }
  }

  return { forwarded, failed, skipped }
}
