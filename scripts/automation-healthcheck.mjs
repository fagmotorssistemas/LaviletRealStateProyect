import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'

const TENANT_ID = 'a1b2c3d4-0001-4000-8000-000000000001'
const PROJECT_ID = 'b1b2c3d4-0001-4000-8000-000000000001'

/** Reads only public REST resources. Never invokes RPCs, workers or providers. */
export async function inspectAutomationHealth({ url, key, now = Date.now(), staleAfterMs = 10 * 60_000 }, request = fetch) {
  const origin = new URL(url)
  if (origin.protocol !== 'https:' || origin.username || origin.password || !key) throw Error('INVALID_HEALTHCHECK_CONFIGURATION')
  const query = { tenant_id: `eq.${TENANT_ID}`, project_id: `eq.${PROJECT_ID}` }
  async function read(table, parameters, projectScoped = true) {
    const resource = new URL(`/rest/v1/${table}`, origin)
    resource.search = new URLSearchParams({ ...(projectScoped ? query : { tenant_id: query.tenant_id }), ...parameters }).toString()
    try {
      const response = await request(resource, { method: 'GET', headers: { apikey: key, Authorization: `Bearer ${key}` },
        redirect: 'error', signal: AbortSignal.timeout(15_000) })
      const body = await response.json()
      return response.ok && Array.isArray(body) ? { ok: true, data: body } : { ok: false,
        code: typeof body?.code === 'string' && /^[A-Z0-9_]+$/.test(body.code) ? body.code : `HTTP_${response.status}` }
    } catch { return { ok: false, code: 'HEALTH_READ_FAILED' } }
  }
  const [profiles, history, config, heartbeat, latest] = await Promise.all([
    read('lead_commercial_profiles', { select: 'lead_id', limit: '1' }, false),
    read('lead_commercial_stage_observations', { select: 'id', limit: '1' }, false),
    read('lv_auto_config', { select: 'enabled,dry_run,test_only', limit: '1' }),
    read('lv_integration_events', { select: 'received_at,completed_at,status', kind: 'eq.maintenance', status: 'eq.completed',
      'payload->>task': 'is.null', order: 'completed_at.desc.nullslast', limit: '1' }),
    read('lv_integration_events', { select: 'received_at,completed_at,status', kind: 'eq.maintenance',
      'payload->>task': 'is.null', order: 'received_at.desc', limit: '1' }),
  ])
  const settings = config.ok ? config.data[0] : null
  const completedAt = heartbeat.ok ? heartbeat.data[0]?.completed_at : null
  const ageMs = typeof completedAt === 'string' ? now - Date.parse(completedAt) : NaN
  const active = settings?.enabled === true && settings?.dry_run === false
  const state = !config.ok || !settings || !heartbeat.ok ? 'unknown' : !active ? 'paused'
    : !Number.isFinite(ageMs) ? 'missing' : ageMs < 0 ? 'unknown' : ageMs > staleAfterMs ? 'stale' : 'healthy'
  return { checkedAt: new Date(now).toISOString(), readOnly: true, sends: false,
    structures: [ ['lead_commercial_profiles', profiles], ['lead_commercial_stage_observations', history] ].map(([table, result]) =>
      ({ table, available: result.ok, ...(!result.ok ? { code: result.code } : {}) })),
    maintenance: { state, thresholdMinutes: staleAfterMs / 60_000,
      lastCompletedAt: typeof completedAt === 'string' ? completedAt : null,
      ageMinutes: Number.isFinite(ageMs) ? Math.round(ageMs / 60_000) : null,
      latestStatus: latest.ok ? latest.data[0]?.status || null : null,
      schedulerConfiguration: 'requires_admin_sql_diagnostic',
      ...(!heartbeat.ok ? { code: heartbeat.code } : {}) },
    configuration: settings ? { enabled: settings.enabled === true, dryRun: settings.dry_run === true, testOnly: settings.test_only === true }
      : { available: false, code: config.code || 'CONFIGURATION_MISSING' } }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    createRequire(import.meta.url)('@next/env').loadEnvConfig(process.cwd())
    const health = await inspectAutomationHealth({ url: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
      key: process.env.SUPABASE_SERVICE_ROLE_KEY })
    console.log(JSON.stringify(health, null, 2))
    if (health.structures.some(item => !item.available) || !['healthy', 'paused'].includes(health.maintenance.state)) process.exitCode = 1
  } catch {
    console.error('AUTOMATION_HEALTHCHECK_FAILED: revisar configuración. No se ejecutó el worker ni se enviaron mensajes.')
    process.exitCode = 1
  }
}
