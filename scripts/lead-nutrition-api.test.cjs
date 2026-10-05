/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test')
const assert = require('node:assert/strict')
const Module = require('node:module')
require('./test-typescript.cjs')
let state
class Query {
  constructor(table) { this.table = table; this.filters = []; state.queries.push(this) }
  select() { return this }
  eq(key, value) { this.filters.push([key, value]); return this }
  in(key, value) { this.filters.push([key, value]); return this }
  contains(key, value) { this.filters.push([key, value]); return this }
  order() { return this }
  limit(value) { this.limitValue = value; return this }
  maybeSingle() { return this }
  then(resolve, reject) { return Promise.resolve(state.tables[this.table]).then(resolve, reject) }
}
const originalLoad = Module._load
Module._load = function (id, parent, isMain) {
  if (id === '@/lib/auth/session') return {
    assertCanAccessCrmPath: async () => { if (!state.session) throw new Error('No autenticado'); return state.session },
    getSessionUser: async () => ({ supabase: {} }),
  }
  if (id === '@/lib/inmobiliaria/tenants') return { getAccessibleTenantIds: async () => state.tenants }
  if (id === '@/lib/supabase/admin') return { createAdminClient: () => ({ from: table => new Query(table) }) }
  return originalLoad.call(this, id, parent, isMain)
}
const { GET } = require('../src/app/api/inmobiliaria/automation/nutrition/route.ts')
Module._load = originalLoad
const leadId = '00000000-0000-4000-8000-000000000001'
const request = () => new Request(`http://localhost/api/inmobiliaria/automation/nutrition?leadId=${leadId}`)
function reset(role = 'admin') {
  state = { session: { user: { id: 'user-a' }, profile: { role } }, tenants: ['tenant-a'], queries: [], tables: {
    leads: { data: { id: leadId, tenant_id: 'tenant-a', project_id: 'project-a' }, error: null },
    lv_integration_events: { data: [{ id: 'job-a', payload: { task: 'nutrition_24h', secret: 'omit' },
      status: 'pending', result: { reason: 'scheduled', secret: 'omit' } }], error: null },
  } }
}
test('follow-ups require an authorized session and lead before reading operational events', async () => {
  reset(); state.session = null
  assert.equal((await GET(request())).status, 401)
  assert.equal(state.queries.length, 0)
  reset('cliente')
  assert.equal((await GET(request())).status, 403)
  assert.equal(state.queries.length, 0)
  reset(); state.tenants = []
  assert.equal((await GET(request())).status, 403)
  assert.equal(state.queries.length, 0)
  reset(); state.tables.leads.data = null
  assert.equal((await GET(request())).status, 404)
  assert.ok(!state.queries.some(q => q.table === 'lv_integration_events'))
})
test('advisors are limited to assigned leads and events are scoped to tenant, project, lead and allowed tasks', async () => {
  reset('asesor')
  const response = await GET(request()), body = await response.json()
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  const lead = state.queries.find(q => q.table === 'leads')
  assert.ok(lead.filters.some(([key, value]) => key === 'assigned_to' && value === 'user-a'))
  assert.ok(lead.filters.some(([key, value]) => key === 'tenant_id' && value[0] === 'tenant-a'))
  const jobs = state.queries.find(q => q.table === 'lv_integration_events')
  for (const [key, value] of [['tenant_id', 'tenant-a'], ['project_id', 'project-a'], ['kind', 'maintenance']])
    assert.ok(jobs.filters.some(([k, v]) => k === key && v === value))
  assert.ok(jobs.filters.some(([key, value]) => key === 'payload' && value.leadId === leadId))
  assert.deepEqual(jobs.filters.find(([key]) => key === 'payload->>task')[1], ['nutrition_24h', 'nutrition_week_one', 'nutrition_week_two', 'nutrition_week_three'])
  assert.equal(jobs.limitValue, 30)
  assert.equal(body.jobs[0].task, 'nutrition_24h')
  assert.ok(!JSON.stringify(body).includes('secret'))
  assert.equal(body.jobs[0].payload, undefined)
})
test('database failures stay errors rather than becoming a successful empty job list', async () => {
  reset(); state.tables.lv_integration_events = { data: null, error: { message: 'private database detail' } }
  const response = await GET(request())
  assert.equal(response.status, 500)
  assert.deepEqual(await response.json(), { error: 'No se pudieron consultar los seguimientos' })
})
