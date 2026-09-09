import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { LAVILET_KOMMO_ORIGIN, LAVILET_MESSAGE_ROUTES, LAVILET_PROJECT_ID, LAVILET_TENANT_ID } from './lavilet'
import { automationSettings } from './automation/config'

type Check = { ok: boolean; status?: number; reason?: string }

// Solo GET, sin seguir redirecciones ni devolver cuerpos de error o credenciales.
async function read<T>(url: string, token: string): Promise<{ check: Check; data?: T }> {
  if (!token) return { check: { ok: false, reason: 'missing_credentials' } }
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      method: 'GET', cache: 'no-store', redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) return { check: { ok: false, status: response.status } }
    return { check: { ok: true, status: response.status }, data: await response.json() as T }
  } catch {
    return { check: { ok: false, reason: 'unavailable_or_invalid_response' } }
  }
}

async function kommoStatus() {
  let origin: string
  try { origin = new URL(process.env.KOMMO_BASE_URL ?? '').origin } catch {
    return { connection: { ok: false, reason: 'invalid_url' } }
  }
  if (origin !== LAVILET_KOMMO_ORIGIN) {
    return { connection: { ok: false, reason: 'account_does_not_match_mapping' } }
  }
  const token = process.env.KOMMO_ACCESS_TOKEN?.trim() ?? ''
  type Inventory = { _embedded?: { items?: { id: number }[]; custom_fields?: { id: number }[] }; _links?: { next?: unknown } }
  const [account, bots, fields] = await Promise.all([
    read(`${origin}/api/v4/account`, token),
    read<Inventory>(`${origin}/api/v4/bots?limit=250`, token),
    read<Inventory>(`${origin}/api/v4/leads/custom_fields?limit=250`, token),
  ])
  function contains(result: { check: Check; data?: Inventory }, items: { id: number }[] | undefined, id: number): Check {
    if (!result.check.ok) return result.check
    if (!Array.isArray(items)) return { ok: false, reason: 'invalid_inventory' }
    if (items.some(item => item.id === id)) return { ok: true }
    return { ok: false, reason: result.data?._links?.next ? 'inventory_requires_more_pages' : 'not_found' }
  }
  const routes = LAVILET_MESSAGE_ROUTES.map(route => ({ ...route,
    bot: contains(bots, bots.data?._embedded?.items, route.botId),
    field: contains(fields, fields.data?._embedded?.custom_fields, route.fieldId),
  }))
  return { connection: account.check, routes }
}

async function databaseStatus() {
  try {
    const db = createAdminClient()
    const [project, config, routes, prompts] = await Promise.all([
      db.from('projects').select('id').eq('id', LAVILET_PROJECT_ID).eq('tenant_id', LAVILET_TENANT_ID).abortSignal(AbortSignal.timeout(10_000)).maybeSingle(),
      db.from('lv_auto_config').select('enabled,test_only,dry_run,cooling_enabled,timezone').eq('project_id', LAVILET_PROJECT_ID).eq('tenant_id', LAVILET_TENANT_ID).abortSignal(AbortSignal.timeout(10_000)).maybeSingle(),
      db.from('lv_routes').select('kind,bot_id,detail_field_id,enabled,approved').eq('project_id', LAVILET_PROJECT_ID).abortSignal(AbortSignal.timeout(10_000)),
      db.from('agent_prompts').select('name,version,is_active').eq('project_id', LAVILET_PROJECT_ID).eq('tenant_id', LAVILET_TENANT_ID).eq('is_active', true).abortSignal(AbortSignal.timeout(10_000)),
    ])
    if (project.error || !project.data || config.error || routes.error || prompts.error) {
      return { ok: false, reason: 'database_read_failed_or_project_missing' }
    }
    return {
      ok: true, config: config.data, prompts: prompts.data,
      routes: LAVILET_MESSAGE_ROUTES.filter(route => route.kind !== 'conversation').map(expected => {
        const actual = routes.data?.find(row => row.kind === expected.kind)
        return { kind: expected.kind, expected, actual: actual ?? null,
          mappingMatches: actual?.bot_id === expected.botId && actual?.detail_field_id === expected.fieldId }
      }),
    }
  } catch { return { ok: false, reason: 'database_unavailable' } }
}

async function openaiStatus() {
  const model = process.env.OPENAI_MODEL?.trim()
  if (!model) return { ok: false, reason: 'missing_model' }
  const result = await read(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, process.env.OPENAI_API_KEY?.trim() ?? '')
  return { ...result.check, model, generationTested: false }
}

export async function getIntegrationStatus() {
  const [kommo, database, openai] = await Promise.all([kommoStatus(), databaseStatus(), openaiStatus()])
  const settings = automationSettings()
  let runtimeInstalled = false
  try {
    const { error } = await createAdminClient().from('lv_integration_events').select('id', { head: true })
      .eq('project_id', LAVILET_PROJECT_ID).limit(1).abortSignal(AbortSignal.timeout(10_000))
    runtimeInstalled = !error
  } catch { /* La migración puede no estar instalada aún. */ }
  return { checkedAt: new Date().toISOString(), phase: settings.mode, runtimeInstalled,
    applicationSendsEnabled: settings.live && runtimeInstalled && database.ok && database.config?.enabled === true
      && database.config?.dry_run === false && database.routes?.every(route => route.mappingMatches) === true,
    settings: { mode: settings.mode, ownershipConfirmed: settings.live, testLeadId: settings.testLeadId,
      globalMaintenance: settings.globalMaintenance }, kommo, database, openai }
}
