'use server'

import type { SupabaseClient } from '@supabase/supabase-js'
import { assertAdmin, getSessionUser } from '@/lib/auth/session'
import {
  addScriptQuestion,
  addTopicPrompt,
  deleteScriptQuestion,
  loadAutomationGuion,
  saveScriptQuestions,
  saveTopicPrompt,
  seedScriptQuestions,
} from '@/services/automationGuion.service'
import type { ScriptQuestionRow, ScriptStage } from '@/types/automationGuion'

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

async function withAdminSession<T>(work: (client: SupabaseClient, userId: string) => Promise<T>): Promise<T> {
  await assertAdmin()
  const { supabase, user } = await getSessionUser()
  if (!user) throw new Error('No autenticado')
  try {
    return await work(supabase, user.id)
  } catch (error) {
    rethrow(error, 'No se pudo completar la operación')
  }
}

export async function loadAutomationGuionAction(projectId: string) {
  return withAdminSession(async (client) => {
    if (!projectId) throw new Error('Elige un proyecto')
    const { data: project, error } = await client
      .from('projects')
      .select('id, tenant_id')
      .eq('id', projectId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!project) throw new Error('Proyecto no encontrado')
    return loadAutomationGuion(client, { tenantId: project.tenant_id, projectId })
  })
}

export async function seedScriptQuestionsAction(projectId: string) {
  await withAdminSession(async (client) => {
    const { data: project, error } = await client
      .from('projects')
      .select('id, tenant_id')
      .eq('id', projectId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!project) throw new Error('Proyecto no encontrado')
    await seedScriptQuestions(client, { tenantId: project.tenant_id, projectId })
  })
}

export async function saveScriptQuestionsAction(
  projectId: string,
  questions: Pick<ScriptQuestionRow, 'id' | 'stage' | 'sort_order' | 'question_text' | 'is_active'>[],
) {
  await withAdminSession(async (client) => {
    const { data: project, error } = await client
      .from('projects')
      .select('id, tenant_id')
      .eq('id', projectId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!project) throw new Error('Proyecto no encontrado')
    await saveScriptQuestions(client, {
      tenantId: project.tenant_id,
      projectId,
      questions,
    })
  })
}

export async function addScriptQuestionAction(params: {
  projectId: string
  stage: ScriptStage
  questionText: string
  sortOrder: number
}) {
  await withAdminSession(async (client) => {
    const { data: project, error } = await client
      .from('projects')
      .select('id, tenant_id')
      .eq('id', params.projectId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!project) throw new Error('Proyecto no encontrado')
    await addScriptQuestion(client, {
      tenantId: project.tenant_id,
      projectId: params.projectId,
      stage: params.stage,
      questionText: params.questionText,
      sortOrder: params.sortOrder,
    })
  })
}

export async function deleteScriptQuestionAction(projectId: string, id: string) {
  await withAdminSession(async (client) => {
    const { data: project, error } = await client
      .from('projects')
      .select('id, tenant_id')
      .eq('id', projectId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!project) throw new Error('Proyecto no encontrado')
    await deleteScriptQuestion(client, { tenantId: project.tenant_id, projectId, id })
  })
}

export async function saveTopicPromptAction(payload: {
  id: number
  content: string
  load_when: string
  is_active: boolean
  version: number
}) {
  await withAdminSession(async (client, userId) => {
    await saveTopicPrompt(client, { ...payload, userId })
  })
}

export async function addTopicPromptAction(params: {
  projectId: string
  name: string
  loadWhen: string
  content: string
  mode: string
}) {
  await withAdminSession(async (client, userId) => {
    const { data: project, error } = await client
      .from('projects')
      .select('id, tenant_id')
      .eq('id', params.projectId)
      .maybeSingle()
    if (error) throw new Error(error.message)
    if (!project) throw new Error('Proyecto no encontrado')
    await addTopicPrompt(client, {
      tenantId: project.tenant_id,
      projectId: params.projectId,
      name: params.name,
      loadWhen: params.loadWhen,
      content: params.content,
      mode: params.mode,
      userId,
    })
  })
}
