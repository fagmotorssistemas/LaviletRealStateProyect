'use server'

import { assertAdmin, getSessionUser } from '@/lib/auth/session'
import { LAVILET_PROJECT_ID, LAVILET_TENANT_ID } from '@/lib/integrations/lavilet'
import { changeEarlyPurchaseDiscountSettings, earlyPurchaseDiscountSettings, validateEarlyPurchaseDiscountSettings, type EarlyPurchaseDiscountResult } from '@/lib/inmobiliaria/earlyPurchaseDiscounts'

async function access() {
  const { user } = await assertAdmin()
  const { supabase } = await getSessionUser()
  const { data: project, error } = await supabase.from('projects').select('id,tenant_id,policies_json,updated_at')
    .eq('id', LAVILET_PROJECT_ID).eq('tenant_id', LAVILET_TENANT_ID).single()
  if (error || !project) throw Error('DISCOUNT_SETTINGS_UNAVAILABLE')
  return { user, supabase, project }
}
export async function loadEarlyPurchaseDiscountSettings(): Promise<EarlyPurchaseDiscountResult> {
  try {
    const { project } = await access()
    return { ok: true, state: { settings: earlyPurchaseDiscountSettings(project.policies_json), version: project.updated_at,
      saved: !!(project.policies_json as Record<string, unknown> | null)?.early_purchase_discounts } }
  } catch {
    return { ok: false, error: 'No se pudo cargar la configuración de descuentos. Compruebe su acceso de administrador y actualice.' }
  }
}
export async function saveEarlyPurchaseDiscountSettings(input: unknown, expectedUpdatedAt: string): Promise<EarlyPurchaseDiscountResult> {
  let settings
  try { settings = validateEarlyPurchaseDiscountSettings(input) } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Revise las reglas de descuento.' }
  }
  if (typeof expectedUpdatedAt !== 'string' || !expectedUpdatedAt) return { ok: false, error: 'Actualice la configuración antes de guardar.' }
  try {
    const { user, supabase, project } = await access()
    const conflict = 'La configuración cambió. Actualice antes de guardar para conservar los cambios de otros usuarios.'
    if (project.updated_at !== expectedUpdatedAt) return { ok: false, error: conflict }
    const now = new Date().toISOString()
    const policies = changeEarlyPurchaseDiscountSettings(project.policies_json, settings, user.id, now)
    const { data, error } = await supabase.from('projects').update({ policies_json: policies, updated_at: now })
      .eq('id', project.id).eq('tenant_id', project.tenant_id).eq('updated_at', expectedUpdatedAt).select('updated_at')
    if (error) return { ok: false, error: 'No se pudo confirmar el guardado. Actualice antes de volver a guardar.' }
    if (data?.length !== 1) return { ok: false, error: conflict }
    return { ok: true, state: { settings: earlyPurchaseDiscountSettings(policies), version: data[0].updated_at, saved: true } }
  } catch {
    return { ok: false, error: 'No se pudo guardar. Compruebe su acceso de administrador y actualice antes de intentarlo nuevamente.' }
  }
}
