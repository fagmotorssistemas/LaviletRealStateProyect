'use server'

import { assertAdmin, getSessionUser } from '@/lib/auth/session'
import { LAVILET_PROJECT_ID, LAVILET_TENANT_ID } from '@/lib/integrations/lavilet'
import { changeFinancingGuidance, financingGuidanceSettings, validateFinancingGuidance, type FinancingGuidanceResult } from '@/lib/inmobiliaria/financingGuidance'

async function access() {
  const { user } = await assertAdmin()
  const { supabase } = await getSessionUser()
  const { data: project, error } = await supabase.from('projects').select('id,tenant_id,policies_json,updated_at')
    .eq('id', LAVILET_PROJECT_ID).eq('tenant_id', LAVILET_TENANT_ID).single()
  if (error || !project) throw Error('FINANCING_SETTINGS_UNAVAILABLE')
  return { user, supabase, project }
}
export async function loadFinancingGuidance(): Promise<FinancingGuidanceResult> {
  try {
    const { project } = await access()
    return { ok: true, state: { settings: financingGuidanceSettings(project.policies_json), version: project.updated_at,
      saved: !!(project.policies_json as Record<string, unknown> | null)?.financing_guidance } }
  } catch {
    return { ok: false, error: 'No se pudo cargar la configuración. Compruebe su acceso de administrador y vuelva a actualizar.' }
  }
}
export async function saveFinancingGuidance(input: unknown, version: string): Promise<FinancingGuidanceResult> {
  let settings
  try { settings = validateFinancingGuidance(input) } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Revise las condiciones ingresadas.' }
  }
  if (typeof version !== 'string' || !version) return { ok: false, error: 'Actualice la configuración antes de guardar.' }
  try {
    const { user, supabase, project } = await access()
    const conflict = 'La configuración cambió. Actualice antes de guardar para conservar los cambios de otros usuarios.'
    if (project.updated_at !== version) return { ok: false, error: conflict }
    const now = new Date().toISOString()
    const policies = changeFinancingGuidance(project.policies_json, settings, user.id, now)
    const { data, error } = await supabase.from('projects').update({ policies_json: policies, updated_at: now })
      .eq('id', project.id).eq('tenant_id', project.tenant_id).eq('updated_at', version).select('updated_at')
    if (error) return { ok: false, error: 'No se pudo confirmar el cambio. Actualice el estado antes de volver a guardar.' }
    if (data?.length !== 1) return { ok: false, error: conflict }
    return { ok: true, state: { settings: financingGuidanceSettings(policies), version: data[0].updated_at, saved: true } }
  } catch {
    return { ok: false, error: 'No se pudo guardar. Compruebe su acceso de administrador y actualice antes de intentarlo nuevamente.' }
  }
}
