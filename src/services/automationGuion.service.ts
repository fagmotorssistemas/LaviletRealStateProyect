import type { SupabaseClient } from '@supabase/supabase-js'
import { buildGuionBlock, isEngineerPrompt, replaceGuionBlock } from '@/lib/inmobiliaria/automationGuion'
import {
  DEFAULT_SCRIPT_QUESTIONS,
  type ScriptQuestionRow,
  type ScriptStage,
  type TopicPromptRow,
} from '@/types/automationGuion'

function throwIf(error: { message: string } | null) {
  if (error) throw new Error(error.message)
}

export async function loadAutomationGuion(
  supabase: SupabaseClient,
  params: { tenantId: string; projectId: string },
) {
  const [questionsRes, topicsRes] = await Promise.all([
    supabase
      .from('agent_script_questions')
      .select('id, tenant_id, project_id, stage, sort_order, question_text, is_active')
      .eq('project_id', params.projectId)
      .order('sort_order', { ascending: true }),
    supabase
      .from('agent_prompts')
      .select('id, name, load_when, content, is_active, mode, version, notes')
      .eq('tenant_id', params.tenantId)
      .eq('project_id', params.projectId)
      .order('name', { ascending: true }),
  ])
  throwIf(questionsRes.error)
  throwIf(topicsRes.error)

  const topics = ((topicsRes.data ?? []) as TopicPromptRow[]).filter(
    (row) => row.name !== 'guion_preguntas',
  )

  return {
    tenantId: params.tenantId,
    questions: (questionsRes.data ?? []) as ScriptQuestionRow[],
    topics,
  }
}

export async function seedScriptQuestions(
  supabase: SupabaseClient,
  params: { tenantId: string; projectId: string },
) {
  const { error } = await supabase.from('agent_script_questions').insert(
    DEFAULT_SCRIPT_QUESTIONS.map((row) => ({
      tenant_id: params.tenantId,
      project_id: params.projectId,
      stage: row.stage,
      sort_order: row.sort_order,
      question_text: row.question_text,
      is_active: true,
    })),
  )
  throwIf(error)
  await syncGuionIntoPrompts(supabase, params)
}

export async function saveScriptQuestions(
  supabase: SupabaseClient,
  params: {
    tenantId: string
    projectId: string
    questions: Pick<ScriptQuestionRow, 'id' | 'stage' | 'sort_order' | 'question_text' | 'is_active'>[]
  },
) {
  for (const row of params.questions) {
    const { error } = await supabase
      .from('agent_script_questions')
      .update({
        stage: row.stage,
        sort_order: row.sort_order,
        question_text: row.question_text.trim(),
        is_active: row.is_active,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
    throwIf(error)
  }
  await syncGuionIntoPrompts(supabase, { tenantId: params.tenantId, projectId: params.projectId })
}

export async function addScriptQuestion(
  supabase: SupabaseClient,
  params: { tenantId: string; projectId: string; stage: ScriptStage; questionText: string; sortOrder: number },
) {
  const { error } = await supabase.from('agent_script_questions').insert({
    tenant_id: params.tenantId,
    project_id: params.projectId,
    stage: params.stage,
    sort_order: params.sortOrder,
    question_text: params.questionText.trim(),
    is_active: true,
  })
  throwIf(error)
  await syncGuionIntoPrompts(supabase, { tenantId: params.tenantId, projectId: params.projectId })
}

export async function deleteScriptQuestion(
  supabase: SupabaseClient,
  params: { tenantId: string; projectId: string; id: string },
) {
  const { error } = await supabase.from('agent_script_questions').delete().eq('id', params.id)
  throwIf(error)
  await syncGuionIntoPrompts(supabase, { tenantId: params.tenantId, projectId: params.projectId })
}

export async function saveTopicPrompt(
  supabase: SupabaseClient,
  params: { id: number; content: string; load_when: string; is_active: boolean; version: number; userId: string },
) {
  if (!params.content.trim()) throw new Error('El prompt no puede estar vacío')
  const { data, error } = await supabase
    .from('agent_prompts')
    .select('name')
    .eq('id', params.id)
    .maybeSingle()
  throwIf(error)
  if (!data?.name || data.name === 'guion_preguntas') {
    throw new Error('Ese texto del agente no se edita aquí')
  }
  if (data.name === 'saludo_inicial' && params.content.trim().length > 1500) {
    throw new Error('El saludo debe tener como máximo 1500 caracteres')
  }

  const { data: updated, error: updateError } = await supabase
    .from('agent_prompts')
    .update({
      content: params.content.trim(),
      load_when: params.load_when.trim() || null,
      is_active: params.is_active,
      version: params.version + 1,
      updated_at: new Date().toISOString(),
      updated_by: params.userId,
    })
    .eq('id', params.id)
    .eq('version', params.version)
    .select('id')
    .maybeSingle()
  throwIf(updateError)
  if (!updated) throw new Error('El prompt cambió desde que abrió esta pantalla. Recargue para conservar la versión más reciente.')
}

export async function addTopicPrompt(
  supabase: SupabaseClient,
  params: {
    tenantId: string
    projectId: string
    name: string
    loadWhen: string
    content: string
    mode: string
    userId: string
  },
) {
  const name = slugPromptName(params.name)
  if (!name) throw new Error('Ponle un nombre al tema')
  if (isEngineerPrompt(name)) throw new Error('Ese nombre está reservado')

  const { error } = await supabase.from('agent_prompts').insert({
    name,
    load_when: params.loadWhen.trim() || 'Consulta del cliente',
    content: params.content.trim(),
    is_active: true,
    mode: params.mode === 'preventa' ? 'preventa' : 'lanzamiento',
    channel: [],
    priority: 100,
    version: 1,
    tenant_id: params.tenantId,
    project_id: params.projectId,
    updated_by: params.userId,
  })
  throwIf(error)
}

async function syncGuionIntoPrompts(
  supabase: SupabaseClient,
  params: { tenantId: string; projectId: string },
) {
  const { data, error } = await supabase
    .from('agent_script_questions')
    .select('question_text, is_active, sort_order')
    .eq('project_id', params.projectId)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
  throwIf(error)

  const block = buildGuionBlock((data ?? []).map((row) => ({ question_text: row.question_text })))

  const { data: commercial, error: commercialError } = await supabase
    .from('agent_prompts')
    .select('id, content, version')
    .eq('name', 'respuesta_comercial')
    .eq('project_id', params.projectId)
    .eq('is_active', true)
    .maybeSingle()
  throwIf(commercialError)

  if (commercial) {
    const { error: updateError } = await supabase
      .from('agent_prompts')
      .update({
        content: replaceGuionBlock(commercial.content, block),
        version: commercial.version + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', commercial.id)
    throwIf(updateError)
  }

  const { data: existing, error: existingError } = await supabase
    .from('agent_prompts')
    .select('id, version')
    .eq('name', 'guion_preguntas')
    .eq('project_id', params.projectId)
    .maybeSingle()
  throwIf(existingError)

  if (existing) {
    const { error: updateError } = await supabase
      .from('agent_prompts')
      .update({
        content: block,
        is_active: true,
        load_when: 'always',
        version: existing.version + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id)
    throwIf(updateError)
    return
  }

  const { error: insertError } = await supabase.from('agent_prompts').insert({
    name: 'guion_preguntas',
    load_when: 'always',
    content: block,
    is_active: true,
    mode: 'lanzamiento',
    channel: ['whatsapp', 'instagram', 'messenger'],
    priority: 100,
    version: 1,
    tenant_id: params.tenantId,
    project_id: params.projectId,
    notes: 'Bloque de preguntas armado desde el CRM (Guion)',
  })
  throwIf(insertError)
}

function slugPromptName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48)
}
