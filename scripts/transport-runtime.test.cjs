/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript')
require('./test-typescript.cjs')
const root = path.resolve(__dirname, '..')
function load(relative, mocks = {}) {
  const filename = path.join(root, relative), m = { exports: {} }, req = Module.createRequire(filename)
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  new Function('require', 'module', 'exports', source)(id => id in mocks ? mocks[id] : req(id), m, m.exports)
  return m.exports
}
const data = require('../src/lib/integrations/automation/data.ts')

test('wakeup uses committed receiver keys, ignores unresolved invalid keys and surfaces read failures', async () => {
  const calls = [], q = {}, result = { error: null, data: [{ contact_key: '42:100' }, { contact_key: '42:100' }, { contact_key: 'contact:101' }, { contact_key: '0:100' }] }
  for (const method of ['select', 'match', 'eq', 'abortSignal']) q[method] = () => q
  q.in = (field, values) => { calls.push([field, values]); return q }
  q.then = resolve => Promise.resolve(result).then(resolve)
  const { persistedWakeupContacts } = load('src/lib/integrations/automation/persisted-wakeup.ts', { './data': { ...data, db: () => ({ from: () => q }) } })
  assert.deepEqual(await persistedWakeupContacts(['client'], ['manual']), ['42:100', 'contact:101'])
  assert.deepEqual(calls[0], ['event_key', ['inbound:client', 'advisor_outbound:manual']])
  result.error = { code: '503' }
  await assert.rejects(persistedWakeupContacts([], ['manual']), /PERSISTED_WAKEUP_READ_FAILED/)
})

test('admission rejects missing, excessive, negative and fractional slots without a provider call', async () => {
  for (const delay of [undefined, null, -1, 1.5, 10_001]) {
    const { reserveKommoCall } = load('src/lib/integrations/automation/kommo-admission.ts', { './data': { rpc: async () => delay } })
    await assert.rejects(reserveKommoCall(), /KOMMO_ADMISSION_FAILED/)
  }
  const { reserveKommoCall } = load('src/lib/integrations/automation/kommo-admission.ts', { './data': { rpc: async () => 0 } })
  await reserveKommoCall()
})

test('SQL admission failure before POST is a known local rejection, with no bot launch or retry', async t => {
  const previousUrl = process.env.KOMMO_BASE_URL, previousToken = process.env.KOMMO_ACCESS_TOKEN
  process.env.KOMMO_BASE_URL = 'https://lavilet.kommo.com'; process.env.KOMMO_ACCESS_TOKEN = 'synthetic'
  t.after(() => { if (previousUrl === undefined) delete process.env.KOMMO_BASE_URL; else process.env.KOMMO_BASE_URL = previousUrl; if (previousToken === undefined) delete process.env.KOMMO_ACCESS_TOKEN; else process.env.KOMMO_ACCESS_TOKEN = previousToken })
  let calls = 0
  t.mock.method(global, 'fetch', async () => { calls++; throw Error('UNEXPECTED_PROVIDER_CALL') })
  const p = load('src/lib/integrations/automation/kommo.ts', { './config': { assertLive() {} },
    './kommo-admission': { reserveKommoCall: async () => { throw Error('RPC_LV_APP_RESERVE_KOMMO_CALL_PGRST202') } } })
  await assert.rejects(p.launchSalesbot(42, 15578), error => error.message === 'KOMMO_ADMISSION_FAILED' && error.uncertain === false && error.operation === 'launch_bot')
  assert.equal(calls, 0)
})

test('database maintenance completes even when the global send worker cannot acquire its lease', async () => {
  const calls = [], q = { then: resolve => Promise.resolve({ error: null }).then(resolve) }
  for (const method of ['upsert', 'update', 'match', 'eq', 'contains', 'lt']) q[method] = () => q
  let maintenanceClaimed = false
  const { runAutomation } = load('src/lib/integrations/automation/worker.ts', {
    './config': { assertLive() {}, automationSettings: () => ({ mode: 'live', globalMaintenance: false }) },
    './data': { ...data, autoConfig: async () => ({ enabled: true, dry_run: false }), db: () => ({ from: () => q }), rpc: async (name, args) => {
      calls.push([name, args])
      if (name === 'lv_app_claim_maintenance') { if (maintenanceClaimed) return []; maintenanceClaimed = true; return [{ id: 'maintenance', kind: 'maintenance' }] }
      if (name === 'lv_app_worker_lock' && args.p_action === 'acquire') return false
      return true
    } },
    './delivery-state': { ...require('../src/lib/integrations/automation/delivery-state.ts'), kommoDeliveryBlock: async () => null },
    './visits': { planVisits: async () => { calls.push(['plan']); return 2 }, pendingVisits: async () => { throw Error('SEND_WORKER_NOT_ACQUIRED') } },
    './transport-monitor': { syncTransportIncidents: async () => ({ missing: 0 }) },
  })
  const result = await runAutomation()
  assert.equal(result.reason, 'worker_busy')
  assert.equal(result.maintenance[0].enqueued, 2)
  assert.equal(calls.find(([name]) => name === 'lv_app_finish')[1].p_status, 'completed')
  assert.equal(calls.some(([name]) => name === 'lv_app_claim'), false)
})

test('reconciliation requires explicit review and provider evidence, invokes no send helper', async () => {
  const calls = []
  const { reconcileDeliveryIncident } = load('src/lib/integrations/automation/delivery-state.ts', { './data': { ...data, rpc: async (name, args) => {
    calls.push([name, args]); return { reconciled: true, contact_key: '' }
  } } })
  const base = { outcome: 'not_sent', reviewed: true, reviewReference: 'Historial revisado' }
  for (const bad of [{ ...base, reviewed: false }, { ...base, reviewReference: '' }, { ...base, outcome: 'sent' }, { ...base, providerMessageId: 'contradiction' }]) {
    await assert.rejects(reconcileDeliveryIncident('event', 'admin', bad), /DELIVERY_REVIEW_REQUIRED/)
  }
  assert.equal(calls.length, 0)
  await reconcileDeliveryIncident('event', 'admin', base)
  assert.equal(calls[0][0], 'lv_app_reconcile_delivery')
  assert.equal(calls[0][1].p_outcome, 'not_sent')
  assert.equal(calls.length, 1)
})

test('reconciliation endpoint rejects unreviewed requests and admits reviewed administrator actions only', async () => {
  const calls = []
  let role = 'asesor'
  const { POST } = load('src/app/api/integrations/delivery/route.ts', {
    '@/lib/auth/session': { getSessionProfile: async () => ({ profile: { role, id: 'actor' } }) },
    '@/lib/integrations/automation/delivery-state': { deliveryHealth: async () => ({}), reconcileDeliveryIncident: async (...args) => calls.push(args) },
  })
  const body = { action: 'reconcile_incident', id: '00000000-0000-4000-8000-000000000001', outcome: 'not_sent', reviewed: true, reviewReference: 'Historial revisado' }
  const request = value => new Request('https://example.test/api/integrations/delivery', { method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json' }, body: JSON.stringify(value) })
  assert.equal((await POST(request(body))).status, 403)
  role = 'admin'
  assert.equal((await POST(request({ ...body, reviewed: false }))).status, 400)
  assert.equal(calls.length, 0)
  assert.equal((await POST(request(body))).status, 200)
  assert.equal(calls.length, 1)
})
