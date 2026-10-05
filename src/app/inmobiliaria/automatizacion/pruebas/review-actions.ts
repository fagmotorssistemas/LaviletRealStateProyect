'use server'

import { assertAdmin, getSessionUser } from '@/lib/auth/session'
import { changeResponseReview, responseReviewSettings, type ResponseReviewState } from '@/lib/inmobiliaria/responseReview'
import { LAVILET_PROJECT_ID, LAVILET_TENANT_ID } from '@/lib/integrations/lavilet'

async function access() {
  const { user } = await assertAdmin()
  const { supabase } = await getSessionUser()
  const { data: project, error } = await supabase.from('projects').select('id,tenant_id,policies_json,updated_at')
    .eq('id', LAVILET_PROJECT_ID).eq('tenant_id', LAVILET_TENANT_ID).single()
  if (error || !project) throw Error('No se pudo cargar la configuración de revisión.')
  return { supabase, project, user }
}
export async function loadResponseReviewAction(): Promise<ResponseReviewState> {
  const { project } = await access()
  return { ...responseReviewSettings(project.policies_json), version: project.updated_at }
}
export async function saveResponseReviewAction(enabled: boolean, expectedVersion: string): Promise<ResponseReviewState> {
  const { supabase, project, user } = await access()
  const conflict = 'La configuración cambió. Recargue la página antes de volver a guardar.'
  if (project.updated_at !== expectedVersion) throw Error(conflict)
  const now = new Date().toISOString()
  const policies = changeResponseReview(project.policies_json, enabled, user.id, now)
  const { data, error } = await supabase.from('projects').update({ policies_json: policies, updated_at: now })
    .eq('id', project.id).eq('tenant_id', project.tenant_id).eq('updated_at', expectedVersion).select('updated_at')
  if (error) throw Error('No se pudo guardar la revisión de respuestas. Intente nuevamente.')
  if (data?.length !== 1) throw Error(conflict)
  return { ...responseReviewSettings(policies), version: data[0].updated_at }
}
