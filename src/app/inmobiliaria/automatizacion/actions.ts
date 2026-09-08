'use server'

import type { SupabaseClient } from '@supabase/supabase-js'
import { assertAdmin, getSessionUser } from '@/lib/auth/session'
import { listTeamProfiles } from '@/services/inmobiliaria.service'
import {
  addProjectSalesperson,
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
      .select('id, tenant_id')
      .eq('id', projectId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!project) throw new Error('Proyecto no encontrado')
    const [rules, profiles] = await Promise.all([
      loadAutomationRules(client, { tenantId: project.tenant_id, projectId }),
      listTeamProfiles(client),
    ])
    return { ...rules, profiles: profiles as TeamProfile[] }
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
