/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')
const root = path.resolve(__dirname, '../../../../..')
require(path.join(root, 'scripts/test-typescript.cjs'))
let state
class Query {
  constructor(table) { this.table = table; this.filters = []; state.queries.push(this) }
  select(fields) { this.fields = fields; return this }
  in(key, value) { this.filters.push([key, value]); return this }
  eq(key, value) { this.filters.push([key, value]); return this }
  ilike(key, value) { this.namePattern = [key, value]; return this }
  order(key, options) { (this.orders ||= []).push([key, options]); return this }
  limit(value) { this.pageLimit = value; return this }
  or(value) { this.cursorFilter = value; return this }
  then(resolve, reject) { return Promise.resolve(state.tables[this.table] || { data: [], error: null }).then(resolve, reject) }
}
const originalLoad = Module._load
Module._load = function (id, parent, isMain) {
  if (id === '@/lib/auth/session') return { getSessionProfile: async () => state.session, getSessionUser: async () => ({ supabase: {} }) }
  if (id === '@/lib/inmobiliaria/tenants') return { getAccessibleTenantIds: async () => state.tenants }
  if (id === '@/lib/supabase/admin') return { createAdminClient: () => ({ from: table => new Query(table) }) }
  return originalLoad.call(this, id, parent, isMain)
}
const { GET } = require(path.join(root, 'src/app/api/integrations/automation/workflow/route.ts'))
const { readWorkflowCursor, writeWorkflowCursor } = require(path.join(root, 'src/app/api/integrations/automation/workflow/pagination.ts'))
Module._load = originalLoad
const id = number => `00000000-0000-0000-0000-${number.toString().padStart(12, '0')}`
const event = number => ({ id: id(number), tenant_id: 'tenant-a', project_id: 'project-a', kind: 'inbound', status: 'completed', payload: { kommoId: 1, text: 'Mi correo es prueba@example.com' }, result: { action: 'accepted' }, received_at: '2026-09-22T12:00:00.123456+00:00', completed_at: '2026-09-22T12:01:00Z' })
function reset() { state = { session: { profile: { role: 'admin' } }, tenants: ['tenant-a'], queries: [], tables: {} } }
test('in-progress inbound is returned with stable lead identity before trace steps exist', async () => {
  reset()
  state.tables.lv_integration_events = { data: [{ ...event(1), status: 'processing', result: {}, completed_at: null }], error: null }
  const body = await (await GET(new Request('http://localhost/api/integrations/automation/workflow'))).json()
  assert.equal(body.executions[0].outcome, 'Procesando')
  assert.equal(body.executions[0].leadGroupId, 'tenant-a:project-a:1')
  assert.equal(body.executions[0].conversationId, null)
  assert.deepEqual(body.executions[0].steps, [])
})
const request = cursor => new Request(`http://localhost/api/integrations/automation/workflow${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`)

test('unauthenticated, non-admin and inaccessible tenants do not read privileged tables', async () => {
  reset(); state.session = null
  assert.equal((await GET(request())).status, 401)
  assert.equal(state.queries.length, 0)
  reset(); state.session.profile.role = 'asesor'
  assert.deepEqual((await (await GET(request())).json()).executions, [])
  assert.equal(state.queries.length, 0)
  reset(); state.tenants = []
  assert.deepEqual((await (await GET(request())).json()).executions, [])
  assert.equal(state.queries.length, 0)
})

test('pagination is bounded, stable and rejects filter injection before querying', async () => {
  reset(); state.tables.lv_integration_events = { data: Array.from({ length: 31 }, (_, index) => event(40 - index)), error: null }
  const response = await GET(request())
  const body = await response.json()
  assert.equal(body.executions.length, 30)
  assert.deepEqual(readWorkflowCursor(body.nextCursor), { at: event(11).received_at, id: id(11) })
  assert.equal(state.queries[0].pageLimit, 31)
  assert.deepEqual(state.queries[0].filters.find(([key]) => key === 'kind')[1], ['inbound'])
  assert.deepEqual(state.queries[0].orders.map(item => item[0]), ['received_at', 'id'])
  assert.equal(response.headers.get('cache-control'), 'no-store')
  reset()
  const malicious = writeWorkflowCursor('2026-09-22T00:00:00Z),tenant_id.eq.other', id(1))
  assert.equal((await GET(request(malicious))).status, 400)
  assert.equal(state.queries.length, 0)
  reset(); const cursor = writeWorkflowCursor(event(1).received_at, id(1))
  await GET(request(cursor))
  assert.match(state.queries[0].cursorFilter, /id\.lt\.00000000/)
})

test('maintenance is separate and invalid views are rejected', async () => {
  reset()
  await GET(new Request('http://localhost/api/integrations/automation/workflow?view=maintenance'))
  assert.deepEqual(state.queries[0].filters.find(([key]) => key === 'kind')[1], ['maintenance'])
  reset()
  assert.equal((await GET(new Request('http://localhost/api/integrations/automation/workflow?view=everything'))).status, 400)
  assert.equal(state.queries.length, 0)
})

test('lead search filters events on the server before paging and preserves tenant and project identity', async () => {
  reset(); state.tenants = [id(1)]
  state.tables.leads = { data: [{ tenant_id: id(1), project_id: id(2), kommo_id: 123, name: 'Carlos' },
    { tenant_id: id(99), project_id: id(3), kommo_id: 456, name: 'Carlos' }], error: null }
  const cursor = writeWorkflowCursor(event(1).received_at, id(5))
  await GET(new Request(`http://localhost/api/integrations/automation/workflow?q=Carlos&cursor=${encodeURIComponent(cursor)}`))
  assert.equal(state.queries[0].table, 'leads')
  assert.deepEqual(state.queries[0].namePattern, ['name', '%Carlos%'])
  const events = state.queries.find(query => query.table === 'lv_integration_events')
  assert.match(events.cursorFilter, /payload->>kommoId.eq.123/)
  assert.ok(events.cursorFilter.includes(`tenant_id.eq.${id(1)},project_id.eq.${id(2)}`))
  assert.ok(!events.cursorFilter.includes(id(99)))
  assert.match(events.cursorFilter, /and\(or\(.+\),or\(received_at.lt/)
})

test('empty lead matches never fall back to unrelated events; search text stays outside logical filters', async () => {
  reset()
  const body = await (await GET(new Request('http://localhost/api/integrations/automation/workflow?q=Carlos%25_'))).json()
  assert.deepEqual(body, { executions: [], nextCursor: null })
  assert.equal(state.queries.length, 1)
  assert.deepEqual(state.queries[0].namePattern, ['name', '%Carlos\\%\\_%'])
  reset()
  await GET(new Request('http://localhost/api/integrations/automation/workflow?q=123'))
  assert.deepEqual(state.queries[0].filters.find(([key]) => key === 'kommo_id'), ['kommo_id', 123])
})

test('every table is tenant scoped, lead identity is project scoped and summaries are sanitized', async () => {
  reset()
  state.tables.lv_integration_events = { data: [event(1)], error: null }
  state.tables.leads = { data: [{ id: 'wrong', tenant_id: 'tenant-b', project_id: 'project-b', kommo_id: 1, name: 'Wrong tenant' }, { id: 'right', tenant_id: 'tenant-a', project_id: 'project-a', kommo_id: 1, name: 'Correct project' }], error: null }
  state.tables.lv_automation_execution_steps = { data: [{ event_id: id(1), conversation_id: id(5), step_order: 1, step_key: 'execution_version', status: 'succeeded', input_summary: { full_name: 'Private person', monthly_income: 4200 }, output_summary: { batch_id: 'batch-a', batch_event_ids: ['event-a'], decision: { reason: 'Contactar prueba@example.com' } } }], error: null }
  const body = await (await GET(request())).json()
  assert.equal(body.executions[0].leadName, 'Correct project')
  assert.equal(body.executions[0].conversationId, id(5))
  assert.equal(body.executions[0].batchId, 'batch-a')
  assert.doesNotMatch(JSON.stringify(body), /prueba@example\.com|Private person|4200|Wrong tenant/)
  assert.ok(state.queries.every(query => query.filters.some(([key, value]) => key === 'tenant_id' && value.includes('tenant-a'))))
})

test('unavailable step evidence remains explicit instead of inventing an observed path', async () => {
  reset(); state.tables.lv_integration_events = { data: [event(1)], error: null }
  state.tables.lv_automation_execution_steps = { data: null, error: { code: 'missing_table' } }
  const body = await (await GET(request())).json()
  assert.equal(body.executions[0].traceSource, 'inferred')
  assert.equal(body.executions[0].traceWarning, 'AUDIT_READ_FAILED')
  assert.equal(body.executions[0].conversationId, null)
  assert.deepEqual(body.executions[0].steps, [])
})
