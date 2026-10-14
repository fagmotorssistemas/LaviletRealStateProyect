'use server'
import { assertAdmin, getSessionUser } from '@/lib/auth/session'
import { LAVILET_PROJECT_ID, LAVILET_TENANT_ID } from '@/lib/integrations/lavilet'
import { cashPaymentSettings, changeCashPaymentRules, validateCashPaymentRules, type CashPaymentResult } from '@/lib/inmobiliaria/cashPaymentRules'

async function access() {
  const { user } = await assertAdmin()
  const { supabase } = await getSessionUser()
  const { data: project, error } = await supabase.from('projects').select('id,tenant_id,policies_json,updated_at')
    .eq('id', LAVILET_PROJECT_ID).eq('tenant_id', LAVILET_TENANT_ID).single()
  if (error || !project) throw Error('CASH_PAYMENT_SETTINGS_UNAVAILABLE')
  return { user, supabase, project }
}
export async function loadCashPaymentRules(): Promise<CashPaymentResult> {
  try {
    const { project } = await access()
    return { ok: true, state: { settings: cashPaymentSettings(project.policies_json), version: project.updated_at,
      saved: !!project.policies_json?.cash_payment_rules } }
  } catch { return { ok: false, error: 'No se pudieron cargar las reglas. Compruebe su acceso de administrador y actualice.' } }
}
export async function saveCashPaymentRules(input: unknown, expectedVersion: string): Promise<CashPaymentResult> {
  let settings
  try { settings = validateCashPaymentRules(input) } catch (error) { return { ok: false, error: error instanceof Error ? error.message : 'Revise las condiciones.' } }
  if (!expectedVersion) return { ok: false, error: 'Actualice las reglas antes de guardar.' }
  try {
    const { user, supabase, project } = await access()
    const conflict = 'La configuración cambió. Actualice antes de guardar para conservar los cambios de otros usuarios.'
    if (project.updated_at !== expectedVersion) return { ok: false, error: conflict }
    const now = new Date().toISOString(), policies = changeCashPaymentRules(project.policies_json, settings, user.id, now)
    const { data, error } = await supabase.from('projects').update({ policies_json: policies, updated_at: now })
      .eq('id', project.id).eq('tenant_id', project.tenant_id).eq('updated_at', expectedVersion).select('updated_at')
    if (error) return { ok: false, error: 'No se pudo confirmar el guardado. Actualice antes de repetirlo.' }
    if (data?.length !== 1) return { ok: false, error: conflict }
    return { ok: true, state: { settings: cashPaymentSettings(policies), version: data[0].updated_at, saved: true } }
  } catch { return { ok: false, error: 'No se pudo guardar. Compruebe su acceso y actualice antes de intentarlo nuevamente.' } }
}
