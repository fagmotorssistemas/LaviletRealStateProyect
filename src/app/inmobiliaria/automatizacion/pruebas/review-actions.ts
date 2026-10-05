'use server'

import { assertAdmin, getSessionUser } from '@/lib/auth/session'
import { changeResponseReview, responseReviewSettings, type ResponseReviewResult } from '@/lib/inmobiliaria/responseReview'
import { LAVILET_PROJECT_ID, LAVILET_TENANT_ID } from '@/lib/integrations/lavilet'

async function access() {
  const { user } = await assertAdmin()
  const { supabase } = await getSessionUser()
  const { data: project, error } = await supabase.from('projects').select('id,tenant_id,policies_json,updated_at')
    .eq('id', LAVILET_PROJECT_ID).eq('tenant_id', LAVILET_TENANT_ID).single()
  if (error || !project) throw Error('No se pudo cargar la configuración de revisión.')
  return { supabase, project, user }
}
export async function loadResponseReviewAction(): Promise<ResponseReviewResult> {
  try {
    const { project } = await access()
    return { ok: true, state: { ...responseReviewSettings(project.policies_json), version: project.updated_at } }
  } catch {
    return { ok: false, error: 'No se pudo cargar la revisión de respuestas. Compruebe su acceso de administrador y pulse «Actualizar estado».' }
  }
}
export async function saveResponseReviewAction(enabled: boolean, expectedVersion: string): Promise<ResponseReviewResult> {
  if (typeof enabled !== 'boolean' || typeof expectedVersion !== 'string' || !expectedVersion)
    return { ok: false, error: 'Seleccione activar o desactivar la revisión de respuestas y actualice su estado.' }
  try {
    const { supabase, project, user } = await access()
    const conflict = 'La configuración cambió. Pulse «Actualizar estado» antes de volver a guardar.'
    if (project.updated_at !== expectedVersion) return { ok: false, error: conflict }
    const now = new Date().toISOString()
    const policies = changeResponseReview(project.policies_json, enabled, user.id, now)
    const { data, error } = await supabase.from('projects').update({ policies_json: policies, updated_at: now })
      .eq('id', project.id).eq('tenant_id', project.tenant_id).eq('updated_at', expectedVersion).select('updated_at')
    if (error) return { ok: false, error: 'No se pudo confirmar el cambio. Pulse «Actualizar estado» antes de intentarlo nuevamente.' }
    if (data?.length !== 1) return { ok: false, error: conflict }
    return { ok: true, state: { ...responseReviewSettings(policies), version: data[0].updated_at } }
  } catch {
    return { ok: false, error: 'No se pudo confirmar el cambio. Compruebe su acceso de administrador y pulse «Actualizar estado» antes de repetir la acción.' }
  }
}
