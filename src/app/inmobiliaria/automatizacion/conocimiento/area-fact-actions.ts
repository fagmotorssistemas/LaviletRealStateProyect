'use server'

import { assertAdmin, getSessionUser } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { AREA_FACT_COLUMNS, areaFactChange, projectAreaFact, type AreaFactCommand } from '@/lib/inmobiliaria/projectAreaFacts'

const missingMigration = 'Falta actualizar la base de datos para editar el entorno. Aplique 20261007190000_project_area_fact_drafts.sql. Las respuestas del bot conservan la información publicada.'
const safeError = (error: { code?: string } | null, message: string) => error && ['42703', 'PGRST204', '42P01', 'PGRST205'].includes(error.code || '') ? missingMigration : message
async function access(projectId: string) {
  await assertAdmin()
  const { supabase } = await getSessionUser()
  // Authorization is checked using the session/RLS before the service-only table is accessed.
  const { data: project, error } = await supabase.from('projects').select('id,tenant_id').eq('id', projectId).single()
  if (error || !project) throw Error('No se pudo acceder al proyecto.')
  return { project, admin: createAdminClient() }
}
export async function loadProjectAreaFacts(projectId: string) {
  try {
    const { project, admin } = await access(projectId)
    const { data, error } = await admin.from('project_area_facts').select(AREA_FACT_COLUMNS)
      .eq('project_id', project.id).eq('tenant_id', project.tenant_id).neq('review_status', 'archived').order('headline').limit(100)
    if (error) return { facts: [], error: safeError(error, 'No se pudo cargar la información del entorno. Intente nuevamente.') }
    return { facts: (data || []).map(projectAreaFact), error: '' }
  } catch { return { facts: [], error: 'No se pudo cargar la información del entorno. Verifique su acceso al proyecto.' } }
}
export async function saveProjectAreaFact(projectId: string, command: AreaFactCommand) {
  const { project, admin } = await access(projectId)
  // Values from the client never select a tenant, set review_status, or approve bot use directly.
  if (!command || !['draft', 'publish', 'pause'].includes(command.action)) throw Error('Operación inválida.')
  if (command.expectedUpdatedAt !== null && (typeof command.expectedUpdatedAt !== 'string' || !Number.isFinite(Date.parse(command.expectedUpdatedAt))))
    throw Error('Recargue la ficha antes de guardar.')
  const { data: existing, error: readError } = await admin.from('project_area_facts').select(AREA_FACT_COLUMNS)
    .eq('project_id', project.id).eq('tenant_id', project.tenant_id).eq('id', command.id).maybeSingle()
  if (readError) throw Error(safeError(readError, 'No se pudo comprobar la ficha del entorno. Intente nuevamente.'))
  if (existing ? existing.updated_at !== command.expectedUpdatedAt : command.expectedUpdatedAt !== null)
    throw Error('La ficha cambió. Recargue la página antes de guardar para conservar los cambios de otros usuarios.')
  const values = areaFactChange(command, existing, new Date().toISOString())
  const scoped = existing
    ? admin.from('project_area_facts').update(values).eq('project_id', project.id).eq('tenant_id', project.tenant_id)
      .eq('id', command.id).eq('updated_at', command.expectedUpdatedAt)
    : admin.from('project_area_facts').insert({ ...values, id: command.id, project_id: project.id, tenant_id: project.tenant_id,
      fact_key: 'entorno_' + command.id.replaceAll('-', '') })
  const { data, error } = await scoped.select(AREA_FACT_COLUMNS).maybeSingle()
  if (error) throw Error(safeError(error, 'No se pudo guardar la ficha del entorno. Intente nuevamente.'))
  if (!data) throw Error('La ficha cambió. Recargue la página antes de guardar.')
  return projectAreaFact(data)
}
