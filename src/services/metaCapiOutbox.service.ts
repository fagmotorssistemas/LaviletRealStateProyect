import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { TOUR_TENANT_ID } from '@/lib/tour/trackingIds'
import { isMetaCapiConfigured } from '@/lib/meta/capiServer'
import {
  isScheduleDeliveryEnabled,
  isScheduleFlushEnabled,
  isScheduleLocalPersistEnabled,
} from '@/lib/meta/scheduleFlags'
import type { MetaDeliveryLane } from '@/lib/meta/deliveryLane'
import { classifyOutboxStatus, type MetaCapiStatusBucket } from '@/lib/meta/metaCapiStatus'
import {
  phoneFromEventPayload,
  resolveMetaCapiPhone,
  type MetaCapiPhoneSource,
} from '@/lib/meta/metaCapiPhone'

export type { MetaCapiStatusBucket, MetaCapiPhoneSource }
export { classifyOutboxStatus }

export type MetaCapiListFilters = {
  dateFrom?: string | null
  dateTo?: string | null
  eventName?: string | null
  statusBucket?: MetaCapiStatusBucket
  lane?: MetaDeliveryLane | 'all' | null
  origin?: string | null
  page?: number
  pageSize?: number
}

export type MetaCapiOutboxKpis = {
  total: number
  deliveredBackend: number
  pending: number
  blockedConfig: number
  retained: number
  cancelled: number
  failed: number
  /** Solo fallidos terminales (dead); no incluye not_configured. */
  deadErrorPct: number | null
  /** true si hay bloqueos de configuración — no usar % error como “salud”. */
  hasConfigBlocks: boolean
  byEventName: Record<string, number>
}

export type MetaReceptionStatus =
  | 'delivered_to_backend'
  | 'meta_reception_unverified'
  | 'not_applicable'
  | 'nest_lookup_unavailable'

export type MetaCapiOutboxRow = {
  id: string
  /** Compat: mismo valor que phoneDisplay. */
  phone: string | null
  phoneDisplay: string
  phoneEvent: string | null
  phoneCrm: string | null
  phoneSource: MetaCapiPhoneSource
  phoneSourceLabel: string
  eventAt: string | null
  registeredAt: string
  forwardedAt: string | null
  timezone: string
  eventName: string
  status: string
  statusLabel: string
  statusBucket: Exclude<MetaCapiStatusBucket, 'all'>
  detail: string
  lastError: string | null
  deliveryLane: string
  eventId: string
  origin: string | null
  leadId: string | null
  visitorKey: string | null
  projectId: string | null
  tenantId: string | null
  reception: MetaReceptionStatus
  receptionLabel: string
}

export type MetaCapiAbsenceReport = {
  viewContentCount: number
  leadCount: number
  scheduleCount: number
  leadsWithAdsConsent: number
  leadsWithMetaEventId: number
  scheduleFlags: {
    localPersist: boolean
    delivery: boolean
    flush: boolean
    whatsappScheduleBlocked: true
  }
  notes: string[]
}

export type MetaCapiNotConfiguredDiag = {
  eventId: string
  eventName: string
  status: string
  deliveryLane: string
  createdAt: string
  eventAt: string | null
  lastError: string | null
  hasVisitor: boolean
  hasLead: boolean
  likelyOrigin: string
  nestReceivedEvidence: 'none' | 'unverified'
}

export type MetaCapiOutboxResult = {
  kpis: MetaCapiOutboxKpis
  rows: MetaCapiOutboxRow[]
  totalFiltered: number
  page: number
  pageSize: number
  eventNames: string[]
  origins: string[]
  timezone: string
  metaOfficialMetrics: {
    available: false
    reason: string
  }
  absence: MetaCapiAbsenceReport
  notConfigured: MetaCapiNotConfiguredDiag[]
  fetchedAt: string
  scope: { tenantIds: string[]; includeOrphanShowroom: boolean }
}

type OutboxDbRow = {
  id: string
  event_id: string
  event_name: string
  event_time: number | null
  payload: Record<string, unknown> | null
  status: string
  delivery_lane: string
  created_at: string
  forwarded_at: string | null
  last_error: string | null
  lead_id: string | null
  visitor_key: string | null
  leads?: {
    tenant_id: string | null
    project_id: string | null
    phone: string | null
  } | null
}

const DISPLAY_TZ = 'America/Guayaquil'

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function phoneFromPayload(payload: Record<string, unknown> | null): string | null {
  return phoneFromEventPayload(payload)
}

function originFromPayload(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null
  const a = payload.action_source
  if (typeof a === 'string' && a.trim()) return a.trim()
  const ch = payload.messaging_channel
  if (typeof ch === 'string' && ch.trim()) return ch.trim()
  return null
}

function projectFromPayload(payload: Record<string, unknown> | null): string | null {
  if (!payload) return null
  const p = payload.project_id
  return typeof p === 'string' && p.trim() ? p.trim() : null
}

function detailLine(
  payload: Record<string, unknown> | null,
  eventId: string,
  lastError: string | null,
): string {
  if (lastError) return lastError.slice(0, 160)
  const clid =
    typeof payload?.ctwa_clid === 'string'
      ? payload.ctwa_clid.trim()
      : typeof payload?.ctwaClid === 'string'
        ? payload.ctwaClid.trim()
        : ''
  if (clid) {
    const short = clid.length > 28 ? `${clid.slice(0, 12)}…${clid.slice(-8)}` : clid
    return `ctwa:${short}`
  }
  return eventId
}

function unixToIso(unix: number | null | undefined): string | null {
  if (unix == null || !Number.isFinite(Number(unix)) || Number(unix) <= 0) return null
  return new Date(Number(unix) * 1000).toISOString()
}

function receptionForRow(
  bucket: Exclude<MetaCapiStatusBucket, 'all'>,
  nestHint: MetaReceptionStatus | null,
): { status: MetaReceptionStatus; label: string } {
  if (bucket !== 'delivered_backend') {
    return { status: 'not_applicable', label: '—' }
  }
  if (nestHint === 'delivered_to_backend') {
    return {
      status: 'delivered_to_backend',
      label: 'Aceptado por API backend (no implica atribución ads)',
    }
  }
  return {
    status: 'meta_reception_unverified',
    label: 'Recepción Meta no verificada',
  }
}

function inScope(
  row: OutboxDbRow,
  tenantIds: string[],
  includeOrphanShowroom: boolean,
): boolean {
  const leadTenant = row.leads?.tenant_id
  if (leadTenant) return tenantIds.includes(leadTenant)
  if (row.lead_id) {
    // lead join falló: no mostrar
    return false
  }
  // Sin lead (p. ej. ViewContent showroom): solo si el tenant Lavilet es accesible.
  return includeOrphanShowroom
}

function mapRow(
  row: OutboxDbRow,
  nestByEventId: Map<string, MetaReceptionStatus>,
  accessibleTenantIds: string[],
): MetaCapiOutboxRow {
  const payload = asRecord(row.payload)
  const classified = classifyOutboxStatus(row.status, row.last_error)
  const reception = receptionForRow(classified.bucket, nestByEventId.get(row.event_id) ?? null)
  const phone = resolveMetaCapiPhone({
    eventPhone: phoneFromPayload(payload),
    leadId: row.lead_id,
    leadTenantId: row.leads?.tenant_id ?? null,
    leadPhone: row.leads?.phone ?? null,
    accessibleTenantIds,
  })
  return {
    id: row.id,
    phone: phone.source === 'none' ? null : phone.display,
    phoneDisplay: phone.display,
    phoneEvent: phone.eventPhone,
    phoneCrm: phone.crmPhone,
    phoneSource: phone.source,
    phoneSourceLabel: phone.sourceLabel,
    eventAt: unixToIso(row.event_time),
    registeredAt: row.created_at,
    forwardedAt: row.forwarded_at,
    timezone: DISPLAY_TZ,
    eventName: row.event_name,
    status: row.status,
    statusLabel: classified.label,
    statusBucket: classified.bucket,
    detail: detailLine(payload, row.event_id, row.last_error),
    lastError: row.last_error,
    deliveryLane: row.delivery_lane,
    eventId: row.event_id,
    origin: originFromPayload(payload),
    leadId: row.lead_id,
    visitorKey: row.visitor_key,
    projectId: row.leads?.project_id || projectFromPayload(payload),
    tenantId: row.leads?.tenant_id || null,
    reception: reception.status,
    receptionLabel: reception.label,
  }
}

async function probeNestReception(
  eventIds: string[],
): Promise<Map<string, MetaReceptionStatus>> {
  const out = new Map<string, MetaReceptionStatus>()
  if (!eventIds.length || !isMetaCapiConfigured()) {
    for (const id of eventIds) out.set(id, 'nest_lookup_unavailable')
    return out
  }
  const base = (
    process.env.META_CAPI_BACKEND_URL?.trim() ||
    process.env.LA_VILET_CAPI_URL?.trim() ||
    ''
  ).replace(/\/$/, '')
  const secret = process.env.META_CAPI_INTERNAL_SECRET?.trim() || ''
  // Contrato Nest de lookup no documentado en este front: no inventar aceptación Graph.
  for (const id of eventIds.slice(0, 40)) {
    try {
      const res = await fetch(`${base}/api/v1/events/${encodeURIComponent(id)}`, {
        method: 'GET',
        headers: { 'X-Internal-Secret': secret, Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(2500),
      })
      if (res.ok) {
        out.set(id, 'delivered_to_backend')
      } else {
        out.set(id, 'meta_reception_unverified')
      }
    } catch {
      out.set(id, 'nest_lookup_unavailable')
    }
  }
  return out
}

async function buildAbsenceReport(admin: SupabaseClient): Promise<MetaCapiAbsenceReport> {
  const { data: byName } = await admin.from('meta_capi_outbox').select('event_name')
  const counts = { ViewContent: 0, Lead: 0, Schedule: 0 }
  for (const row of byName ?? []) {
    const n = String((row as { event_name?: string }).event_name || '')
    if (n === 'ViewContent' || n === 'Lead' || n === 'Schedule') counts[n] += 1
  }

  const { count: adsConsent } = await admin
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .eq('meta_ads_consent', true)
  const { count: withMetaId } = await admin
    .from('leads')
    .select('id', { count: 'exact', head: true })
    .not('meta_lead_event_id', 'is', null)

  const notes: string[] = []
  if (counts.Schedule === 0) {
    notes.push(
      'No hay filas Schedule en outbox. WhatsApp Schedule permanece bloqueado; persistencia web depende de META_SCHEDULE_* (hoy OFF → ausencia de actividad elegible, no fallo de la bitácora).',
    )
  }
  if (counts.Lead === 0) {
    notes.push('No hay eventos Lead en outbox en el alcance consultado.')
  } else if ((withMetaId ?? 0) > counts.Lead) {
    notes.push(
      `Hay leads con meta_lead_event_id (${withMetaId}) y ${counts.Lead} Lead en outbox: posible historial parcial o recuperación incompleta.`,
    )
  }
  notes.push(
    'PageView del navegador no pasa por meta_capi_outbox; no se duplica aquí. Sin acceso autorizado a la API oficial de Meta Events Manager no se listan métricas de Pixel.',
  )

  return {
    viewContentCount: counts.ViewContent,
    leadCount: counts.Lead,
    scheduleCount: counts.Schedule,
    leadsWithAdsConsent: adsConsent ?? 0,
    leadsWithMetaEventId: withMetaId ?? 0,
    scheduleFlags: {
      localPersist: isScheduleLocalPersistEnabled(),
      delivery: isScheduleDeliveryEnabled(),
      flush: isScheduleFlushEnabled(),
      whatsappScheduleBlocked: true,
    },
    notes,
  }
}

/**
 * Bitácora CAPI: historial completo por defecto, paginación servidor, alcance por tenant.
 */
export async function listMetaCapiOutbox(
  admin: SupabaseClient,
  opts: {
    filters?: MetaCapiListFilters
    accessibleTenantIds: string[]
  },
): Promise<MetaCapiOutboxResult> {
  const filters = opts.filters ?? {}
  const page = Math.max(1, Number(filters.page) || 1)
  const pageSize = Math.min(100, Math.max(10, Number(filters.pageSize) || 50))
  const tenantIds = opts.accessibleTenantIds.filter(Boolean)
  const includeOrphanShowroom = tenantIds.includes(TOUR_TENANT_ID)

  // Lectura amplia; filtro de alcance y buckets en memoria (tabla pequeña hoy; sin límite silencioso 800).
  let query = admin
    .from('meta_capi_outbox')
    .select(
      'id, event_id, event_name, event_time, payload, status, delivery_lane, created_at, forwarded_at, last_error, lead_id, visitor_key, leads(tenant_id, project_id, phone)',
    )
    .order('created_at', { ascending: false })

  if (filters.dateFrom) query = query.gte('created_at', new Date(filters.dateFrom).toISOString())
  if (filters.dateTo) {
    const end = new Date(filters.dateTo)
    if (!Number.isNaN(end.getTime())) {
      end.setHours(23, 59, 59, 999)
      query = query.lte('created_at', end.toISOString())
    }
  }
  if (filters.eventName && filters.eventName !== 'all') {
    query = query.eq('event_name', filters.eventName)
  }
  if (filters.lane && filters.lane !== 'all') {
    query = query.eq('delivery_lane', filters.lane)
  }

  const { data, error } = await query
  if (error) throw new Error(error.message || 'No se pudo leer la cola CAPI')

  const normalized: OutboxDbRow[] = (data ?? []).map((raw) => {
    const row = raw as Record<string, unknown>
    const leadJoin = row.leads
    let leads: OutboxDbRow['leads'] = null
    if (Array.isArray(leadJoin) && leadJoin[0] && typeof leadJoin[0] === 'object') {
      const first = leadJoin[0] as {
        tenant_id?: string | null
        project_id?: string | null
        phone?: string | null
      }
      leads = {
        tenant_id: first.tenant_id ?? null,
        project_id: first.project_id ?? null,
        phone: first.phone ?? null,
      }
    } else if (leadJoin && typeof leadJoin === 'object') {
      const one = leadJoin as {
        tenant_id?: string | null
        project_id?: string | null
        phone?: string | null
      }
      leads = {
        tenant_id: one.tenant_id ?? null,
        project_id: one.project_id ?? null,
        phone: one.phone ?? null,
      }
    }
    return {
      id: String(row.id),
      event_id: String(row.event_id),
      event_name: String(row.event_name),
      event_time: row.event_time == null ? null : Number(row.event_time),
      payload: asRecord(row.payload),
      status: String(row.status),
      delivery_lane: String(row.delivery_lane),
      created_at: String(row.created_at),
      forwarded_at: row.forwarded_at == null ? null : String(row.forwarded_at),
      last_error: row.last_error == null ? null : String(row.last_error),
      lead_id: row.lead_id == null ? null : String(row.lead_id),
      visitor_key: row.visitor_key == null ? null : String(row.visitor_key),
      leads,
    }
  })

  const scoped = normalized.filter((row) => inScope(row, tenantIds, includeOrphanShowroom))

  const eventNames = Array.from(new Set(scoped.map((r) => r.event_name))).sort()
  const origins = Array.from(
    new Set(scoped.map((r) => originFromPayload(asRecord(r.payload))).filter(Boolean) as string[]),
  ).sort()

  let working = scoped
  if (filters.origin && filters.origin !== 'all') {
    working = working.filter((r) => originFromPayload(asRecord(r.payload)) === filters.origin)
  }
  if (filters.statusBucket && filters.statusBucket !== 'all') {
    working = working.filter(
      (r) => classifyOutboxStatus(r.status, r.last_error).bucket === filters.statusBucket,
    )
  }

  const byEventName: Record<string, number> = {}
  let deliveredBackend = 0
  let pending = 0
  let blockedConfig = 0
  let retained = 0
  let cancelled = 0
  let failed = 0
  for (const row of working) {
    byEventName[row.event_name] = (byEventName[row.event_name] || 0) + 1
    const b = classifyOutboxStatus(row.status, row.last_error).bucket
    if (b === 'delivered_backend') deliveredBackend += 1
    else if (b === 'pending') pending += 1
    else if (b === 'blocked_config') blockedConfig += 1
    else if (b === 'retained') retained += 1
    else if (b === 'cancelled') cancelled += 1
    else if (b === 'failed') failed += 1
  }
  const total = working.length
  const deadErrorPct =
    total > 0 && failed > 0 ? Math.round((failed / total) * 1000) / 10 : failed === 0 ? 0 : null

  const totalFiltered = working.length
  const slice = working.slice((page - 1) * pageSize, page * pageSize)
  const nestMap = await probeNestReception(
    slice.filter((r) => r.status === 'forwarded').map((r) => r.event_id),
  )
  const rows = slice.map((r) => mapRow(r, nestMap, tenantIds))

  const notConfiguredRows = scoped
    .filter((r) => r.last_error === 'not_configured' || (r.status === 'pending' && r.last_error === 'not_configured'))
    .map((r): MetaCapiNotConfiguredDiag => ({
      eventId: r.event_id,
      eventName: r.event_name,
      status: r.status,
      deliveryLane: r.delivery_lane,
      createdAt: r.created_at,
      eventAt: unixToIso(r.event_time),
      lastError: r.last_error,
      hasVisitor: Boolean(r.visitor_key),
      hasLead: Boolean(r.lead_id),
      likelyOrigin:
        r.delivery_lane === 'test'
          ? 'Lane test (local/preview o META_* test). Faltaba META_CAPI_BACKEND_URL / INTERNAL_SECRET al flush.'
          : 'Lane live; config CAPI ausente en el proceso que hizo flush.',
      nestReceivedEvidence: 'none',
    }))

  const absence = await buildAbsenceReport(admin)

  return {
    kpis: {
      total,
      deliveredBackend,
      pending,
      blockedConfig,
      retained,
      cancelled,
      failed,
      deadErrorPct: blockedConfig > 0 && failed === 0 ? null : deadErrorPct,
      hasConfigBlocks: blockedConfig > 0,
      byEventName,
    },
    rows,
    totalFiltered,
    page,
    pageSize,
    eventNames,
    origins,
    timezone: DISPLAY_TZ,
    metaOfficialMetrics: {
      available: false,
      reason:
        'No hay credenciales/API autorizada en este front para leer el Administrador de eventos de Meta. PageView solo existe en Pixel (navegador).',
    },
    absence,
    notConfigured: notConfiguredRows,
    fetchedAt: new Date().toISOString(),
    scope: { tenantIds, includeOrphanShowroom },
  }
}
