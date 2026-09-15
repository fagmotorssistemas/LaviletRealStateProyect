const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
const original = Module._load
Module._load = function (id, parent, main) {
  if (id === 'server-only') return {}
  if (id.startsWith('@/')) id = path.join(root, 'src', id.slice(2))
  return original.call(this, id, parent, main)
}
const compile = filename => ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText
require.extensions['.ts'] = (module, filename) => module._compile(compile(filename), filename)
function load(relative, mocks = {}) {
  const filename = path.join(root, relative), m = { exports: {} }, req = Module.createRequire(filename)
  new Function('require', 'module', 'exports', compile(filename))(id => id in mocks ? mocks[id] : req(id), m, m.exports)
  return m.exports
}
const data = require('../src/lib/integrations/automation/data.ts')
const state = require('../src/lib/integrations/automation/delivery-state.ts')
const provider = require('../src/lib/integrations/automation/kommo.ts')

function databaseHarness(initial = []) {
  const rows = structuredClone(initial), calls = []
  function from(table) {
    assert.equal(table, 'lv_integration_events')
    let filters = [], update, upsert, single = false, max = Infinity, cols = '*', options, order = []
    const value = (row, key) => key.includes('->>') ? row[key.split('->>')[0]]?.[key.split('->>')[1]] : row[key]
    const q = {
      select(c, o) { cols = c; options = o; return q },
      match(v) { calls.push({ action: 'scope', value: v }); filters.push(r => Object.entries(v).every(([k, v]) => r[k] === v)); return q },
      eq(k, v) { filters.push(r => value(r, k) === v); return q },
      neq(k, v) { filters.push(r => value(r, k) !== v); return q },
      gt(k, v) { filters.push(r => value(r, k) > v); return q },
      in(k, values) { filters.push(r => values.map(String).includes(String(value(r, k)))); return q },
      contains(k, v) { filters.push(r => Object.entries(v).every(([key, x]) => r[k]?.[key] === x)); return q },
      or() { filters.push(r => r.status === 'uncertain' || (r.status === 'cancelled' && r.result.requires_review === true)); return q },
      order(k, opts) { order.push([k, opts]); return q },
      limit(n) { max = n; return q },
      abortSignal() { return q },
      maybeSingle() { single = true; return q },
      update(v) { update = v; calls.push({ action: 'update', value: v }); return q },
      upsert(v) { upsert = v; calls.push({ action: 'upsert', value: v }); return q },
      then(resolve) {
        let chosen = rows.filter(r => filters.every(f => f(r)))
        for (const [key, opts] of order) chosen.sort((a, b) => String(a[key] || '').localeCompare(String(b[key] || '')) * (opts?.ascending === false ? -1 : 1))
        const count = chosen.length
        chosen = chosen.slice(0, max)
        if (update) for (const row of chosen) Object.assign(row, update)
        if (upsert) {
          const row = rows.find(r => r.project_id === upsert.project_id && r.event_key === upsert.event_key)
          if (row) Object.assign(row, upsert); else rows.push({ id: 'state', ...upsert })
        }
        return Promise.resolve({ data: single ? chosen[0] || null : chosen, error: null, count }).then(resolve)
      },
    }
    return q
  }
  const mod = load('src/lib/integrations/automation/delivery-state.ts', {
    './data': { ...data, db: () => ({ from }), rpc: async (name, args) => { calls.push({ action: name, args }); return true } },
  })
  return { ...mod, rows, calls }
}
function event(id, status, result = {}, overrides = {}) {
  return { ...data.scope, id, status, result, kind: 'inbound', contact_key: '3577404:8105914',
    received_at: '2026-09-15T13:55:59Z', completed_at: '2026-09-15T13:56:00Z', ...overrides }
}

test('explicit Kommo rejections are not ambiguous deliveries and account blocks are saved without retry', async t => {
  const old = process.env.KOMMO_BASE_URL, token = process.env.KOMMO_ACCESS_TOKEN
  process.env.KOMMO_BASE_URL = 'https://lavilet.kommo.com'; process.env.KOMMO_ACCESS_TOKEN = 'synthetic'
  t.after(() => { if (old === undefined) delete process.env.KOMMO_BASE_URL; else process.env.KOMMO_BASE_URL = old; if (token === undefined) delete process.env.KOMMO_ACCESS_TOKEN; else process.env.KOMMO_ACCESS_TOKEN = token })
  const blocks = [], calls = []
  const p = load('src/lib/integrations/automation/kommo.ts', {
    './config': { assertLive() {} },
    './delivery-state': { ...state, recordKommoBlock: async (...args) => blocks.push(args) },
  })
  let status = 402
  t.mock.method(global, 'fetch', async () => { calls.push(status); return new Response('Sensitive provider body must not leak', { status }) })
  for (status of [400, 401, 402, 403, 404, 422, 429, 408, 503]) {
    const before = calls.length
    await assert.rejects(() => p.setKommoField(3577404, 457014, 'Test'), e => e.status === status && e.uncertain === [408, 503].includes(status) && !e.message.includes('Sensitive'))
    assert.equal(calls.length, before + 1)
  }
  status = 402
  await assert.rejects(() => p.launchSalesbot(3577404, 15578), e => e.operation === 'launch_bot' && !e.uncertain)
  assert.deepEqual(blocks.map(x => x[0]), [401, 402, 403, 402])
})

test('legacy Pablo 402 is visible, and GET success alone cannot clear the block', async () => {
  const h = databaseHarness([event('pablo', 'uncertain', { reason: 'KOMMO_402', http_status: 402, delivery_uncertain: true, provider_operation: 'update_field' }), event('next', 'pending')])
  const health = await h.deliveryHealth()
  assert.equal(health.blocked, true); assert.equal(health.httpStatus, 402)
  assert.equal(health.pendingMessages, 1); assert.equal(health.incidentCount, 1)
  assert.equal(health.incidents[0].kommoId, 3577404); assert.equal(health.incidents[0].delivery, 'rejected')
  assert.equal(h.calls.some(c => c.action === 'update' || c.action === 'upsert'), false)
  await h.recordKommoBlock(402, 'update_field')
  assert.equal((await h.kommoDeliveryBlock()).http_status, 402)
})

test('manual account recovery preserves inputs, lead pauses and history, releasing only known rejected attempts', async () => {
  const h = databaseHarness([
    event('pablo', 'uncertain', { reason: 'KOMMO_402', http_status: 402, delivery_uncertain: true }),
    event('timeout', 'uncertain', { reason: 'KOMMO_UNAVAILABLE', http_status: 0, delivery_uncertain: true }),
    event('next', 'pending'),
    event('other', 'uncertain', { reason: 'KOMMO_402', http_status: 402 }, { project_id: 'other-project' }),
  ])
  await h.recordKommoBlock(402, 'update_field')
  await h.resumeAfterKommoReview('admin-id')
  assert.equal(h.rows.find(r => r.id === 'pablo').status, 'cancelled')
  assert.equal(h.rows.find(r => r.id === 'pablo').result.requires_review, true)
  assert.equal(h.rows.find(r => r.id === 'timeout').status, 'uncertain')
  assert.equal(h.rows.find(r => r.id === 'next').status, 'pending')
  assert.equal(h.rows.find(r => r.id === 'other').status, 'uncertain')
  assert.equal(await h.kommoDeliveryBlock(), null)
  assert.equal((await h.deliveryHealth()).incidentCount, 2)
  await h.resolveDeliveryIncident('pablo', 'admin-id')
  assert.equal((await h.deliveryHealth()).incidentCount, 1)
  await assert.rejects(() => h.resolveDeliveryIncident('timeout', 'admin-id'), /INCIDENT_NOT_REVIEWABLE/)
  assert.ok(h.calls.every(c => ['scope', 'upsert', 'update', 'lv_app_worker_lock'].includes(c.action)))
})

test('a new rejection reopens the account block after an administrator allowed another attempt', async () => {
  const h = databaseHarness()
  await h.recordKommoBlock(402, 'update_field')
  await h.resumeAfterKommoReview('admin-id')
  assert.equal(await h.kommoDeliveryBlock(), null)
  await h.recordKommoBlock(403, 'launch_bot')
  assert.equal((await h.deliveryHealth()).httpStatus, 403)
})

function workerHarness({ blocked = false, failure = null, action = 'accepted' } = {}) {
  const calls = []
  let claimed = false, hasBlock = blocked
  const q = { then: resolve => Promise.resolve({ error: null }).then(resolve) }
  for (const method of ['upsert', 'update', 'match', 'eq', 'contains', 'lt']) q[method] = () => q
  const { runAutomation } = load('src/lib/integrations/automation/worker.ts', {
    './data': { ...data, db: () => ({ from: () => q }), autoConfig: async () => ({ enabled: true, dry_run: false }),
      rpc: async (name, args) => { calls.push({ name, args }); if (name === 'lv_app_claim') { if (claimed) return []; claimed = true; return [event('pablo', 'processing', {}, { payload: { kommoId: 3577404 } })] } return true } },
    './config': { assertLive() {}, automationSettings: () => ({ mode: 'live' }) },
    './kommo': provider,
    './delivery-state': { ...state, kommoDeliveryBlock: async () => hasBlock ? { http_status: 402 } : null },
    './nutrition': { cancelNutrition24h: async () => {}, sendNutrition24h: async () => ({}) },
    './nutrition-week-one': { cancelNutritionWeekOne: async () => { calls.push({ name: 'cancel_week_one' }) }, sendNutritionWeekOne: async () => ({}) },
    './conversation': { processConversation: async () => { calls.push({ name: 'process' }); if (failure) { hasBlock = failure.status === 402; throw failure } return { action } } },
    './visits': { pendingVisits: async () => { calls.push({ name: 'visits' }); return [] }, planVisits: async () => 0 },
  })
  return { runAutomation, calls }
}

test('blocked account leaves all pending leads untouched and releases the worker lease', async () => {
  const h = workerHarness({ blocked: true })
  const result = await h.runAutomation()
  assert.equal(result.reason, 'kommo_account_blocked')
  assert.equal(h.calls.some(c => ['lv_app_claim', 'process', 'visits'].includes(c.name)), false)
  assert.equal(h.calls.at(-1).args.p_action, 'release')
})

test('worker distinguishes definite rejection from uncertainty and stops the batch on 402', async () => {
  for (const [status, uncertain] of [[402, false], [0, true]]) {
    const h = workerHarness({ failure: new provider.ProviderError(status, uncertain, 'update_field') })
    await h.runAutomation()
    const result = h.calls.find(c => c.name === 'lv_app_finish').args
    assert.equal(result.p_status, uncertain ? 'uncertain' : 'cancelled')
    assert.equal(result.p_result.requires_review, true)
    assert.equal(result.p_result.delivery_uncertain, uncertain)
    assert.equal(h.calls.filter(c => c.name === 'process').length, 1)
    assert.equal(h.calls.some(c => c.name === 'visits'), uncertain)
  }
})

test('a pending input that expires during an outage needs advisor review instead of silently completing', async () => {
  const h = workerHarness({ action: 'expired' })
  await h.runAutomation()
  const result = h.calls.find(c => c.name === 'lv_app_finish').args
  assert.equal(result.p_status, 'cancelled')
  assert.equal(result.p_result.requires_review, true)
  assert.equal(result.p_result.delivery_status, 'not_sent')
  const database = databaseHarness([event('expired', result.p_status, result.p_result)])
  assert.equal((await database.deliveryHealth()).incidents[0].delivery, 'not_sent')
  await database.resolveDeliveryIncident('expired', 'admin')
  assert.equal((await database.deliveryHealth()).incidentCount, 0)
})

test('recovery endpoint denies anonymous, non-admin and cross-origin requests without mutations', async () => {
  let session = null, mutations = 0
  const r = load('src/app/api/integrations/delivery/route.ts', {
    '@/lib/auth/session': { getSessionProfile: async () => session },
    '@/lib/integrations/automation/delivery-state': { deliveryHealth: async () => ({}),
      resumeAfterKommoReview: async () => mutations++, resolveDeliveryIncident: async () => mutations++ },
  })
  const request = (origin = 'https://lavilett.com', action = 'resume_after_account_review') => new Request('https://lavilett.com/api/integrations/delivery', {
    method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify({ action }),
  })
  assert.equal((await r.GET()).status, 401)
  assert.equal((await r.POST(request())).status, 401)
  session = { profile: { id: 'advisor', role: 'asesor' } }
  assert.equal((await r.GET()).status, 200)
  assert.equal((await r.POST(request())).status, 403)
  session.profile.role = 'marketing'
  assert.equal((await r.GET()).status, 403)
  session.profile.role = 'admin'
  assert.equal((await r.POST(request('https://attacker.test'))).status, 403)
  assert.equal((await r.POST(request(undefined, 'send_message'))).status, 400)
  assert.equal(mutations, 0)
  assert.equal((await r.POST(request())).status, 200)
  assert.equal(mutations, 1)
})
