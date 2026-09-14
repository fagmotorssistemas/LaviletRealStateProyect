'use server'

import type { SupabaseClient } from '@supabase/supabase-js'
import { assertAdmin, getSessionUser } from '@/lib/auth/session'
import { listTeamProfiles } from '@/services/inmobiliaria.service'
import {
  addProjectSalesperson,
  disableNutritionSequence,
  loadAutomationRules,
  seedNutritionSteps,
  updateSalespersonRow,
  updateScoringRule,
  upsertAutomationConfig,
  upsertNutritionSteps,
} from '@/services/automationRules.service'
import { DEFAULT_NUTRITION_TOPICS } from '@/types/automationRules'
import type {
  NutritionStepRow,
  ProjectAutomationConfig,
  ScoringRuleRow,
} from '@/types/automationRules'
import type { TeamProfile } from '@/types/inmobiliaria'
import { nutrition24hConfig, withNutrition24h, type Nutrition24hConfig } from '@/lib/inmobiliaria/nutrition24h'
import { LAVILET_PROJECT_ID } from '@/lib/integrations/lavilet'
import { verifyNutritionTemplate } from '@/lib/integrations/automation/kommo'
import { botVisitPolicy, withBotVisitPolicy, type BotVisitPolicy } from '@/lib/inmobiliaria/botVisits'

function readableMessage(message: string) {
  const trimmed = message.trim()
  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed) as { message?: string }
      if (parsed.message) return readableMessage(parsed.message)
    } catch {
      /* ignore */
    }
  }
  if (/invalid api key/i.test(trimmed)) {
    return 'No se pudo conectar con Supabase. Revisa SUPABASE_SERVICE_ROLE_KEY en el .env.'
  }
  return trimmed
}

function rethrow(error: unknown, fallback: string): never {
  if (error instanceof Error && error.message) {
    throw new Error(readableMessage(error.message) || fallback)
  }
  if (typeof error === 'object' && error && 'message' in error) {
    throw new Error(readableMessage(String((error as { message?: unknown }).message ?? '')) || fallback)
  }
  throw new Error(fallback)
}

async function withAdminSession<T>(work: (client: SupabaseClient) => Promise<T>): Promise<T> {
  await assertAdmin()
  const { supabase } = await getSessionUser()
  try {
    return await work(supabase)
  } catch (error) {
    rethrow(error, 'No se pudo completar la operación')
  }
}

export async function loadAutomationRulesAction(projectId: string) {
  return withAdminSession(async (client) => {
    if (!projectId) throw new Error('Elige un proyecto')
    const { data: project, error } = await client
      .from('projects')
      .select('id, tenant_id, policies_json, updated_at')
      .eq('id', projectId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!project) throw new Error('Proyecto no encontrado')
    const [rules, profiles] = await Promise.all([
      loadAutomationRules(client, { tenantId: project.tenant_id, projectId }),
      listTeamProfiles(client),
    ])
    return { ...rules, profiles: profiles as TeamProfile[], nutrition24h: nutrition24hConfig(project.policies_json), botVisits: botVisitPolicy(project.policies_json, rules.config?.mode || 'lanzamiento'), projectUpdatedAt: project.updated_at as string }
  })
}

export async function saveAutomationConfigAction(payload: ProjectAutomationConfig) {
  await withAdminSession((client) => upsertAutomationConfig(client, payload))
}

export async function saveSalespersonAction(params: {
  id: string
  receives_leads?: boolean
  receives_bot_appointments?: boolean
  rotation_order?: number
}) {
  await withAdminSession((client) => updateSalespersonRow(client, params))
}

export async function addSalespersonAction(params: {
  tenantId: string
  projectId: string
  salespersonId: string
  rotationOrder: number
}) {
  await withAdminSession((client) => addProjectSalesperson(client, params))
}

export async function saveScoringRuleAction(
  payload: Pick<ScoringRuleRow, 'event_type' | 'points' | 'repeatable' | 'active'>,
) {
  await withAdminSession((client) => updateScoringRule(client, payload))
}

export async function saveNutritionStepsAction(
  steps: Pick<NutritionStepRow, 'id' | 'week_number' | 'topic' | 'meta_template_name' | 'is_approved' | 'active'>[],
) {
  await withAdminSession((client) => upsertNutritionSteps(client, steps))
}

export async function seedNutritionStepsAction(projectId: string) {
  await withAdminSession((client) =>
    seedNutritionSteps(client, {
      projectId,
      steps: DEFAULT_NUTRITION_TOPICS,
    }),
  )
}

export async function saveNutrition24hAction(projectId: string, input: Nutrition24hConfig, expectedUpdatedAt: string) {
  return withAdminSession(async client => {
    if (projectId !== LAVILET_PROJECT_ID) throw Error('El seguimiento de 24 horas está disponible para La Vilet.')
    const { data: project, error } = await client.from('projects').select('tenant_id,policies_json,updated_at').eq('id', projectId).maybeSingle()
    if (error || !project) throw Error('No se pudo cargar el proyecto.')
    const conflict = 'El proyecto cambió. Actualice la página antes de guardar.'
    if (!expectedUpdatedAt || project.updated_at !== expectedUpdatedAt) throw Error(conflict)
    const policies = withNutrition24h(project.policies_json, input)
    if (input.enabled && !await verifyNutritionTemplate(input.templateName.trim(), input.fieldId)) throw Error('Kommo no confirma una plantilla de WhatsApp aprobada con ese nombre, texto y variable. Revise la plantilla antes de activar.')
    const { data, error: writeError } = await client.from('projects').update({ policies_json: policies, updated_at: new Date().toISOString() })
      .eq('id', projectId).eq('tenant_id', project.tenant_id).eq('updated_at', expectedUpdatedAt).select('policies_json,updated_at').maybeSingle()
    if (writeError) throw Error('No se pudo guardar el seguimiento.')
    if (!data) throw Error(conflict)
    return { config: nutrition24hConfig(data.policies_json), updatedAt: data.updated_at as string }
  })
}

export async function saveBotVisitsAction(projectId: string, input: BotVisitPolicy, expectedUpdatedAt: string) {
  return withAdminSession(async client => {
    if (projectId !== LAVILET_PROJECT_ID) throw Error('Esta configuración corresponde a La Vilet.')
    const { data: project, error } = await client.from('projects').select('tenant_id,policies_json,updated_at').eq('id', projectId).maybeSingle()
    if (error || !project) throw Error('No se pudo cargar el proyecto.')
    if (!expectedUpdatedAt || project.updated_at !== expectedUpdatedAt) throw Error('El proyecto cambió. Actualice antes de guardar.')
    const { data, error: updateError } = await client.from('projects').update({ policies_json: withBotVisitPolicy(project.policies_json, input), updated_at: new Date().toISOString() })
      .eq('id', projectId).eq('tenant_id', project.tenant_id).eq('updated_at', expectedUpdatedAt).select('updated_at').maybeSingle()
    if (updateError || !data) throw Error('No se pudo guardar; actualice la página y vuelva a intentarlo.')
    return { updatedAt: data.updated_at as string }
  })
}

export async function disableNutritionSequenceAction(projectId: string) {
  await withAdminSession(async client => {
    if (!projectId) throw new Error('Elige un proyecto')
    const { data, error } = await client.from('projects').select('id').eq('id', projectId).maybeSingle()
    if (error) throw new Error(error.message)
    if (!data) throw new Error('Proyecto no encontrado')
    await disableNutritionSequence(client, projectId)
  })
}
