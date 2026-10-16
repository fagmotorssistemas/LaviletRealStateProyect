import type { SupabaseClient } from '@supabase/supabase-js'
import { UNASSIGNED_ASSIGNEE } from '@/types/inmobiliaria'
import type {
  BotEscalationRow,
  ConversationRow,
  LeadAutomationDetail,
  LeadAutomationFilters,
  LeadAutomationKpis,
  LeadAutomationRow,
  LeadAttentionRow,
  LeadInterestUnitRow,
  LeadNutritionJob,
  LeadScoreEventRow,
  LeadTemperatureHistoryRow,
  LeadVisitRow,
  MessageRow,
} from '@/types/leadAutomation'
import { buildAutomationTimeline, EMPTY_AUTOMATION_KPIS, sanitizeSearch, toInclusiveRange } from '@/lib/inmobiliaria/leadAutomation'
import { getLeadPipelineDetailAction, readLeadPipelineSnapshotsAction } from '@/app/inmobiliaria/leads/pipeline-actions'
import { LEAD_PIPELINE_STAGE_OPTIONS } from '@/types/leadPipeline'

const VIEW = 'vw_lead_automation_dashboard'

function applyDashboardFilters(
  // PostgREST filter builder; generated DB types do not expose a shared query class.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
  tenantIds: string[],
  filters: LeadAutomationFilters,
) {
  const range = toInclusiveRange(filters.from.includes('T') ? '' : filters.from, filters.to.includes('T') ? '' : filters.to)
  if (filters.from.includes('T')) range.from = filters.from
  if (filters.to.includes('T')) range.to = filters.to
  let next = query.in('tenant_id', tenantIds)
  if (filters.projectId) next = next.eq('project_id', filters.projectId)
  if (range.from) next = next.gte('created_at', range.from)
  if (range.to) next = next.lte('created_at', range.to)
  if (filters.source) next = next.eq('source', filters.source)
  if (filters.temperature === 'tibio_caliente') next = next.in('temperature', ['tibio', 'caliente'])
  else if (filters.temperature) next = next.eq('temperature', filters.temperature)
  if (filters.assignedTo === UNASSIGNED_ASSIGNEE) next = next.is('assigned_to', null)
  else if (filters.assignedTo) next = next.eq('assigned_to', filters.assignedTo)
  if (filters.handoff) next = next.eq('handoff_status', filters.handoff)
  if (filters.bot === 'activo') next = next.eq('bot_enabled', true)
  if (filters.bot === 'desactivado') next = next.eq('bot_enabled', false)
  if (filters.sla) next = next.eq('sla_status', filters.sla)

  const search = sanitizeSearch(filters.search)
  if (search) {
    const kommo = Number.parseInt(search, 10)
    const clauses = [
      `name.ilike.%${search}%`,
      `phone.ilike.%${search}%`,
      `phone_normalized.ilike.%${search}%`,
      `assignee_kommo_id.ilike.%${search}%`,
    ]
    if (Number.isFinite(kommo)) clauses.push(`lead_kommo_id.eq.${kommo}`)
    next = next.or(clauses.join(','))
  }

  return next
}

async function withCommercialPipeline(rows: LeadAutomationRow[]): Promise<LeadAutomationRow[]> {
  if (!rows.length) return []
  const ids = [...new Set(rows.map(row => row.lead_id))]
  const snapshots = new Map<string, NonNullable<LeadAutomationRow['pipeline']>>()
  for (let from = 0; from < ids.length; from += 200) {
    const response = await readLeadPipelineSnapshotsAction(ids.slice(from, from + 200))
    if (!response.ok) throw new Error(response.error)
    for (const item of response.data) snapshots.set(item.leadId, item.pipeline)
  }
  return rows.map(row => {
    const pipeline = snapshots.get(row.lead_id)
    if (!pipeline) throw new Error('No se pudo verificar la etapa comercial de uno de los leads. Actualice el monitoreo.')
    return { ...row, pipeline, stage: pipeline.stage, stage_reason: pipeline.stageReason,
      stage_changed_at: pipeline.stageChangedAt, last_stage_reason: pipeline.stageReason,
      last_interaction_at: pipeline.lastActivityAt || row.last_interaction_at }
  })
}

/** Read every authorized result before applying a projected commercial-stage filter. */
async function readDashboardRows(supabase: SupabaseClient, tenantIds: string[], filters: LeadAutomationFilters) {
  const rows: LeadAutomationRow[] = []
  const batchSize = 500
  for (let from = 0; ; from += batchSize) {
    const query = supabase.from(VIEW).select('*')
      .order('last_interaction_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false }).order('lead_id', { ascending: true })
    const result = await applyDashboardFilters(query, tenantIds, filters).range(from, from + batchSize - 1)
    if (result.error) throw result.error
    const batch = (result.data ?? []) as LeadAutomationRow[]
    rows.push(...batch)
    if (batch.length < batchSize) break
  }
  return withCommercialPipeline(rows)
}

export async function listLeadAutomationDashboard(
  supabase: SupabaseClient,
  params: {
    tenantId: string
    tenantIds?: string[]
    filters: LeadAutomationFilters
    page?: number
    pageSize?: number
  },
) {
  const page = Math.max(1, params.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, params.pageSize ?? 25))
  const from = (page - 1) * pageSize
  const tenantIds = params.tenantIds?.length ? params.tenantIds : [params.tenantId]

  const projectedRows = await readDashboardRows(supabase, tenantIds, params.filters)
  const filteredRows = params.filters.stage ? projectedRows.filter(row => row.stage === params.filters.stage) : projectedRows
  const dashboardRows = filteredRows.slice(from, from + pageSize)
  const leadIds = dashboardRows.map(row => row.lead_id)
  const interestNumbers = new Map<string, string>()
  if (leadIds.length) {
    const interests = await supabase
      .from('lead_units')
      .select('lead_id,rejected,created_at,unit:units(unit_number)')
      .in('lead_id', leadIds)
      .order('created_at', { ascending: false, nullsFirst: false })
    if (interests.error) throw interests.error
    for (const raw of interests.data ?? []) {
      const item = raw as unknown as {
        lead_id: string
        rejected: boolean | null
        unit: { unit_number: string } | { unit_number: string }[] | null
      }
      if (item.rejected === true || interestNumbers.has(item.lead_id)) continue
      const unit = firstRelation(item.unit)
      if (unit?.unit_number) interestNumbers.set(item.lead_id, unit.unit_number)
    }
  }
  return {
    data: dashboardRows.map(row => ({ ...row, interest_unit_number: interestNumbers.get(row.lead_id) ?? null })),
    total: filteredRows.length,
  }
}

export async function listLeadAttentionQueue(
  supabase: SupabaseClient,
  tenantIds: string[],
): Promise<LeadAttentionRow[]> {
  if (!tenantIds.length) return []
  const { data, error } = await supabase
    .from(VIEW)
    .select('*')
    .in('tenant_id', tenantIds)
    .in('handoff_status', ['queued', 'assigned', 'acknowledged', 'resolved'])
    .order('handoff_requested_at', { ascending: false, nullsFirst: false })
    .limit(150)
  if (error) throw error

  const rows = await withCommercialPipeline((data ?? []) as LeadAutomationRow[])
  const conversationIds = [...new Set(rows.map((row) => row.latest_conversation_id).filter((id): id is string => Boolean(id)))]
  if (!conversationIds.length) return rows.map((row) => ({ ...row, last_customer_message: null, last_customer_message_at: null }))

  const messages = await supabase
    .from('messages')
    .select('conversation_id, content, sent_at')
    .in('conversation_id', conversationIds)
    .eq('role', 'cliente')
    .order('sent_at', { ascending: false })
    .limit(500)
  if (messages.error) throw messages.error

  const latestByConversation = new Map<string, { content: string | null; sent_at: string | null }>()
  for (const message of messages.data ?? []) {
    if (!latestByConversation.has(message.conversation_id)) {
      latestByConversation.set(message.conversation_id, {
        content: message.content,
        sent_at: message.sent_at,
      })
    }
  }
  return rows.map((row) => {
    const latest = row.latest_conversation_id ? latestByConversation.get(row.latest_conversation_id) : null
    return {
      ...row,
      last_customer_message: latest?.content ?? null,
      last_customer_message_at: latest?.sent_at ?? null,
    }
  })
}

export async function getLeadAutomationKpis(
  supabase: SupabaseClient,
  params: { tenantId: string; tenantIds?: string[]; projectId?: string; from?: string; to?: string },
): Promise<LeadAutomationKpis> {
  const { data, error } = await supabase.rpc('get_lead_automation_kpis', {
    p_tenant_id: params.tenantId,
    p_project_id: params.projectId || null,
    p_from: params.from ?? null,
    p_to: params.to ?? null,
  })
  if (error) throw error
  const stageRows = await readDashboardRows(supabase, params.tenantIds?.length ? params.tenantIds : [params.tenantId], {
    search: '', from: params.from || '', to: params.to || '', projectId: params.projectId || '',
    source: '', stage: '', temperature: '', assignedTo: '', handoff: '', bot: '', sla: '',
  })
  const payload = (data ?? {}) as Partial<LeadAutomationKpis>
  return {
    ...EMPTY_AUTOMATION_KPIS,
    ...payload,
    leads_by_source: payload.leads_by_source ?? [],
    leads_by_stage: LEAD_PIPELINE_STAGE_OPTIONS.map(stage => ({ stage: stage.value, count: stageRows.filter(row => row.stage === stage.value).length })),
  }
}

export async function getLeadAutomationRow(
  supabase: SupabaseClient,
  leadId: string,
  tenantIds: string[],
): Promise<LeadAutomationRow> {
  const { data, error } = await supabase
    .from(VIEW)
    .select('*')
    .eq('lead_id', leadId)
    .in('tenant_id', tenantIds)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('Lead no encontrado')
  return (await withCommercialPipeline([data as LeadAutomationRow]))[0]
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export async function getLeadNutritionJobs(leadId: string): Promise<{ data: LeadNutritionJob[]; error: boolean }> {
  try {
    const response = await fetch(`/api/inmobiliaria/automation/nutrition?leadId=${encodeURIComponent(leadId)}`, { cache: 'no-store' })
    if (!response.ok) return { data: [], error: true }
    const payload = await response.json() as { jobs?: LeadNutritionJob[] }
    if (!Array.isArray(payload.jobs)) return { data: [], error: true }
    return { data: payload.jobs, error: false }
  } catch {
    return { data: [], error: true }
  }
}

export async function getLeadAutomationDetail(
  supabase: SupabaseClient,
  leadId: string,
  tenantIds: string[],
): Promise<LeadAutomationDetail> {
  const row = await getLeadAutomationRow(supabase, leadId, tenantIds)

  const [
    conversationsRes,
    scoreRes,
    tempRes,
    unitsRes,
    visitsRes,
    nutritionJobsRes,
    commercialRes,
  ] = await Promise.all([
    supabase.from('conversations').select('id,lead_id,channel,status,started_at,last_message_at,closed_at').eq('lead_id', leadId).order('started_at', { ascending: false }),
    supabase.from('lead_score_events').select('*').eq('lead_id', leadId).order('created_at', { ascending: false }),
    supabase.from('lead_temperature_history').select('*').eq('lead_id', leadId).order('created_at', { ascending: false }),
    supabase
      .from('lead_units')
      .select('lead_id, unit_id, interest_level, source, rejected, rejection_reason, notes, created_at, unit:units(id, unit_number, category, status, published_commercial_price)')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false }),
    supabase
      .from('appointments')
      .select('id, status, requested_at, scheduled_at, start_time, preferred_time_text, confirmed_by_client, notes, appointment_units(unit:units(id, unit_number))')
      .eq('lead_id', leadId)
      .in('tenant_id', tenantIds)
      .order('requested_at', { ascending: false }),
    getLeadNutritionJobs(leadId),
    getLeadPipelineDetailAction(leadId),
  ])

  const firstError = [
    conversationsRes.error,
    scoreRes.error,
    tempRes.error,
    unitsRes.error,
    visitsRes.error,
  ].find(Boolean)
  if (firstError) throw firstError

  const nutritionJobs = nutritionJobsRes.data

  const conversations = (conversationsRes.data ?? []) as ConversationRow[]
  const conversationIds = conversations.map((item) => item.id)

  let messages: MessageRow[] = []
  let escalations: BotEscalationRow[] = []
  if (conversationIds.length) {
    const [messagesRes, escalationsRes] = await Promise.all([
      supabase.from('messages').select('id, conversation_id, role, content, media_url, sent_at, external_message_id, delivery_status:tool_calls->>delivery_status, provider_status:tool_calls->>provider_status').in('conversation_id', conversationIds).order('sent_at', { ascending: true }),
      supabase.from('bot_escalations').select('*').in('conversation_id', conversationIds).order('escalated_at', { ascending: false }),
    ])
    if (messagesRes.error) throw messagesRes.error
    if (escalationsRes.error) throw escalationsRes.error
    messages = (messagesRes.data ?? []) as MessageRow[]
    escalations = (escalationsRes.data ?? []) as BotEscalationRow[]
  }

  const visits: LeadVisitRow[] = (visitsRes.data ?? []).map((visit) => {
    const raw = visit as unknown as {
      id: string
      status: string
      requested_at: string
      scheduled_at: string | null
      start_time: string | null
      preferred_time_text: string | null
      confirmed_by_client: boolean
      notes: string | null
      appointment_units?: { unit: { id: string; unit_number: string } | { id: string; unit_number: string }[] | null }[]
    }
    return {
      id: raw.id,
      status: raw.status,
      requested_at: raw.requested_at,
      scheduled_at: raw.scheduled_at,
      start_time: raw.start_time,
      preferred_time_text: raw.preferred_time_text,
      confirmed_by_client: raw.confirmed_by_client,
      notes: raw.notes,
      units: (raw.appointment_units ?? [])
        .map((link) => firstRelation(link.unit))
        .filter((unit): unit is { id: string; unit_number: string } => Boolean(unit)),
    }
  })

  const units = (unitsRes.data ?? []).map((item) => {
    const raw = item as unknown as Omit<LeadInterestUnitRow, 'unit'> & {
      unit?: LeadInterestUnitRow['unit'] | LeadInterestUnitRow['unit'][]
    }
    return { ...raw, unit: firstRelation(raw.unit) }
  })

  const commercialProfile = commercialRes.ok ? commercialRes.data : undefined
  if (commercialProfile) {
    row.pipeline = commercialProfile.pipeline
    row.stage = commercialProfile.pipeline.stage
    row.stage_reason = commercialProfile.pipeline.stageReason
  }
  const detailWithoutTimeline = {
    commercialProfile,
    commercialProfileError: commercialRes.ok ? undefined : commercialRes.error,
    row,
    conversations,
    messages,
    scoreEvents: (scoreRes.data ?? []) as LeadScoreEventRow[],
    temperatureHistory: (tempRes.data ?? []) as LeadTemperatureHistoryRow[],
    stageHistory: (commercialProfile?.pipeline.history || []).map((entry, index) => ({ id: `commercial-${index}`, lead_id: leadId,
      from_stage: entry.from, to_stage: entry.to, reason: entry.reason, created_at: entry.at || '' })),
    units,
    visits,
    nutritionJobs,
    nutritionJobsUnavailable: nutritionJobsRes.error,
    escalations,
  }

  return {
    ...detailWithoutTimeline,
    timeline: buildAutomationTimeline(detailWithoutTimeline),
  }
}
