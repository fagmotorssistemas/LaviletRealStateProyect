'use server'
import { assertAdmin, getSessionUser } from '@/lib/auth/session'
import { LAVILET_PROJECT_ID, LAVILET_TENANT_ID } from '@/lib/integrations/lavilet'
import { changePoolAccess, poolAccessSettings, type PoolAccessResult } from '@/lib/inmobiliaria/poolAccess'

async function access() {
  const { user } = await assertAdmin()
  const { supabase } = await getSessionUser()
  const { data: project, error } = await supabase.from('projects').select('id,tenant_id,policies_json,updated_at')
    .eq('id', LAVILET_PROJECT_ID).eq('tenant_id', LAVILET_TENANT_ID).single()
  if (error || !project) throw Error('POOL_ACCESS_UNAVAILABLE')
  return { user, supabase, project }
}
export async function loadPoolAccess(): Promise<PoolAccessResult> {
  try { const { project } = await access(); return { ok: true, state: { settings: poolAccessSettings(project.policies_json), version: project.updated_at } } }
  catch { return { ok: false, error: 'No se pudo cargar la configuración de la piscina. Compruebe su acceso y actualice.' } }
}
export async function savePoolAccess(input: unknown, expectedVersion: string): Promise<PoolAccessResult> {
  try {
    const { user, supabase, project } = await access()
    const conflict = 'La configuración cambió. Actualice antes de guardar para conservar los cambios de otros usuarios.'
    if (!expectedVersion || project.updated_at !== expectedVersion) return { ok: false, error: conflict }
    const now = new Date().toISOString(), policies = changePoolAccess(project.policies_json, input, user.id, now)
    const { data, error } = await supabase.from('projects').update({ policies_json: policies, updated_at: now })
      .eq('id', project.id).eq('tenant_id', project.tenant_id).eq('updated_at', expectedVersion).select('updated_at')
    if (error) return { ok: false, error: 'No se pudo confirmar el guardado. Actualice antes de repetirlo.' }
    if (data?.length !== 1) return { ok: false, error: conflict }
    return { ok: true, state: { settings: poolAccessSettings(policies), version: data[0].updated_at } }
  } catch (error) { return { ok: false, error: error instanceof Error && error.message.startsWith('Seleccione') ? error.message : 'No se pudo guardar. Compruebe su acceso y actualice.' } }
}
