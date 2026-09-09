import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { LAVILET_PROJECT_ID, LAVILET_TENANT_ID } from '../lavilet'

export type Row = Record<string, unknown>
export function object(value: unknown): Row {
  if (typeof value === 'string') { try { return object(JSON.parse(value)) } catch { return {} } }
  if (Array.isArray(value)) return object(value[0])
  return value && typeof value === 'object' ? value as Row : {}
}
export const text = (value: unknown) => typeof value === 'string' ? value : ''
export const scope = { tenant_id: LAVILET_TENANT_ID, project_id: LAVILET_PROJECT_ID }
export const db = () => createAdminClient()
export async function rpc<T = unknown>(name: string, args: Row = {}): Promise<T> {
  const { data, error } = await db().rpc(name, args).abortSignal(AbortSignal.timeout(15_000))
  if (error) throw new Error(`RPC_${name}_${error.code || 'FAILED'}`)
  return data as T
}
export async function one(table: string, id: string, scoped = true): Promise<Row> {
  let q = db().from(table).select('*').eq('id', id)
  if (scoped) q = q.eq('tenant_id', scope.tenant_id).eq('project_id', scope.project_id)
  const { data, error } = await q.abortSignal(AbortSignal.timeout(10_000)).maybeSingle()
  if (error || !data) throw new Error(`READ_${table}_FAILED`)
  return data as Row
}
export async function autoConfig(): Promise<Row> {
  const { data, error } = await db().from('lv_auto_config').select('*').match(scope)
    .abortSignal(AbortSignal.timeout(10_000)).maybeSingle()
  if (error || !data) throw new Error('AUTOMATION_CONFIG_MISSING')
  return data as Row
}
export function permitted(config: Row, lead: Row, testLeadId: string | null) {
  return config.enabled === true && config.dry_run === false
    && lead.tenant_id === scope.tenant_id && lead.project_id === scope.project_id
    && (config.test_only === false || config.test_lead_id === lead.id)
    && (!testLeadId || testLeadId === lead.id)
}
