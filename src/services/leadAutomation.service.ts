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
  LeadStageHistoryRow,
  LeadTemperatureHistoryRow,
  LeadVisitRow,
  MessageRow,
  NutritionTask,
} from '@/types/leadAutomation'
import { buildAutomationTimeline, EMPTY_AUTOMATION_KPIS, sanitizeSearch, toInclusiveRange } from '@/lib/inmobiliaria/leadAutomation'

const VIEW = 'vw_lead_automation_dashboard'

function applyDashboardFilters(
  // PostgREST filter builder; generated DB types do not expose a shared query class.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
  tenantIds: string[],
  filters: LeadAutomationFilters,
) {
  const range = toInclusiveRange(filters.from, filters.to)
  let next = query.in('tenant_id', tenantIds)
  if (filters.projectId) next = next.eq('project_id', filters.projectId)
  if (range.from) next = next.gte('created_at', range.from)
  if (range.to) next = next.lte('created_at', range.to)
  if (filters.source) next = next.eq('source', filters.source)
  if (filters.stage) next = next.eq('stage', filters.stage)
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
  const page = params.page ?? 1
  const pageSize = params.pageSize ?? 25
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1
  const tenantIds = params.tenantIds?.length ? params.tenantIds : [params.tenantId]

  let query = supabase
    .from(VIEW)
    .select('*', { count: 'exact' })
    .order('last_interaction_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  query = applyDashboardFilters(query, tenantIds, params.filters)

  const { data, error, count } = await query.range(from, to)
  if (error) throw error
  const dashboardRows = (data ?? []) as Omit<LeadAutomationRow, 'interest_unit_number'>[]
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
    total: count ?? 0,
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

  const rows = (data ?? []) as LeadAutomationRow[]
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
  params: { tenantId: string; projectId?: string; from?: string; to?: string },
): Promise<LeadAutomationKpis> {
  const { data, error } = await supabase.rpc('get_lead_automation_kpis', {
    p_tenant_id: params.tenantId,
    p_project_id: params.projectId || null,
    p_from: params.from ?? null,
    p_to: params.to ?? null,
  })
  if (error) throw error
  const payload = (data ?? {}) as Partial<LeadAutomationKpis>
  return {
    ...EMPTY_AUTOMATION_KPIS,
    ...payload,
    leads_by_source: payload.leads_by_source ?? [],
    leads_by_stage: payload.leads_by_stage ?? [],
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
  return data as LeadAutomationRow
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
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
    stageRes,
    unitsRes,
    visitsRes,
    nutritionJobsRes,
  ] = await Promise.all([
    supabase.from('conversations').select('*').eq('lead_id', leadId).order('started_at', { ascending: false }),
    supabase.from('lead_score_events').select('*').eq('lead_id', leadId).order('created_at', { ascending: false }),
    supabase.from('lead_temperature_history').select('*').eq('lead_id', leadId).order('created_at', { ascending: false }),
    supabase.from('lead_stage_history').select('*').eq('lead_id', leadId).order('created_at', { ascending: false }),
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
    supabase.from('lv_integration_events')
      .select('id,payload,status,available_at,received_at,completed_at,result')
      .eq('kind', 'maintenance')
      .contains('payload', { leadId })
      .order('received_at', { ascending: false })
      .limit(30),
  ])

  const firstError = [
    conversationsRes.error,
    scoreRes.error,
    tempRes.error,
    stageRes.error,
    unitsRes.error,
    visitsRes.error,
  ].find(Boolean)
  if (firstError) throw firstError

  const nutritionTasks = new Set<NutritionTask>([
    'nutrition_24h',
    'nutrition_week_one',
    'nutrition_week_two',
    'nutrition_week_three',
  ])
  // La migracion de produccion concede acceso solo a estos trabajos. Durante
  // una actualizacion gradual, una politica todavia no aplicada no debe romper
  // el resto del detalle del lead.
  const nutritionJobs: LeadNutritionJob[] = nutritionJobsRes.error
    ? []
    : (nutritionJobsRes.data ?? []).flatMap((event) => {
        const payload = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
          ? event.payload as Record<string, unknown>
          : {}
        const result = event.result && typeof event.result === 'object' && !Array.isArray(event.result)
          ? event.result as Record<string, unknown>
          : {}
        const task = typeof payload.task === 'string' ? payload.task as NutritionTask : null
        if (!task || !nutritionTasks.has(task)) return []
        return [{
          id: event.id,
          task,
          status: event.status,
          scheduled_at: event.available_at,
          created_at: event.received_at,
          completed_at: event.completed_at,
          reason: typeof result.reason === 'string' ? result.reason : null,
          delivery_status: typeof result.delivery_status === 'string' ? result.delivery_status : null,
        }]
      })

  const conversations = (conversationsRes.data ?? []) as ConversationRow[]
  const conversationIds = conversations.map((item) => item.id)

  let messages: MessageRow[] = []
  let escalations: BotEscalationRow[] = []
  if (conversationIds.length) {
    const [messagesRes, escalationsRes] = await Promise.all([
      supabase.from('messages').select('id, conversation_id, role, content, media_url, sent_at').in('conversation_id', conversationIds).order('sent_at', { ascending: true }),
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

  const detailWithoutTimeline = {
    row,
    conversations,
    messages,
    scoreEvents: (scoreRes.data ?? []) as LeadScoreEventRow[],
    temperatureHistory: (tempRes.data ?? []) as LeadTemperatureHistoryRow[],
    stageHistory: (stageRes.data ?? []) as LeadStageHistoryRow[],
    units,
    visits,
    nutritionJobs,
    escalations,
  }

  return {
    ...detailWithoutTimeline,
    timeline: buildAutomationTimeline(detailWithoutTimeline),
  }
}
