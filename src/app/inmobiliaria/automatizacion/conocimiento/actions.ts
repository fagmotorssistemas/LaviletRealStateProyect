'use server'

import { assertAdmin, getSessionUser } from '@/lib/auth/session'
import { businessPolicies, changeBusinessPolicy, type PolicyCommand } from '@/lib/inmobiliaria/businessPolicies'

async function access(projectId: string) {
  const session = await assertAdmin()
  const { supabase } = await getSessionUser()
  // Session-bound client: project reads and updates continue to enforce tenant RLS.
  const { data: project, error } = await supabase.from('projects')
    .select('id,tenant_id,name,policies_json,updated_at').eq('id', projectId).single()
  if (error || !project) throw Error('No se pudo acceder al proyecto.')
  return { supabase, project, user: session.user }
}
export async function loadBusinessPolicies(projectId: string) {
  const { project } = await access(projectId)
  return { projectName: project.name as string, updatedAt: project.updated_at as string, state: businessPolicies(project.policies_json) }
}
export async function saveBusinessPolicy(projectId: string, command: PolicyCommand, expectedUpdatedAt: string) {
  const { supabase, project, user } = await access(projectId)
  if (project.updated_at !== expectedUpdatedAt) throw Error('La configuración cambió. Recargue la página antes de guardar para conservar los cambios de otros usuarios.')
  const now = new Date().toISOString()
  const policies = changeBusinessPolicy(project.policies_json, command, user.id, now)
  const { data, error } = await supabase.from('projects').update({ policies_json: policies, updated_at: now })
    .eq('id', project.id).eq('tenant_id', project.tenant_id).eq('updated_at', expectedUpdatedAt).select('updated_at')
  if (error) throw Error('No se pudo guardar la política. Intente nuevamente.')
  if (data?.length !== 1) throw Error('La configuración cambió. Recargue la página antes de guardar.')
  return { updatedAt: data[0].updated_at as string, state: businessPolicies(policies) }
}
