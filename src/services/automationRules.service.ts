import type { SupabaseClient } from '@supabase/supabase-js'
import { defaultAutomationConfig } from '@/lib/inmobiliaria/automationRules'
import type {
  AutomationRulesPayload,
  NutritionStepRow,
  ProjectAutomationConfig,
  ProjectSalespersonRow,
  ScoringRuleRow,
} from '@/types/automationRules'

function asHours(value: unknown): ProjectAutomationConfig['business_hours'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as ProjectAutomationConfig['business_hours']
}

export async function loadAutomationRules(
  supabase: SupabaseClient,
  params: { tenantId: string; projectId: string },
): Promise<AutomationRulesPayload> {
  const [configRes, scoringRes, nutritionRes] = await Promise.all([
    supabase.from('project_automation_config').select('*').eq('project_id', params.projectId).maybeSingle(),
    supabase.from('lead_scoring_rules').select('event_type, points, reason, repeatable, active').order('points', { ascending: false }),
    supabase
      .from('nutrition_steps')
      .select('id, project_id, week_number, topic, meta_template_name, is_approved, active')
      .eq('project_id', params.projectId)
      .order('week_number', { ascending: true }),
  ])
  const teamQuery = await supabase
    .from('project_salespeople')
    .select('id, tenant_id, project_id, salesperson_id, role_in_project, receives_leads, receives_bot_appointments, rotation_order, last_lead_assigned_at')
    .eq('project_id', params.projectId)
    .order('rotation_order', { ascending: true })

  let teamRows: Omit<ProjectSalespersonRow, 'full_name' | 'phone' | 'is_active'>[] = []
  if (teamQuery.error && /receives_bot_appointments/i.test(teamQuery.error.message)) {
    const fallback = await supabase
      .from('project_salespeople')
      .select('id, tenant_id, project_id, salesperson_id, role_in_project, receives_leads, rotation_order, last_lead_assigned_at')
      .eq('project_id', params.projectId)
      .order('rotation_order', { ascending: true })
    if (fallback.error) throw new Error(fallback.error.message)
    teamRows = (fallback.data ?? []).map((row) => ({
      ...row,
      receives_bot_appointments: row.receives_leads,
    }))
  } else if (teamQuery.error) {
    throw new Error(teamQuery.error.message)
  } else {
    teamRows = (teamQuery.data ?? []) as Omit<ProjectSalespersonRow, 'full_name' | 'phone' | 'is_active'>[]
  }
  if (configRes.error) throw new Error(configRes.error.message)
  if (scoringRes.error) throw new Error(scoringRes.error.message)
  if (nutritionRes.error) throw new Error(nutritionRes.error.message)

  const salespersonIds = teamRows.map((row) => row.salesperson_id)
  const profilesRes = salespersonIds.length
    ? await supabase.from('profiles').select('id, full_name, phone, is_active').in('id', salespersonIds)
    : { data: [], error: null }
  if (profilesRes.error) throw new Error(profilesRes.error.message)
  const byId = new Map((profilesRes.data ?? []).map((row) => [row.id, row]))

  const configRow = configRes.data as (ProjectAutomationConfig & { business_hours: unknown }) | null
  const config: ProjectAutomationConfig | null = configRow
    ? {
        ...defaultAutomationConfig(params.projectId, params.tenantId),
        ...configRow,
        business_hours: asHours(configRow.business_hours),
        mode: configRow.mode === 'preventa' ? 'preventa' : 'lanzamiento',
      }
    : null

  return {
    tenantId: params.tenantId,
    config,
    salespeople: teamRows.map((row) => {
      const profile = byId.get(row.salesperson_id)
      return {
        ...row,
        receives_bot_appointments:
          (row as { receives_bot_appointments?: boolean }).receives_bot_appointments
          ?? row.receives_leads,
        full_name: profile?.full_name ?? null,
        phone: profile?.phone ?? null,
        is_active: profile?.is_active ?? null,
      }
    }),
    scoringRules: (scoringRes.data ?? []) as ScoringRuleRow[],
    nutritionSteps: (nutritionRes.data ?? []) as NutritionStepRow[],
  }
}

export async function upsertAutomationConfig(
  supabase: SupabaseClient,
  payload: ProjectAutomationConfig,
) {
  if (payload.temperature_hot_min <= payload.temperature_warm_min) {
    throw new Error('El corte de caliente debe ser mayor que el de tibio')
  }
  if (payload.sla_response_minutes <= 0) {
    throw new Error('El SLA debe ser mayor a 0 minutos')
  }

  const row = {
    project_id: payload.project_id,
    tenant_id: payload.tenant_id,
    mode: payload.mode,
    timezone: payload.timezone,
    business_hours: payload.business_hours,
    admin_profile_id: payload.admin_profile_id || null,
    is_active: payload.is_active,
    sla_response_minutes: payload.sla_response_minutes,
    temperature_warm_min: payload.temperature_warm_min,
    temperature_hot_min: payload.temperature_hot_min,
    visit_location_url: payload.visit_location_url,
    review_sla_minutes: payload.review_sla_minutes,
    proposal_hold_minutes: payload.proposal_hold_minutes,
    max_auto_reassignments: payload.max_auto_reassignments,
    updated_at: new Date().toISOString(),
  }
  const { error } = await supabase.from('project_automation_config').upsert(row, { onConflict: 'project_id' })
  if (!error) return
  if (!/visit_location_url|review_sla_minutes|proposal_hold_minutes|max_auto_reassignments/i.test(error.message)) {
    throw new Error(error.message)
  }
  const { error: retryError } = await supabase.from('project_automation_config').upsert(
    {
      project_id: row.project_id,
      tenant_id: row.tenant_id,
      mode: row.mode,
      timezone: row.timezone,
      business_hours: row.business_hours,
      admin_profile_id: row.admin_profile_id,
      is_active: row.is_active,
      sla_response_minutes: row.sla_response_minutes,
      temperature_warm_min: row.temperature_warm_min,
      temperature_hot_min: row.temperature_hot_min,
      updated_at: row.updated_at,
    },
    { onConflict: 'project_id' },
  )
  if (retryError) throw new Error(retryError.message)
}

export async function updateSalespersonRow(
  supabase: SupabaseClient,
  params: { id: string; receives_leads?: boolean; receives_bot_appointments?: boolean; rotation_order?: number },
) {
  const patch: { receives_leads?: boolean; receives_bot_appointments?: boolean; rotation_order?: number } = {}
  if (params.receives_leads !== undefined) patch.receives_leads = params.receives_leads
  if (params.receives_bot_appointments !== undefined) patch.receives_bot_appointments = params.receives_bot_appointments
  if (params.rotation_order !== undefined) patch.rotation_order = params.rotation_order
  const { error } = await supabase.from('project_salespeople').update(patch).eq('id', params.id)
  if (error) throw new Error(error.message)
}

export async function addProjectSalesperson(
  supabase: SupabaseClient,
  params: { tenantId: string; projectId: string; salespersonId: string; rotationOrder: number },
) {
  const existing = await supabase
    .from('project_salespeople')
    .select('id')
    .eq('project_id', params.projectId)
    .eq('salesperson_id', params.salespersonId)
    .maybeSingle()
  if (existing.error) throw new Error(existing.error.message)
  if (existing.data) {
    const { error } = await supabase
      .from('project_salespeople')
      .update({ receives_leads: true, rotation_order: params.rotationOrder })
      .eq('id', existing.data.id)
    if (error) throw new Error(error.message)
    return
  }

  const { error } = await supabase.from('project_salespeople').insert({
    tenant_id: params.tenantId,
    project_id: params.projectId,
    salesperson_id: params.salespersonId,
    role_in_project: 'asesor',
    receives_leads: true,
    receives_bot_appointments: true,
    rotation_order: params.rotationOrder,
  })
  if (error) throw new Error(error.message)
}

export async function updateScoringRule(
  supabase: SupabaseClient,
  payload: Pick<ScoringRuleRow, 'event_type' | 'points' | 'repeatable' | 'active'>,
) {
  const { error } = await supabase
    .from('lead_scoring_rules')
    .update({
      points: payload.points,
      repeatable: payload.repeatable,
      active: payload.active,
    })
    .eq('event_type', payload.event_type)
  if (error) throw new Error(error.message)
}

export async function upsertNutritionSteps(
  supabase: SupabaseClient,
  steps: Pick<NutritionStepRow, 'id' | 'week_number' | 'topic' | 'meta_template_name' | 'is_approved' | 'active'>[],
) {
  for (const step of steps) {
    const { error } = await supabase
      .from('nutrition_steps')
      .update({
        topic: step.topic.trim(),
        meta_template_name: step.meta_template_name.trim(),
        is_approved: step.is_approved,
        active: step.active,
        week_number: step.week_number,
      })
      .eq('id', step.id)
    if (error) throw new Error(error.message)
  }
}

export async function seedNutritionSteps(
  supabase: SupabaseClient,
  params: {
    projectId: string
    steps: { week_number: number; topic: string; meta_template_name: string }[]
  },
) {
  const { error } = await supabase.from('nutrition_steps').insert(
    params.steps.map((step) => ({
      project_id: params.projectId,
      week_number: step.week_number,
      topic: step.topic,
      meta_template_name: step.meta_template_name,
      is_approved: false,
      active: true,
    })),
  )
  if (error) throw new Error(error.message)
}
