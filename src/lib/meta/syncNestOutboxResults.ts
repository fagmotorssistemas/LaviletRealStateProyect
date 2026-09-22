/**
 * Sincroniza evidencias Nest → meta_capi_conversion_log sin reenviar eventos.
 * Server-only; usa META_CAPI_INTERNAL_SECRET (nunca al navegador).
 */
import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isMetaCapiConfigured } from '@/lib/meta/capiServer'
import type { NestEventLookupEvidence } from '@/lib/meta/metaCapiDeliveryOutcome'

const DEFAULT_LIMIT = 25
const MAX_LIMIT = 40
const LOOKUP_TIMEOUT_MS = 8000

export type NestOutboxSyncResult = {
  examined: number
  writtenAccepted: number
  writtenRejected: number
  writtenUnverified: number
  notFound: number
  skipped: number
  errors: number
}

function nestBaseAndSecret(): { base: string; secret: string } | null {
  if (!isMetaCapiConfigured()) return null
  const base = (
    process.env.META_CAPI_BACKEND_URL?.trim() ||
    process.env.LA_VILET_CAPI_URL?.trim() ||
    ''
  ).replace(/\/$/, '')
  const secret = process.env.META_CAPI_INTERNAL_SECRET?.trim() || ''
  if (!base || !secret) return null
  return { base, secret }
}

async function lookupNestEvent(
  base: string,
  secret: string,
  eventId: string,
): Promise<NestEventLookupEvidence> {
  const empty = (lookupOk: boolean): NestEventLookupEvidence => ({
    found: false,
    status: null,
    attemptCount: null,
    lastError: null,
    deliveryLane: null,
    datasetId: null,
    sentAt: null,
    apiAccepted: false,
    acceptanceTier: null,
    eventsReceived: null,
    fbtraceId: null,
    httpStatus: null,
    lookupOk,
  })
  try {
    const res = await fetch(`${base}/api/v1/events/${encodeURIComponent(eventId)}`, {
      method: 'GET',
      headers: { 'X-Internal-Secret': secret, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    })
    if (!res.ok) return { ...empty(true), found: false }
    const body = (await res.json()) as Record<string, unknown>
    const meta =
      body.meta_response &&
      typeof body.meta_response === 'object' &&
      !Array.isArray(body.meta_response)
        ? (body.meta_response as Record<string, unknown>)
        : null
    return {
      found: body.found === true || body.ok === true,
      status: typeof body.status === 'string' ? body.status : null,
      attemptCount:
        typeof body.attempt_count === 'number' ? body.attempt_count : null,
      lastError: typeof body.last_error === 'string' ? body.last_error : null,
      deliveryLane:
        typeof body.delivery_lane === 'string' ? body.delivery_lane : null,
      datasetId: typeof body.dataset_id === 'string' ? body.dataset_id : null,
      sentAt: typeof body.sent_at === 'string' ? body.sent_at : null,
      apiAccepted: body.api_accepted === true,
      acceptanceTier:
        typeof body.acceptance_tier === 'string' ? body.acceptance_tier : null,
      eventsReceived:
        typeof meta?.events_received === 'number' ? meta.events_received : null,
      fbtraceId: typeof meta?.fbtrace_id === 'string' ? meta.fbtrace_id : null,
      httpStatus: typeof meta?.http_status === 'number' ? meta.http_status : null,
      lookupOk: true,
    }
  } catch {
    return empty(false)
  }
}

async function logConversion(
  admin: SupabaseClient,
  input: {
    stage: string
    eventName: string
    reason?: string | null
    leadId?: string | null
    tenantId?: string | null
    projectId?: string | null
    eventId: string
    idempotencyKey?: string | null
    deliveryLane?: string | null
    details?: Record<string, unknown>
  },
): Promise<boolean> {
  try {
    const { error } = await admin.rpc('lv_log_meta_conversion', {
      p_stage: input.stage,
      p_event_name: input.eventName,
      p_reason: input.reason ?? null,
      p_lead_id: input.leadId ?? null,
      p_contact_id: null,
      p_tenant_id: input.tenantId ?? null,
      p_project_id: input.projectId ?? null,
      p_event_id: input.eventId,
      p_idempotency_key: input.idempotencyKey ?? null,
      p_delivery_lane: input.deliveryLane ?? null,
      p_details: input.details ?? {},
    })
    return !error
  } catch {
    return false
  }
}

/**
 * Para filas forwarded sin stage Graph terminal, consulta Nest y persiste evidencia.
 * No cambia status de outbox ni reenvía.
 */
export async function syncNestOutboxResults(
  admin: SupabaseClient,
  opts?: {
    limit?: number
    /** Si se pasan ids, solo esos (p. ej. página visible). */
    eventIds?: string[]
  },
): Promise<NestOutboxSyncResult> {
  const result: NestOutboxSyncResult = {
    examined: 0,
    writtenAccepted: 0,
    writtenRejected: 0,
    writtenUnverified: 0,
    notFound: 0,
    skipped: 0,
    errors: 0,
  }
  const creds = nestBaseAndSecret()
  if (!creds) return result

  const limit = Math.min(
    Math.max(1, opts?.limit ?? DEFAULT_LIMIT),
    MAX_LIMIT,
  )

  type Row = {
    id: string
    event_id: string
    event_name: string
    idempotency_key: string | null
    delivery_lane: string
    lead_id: string | null
    payload: Record<string, unknown> | null
  }

  let candidates: Row[] = []

  if (opts?.eventIds?.length) {
    const ids = opts.eventIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id)).slice(0, limit)
    if (!ids.length) return result
    const { data, error } = await admin
      .from('meta_capi_outbox')
      .select('id,event_id,event_name,idempotency_key,delivery_lane,lead_id,payload')
      .eq('status', 'forwarded')
      .in('event_id', ids)
    if (error || !data) return result
    candidates = data as Row[]
  } else {
    const { data, error } = await admin
      .from('meta_capi_outbox')
      .select('id,event_id,event_name,idempotency_key,delivery_lane,lead_id,payload')
      .eq('status', 'forwarded')
      .order('updated_at', { ascending: false })
      .limit(limit * 3)
    if (error || !data?.length) return result
    candidates = data as Row[]
  }

  const eventIds = candidates.map((r) => r.event_id)
  const { data: logs } = await admin
    .from('meta_capi_conversion_log')
    .select('event_id,stage')
    .in('event_id', eventIds)
    .in('stage', ['meta_accepted', 'meta_rejected', 'nest_lookup_unverified'])

  const done = new Set(
    (logs || [])
      .filter((l) => l.stage === 'meta_accepted' || l.stage === 'meta_rejected')
      .map((l) => String(l.event_id)),
  )
  const alreadyUnverified = new Set(
    (logs || [])
      .filter((l) => l.stage === 'nest_lookup_unverified')
      .map((l) => String(l.event_id)),
  )

  const todo = candidates.filter((r) => !done.has(r.event_id)).slice(0, limit)
  result.examined = todo.length

  for (const row of todo) {
    const nest = await lookupNestEvent(creds.base, creds.secret, row.event_id)
    const payload =
      row.payload && typeof row.payload === 'object' ? row.payload : {}
    const tenantId =
      typeof payload.tenant_id === 'string' ? payload.tenant_id : null
    const projectId =
      typeof payload.project_id === 'string' ? payload.project_id : null

    if (!nest.lookupOk) {
      // Timeout / red / fallo de consulta: no escribir meta_rejected.
      result.errors += 1
      continue
    }
    if (!nest.found) {
      result.notFound += 1
      continue
    }

    if (nest.apiAccepted) {
      if (done.has(row.event_id)) {
        result.skipped += 1
        continue
      }
      const ok = await logConversion(admin, {
        stage: 'meta_accepted',
        eventName: row.event_name,
        reason: 'nest_lookup_sync',
        leadId: row.lead_id,
        tenantId,
        projectId,
        eventId: row.event_id,
        idempotencyKey: row.idempotency_key,
        deliveryLane: nest.deliveryLane || row.delivery_lane,
        details: {
          source: 'fe_nest_lookup_sync',
          fbtrace_id: nest.fbtraceId,
          events_received: nest.eventsReceived,
          http_status: nest.httpStatus,
          nest_status: nest.status,
          dataset_id: nest.datasetId,
          acceptance_tier: nest.acceptanceTier,
        },
      })
      if (ok) {
        result.writtenAccepted += 1
        done.add(row.event_id)
      } else result.errors += 1
      continue
    }

    if (
      nest.status === 'dead' ||
      nest.status === 'failed' ||
      nest.acceptanceTier === 'api_rejected'
    ) {
      if (done.has(row.event_id)) {
        result.skipped += 1
        continue
      }
      const ok = await logConversion(admin, {
        stage: 'meta_rejected',
        eventName: row.event_name,
        reason: nest.lastError || nest.acceptanceTier || 'nest_rejected',
        leadId: row.lead_id,
        tenantId,
        projectId,
        eventId: row.event_id,
        idempotencyKey: row.idempotency_key,
        deliveryLane: nest.deliveryLane || row.delivery_lane,
        details: {
          source: 'fe_nest_lookup_sync',
          nest_status: nest.status,
          acceptance_tier: nest.acceptanceTier,
          fbtrace_id: nest.fbtraceId,
          events_received: nest.eventsReceived,
          http_status: nest.httpStatus,
        },
      })
      if (ok) {
        result.writtenRejected += 1
        done.add(row.event_id)
      } else result.errors += 1
      continue
    }

    // Nest recibió pero sin evidencia Graph suficiente: una sola marca unverified.
    if (alreadyUnverified.has(row.event_id) || done.has(row.event_id)) {
      result.skipped += 1
      continue
    }
    const ok = await logConversion(admin, {
      stage: 'nest_lookup_unverified',
      eventName: row.event_name,
      reason: nest.acceptanceTier || 'insufficient_evidence',
      leadId: row.lead_id,
      tenantId,
      projectId,
      eventId: row.event_id,
      idempotencyKey: row.idempotency_key,
      deliveryLane: nest.deliveryLane || row.delivery_lane,
      details: {
        source: 'fe_nest_lookup_sync',
        nest_status: nest.status,
        note: 'Nest recibió; aceptación Graph no verificada. Conservar nest_received en panel.',
      },
    })
    if (ok) {
      result.writtenUnverified += 1
      alreadyUnverified.add(row.event_id)
    } else result.errors += 1
  }

  return result
}
