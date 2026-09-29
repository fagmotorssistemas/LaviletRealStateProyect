const test = require('node:test')
const assert = require('node:assert/strict')
require('./test-typescript.cjs')
const { compareIncomingEvents } = require('../src/lib/integrations/automation/transport-monitor.ts')
const now = Date.parse('2026-09-29T17:00:00Z')
const event = (id, lead = 123, age = 600) => ({ type: 'incoming_chat_message', entity_type: 'lead', entity_id: lead,
  created_at: now / 1000 - age, value_after: [{ message: { id } }] })

test('only managed incoming messages beyond the arrival grace period are reported missing', () => {
  const result = compareIncomingEvents([event('missing'), event('observed'), event('foreign', 456), event('fresh', 123, 30),
    { ...event('outgoing'), type: 'outgoing_chat_message' },
    { ...event('other-channel'), value_after: [{ message: { id: 'other-channel', origin: 'telegram' } }] }],
    [{ event_key: 'inbound:observed', received_at: '2026-09-29T16:50:01Z', payload: { sentAt: '2026-09-29T16:50:00Z' } }], [123], now)
  assert.deepEqual(result.missing.map(row => row.id), ['missing'])
  assert.deepEqual(result.delayed, [])
})

test('a delayed received webhook is reported as delayed, not missing or eligible for replay', () => {
  const result = compareIncomingEvents([event('late')], [{ event_key: 'inbound:late', received_at: '2026-09-29T16:50:00Z',
    payload: { sentAt: '2026-09-29T16:30:00Z' } }], [123], now)
  assert.deepEqual(result.missing, [])
  assert.equal(result.delayed[0].minutes, 20)
  assert.equal(result.delayed[0].kommoId, 123)
})

test('background monitoring records one incident per message and resolves it when the webhook arrives without replay', async () => {
  const fs = require('node:fs'), path = require('node:path'), ts = require('typescript'), Module = require('node:module')
  const file = path.resolve(__dirname, '../src/lib/integrations/automation/transport-monitor.ts')
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const incidents = new Map(), received = new Map()
  const data = require('../src/lib/integrations/automation/data.ts')
  const db = () => ({ from: table => {
    assert.equal(table, 'lv_integration_events')
    let select = '', inserted, updated, id
    const q = { select(value) { select = value; return q }, upsert(value) { inserted = value; return q },
      update(value) { updated = value; return q }, eq(key, value) { if (key === 'id') id = value; return q },
      then(resolve) {
        if (inserted) for (const row of inserted) if (!incidents.has(row.event_key)) incidents.set(row.event_key, { id: row.event_key, ...row })
        if (updated) Object.assign(incidents.get(id), updated)
        return Promise.resolve({ error: null, data: select === 'id,result'
          ? [...incidents.values()].filter(row => row.result.requires_review) : [...received.values()] }).then(resolve)
      } }
    for (const method of ['match', 'contains', 'order', 'limit', 'abortSignal', 'in']) q[method] = () => q
    return q
  } })
  const module = { exports: {} }, localRequire = Module.createRequire(file)
  new Function('require', 'module', 'exports', source)(id => id === './data' ? { ...data, db }
    : id === './config' ? { assertLive: () => {} } : localRequire(id), module, module.exports)
  const health = async () => ({ checkedAt: new Date(now).toISOString(), error: null, limited: false,
    missing: [{ id: 'late', kommoId: 123, at: new Date(now - 600_000).toISOString(), minutes: null }], delayed: [] })
  await module.exports.syncTransportIncidents(health)
  await module.exports.syncTransportIncidents(health)
  assert.equal(incidents.size, 1)
  assert.equal(incidents.get('transport_missing:late').result.requires_review, true)
  received.set('late', { event_key: 'inbound:late' })
  const result = await module.exports.syncTransportIncidents(health)
  assert.equal(result.recovered, 1)
  assert.equal(incidents.get('transport_missing:late').result.requires_review, false)
  assert.equal(incidents.get('transport_missing:late').result.recovery, 'webhook_received')
})
