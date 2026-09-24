import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { TOUR_TENANT_ID } from '@/lib/tour/trackingIds'
import { isMetaCapiConfigured } from '@/lib/meta/capiServer'
import {
  resolveMetaCapiChannel,
  type MetaCapiChannelKind,
  type MetaCapiDestinationKind,
} from '@/lib/meta/metaCapiChannel'
import {
  isScheduleDeliveryEnabled,
  isScheduleFlushEnabled,
  isScheduleLocalPersistEnabled,
} from '@/lib/meta/scheduleFlags'
import type { MetaDeliveryLane } from '@/lib/meta/deliveryLane'
import { classifyOutboxStatus, type MetaCapiStatusBucket } from '@/lib/meta/metaCapiStatus'
import {
  classifyDeliveryOutcome,
  deliveryOutcomeMatchesFilter,
  type ConversionLogEvidence,
  type MetaCapiDeliveryOutcome,
  type NestEventLookupEvidence,
} from '@/lib/meta/metaCapiDeliveryOutcome'
import {
  phoneFromEventPayload,
  resolveMetaCapiPhone,
  type MetaCapiPhoneSource,
} from '@/lib/meta/metaCapiPhone'
import {
  fetchMetaOfficialAggregates,
  type MetaOfficialMetricsResult,
} from '@/lib/meta/metaOfficialMetrics'
import { getAdsInsightsStatus, type AdsInsightsStatus } from '@/lib/meta/adsInsightsStatus'
import {
  summarizeOptimizationVolume,
  type OptimizationEventVolume,
  type OptimizationEventEvidence,
} from '@/lib/meta/optimizationVolume'
import {
  isWaLeadSubmittedDeliveryEnabled,
  isWaLeadSubmittedEnabled,
} from '@/lib/meta/waLeadSubmittedFlags'
import {
  labelMetaCapiReason,
  labelMetaCapiStage,
  isMetaCapiProbeRow,
} from '@/lib/meta/capiConversionLogLabels'
import { labelMetaInternalSubtype, subtypeForEventName } from '@/lib/meta/metaMeasurementContract'
import {
  buildContactDetails,
  dedupeInboundMessages,
  inPeriod,
  maskPhoneDisplay,
  periodBounds,
  summarizeWaCrmPeriod,
  type WaCrmContactDetail,
  type WaCrmCtwaAttributionInfo,
  type WaCrmInboundMessageRow,
} from '@/lib/meta/waCrmVisibility'

export type { MetaCapiStatusBucket, MetaCapiPhoneSource }
export { classifyOutboxStatus }

export type MetaCapiListFilters = {
  dateFrom?: string | null
  dateTo?: string | null
  eventName?: string | null
  statusBucket?: MetaCapiStatusBucket
  lane?: MetaDeliveryLane | 'all' | null
  origin?: string | null
  /** web | whatsapp | undetermined | all */
  channel?: MetaCapiChannelKind | 'all' | null
  /** Hint de dataset en payload (messaging_dataset_id), si existe. */
  dataset?: string | null
  page?: number
  pageSize?: number
}

export type MetaCapiOutboxKpis = {
  total: number
  /** Recibido por Nest (forwarded; aún puede faltar Graph). */
  nestReceived: number
  /** @deprecated Prefer nestReceived */
  deliveredBackend: number
  pending: number
  /** Aceptados Meta con evidencia Graph. */
  metaAccepted: number
  blocked: number
  /** @deprecated Prefer blocked */
  blockedConfig: number
  retained: number
  cancelled: number
  failedRetrying: number
  /** @deprecated Prefer failedRetrying */
  failed: number
  unknown: number
  /** Solo fallidos terminales (dead); no incluye not_configured. */
  deadErrorPct: number | null
  /** true si hay bloqueos de configuración — no usar % error como “salud”. */
  hasConfigBlocks: boolean
  byEventName: Record<string, number>
}

export type MetaReceptionStatus =
  | 'delivered_to_backend'
  | 'meta_accepted'
  | 'meta_reception_unverified'
  | 'not_applicable'
  | 'nest_lookup_unavailable'
  | 'failed'

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
  /** Contrato panel: pendiente | nest_received | meta_accepted | blocked | failed_retrying | unknown | pending_backend_support | internal_activity */
  deliveryOutcome: MetaCapiDeliveryOutcome
  deliveryOutcomeLabel: string
  deliveryReason: string | null
  graphFbtraceId: string | null
  graphEventsReceived: number | null
  /** Subtipo interno (showroom_general, detalle_unidad, favorito, …). */
  internalSubtype: string | null
  internalSubtypeLabel: string
  /** Unidad/propiedad si el payload la trae. */
  unitLabel: string | null
  detail: string
  lastError: string | null
  deliveryLane: string
  /** Canal de evidencia (web / WhatsApp / no determinado). */
  channel: MetaCapiChannelKind
  channelLabel: string
  destination: MetaCapiDestinationKind
  destinationLabel: string
  hasCtwaClid: boolean
  ctwaNote: string | null
  /** Solo si el payload trae messaging_dataset_id. */
  datasetHint: string | null
  eventId: string
  origin: string | null
  leadId: string | null
  visitorKey: string | null
  projectId: string | null
  tenantId: string | null
  /** Enlace CRM: lead identificado vía tour/outbox. */
  connectedLead: boolean
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
  channel: MetaCapiChannelKind
  channelLabel: string
  destinationLabel: string
  createdAt: string
  eventAt: string | null
  lastError: string | null
  hasVisitor: boolean
  hasLead: boolean
  eventSourceHost: string | null
  actionSource: string | null
  /** Error histórico del flush (p. ej. local sin META_CAPI_*). */
  configGapAtFlush: string
  /** true si la evidencia apunta a localhost/preview, no a Production. */
  historicalLocal: boolean
  /** Config del proceso actual de esta bitácora (no afirma el estado de Production). */
  currentProcessCapiConfigured: boolean
  likelyOrigin: string
  nestReceivedEvidence: 'none' | 'unverified'
}

/** Contactos/mensajes Kommo→CRM. No son conversiones CAPI enviadas a Meta. */
export type MetaWhatsAppCrmContact = {
  leadId: string
  phone: string | null
  phoneSource: 'crm_lead'
  name: string | null
  source: string | null
  channelOrigin: string | null
  hasKommo: boolean
  contactId: string | null
  projectId: string | null
  createdAt: string
  messageCount: number
  lastMessageAt: string | null
}

export type MetaWhatsAppCrmMessage = {
  messageId: string
  leadId: string
  phone: string | null
  role: string
  sentAt: string
  preview: string
  externalMessageId: string | null
}

export type MetaWaConversionLogItem = {
  id: string
  createdAt: string
  leadId: string | null
  contactId: string | null
  /** Teléfono enmascarado del lead CRM si existe; nunca completo en UI. */
  phoneMasked: string | null
  leadHref: string | null
  eventName: string
  stage: string
  stageLabel: string
  reason: string | null
  reasonLabel: string
  deliveryLane: string | null
  isTechnicalProbe: boolean
  /** Distinción: recibido CRM / entregado Nest / aceptado Meta — según stage. */
  pipelineStep:
    'evaluated_or_blocked' | 'enqueued' | 'backend_accepted' | 'meta_accepted' | 'meta_rejected'
}

export type MetaWaConversionTracking = {
  featureEnabled: boolean
  deliveryEnabled: boolean
  banner: string | null
  kpis: {
    evaluated: number
    blocked: number
    enqueued: number
    backendAccepted: number
    metaAccepted: number
    metaRejected: number
  }
  rows: MetaWaConversionLogItem[]
  indicatorHelp: string[]
}

export type MetaWhatsAppVisibility = {
  disclaimer: string
  indicatorHelp: string[]
  period: { dateFrom: string | null; dateTo: string | null }
  periodSummary: {
    inboundMessages: number
    uniqueContacts: number
    contactsWithCtwa: number
    contactsWithoutCtwa: number
    lastReceptionAt: string | null
  }
  contacts: MetaWhatsAppCrmContact[]
  contactDetails: WaCrmContactDetail[]
  recentMessages: MetaWhatsAppCrmMessage[]
  totals: {
    contacts: number
    messages: number
    ctwaCaptures: number
    capiWhatsappOutbox: number
  }
  ctwa: {
    captures: number
    note: string
  }
  conversions: MetaWaConversionTracking
  adsInsights: AdsInsightsStatus
  scheduleWhatsappBlocked: true
}

export type MetaCapiChannelKpis = {
  web: number
  whatsapp: number
  undetermined: number
}

export type MetaCapiOutboxResult = {
  kpis: MetaCapiOutboxKpis
  /** Conteos outbox por canal (misma ventana de filtros, sin mezclar con CRM WA). */
  kpisByChannel: MetaCapiChannelKpis
  rows: MetaCapiOutboxRow[]
  totalFiltered: number
  page: number
  pageSize: number
  eventNames: string[]
  origins: string[]
  datasets: string[]
  timezone: string
  metaOfficialMetrics: MetaOfficialMetricsResult
  absence: MetaCapiAbsenceReport
  notConfigured: MetaCapiNotConfiguredDiag[]
  whatsapp: MetaWhatsAppVisibility
  optimizationVolume: OptimizationEventVolume[]
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

function inScope(row: OutboxDbRow, tenantIds: string[], includeOrphanShowroom: boolean): boolean {
  const leadTenant = row.leads?.tenant_id
  if (leadTenant) return tenantIds.includes(leadTenant)
  if (row.lead_id) {
    // lead join falló: no mostrar
    return false
  }
  // Sin lead (p. ej. ViewContent showroom): solo si el tenant Lavilet es accesible.
  return includeOrphanShowroom
}

function receptionForOutcome(
  outcome: MetaCapiDeliveryOutcome,
  receptionLabel: string,
): { status: MetaReceptionStatus; label: string } {
  if (
    outcome === 'pending' ||
    outcome === 'blocked' ||
    outcome === 'pending_backend_support' ||
    outcome === 'internal_activity'
  ) {
    return {
      status: 'not_applicable',
      label:
        outcome === 'pending_backend_support' || outcome === 'internal_activity'
          ? receptionLabel
          : '—',
    }
  }
  if (outcome === 'meta_accepted') {
    return { status: 'meta_accepted', label: receptionLabel }
  }
  if (outcome === 'failed_retrying') {
    return { status: 'failed', label: receptionLabel }
  }
  if (outcome === 'nest_received') {
    return { status: 'delivered_to_backend', label: receptionLabel }
  }
  return { status: 'meta_reception_unverified', label: receptionLabel }
}

function mapRow(
  row: OutboxDbRow,
  nestByEventId: Map<string, NestEventLookupEvidence>,
  conversionByEventId: Map<string, ConversionLogEvidence>,
  accessibleTenantIds: string[],
): MetaCapiOutboxRow {
  const payload = asRecord(row.payload) || {}
  const delivery = classifyDeliveryOutcome({
    outboxStatus: row.status,
    lastError: row.last_error,
    conversion: conversionByEventId.get(row.event_id) ?? null,
    nest: nestByEventId.get(row.event_id) ?? null,
    eventName: row.event_name,
  })
  const reception = receptionForOutcome(delivery.outcome, delivery.receptionLabel)
  const phone = resolveMetaCapiPhone({
    eventPhone: phoneFromPayload(payload),
    leadId: row.lead_id,
    leadTenantId: row.leads?.tenant_id ?? null,
    leadPhone: row.leads?.phone ?? null,
    accessibleTenantIds,
  })
  const channelView = resolveMetaCapiChannel(payload, row.delivery_lane)
  const subtype =
    subtypeForEventName(
      row.event_name,
      typeof payload.lv_internal_subtype === 'string' ? payload.lv_internal_subtype : null,
    ) || (typeof payload.lv_internal_subtype === 'string' ? payload.lv_internal_subtype : null)
  const unitId =
    typeof payload.unit_id === 'string'
      ? payload.unit_id
      : Array.isArray(payload.content_ids) && typeof payload.content_ids[0] === 'string'
        ? payload.content_ids[0]
        : null
  const unitNumber =
    typeof payload.unit_number === 'string'
      ? payload.unit_number
      : typeof payload.content_name === 'string'
        ? payload.content_name
        : null
  const unitLabel = unitNumber || (unitId ? `Unidad ${unitId.slice(0, 8)}…` : null)
  return {
    id: row.id,
    phone: phone.source === 'none' ? null : phone.display,
    phoneDisplay: phone.display,
    phoneEvent: phone.eventPhone,
    phoneCrm: phone.crmPhone,
    phoneSource: phone.source,
    phoneSourceLabel: phone.source === 'crm_lead' ? 'CRM (lead 360 / CAPI)' : phone.sourceLabel,
    eventAt: unixToIso(row.event_time),
    registeredAt: row.created_at,
    forwardedAt: row.forwarded_at,
    timezone: DISPLAY_TZ,
    eventName: row.event_name,
    status: row.status,
    statusLabel: delivery.label,
    statusBucket:
      delivery.outcome === 'nest_received'
        ? 'delivered_backend'
        : delivery.outcome === 'failed_retrying'
          ? 'failed'
          : delivery.outcome === 'blocked' && row.last_error === 'not_configured'
            ? 'blocked_config'
            : delivery.outcome === 'pending_backend_support' ||
                delivery.outcome === 'internal_activity'
              ? 'retained'
              : delivery.outcome,
    deliveryOutcome: delivery.outcome,
    deliveryOutcomeLabel: delivery.label,
    deliveryReason: delivery.reason,
    graphFbtraceId: delivery.graphEvidence?.fbtraceId ?? null,
    graphEventsReceived: delivery.graphEvidence?.eventsReceived ?? null,
    internalSubtype: subtype,
    internalSubtypeLabel: labelMetaInternalSubtype(subtype),
    unitLabel,
    detail: detailLine(payload, row.event_id, row.last_error),
    lastError: row.last_error,
    deliveryLane: row.delivery_lane,
    channel: channelView.channel,
    channelLabel: channelView.channelLabel,
    destination: channelView.destination,
    destinationLabel: channelView.destinationLabel,
    hasCtwaClid: channelView.hasCtwaClid,
    ctwaNote: channelView.ctwaNote,
    datasetHint: channelView.destinationIdHint,
    eventId: row.event_id,
    origin: originFromPayload(payload),
    leadId: row.lead_id,
    visitorKey: row.visitor_key,
    projectId: row.leads?.project_id || projectFromPayload(payload),
    tenantId: row.leads?.tenant_id || null,
    connectedLead: Boolean(row.lead_id && row.leads),
    reception: reception.status,
    receptionLabel: reception.label,
  }
}

async function loadConversionEvidence(
  admin: SupabaseClient,
  eventIds: string[],
): Promise<Map<string, ConversionLogEvidence>> {
  const out = new Map<string, ConversionLogEvidence>()
  const ids = [...new Set(eventIds.filter(Boolean))]
  if (!ids.length) return out
  // Preferir stages Graph / Nest; última por event_id.
  const { data, error } = await admin
    .from('meta_capi_conversion_log')
    .select('event_id, stage, reason, created_at, details')
    .in('event_id', ids)
    .in('stage', [
      'meta_accepted',
      'meta_rejected',
      'transport_failed',
      'meta_unverified',
      'cancelled',
      'backend_accepted',
      'nest_lookup_unverified',
    ])
    .order('created_at', { ascending: false })
    .limit(Math.min(ids.length * 4, 400))
  if (error || !data) return out
  // Prioridad: respuesta Meta > fallo de transporte > recepciÃ³n interna.
  const rank = (stage: string) => {
    if (stage === 'meta_accepted') return 6
    if (stage === 'meta_rejected') return 5
    if (stage === 'cancelled') return 5
    if (stage === 'transport_failed') return 4
    if (stage === 'meta_unverified') return 3
    if (stage === 'nest_lookup_unverified') return 2
    if (stage === 'backend_accepted') return 1
    return 0
  }
  const best = new Map<string, (typeof data)[number]>()
  for (const raw of data) {
    const eid = raw.event_id ? String(raw.event_id) : ''
    if (!eid) continue
    const prev = best.get(eid)
    if (!prev || rank(String(raw.stage || '')) > rank(String(prev.stage || ''))) {
      best.set(eid, raw)
    }
  }
  for (const [eid, raw] of best) {
    const details =
      raw.details && typeof raw.details === 'object' && !Array.isArray(raw.details)
        ? (raw.details as Record<string, unknown>)
        : {}
    const eventsReceivedRaw = details.events_received
    const eventsReceived =
      typeof eventsReceivedRaw === 'number'
        ? eventsReceivedRaw
        : typeof eventsReceivedRaw === 'string' && eventsReceivedRaw.trim()
          ? Number(eventsReceivedRaw)
          : null
    out.set(eid, {
      stage: String(raw.stage || ''),
      reason: raw.reason ? String(raw.reason) : null,
      createdAt: String(raw.created_at),
      fbtraceId: typeof details.fbtrace_id === 'string' ? details.fbtrace_id : null,
      eventsReceived:
        eventsReceived != null && Number.isFinite(eventsReceived) ? eventsReceived : null,
      httpStatus: typeof details.http_status === 'number' ? details.http_status : null,
      datasetId: typeof details.dataset_id === 'string' ? details.dataset_id : null,
      attributionVerified: details.attribution_verified === true,
      metaAttributed: details.meta_attributed === true,
      attributedAdSetId:
        typeof details.attributed_adset_id === 'string' ? details.attributed_adset_id : null,
    })
  }
  return out
}

async function probeNestReception(
  eventIds: string[],
): Promise<Map<string, NestEventLookupEvidence>> {
  const out = new Map<string, NestEventLookupEvidence>()
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
  if (!eventIds.length || !isMetaCapiConfigured()) {
    for (const id of eventIds) out.set(id, empty(false))
    return out
  }
  const base = (
    process.env.META_CAPI_BACKEND_URL?.trim() ||
    process.env.LA_VILET_CAPI_URL?.trim() ||
    ''
  ).replace(/\/$/, '')
  const secret = process.env.META_CAPI_INTERNAL_SECRET?.trim() || ''
  for (const id of eventIds.slice(0, 40)) {
    try {
      const res = await fetch(`${base}/api/v1/events/${encodeURIComponent(id)}`, {
        method: 'GET',
        headers: { 'X-Internal-Secret': secret, Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(2500),
      })
      if (!res.ok) {
        out.set(id, { ...empty(true), found: false })
        continue
      }
      const body = (await res.json()) as Record<string, unknown>
      const meta =
        body.meta_response &&
        typeof body.meta_response === 'object' &&
        !Array.isArray(body.meta_response)
          ? (body.meta_response as Record<string, unknown>)
          : null
      out.set(id, {
        found: body.found === true || body.ok === true,
        status: typeof body.status === 'string' ? body.status : null,
        attemptCount: typeof body.attempt_count === 'number' ? body.attempt_count : null,
        lastError: typeof body.last_error === 'string' ? body.last_error : null,
        deliveryLane: typeof body.delivery_lane === 'string' ? body.delivery_lane : null,
        datasetId: typeof body.dataset_id === 'string' ? body.dataset_id : null,
        sentAt: typeof body.sent_at === 'string' ? body.sent_at : null,
        apiAccepted: body.api_accepted === true,
        deliveryOutcome: typeof body.delivery_outcome === 'string' ? body.delivery_outcome : null,
        acceptanceTier: typeof body.acceptance_tier === 'string' ? body.acceptance_tier : null,
        eventsReceived: typeof meta?.events_received === 'number' ? meta.events_received : null,
        fbtraceId: typeof meta?.fbtrace_id === 'string' ? meta.fbtrace_id : null,
        httpStatus: typeof meta?.http_status === 'number' ? meta.http_status : null,
        lookupOk: true,
      })
    } catch {
      out.set(id, empty(false))
    }
  }
  return out
}

async function buildAbsenceReport(
  admin: SupabaseClient,
  scoped: OutboxDbRow[],
): Promise<MetaCapiAbsenceReport> {
  const counts = { ViewContent: 0, Lead: 0, Schedule: 0 }
  for (const row of scoped) {
    const n = row.event_name
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
      'Schedule ausente en outbox del alcance: WhatsApp Schedule sigue bloqueado; persistencia web depende de META_SCHEDULE_* (si OFF → falta de actividad elegible, no fallo de la bitácora).',
    )
  }
  if (counts.Lead === 0) {
    notes.push(
      'Lead ausente: puede ser falta de actividad elegible, consentimiento ads, filtros de persistencia o error de implementación — no se inventa desde WhatsApp/Kommo.',
    )
  } else if ((withMetaId ?? 0) > counts.Lead) {
    notes.push(
      `Hay leads con meta_lead_event_id (${withMetaId}) y ${counts.Lead} Lead en outbox: historial parcial o recuperación incompleta.`,
    )
  }
  if (counts.ViewContent === 0) {
    notes.push('Sin ViewContent en outbox del alcance (tour/unidad con consentimiento y enqueue).')
  }
  notes.push(
    'PageView del navegador no vive en meta_capi_outbox. Los agregados oficiales (si hay permiso Graph) van en sección separada; no se mezclan con filas de la cola.',
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

function isWhatsAppLeadRow(row: {
  source?: string | null
  channel_origin?: string | null
  kommo_id?: number | string | null
  whatsapp_id?: string | null
}): boolean {
  if (row.kommo_id != null && String(row.kommo_id).trim() !== '') return true
  if (row.whatsapp_id != null && String(row.whatsapp_id).trim() !== '') return true
  const source = String(row.source || '').toLowerCase()
  const origin = String(row.channel_origin || '').toLowerCase()
  return (
    source === 'waba' ||
    source === 'whatsapp' ||
    origin === 'whatsapp' ||
    origin.includes('whatsapp')
  )
}

function pipelineStepFromStage(stage: string): MetaWaConversionLogItem['pipelineStep'] {
  if (stage === 'enqueued') return 'enqueued'
  if (stage === 'backend_accepted') return 'backend_accepted'
  if (stage === 'meta_accepted') return 'meta_accepted'
  if (stage === 'meta_rejected') return 'meta_rejected'
  return 'evaluated_or_blocked'
}

async function buildWaConversionTracking(
  admin: SupabaseClient,
  tenantIds: string[],
  dateFrom?: string | null,
  dateTo?: string | null,
): Promise<MetaWaConversionTracking> {
  const featureEnabled = isWaLeadSubmittedEnabled()
  const deliveryEnabled = isWaLeadSubmittedDeliveryEnabled()
  const banner =
    !featureEnabled || !deliveryEnabled ? 'Envío de conversiones WhatsApp desactivado' : null
  const empty: MetaWaConversionTracking = {
    featureEnabled,
    deliveryEnabled,
    banner,
    kpis: {
      evaluated: 0,
      blocked: 0,
      enqueued: 0,
      backendAccepted: 0,
      metaAccepted: 0,
      metaRejected: 0,
    },
    rows: [],
    indicatorHelp: [
      'Solo event_name=LeadSubmitted (no ViewContent/Lead web).',
      'evaluated / blocked: evaluación local (mensaje recibido en CRM; aún no hay cola).',
      'enqueued: intent local en outbox (aún no Nest).',
      'backend_accepted: Nest aceptó el envío (no implica Graph).',
      'meta_accepted / meta_rejected: respuesta de Meta cuando exista registro real.',
      'Flags OFF: no se crean envíos; la recepción CRM sigue visible aparte.',
    ],
  }
  if (!tenantIds.length) return empty

  const { fromIso, toIso } = periodBounds(dateFrom, dateTo)
  let q = admin
    .from('meta_capi_conversion_log')
    .select(
      'id, created_at, tenant_id, project_id, lead_id, contact_id, event_name, stage, reason, event_id, idempotency_key, delivery_lane, details',
    )
    .in('tenant_id', tenantIds)
    .not('tenant_id', 'is', null)
    // Solo LeadSubmitted BM: no mezclar ViewContent/Lead web en KPIs WhatsApp.
    .eq('event_name', 'LeadSubmitted')
    .order('created_at', { ascending: false })
    .limit(200)
  if (fromIso) q = q.gte('created_at', fromIso)
  if (toIso) q = q.lte('created_at', toIso)

  const { data, error } = await q
  if (error) {
    return {
      ...empty,
      banner: banner || `No se pudo leer conversion_log: ${error.message.slice(0, 80)}`,
    }
  }

  const leadIds = [
    ...new Set(
      (data || [])
        .map((r) => (r.lead_id ? String(r.lead_id) : null))
        .filter((id): id is string => Boolean(id)),
    ),
  ]
  const phoneByLead = new Map<string, string | null>()
  if (leadIds.length) {
    const { data: leadPhones } = await admin
      .from('leads')
      .select('id, phone')
      .in('id', leadIds)
      .in('tenant_id', tenantIds)
    for (const row of leadPhones || []) {
      phoneByLead.set(
        String(row.id),
        typeof row.phone === 'string' && row.phone.trim() ? row.phone.trim() : null,
      )
    }
  }

  const tenantSet = new Set(tenantIds)
  const rows: MetaWaConversionLogItem[] = []
  const kpis = { ...empty.kpis }
  for (const raw of data || []) {
    const tenantId = raw.tenant_id ? String(raw.tenant_id) : null
    if (!tenantId || !tenantSet.has(tenantId)) continue
    if (String(raw.event_name || '') !== 'LeadSubmitted') continue
    const stage = String(raw.stage || '')
    if (stage === 'evaluated') kpis.evaluated += 1
    else if (stage === 'blocked') kpis.blocked += 1
    else if (stage === 'enqueued') kpis.enqueued += 1
    else if (stage === 'backend_accepted') kpis.backendAccepted += 1
    else if (stage === 'meta_accepted') kpis.metaAccepted += 1
    else if (stage === 'meta_rejected') kpis.metaRejected += 1
    const details =
      raw.details && typeof raw.details === 'object' && !Array.isArray(raw.details)
        ? (raw.details as Record<string, unknown>)
        : {}
    const leadId = raw.lead_id ? String(raw.lead_id) : null
    rows.push({
      id: String(raw.id),
      createdAt: String(raw.created_at),
      leadId,
      contactId: raw.contact_id ? String(raw.contact_id) : null,
      phoneMasked: leadId ? maskPhoneDisplay(phoneByLead.get(leadId) ?? null) : null,
      leadHref: leadId ? `/inmobiliaria/leads?lead=${encodeURIComponent(leadId)}` : null,
      eventName: String(raw.event_name || ''),
      stage,
      stageLabel: labelMetaCapiStage(stage),
      reason: raw.reason ? String(raw.reason) : null,
      reasonLabel: labelMetaCapiReason(raw.reason ? String(raw.reason) : null),
      deliveryLane: raw.delivery_lane ? String(raw.delivery_lane) : null,
      isTechnicalProbe: isMetaCapiProbeRow({
        delivery_lane: raw.delivery_lane ? String(raw.delivery_lane) : null,
        idempotency_key: raw.idempotency_key ? String(raw.idempotency_key) : null,
        details,
      }),
      pipelineStep: pipelineStepFromStage(stage),
    })
  }

  return { ...empty, featureEnabled, deliveryEnabled, banner, kpis, rows }
}

/**
 * Visibilidad CRM WhatsApp/Kommo: contactos y mensajes reales con tenant/proyecto.
 * Nunca se presentan como conversiones CAPI enviadas a Meta.
 * source=WHATSAPP / tarjeta de anuncio ≠ prueba de ctwa_clid.
 */
async function buildWhatsAppVisibility(
  admin: SupabaseClient,
  tenantIds: string[],
  scopedOutbox: OutboxDbRow[],
  dateFrom?: string | null,
  dateTo?: string | null,
): Promise<MetaWhatsAppVisibility> {
  const { fromIso, toIso } = periodBounds(dateFrom, dateTo)
  const indicatorHelp = [
    'Mensajes entrantes: filas messages con role=cliente en el periodo, deduplicadas por external_message_id.',
    'Contactos únicos: leads con al menos un inbound en el periodo (alcance tenant).',
    'CTWA confirmada: solo filas en lv_whatsapp_ctwa_attribution (project_id+contact_id). No cuenta source/channel WHATSAPP ni tarjeta de anuncio.',
    'Sin atribución confirmada: inbound en periodo sin captura CTWA.',
    'Última recepción: max(sent_at) inbound del periodo.',
    'Prueba técnica: solo huella explícita mensaje (kommo+contact+minuto); no marca el contacto entero.',
  ]
  const empty: MetaWhatsAppVisibility = {
    disclaimer:
      'Sección CRM Kommo/WhatsApp: recepción almacenada. No son conversiones CAPI ni aceptación Meta.',
    indicatorHelp,
    period: { dateFrom: dateFrom ?? null, dateTo: dateTo ?? null },
    periodSummary: {
      inboundMessages: 0,
      uniqueContacts: 0,
      contactsWithCtwa: 0,
      contactsWithoutCtwa: 0,
      lastReceptionAt: null,
    },
    contacts: [],
    contactDetails: [],
    recentMessages: [],
    totals: {
      contacts: 0,
      messages: 0,
      ctwaCaptures: 0,
      capiWhatsappOutbox: 0,
    },
    ctwa: {
      captures: 0,
      note: 'Sin capturas ctwa_clid en lv_whatsapp_ctwa_attribution para el alcance.',
    },
    conversions: {
      featureEnabled: isWaLeadSubmittedEnabled(),
      deliveryEnabled: isWaLeadSubmittedDeliveryEnabled(),
      banner:
        !isWaLeadSubmittedEnabled() || !isWaLeadSubmittedDeliveryEnabled()
          ? 'Envío de conversiones WhatsApp desactivado'
          : null,
      kpis: {
        evaluated: 0,
        blocked: 0,
        enqueued: 0,
        backendAccepted: 0,
        metaAccepted: 0,
        metaRejected: 0,
      },
      rows: [],
      indicatorHelp: [],
    },
    adsInsights: getAdsInsightsStatus(),
    scheduleWhatsappBlocked: true,
  }
  if (!tenantIds.length) {
    empty.conversions = await buildWaConversionTracking(admin, tenantIds, dateFrom, dateTo)
    return empty
  }

  const { data: leadRows, error: leadError } = await admin
    .from('leads')
    .select(
      'id, name, phone, source, channel_origin, kommo_id, whatsapp_id, contact_id, project_id, tenant_id, created_at',
    )
    .in('tenant_id', tenantIds)
    .order('created_at', { ascending: false })
    .limit(500)

  if (leadError) {
    const conversions = await buildWaConversionTracking(admin, tenantIds, dateFrom, dateTo)
    return {
      ...empty,
      disclaimer: `${empty.disclaimer} (lectura leads: ${leadError.message.slice(0, 80)})`,
      conversions,
    }
  }

  const waLeads = (leadRows ?? []).filter((row) =>
    isWhatsAppLeadRow(row as Parameters<typeof isWhatsAppLeadRow>[0]),
  )
  const leadIds = waLeads.map((l) => String(l.id))
  const phoneByLead = new Map(
    waLeads.map((l) => [String(l.id), (l.phone as string | null) ?? null]),
  )

  const inboundByLead = new Map<string, WaCrmInboundMessageRow[]>()
  const recentMessages: MetaWhatsAppCrmMessage[] = []
  let messagesTotalAllRoles = 0

  if (leadIds.length) {
    const { data: conversations } = await admin
      .from('conversations')
      .select('id, lead_id, tenant_id, project_id')
      .in('lead_id', leadIds)
      .in('tenant_id', tenantIds)

    const convRows = conversations ?? []
    const convIds = convRows.map((c) => String(c.id))
    const leadByConv = new Map(convRows.map((c) => [String(c.id), String(c.lead_id)]))

    if (convIds.length) {
      const { count: msgCount } = await admin
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .in('conversation_id', convIds)
      messagesTotalAllRoles = msgCount ?? 0

      let msgQuery = admin
        .from('messages')
        .select('id, conversation_id, role, content, sent_at, external_message_id')
        .in('conversation_id', convIds)
        .eq('role', 'cliente')
        .order('sent_at', { ascending: false })
        .limit(800)
      if (fromIso) msgQuery = msgQuery.gte('sent_at', fromIso)
      if (toIso) msgQuery = msgQuery.lte('sent_at', toIso)

      const { data: msgs } = await msgQuery
      const inboundRaw: WaCrmInboundMessageRow[] = []
      for (const m of msgs ?? []) {
        const leadId = leadByConv.get(String(m.conversation_id))
        if (!leadId) continue
        const sentAt = String(m.sent_at || '')
        if (!sentAt || !inPeriod(sentAt, fromIso, toIso)) continue
        const content = typeof m.content === 'string' ? m.content : ''
        inboundRaw.push({
          id: String(m.id),
          conversationId: String(m.conversation_id),
          leadId,
          role: 'cliente',
          sentAt,
          externalMessageId: m.external_message_id == null ? null : String(m.external_message_id),
          contentPreview: content.slice(0, 120),
        })
      }
      const inbound = dedupeInboundMessages(inboundRaw)
      for (const row of inbound) {
        const list = inboundByLead.get(row.leadId) || []
        list.push(row)
        inboundByLead.set(row.leadId, list)
      }

      for (const row of inbound.slice(0, 20)) {
        recentMessages.push({
          messageId: row.id,
          leadId: row.leadId,
          phone: phoneByLead.get(row.leadId) ?? null,
          role: row.role,
          sentAt: row.sentAt,
          preview: row.contentPreview,
          externalMessageId: row.externalMessageId,
        })
      }
    }
  }

  const { data: ctwaRows } = await admin
    .from('lv_whatsapp_ctwa_attribution')
    .select('id, project_id, contact_id, source_id, referral_source_type, captured_at')
    .in('tenant_id', tenantIds)
    .order('captured_at', { ascending: true })
    .limit(2000)

  const ctwaKeys = new Set<string>()
  const ctwaByKey = new Map<string, WaCrmCtwaAttributionInfo>()
  for (const r of ctwaRows ?? []) {
    if (!r.project_id || !r.contact_id) continue
    const key = `${String(r.project_id)}:${String(r.contact_id)}`
    ctwaKeys.add(key)
    // First-touch: conservar la captura más antigua (orden ascendente).
    if (!ctwaByKey.has(key)) {
      ctwaByKey.set(key, {
        sourceId: r.source_id ? String(r.source_id) : null,
        referralSourceType: r.referral_source_type ? String(r.referral_source_type) : null,
        capturedAt: r.captured_at ? String(r.captured_at) : null,
      })
    }
  }
  const ctwaCaptures = ctwaKeys.size

  const leadsForDetails = waLeads.map((l) => ({
    id: String(l.id),
    name: typeof l.name === 'string' ? l.name : null,
    phone: typeof l.phone === 'string' && l.phone.trim() ? l.phone.trim() : null,
    kommo_id: l.kommo_id == null ? null : Number(l.kommo_id),
    contact_id: l.contact_id == null ? null : String(l.contact_id),
    project_id: l.project_id == null ? null : String(l.project_id),
    tenant_id: String(l.tenant_id),
    source: typeof l.source === 'string' ? l.source : null,
    channel_origin: typeof l.channel_origin === 'string' ? l.channel_origin : null,
  }))

  const contactDetails = buildContactDetails({
    leads: leadsForDetails,
    inboundByLead,
    ctwaKeys,
    ctwaByKey,
  })
  const inboundTotal = [...inboundByLead.values()].reduce((n, rows) => n + rows.length, 0)
  const periodSummary = summarizeWaCrmPeriod(contactDetails, inboundTotal)

  const capiWhatsappOutbox = scopedOutbox.filter((r) => {
    const ch = resolveMetaCapiChannel(asRecord(r.payload), r.delivery_lane)
    return ch.channel === 'whatsapp'
  }).length

  const contacts: MetaWhatsAppCrmContact[] = contactDetails.map((d) => {
    const lead = waLeads.find((l) => String(l.id) === d.leadId)
    return {
      leadId: d.leadId,
      phone: d.phone,
      phoneSource: 'crm_lead' as const,
      name: d.name,
      source: d.source,
      channelOrigin: d.channelOrigin,
      hasKommo: d.kommoId != null,
      contactId: d.contactId,
      projectId: d.projectId,
      createdAt: lead ? String(lead.created_at) : '',
      messageCount: d.inboundCount,
      lastMessageAt: d.lastInboundAt,
    }
  })

  const conversions = await buildWaConversionTracking(admin, tenantIds, dateFrom, dateTo)

  return {
    disclaimer:
      'Sección CRM Kommo/WhatsApp: recepción almacenada con aislamiento tenant. No son conversiones CAPI ni aceptación Meta Graph. source=WHATSAPP no prueba ctwa_clid.',
    indicatorHelp,
    period: { dateFrom: dateFrom ?? null, dateTo: dateTo ?? null },
    periodSummary,
    contacts,
    contactDetails,
    recentMessages,
    totals: {
      contacts: contacts.length,
      messages: messagesTotalAllRoles,
      ctwaCaptures,
      capiWhatsappOutbox,
    },
    ctwa: {
      captures: ctwaCaptures,
      note:
        ctwaCaptures === 0
          ? '0 capturas first-touch en lv_whatsapp_ctwa_attribution. Origen CRM WHATSAPP ≠ atribución confirmada.'
          : `${ctwaCaptures} contacto(s) con captura first-touch. Presencia de clid no implica envío CAPI ni atribución comercial Meta.`,
    },
    conversions,
    adsInsights: getAdsInsightsStatus(),
    scheduleWhatsappBlocked: true,
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
  const datasets = Array.from(
    new Set(
      scoped
        .map((r) => resolveMetaCapiChannel(asRecord(r.payload), r.delivery_lane).destinationIdHint)
        .filter(Boolean) as string[],
    ),
  ).sort()

  let working = scoped
  if (filters.origin && filters.origin !== 'all') {
    working = working.filter((r) => originFromPayload(asRecord(r.payload)) === filters.origin)
  }
  if (filters.channel && filters.channel !== 'all') {
    working = working.filter(
      (r) =>
        resolveMetaCapiChannel(asRecord(r.payload), r.delivery_lane).channel === filters.channel,
    )
  }
  if (filters.dataset && filters.dataset !== 'all') {
    working = working.filter((r) => {
      const hint = resolveMetaCapiChannel(asRecord(r.payload), r.delivery_lane).destinationIdHint
      return hint === filters.dataset
    })
  }

  // Sync Nest → conversion_log (página + backlog acotado) antes de KPIs. Sin reenvío.
  try {
    const { syncNestOutboxResults } = await import('@/lib/meta/syncNestOutboxResults')
    await syncNestOutboxResults(admin, { limit: 25 })
  } catch (error) {
    console.error('[meta-capi] nest sync', {
      error: error instanceof Error ? error.message.slice(0, 160) : 'error',
    })
  }

  // Evidencia Graph desde conversion_log (toda la ventana filtrada).
  const conversionMap = await loadConversionEvidence(
    admin,
    working.map((r) => r.event_id),
  )

  // KPIs con outcomes reales (conversion_log); Nest probe solo en página.
  const byEventName: Record<string, number> = {}
  let nestReceived = 0
  let pending = 0
  let metaAccepted = 0
  let blocked = 0
  let blockedConfig = 0
  let retained = 0
  let cancelled = 0
  let failedRetrying = 0
  let unknown = 0
  const outcomeById = new Map<string, MetaCapiDeliveryOutcome>()
  for (const row of working) {
    byEventName[row.event_name] = (byEventName[row.event_name] || 0) + 1
    const delivery = classifyDeliveryOutcome({
      outboxStatus: row.status,
      lastError: row.last_error,
      conversion: conversionMap.get(row.event_id) ?? null,
      nest: null,
    })
    outcomeById.set(row.id, delivery.outcome)
    if (delivery.outcome === 'nest_received') nestReceived += 1
    else if (delivery.outcome === 'pending') pending += 1
    else if (delivery.outcome === 'meta_accepted') metaAccepted += 1
    else if (delivery.outcome === 'blocked') {
      blocked += 1
      if (row.last_error === 'not_configured') blockedConfig += 1
      if (row.status === 'needs_review' || row.status === 'review_hold') retained += 1
      if (row.status === 'cancelled') cancelled += 1
    } else if (delivery.outcome === 'failed_retrying') failedRetrying += 1
    else if (delivery.outcome === 'unknown') unknown += 1
  }
  const total = working.length
  const deadErrorPct =
    total > 0 && failedRetrying > 0
      ? Math.round((failedRetrying / total) * 1000) / 10
      : failedRetrying === 0
        ? 0
        : null

  if (filters.statusBucket && filters.statusBucket !== 'all') {
    working = working.filter((r) =>
      deliveryOutcomeMatchesFilter(outcomeById.get(r.id) || 'pending', filters.statusBucket),
    )
  }

  const totalFiltered = working.length
  const slice = working.slice((page - 1) * pageSize, page * pageSize)
  const nestMap = await probeNestReception(slice.map((r) => r.event_id))
  const rows = slice.map((r) => mapRow(r, nestMap, conversionMap, tenantIds))

  const notConfiguredRows = scoped
    .filter(
      (r) =>
        r.last_error === 'not_configured' ||
        (r.status === 'pending' && r.last_error === 'not_configured'),
    )
    .map((r): MetaCapiNotConfiguredDiag => {
      const payload = asRecord(r.payload)
      const channelView = resolveMetaCapiChannel(payload, r.delivery_lane)
      const host = channelView.eventSourceHost
      const historicalLocal =
        Boolean(host && /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)) ||
        (r.delivery_lane === 'test' && Boolean(host?.includes('localhost')))
      const configGapAtFlush =
        'Al flush faltaban META_CAPI_BACKEND_URL y/o META_CAPI_INTERNAL_SECRET en ese proceso (error histórico en outbox).'
      return {
        eventId: r.event_id,
        eventName: r.event_name,
        status: r.status,
        deliveryLane: r.delivery_lane,
        channel: channelView.channel,
        channelLabel: channelView.channelLabel,
        destinationLabel: channelView.destinationLabel,
        createdAt: r.created_at,
        eventAt: unixToIso(r.event_time),
        lastError: r.last_error,
        hasVisitor: Boolean(r.visitor_key),
        hasLead: Boolean(r.lead_id),
        eventSourceHost: host,
        actionSource: channelView.actionSource,
        configGapAtFlush,
        historicalLocal,
        currentProcessCapiConfigured: isMetaCapiConfigured(),
        likelyOrigin: historicalLocal
          ? `Prueba local/preview (${host || 'localhost'}) · lane=test · not_configured en ese proceso · no reenviar ni promover a live`
          : `Lane ${r.delivery_lane} · ${channelView.channelLabel} · config CAPI ausente en el proceso que hizo flush (no afirma fallo de Production)`,
        nestReceivedEvidence: 'none',
      }
    })

  const absence = await buildAbsenceReport(admin, scoped)
  const whatsapp = await buildWhatsAppVisibility(
    admin,
    tenantIds,
    scoped,
    filters.dateFrom,
    filters.dateTo,
  )
  const metaOfficialMetrics = await fetchMetaOfficialAggregates()

  const optimizationEvidence: OptimizationEventEvidence[] = scoped.map((row) => {
    const conversion = conversionMap.get(row.event_id) || null
    const payload = asRecord(row.payload)
    const payloadAdSet =
      payload?.attribution_verified === true && typeof payload?.adset_id === 'string'
        ? payload.adset_id
        : null
    return {
      eventType: row.event_name,
      eventId: row.event_id,
      capturedAt: unixToIso(row.event_time) || row.created_at,
      metaAccepted: Boolean(
        conversion?.stage === 'meta_accepted' &&
        ((conversion.eventsReceived ?? 0) >= 1 || conversion.fbtraceId),
      ),
      metaAttributionVerified: conversion?.attributionVerified === true,
      metaAttributed: conversion?.metaAttributed === true,
      verifiedAdSetId: conversion?.attributedAdSetId || payloadAdSet,
      deliveryEvidenceComplete: Boolean(conversion),
      channel: resolveMetaCapiChannel(payload, row.delivery_lane).channel,
      dataset: resolveMetaCapiChannel(payload, row.delivery_lane).destinationIdHint || 'unknown',
      deliveryLane: row.delivery_lane === 'test' ? 'test' : 'live',
      status: row.status,
      deliveryOutcome: conversion?.stage || 'backend_accepted',
      eligible: true,
    }
  })

  // La tabla nueva puede no existir hasta aplicar la migración. En ese caso el
  // panel conserva el resto de familias y no convierte ausencia en cero global.
  const qualificationRead = await admin
    .from('meta_crm_qualification_intents')
    .select('event_id,qualified_at,status,hold_reasons,tenant_id')
    .in('tenant_id', tenantIds)
  if (!qualificationRead.error) {
    const outboxEventIds = new Set(scoped.map((row) => row.event_id))
    for (const row of qualificationRead.data || []) {
      if (outboxEventIds.has(String(row.event_id))) continue
      optimizationEvidence.push({
        eventType: 'QualifiedLead',
        eventId: String(row.event_id),
        capturedAt: String(row.qualified_at),
        metaAccepted: false,
        metaAttributionVerified: false,
        metaAttributed: false,
        verifiedAdSetId: null,
        deliveryEvidenceComplete: false,
        channel: 'whatsapp',
        dataset: 'messaging_pending',
        deliveryLane: 'live',
        status: String(row.status),
        deliveryOutcome: row.status === 'enqueued' ? 'backend_accepted' : 'not_accepted',
        eligible: row.status !== 'excluded',
        exclusionReasons: Array.isArray(row.hold_reasons)
          ? row.hold_reasons.filter((value): value is string => typeof value === 'string')
          : [],
      })
    }
  }
  const optimizationVolume = summarizeOptimizationVolume(
    optimizationEvidence,
    new Date().toISOString(),
  )

  const kpisByChannel: MetaCapiChannelKpis = {
    web: 0,
    whatsapp: 0,
    undetermined: 0,
  }
  let channelBase = scoped
  if (filters.origin && filters.origin !== 'all') {
    channelBase = channelBase.filter(
      (r) => originFromPayload(asRecord(r.payload)) === filters.origin,
    )
  }
  if (filters.dataset && filters.dataset !== 'all') {
    channelBase = channelBase.filter((r) => {
      const hint = resolveMetaCapiChannel(asRecord(r.payload), r.delivery_lane).destinationIdHint
      return hint === filters.dataset
    })
  }
  for (const row of channelBase) {
    const ch = resolveMetaCapiChannel(asRecord(row.payload), row.delivery_lane).channel
    if (ch === 'web') kpisByChannel.web += 1
    else if (ch === 'whatsapp') kpisByChannel.whatsapp += 1
    else kpisByChannel.undetermined += 1
  }

  return {
    kpis: {
      total,
      nestReceived,
      deliveredBackend: nestReceived,
      pending,
      metaAccepted,
      blocked,
      blockedConfig,
      retained,
      cancelled,
      failedRetrying,
      failed: failedRetrying,
      unknown,
      deadErrorPct: blockedConfig > 0 && failedRetrying === 0 ? null : deadErrorPct,
      hasConfigBlocks: blockedConfig > 0,
      byEventName,
    },
    kpisByChannel,
    rows,
    totalFiltered,
    page,
    pageSize,
    eventNames,
    origins,
    datasets,
    timezone: DISPLAY_TZ,
    metaOfficialMetrics,
    absence,
    notConfigured: notConfiguredRows,
    whatsapp,
    optimizationVolume,
    fetchedAt: new Date().toISOString(),
    scope: { tenantIds, includeOrphanShowroom },
  }
}
