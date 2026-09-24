import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isMetaCapiConfigured } from '@/lib/meta/capiServer'

export type NestFetchFailureKind =
  | 'dns'
  | 'tls'
  | 'connection'
  | 'timeout'
  | 'auth'
  | 'http'
  | 'parse'
  | 'not_configured'
  | 'unknown'

export type NestLookupSyncItemResult = {
  eventId: string
  eventName: string | null
  utc: string
  fetch: {
    ok: boolean
    kind: NestFetchFailureKind | 'ok'
    httpStatus: number | null
    message: string | null
    durationMs: number
  }
  nest: {
    found: boolean
    status: string | null
    apiAccepted: boolean
    acceptanceTier: string | null
    deliveryOutcome: string | null
    datasetId: string | null
    eventsReceived: number | null
    fbtraceId: string | null
    metaHttpStatus: number | null
  } | null
  graphEvidence: boolean
  persisted: boolean
  alreadyAccepted: boolean
  stageWritten: string | null
  reason: string | null
}

function backendBaseUrl() {
  return (
    process.env.META_CAPI_BACKEND_URL?.trim() ||
    process.env.LA_VILET_CAPI_URL?.trim() ||
    ''
  ).replace(/\/$/, '')
}

function internalSecret() {
  return process.env.META_CAPI_INTERNAL_SECRET?.trim() || ''
}

function classifyFetchError(err: unknown): {
  kind: NestFetchFailureKind
  message: string
} {
  const msg = err instanceof Error ? err.message : String(err || 'unknown')
  const name = err instanceof Error ? err.name : ''
  const lower = `${name} ${msg}`.toLowerCase()
  if (
    lower.includes('enotfound') ||
    lower.includes('getaddrinfo') ||
    lower.includes('err_name_not_resolved')
  ) {
    return { kind: 'dns', message: msg }
  }
  if (
    lower.includes('certificate') ||
    lower.includes('ssl') ||
    lower.includes('tls') ||
    lower.includes('cert_') ||
    lower.includes('err_tls')
  ) {
    return { kind: 'tls', message: msg }
  }
  if (
    name === 'TimeoutError' ||
    name === 'AbortError' ||
    lower.includes('timeout') ||
    lower.includes('etimedout') ||
    lower.includes('aborted')
  ) {
    return { kind: 'timeout', message: msg }
  }
  if (
    lower.includes('econnrefused') ||
    lower.includes('econnreset') ||
    lower.includes('ehostunreach') ||
    lower.includes('enetunreach') ||
    lower.includes('socket')
  ) {
    return { kind: 'connection', message: msg }
  }
  return { kind: 'unknown', message: msg }
}

function hasGraphEvidence(input: {
  eventsReceived: number | null
  fbtraceId: string | null
  apiAccepted: boolean
}): boolean {
  if (!input.apiAccepted) return false
  if (input.eventsReceived != null && input.eventsReceived >= 1) return true
  if (input.fbtraceId) return true
  return false
}

async function alreadyHasMetaAccepted(
  admin: SupabaseClient,
  eventId: string,
): Promise<boolean> {
  const { data } = await admin
    .from('meta_capi_conversion_log')
    .select('id, stage, details')
    .eq('event_id', eventId)
    .eq('stage', 'meta_accepted')
    .order('created_at', { ascending: false })
    .limit(5)
  if (!data?.length) return false
  for (const row of data) {
    const details =
      row.details && typeof row.details === 'object' && !Array.isArray(row.details)
        ? (row.details as Record<string, unknown>)
        : {}
    const eventsReceived =
      typeof details.events_received === 'number' ? details.events_received : null
    const fbtrace =
      typeof details.fbtrace_id === 'string' ? details.fbtrace_id : null
    if ((eventsReceived != null && eventsReceived >= 1) || fbtrace) return true
  }
  return false
}

/**
 * Lookup Nest (GET /api/v1/events/:id) desde el runtime FE.
 * No reenvía a Meta. Persiste meta_accepted solo con evidencia Graph.
 */
export async function syncNestLookupToConversionLog(
  admin: SupabaseClient,
  eventIds: string[],
): Promise<{
  utc: string
  backendUrl: string
  results: NestLookupSyncItemResult[]
}> {
  const utc = new Date().toISOString()
  const base = backendBaseUrl()
  const secret = internalSecret()
  const results: NestLookupSyncItemResult[] = []

  if (!isMetaCapiConfigured() || !base || !secret) {
    for (const eventId of eventIds) {
      results.push({
        eventId,
        eventName: null,
        utc,
        fetch: {
          ok: false,
          kind: 'not_configured',
          httpStatus: null,
          message: 'META_CAPI_BACKEND_URL o META_CAPI_INTERNAL_SECRET ausente',
          durationMs: 0,
        },
        nest: null,
        graphEvidence: false,
        persisted: false,
        alreadyAccepted: false,
        stageWritten: null,
        reason: 'not_configured',
      })
    }
    return { utc, backendUrl: base || '(empty)', results }
  }

  for (const rawId of eventIds) {
    const eventId = String(rawId || '').trim()
    if (!eventId) continue

    const { data: outbox } = await admin
      .from('meta_capi_outbox')
      .select('event_id, event_name, lead_id, delivery_lane')
      .eq('event_id', eventId)
      .maybeSingle()

    const eventName =
      typeof outbox?.event_name === 'string' ? outbox.event_name : null
    const alreadyAccepted = await alreadyHasMetaAccepted(admin, eventId)
    if (alreadyAccepted) {
      results.push({
        eventId,
        eventName,
        utc,
        fetch: {
          ok: true,
          kind: 'ok',
          httpStatus: null,
          message: 'skip_already_accepted',
          durationMs: 0,
        },
        nest: null,
        graphEvidence: true,
        persisted: false,
        alreadyAccepted: true,
        stageWritten: null,
        reason: 'already_meta_accepted',
      })
      continue
    }

    const started = Date.now()
    try {
      const res = await fetch(
        `${base}/api/v1/events/${encodeURIComponent(eventId)}`,
        {
          method: 'GET',
          headers: {
            'X-Internal-Secret': secret,
            Accept: 'application/json',
          },
          cache: 'no-store',
          signal: AbortSignal.timeout(8000),
        },
      )
      const durationMs = Date.now() - started

      if (res.status === 401 || res.status === 403) {
        results.push({
          eventId,
          eventName,
          utc,
          fetch: {
            ok: false,
            kind: 'auth',
            httpStatus: res.status,
            message: `Nest respondió HTTP ${res.status}`,
            durationMs,
          },
          nest: null,
          graphEvidence: false,
          persisted: false,
          alreadyAccepted: false,
          stageWritten: null,
          reason: 'nest_auth',
        })
        continue
      }

      if (!res.ok) {
        results.push({
          eventId,
          eventName,
          utc,
          fetch: {
            ok: false,
            kind: 'http',
            httpStatus: res.status,
            message: `Nest respondió HTTP ${res.status}`,
            durationMs,
          },
          nest: null,
          graphEvidence: false,
          persisted: false,
          alreadyAccepted: false,
          stageWritten: null,
          reason: `nest_http_${res.status}`,
        })
        continue
      }

      let body: Record<string, unknown>
      try {
        body = (await res.json()) as Record<string, unknown>
      } catch (parseErr) {
        const classified = classifyFetchError(parseErr)
        results.push({
          eventId,
          eventName,
          utc,
          fetch: {
            ok: false,
            kind: 'parse',
            httpStatus: res.status,
            message: classified.message,
            durationMs,
          },
          nest: null,
          graphEvidence: false,
          persisted: false,
          alreadyAccepted: false,
          stageWritten: null,
          reason: 'nest_parse',
        })
        continue
      }

      const meta =
        body.meta_response &&
        typeof body.meta_response === 'object' &&
        !Array.isArray(body.meta_response)
          ? (body.meta_response as Record<string, unknown>)
          : null

      const nest = {
        found: body.found === true || body.ok === true,
        status: typeof body.status === 'string' ? body.status : null,
        apiAccepted: body.api_accepted === true,
        acceptanceTier:
          typeof body.acceptance_tier === 'string'
            ? body.acceptance_tier
            : null,
        deliveryOutcome:
          typeof body.delivery_outcome === 'string' ? body.delivery_outcome : null,
        datasetId: typeof body.dataset_id === 'string' ? body.dataset_id : null,
        eventsReceived:
          typeof meta?.events_received === 'number'
            ? meta.events_received
            : null,
        fbtraceId:
          typeof meta?.fbtrace_id === 'string' ? meta.fbtrace_id : null,
        metaHttpStatus:
          typeof meta?.http_status === 'number' ? meta.http_status : null,
      }

      const graphEvidence = hasGraphEvidence(nest)
      let persisted = false
      let stageWritten: string | null = null

      const reportedStage = graphEvidence
        ? 'meta_accepted'
        : ['backend_accepted', 'transport_failed', 'meta_rejected', 'meta_unverified', 'cancelled']
            .includes(String(nest.deliveryOutcome || ''))
          ? String(nest.deliveryOutcome)
          : null
      if (reportedStage) {
        const { error } = await admin.rpc('lv_log_meta_conversion', {
          p_stage: reportedStage,
          p_event_name: eventName || 'ViewContent',
          p_reason: 'nest_lookup_sync',
          p_lead_id: outbox?.lead_id ?? null,
          p_contact_id: null,
          p_tenant_id: null,
          p_project_id: null,
          p_event_id: eventId,
          p_idempotency_key: `nest_lookup_sync:${eventId}:${reportedStage}`,
          p_delivery_lane: outbox?.delivery_lane ?? null,
          p_details: {
            source: 'fe_nest_lookup_sync',
            dataset_id: nest.datasetId,
            fbtrace_id: nest.fbtraceId,
            http_status: nest.metaHttpStatus,
            nest_status: nest.status,
            acceptance_tier: nest.acceptanceTier,
            events_received: nest.eventsReceived,
            synced_at: utc,
            backend_url_host: (() => {
              try {
                return new URL(base).host
              } catch {
                return null
              }
            })(),
          },
        })
        if (!error) {
          persisted = true
          stageWritten = reportedStage
        }
      }

      results.push({
        eventId,
        eventName,
        utc,
        fetch: {
          ok: true,
          kind: 'ok',
          httpStatus: res.status,
          message: null,
          durationMs,
        },
        nest,
        graphEvidence,
        persisted,
        alreadyAccepted: false,
        stageWritten,
        reason: reportedStage
          ? persisted
            ? reportedStage
            : 'persist_failed'
          : nest.found
            ? 'found_without_graph_evidence'
            : 'not_found',
      })
    } catch (err) {
      const durationMs = Date.now() - started
      const classified = classifyFetchError(err)
      results.push({
        eventId,
        eventName,
        utc,
        fetch: {
          ok: false,
          kind: classified.kind,
          httpStatus: null,
          message: classified.message,
          durationMs,
        },
        nest: null,
        graphEvidence: false,
        persisted: false,
        alreadyAccepted: false,
        stageWritten: null,
        reason: classified.kind,
      })
    }
  }

  return { utc, backendUrl: base, results }
}
