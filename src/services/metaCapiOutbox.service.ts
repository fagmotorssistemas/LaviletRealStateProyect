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
  phoneFromEventPayload,
  resolveMetaCapiPhone,
  type MetaCapiPhoneSource,
} from '@/lib/meta/metaCapiPhone'
import {
  fetchMetaOfficialAggregates,
  type MetaOfficialMetricsResult,
} from '@/lib/meta/metaOfficialMetrics'

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

export type MetaWhatsAppVisibility = {
  disclaimer: string
  contacts: MetaWhatsAppCrmContact[]
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
  scheduleWhatsappBlocked: true
}

export type MetaCapiOutboxResult = {
  kpis: MetaCapiOutboxKpis
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
      label: 'Entregado al backend Nest (no implica aceptación Meta Graph)',
    }
  }
  return {
    status: 'meta_reception_unverified',
    label: 'Recepción Meta Graph no verificada',
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
  const channelView = resolveMetaCapiChannel(payload, row.delivery_lane)
  return {
    id: row.id,
    phone: phone.source === 'none' ? null : phone.display,
    phoneDisplay: phone.display,
    phoneEvent: phone.eventPhone,
    phoneCrm: phone.crmPhone,
    phoneSource: phone.source,
    phoneSourceLabel:
      phone.source === 'crm_lead'
        ? 'CRM (lead 360 / CAPI)'
        : phone.sourceLabel,
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

/**
 * Visibilidad CRM WhatsApp/Kommo: contactos y mensajes reales con tenant/proyecto.
 * Nunca se presentan como conversiones CAPI enviadas a Meta.
 */
async function buildWhatsAppVisibility(
  admin: SupabaseClient,
  tenantIds: string[],
  scopedOutbox: OutboxDbRow[],
): Promise<MetaWhatsAppVisibility> {
  const empty: MetaWhatsAppVisibility = {
    disclaimer:
      'Sección CRM Kommo/WhatsApp: contactos y mensajes del tenant. No son conversiones CAPI ni aceptación Meta.',
    contacts: [],
    recentMessages: [],
    totals: { contacts: 0, messages: 0, ctwaCaptures: 0, capiWhatsappOutbox: 0 },
    ctwa: {
      captures: 0,
      note: 'Sin capturas ctwa_clid en lv_whatsapp_ctwa_attribution para el alcance.',
    },
    scheduleWhatsappBlocked: true,
  }
  if (!tenantIds.length) return empty

  const { data: leadRows, error: leadError } = await admin
    .from('leads')
    .select(
      'id, name, phone, source, channel_origin, kommo_id, whatsapp_id, contact_id, project_id, tenant_id, created_at',
    )
    .in('tenant_id', tenantIds)
    .order('created_at', { ascending: false })
    .limit(400)

  if (leadError) {
    return {
      ...empty,
      disclaimer: `${empty.disclaimer} (lectura leads: ${leadError.message.slice(0, 80)})`,
    }
  }

  const waLeads = (leadRows ?? []).filter((row) =>
    isWhatsAppLeadRow(row as Parameters<typeof isWhatsAppLeadRow>[0]),
  )
  const leadIds = waLeads.map((l) => String(l.id))
  const phoneByLead = new Map(
    waLeads.map((l) => [String(l.id), (l.phone as string | null) ?? null]),
  )

  let messageCountByLead = new Map<string, number>()
  let lastMessageByLead = new Map<string, string>()
  const recentMessages: MetaWhatsAppCrmMessage[] = []
  let messagesTotal = 0

  if (leadIds.length) {
    const { data: conversations } = await admin
      .from('conversations')
      .select('id, lead_id, last_message_at')
      .in('lead_id', leadIds)
      .in('tenant_id', tenantIds)

    const convIds = (conversations ?? []).map((c) => String(c.id))
    const leadByConv = new Map(
      (conversations ?? []).map((c) => [String(c.id), String(c.lead_id)]),
    )

    for (const c of conversations ?? []) {
      const leadId = String(c.lead_id)
      if (c.last_message_at) {
        const prev = lastMessageByLead.get(leadId)
        if (!prev || String(c.last_message_at) > prev) {
          lastMessageByLead.set(leadId, String(c.last_message_at))
        }
      }
    }

    if (convIds.length) {
      const { count: msgCount } = await admin
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .in('conversation_id', convIds)
      messagesTotal = msgCount ?? 0

      const { data: msgs } = await admin
        .from('messages')
        .select('id, conversation_id, role, content, sent_at, external_message_id')
        .in('conversation_id', convIds)
        .order('sent_at', { ascending: false })
        .limit(200)

      for (const m of msgs ?? []) {
        const leadId = leadByConv.get(String(m.conversation_id))
        if (!leadId) continue
        messageCountByLead.set(leadId, (messageCountByLead.get(leadId) || 0) + 1)
      }

      // Si hay más de 200 mensajes globales, los conteos por lead del sample son parciales:
      // preferimos total exacto y sample reciente para la lista.
      for (const m of (msgs ?? []).slice(0, 15)) {
        const leadId = leadByConv.get(String(m.conversation_id))
        if (!leadId) continue
        const content = typeof m.content === 'string' ? m.content : ''
        recentMessages.push({
          messageId: String(m.id),
          leadId,
          phone: phoneByLead.get(leadId) ?? null,
          role: String(m.role || ''),
          sentAt: String(m.sent_at || ''),
          preview: content.slice(0, 100),
          externalMessageId:
            m.external_message_id == null ? null : String(m.external_message_id),
        })
      }

      if (messagesTotal > 200) {
        // Conteos por lead del sample son incompletos: marcar con total conocido vía conversación.
        messageCountByLead = new Map(
          leadIds.map((id) => [id, messageCountByLead.get(id) || 0]),
        )
      }
    }
  }

  const { count: ctwaCaptures } = await admin
    .from('lv_whatsapp_ctwa_attribution')
    .select('id', { count: 'exact', head: true })
    .in('tenant_id', tenantIds)

  const capiWhatsappOutbox = scopedOutbox.filter((r) => {
    const ch = resolveMetaCapiChannel(asRecord(r.payload), r.delivery_lane)
    return ch.channel === 'whatsapp'
  }).length

  const contacts: MetaWhatsAppCrmContact[] = waLeads.map((l) => ({
    leadId: String(l.id),
    phone: typeof l.phone === 'string' && l.phone.trim() ? l.phone.trim() : null,
    phoneSource: 'crm_lead' as const,
    name: typeof l.name === 'string' ? l.name : null,
    source: typeof l.source === 'string' ? l.source : null,
    channelOrigin: typeof l.channel_origin === 'string' ? l.channel_origin : null,
    hasKommo: l.kommo_id != null && String(l.kommo_id).trim() !== '',
    contactId: l.contact_id == null ? null : String(l.contact_id),
    projectId: l.project_id == null ? null : String(l.project_id),
    createdAt: String(l.created_at),
    messageCount: messageCountByLead.get(String(l.id)) || 0,
    lastMessageAt: lastMessageByLead.get(String(l.id)) || null,
  }))

  return {
    disclaimer:
      'Sección CRM Kommo/WhatsApp: contactos y mensajes del tenant con relaciones verificadas. No son conversiones CAPI ni aceptación Meta Graph.',
    contacts,
    recentMessages,
    totals: {
      contacts: contacts.length,
      messages: messagesTotal,
      ctwaCaptures: ctwaCaptures ?? 0,
      capiWhatsappOutbox,
    },
    ctwa: {
      captures: ctwaCaptures ?? 0,
      note:
        (ctwaCaptures ?? 0) === 0
          ? '0 capturas first-touch en lv_whatsapp_ctwa_attribution. ctwa_clid presente ≠ atribución confirmada; hoy no hay captura persistida.'
          : `${ctwaCaptures} captura(s) first-touch. Presencia de ctwa_clid no implica atribución ads confirmada ni envío CAPI.`,
    },
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
      (r) => resolveMetaCapiChannel(asRecord(r.payload), r.delivery_lane).channel === filters.channel,
    )
  }
  if (filters.dataset && filters.dataset !== 'all') {
    working = working.filter((r) => {
      const hint = resolveMetaCapiChannel(asRecord(r.payload), r.delivery_lane).destinationIdHint
      return hint === filters.dataset
    })
  }

  // KPIs de la ventana (fecha/origen) sin el filtro de pestaña estado.
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

  if (filters.statusBucket && filters.statusBucket !== 'all') {
    working = working.filter(
      (r) => classifyOutboxStatus(r.status, r.last_error).bucket === filters.statusBucket,
    )
  }

  const totalFiltered = working.length
  const slice = working.slice((page - 1) * pageSize, page * pageSize)
  const nestMap = await probeNestReception(
    slice.filter((r) => r.status === 'forwarded').map((r) => r.event_id),
  )
  const rows = slice.map((r) => mapRow(r, nestMap, tenantIds))

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
          ? `Entorno local (${host || 'host no determinado'}) · lane test · ViewContent web · sin entrega al backend`
          : `Lane ${r.delivery_lane} · ${channelView.channelLabel} · config CAPI ausente en el proceso que hizo flush (no afirma fallo de Production)`,
        nestReceivedEvidence: 'none',
      }
    })

  const absence = await buildAbsenceReport(admin, scoped)
  const whatsapp = await buildWhatsAppVisibility(admin, tenantIds, scoped)
  const metaOfficialMetrics = await fetchMetaOfficialAggregates()

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
    datasets,
    timezone: DISPLAY_TZ,
    metaOfficialMetrics,
    absence,
    notConfigured: notConfiguredRows,
    whatsapp,
    fetchedAt: new Date().toISOString(),
    scope: { tenantIds, includeOrphanShowroom },
  }
}
