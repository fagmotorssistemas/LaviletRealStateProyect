/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict')
const path = require('node:path'), Module = require('node:module'), fs = require('node:fs'), ts = require('typescript')
require('./test-typescript.cjs')
const { emptyProjectDelivery } = require('../src/lib/inmobiliaria/projectDelivery.ts')
function actions(auth) {
  const full = path.resolve('src/app/inmobiliaria/automatizacion/proyecto/actions.ts'), loaded = { exports: {} }, load = Module.createRequire(full)
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'module', 'exports', code)(id => id === '@/lib/auth/session' ? auth : load(id), loaded, loaded.exports)
  return loaded.exports
}
const value = { ...emptyProjectDelivery(), enabled: true, timing: 'year', year: 2028, source: 'Responsable comercial' }
test('delivery save checks admin/session, scopes project and tenant, retains unrelated settings and rejects concurrent changes', async () => {
  const policies = { project_readiness: { current: { stage: 'building' } }, bot_visits: { allow_suggestions: false },
    business_policies: { items: [{ id: 'keep' }] }, financing_guidance: { enabled: true } }
  const row = { id: 'project', tenant_id: 'tenant', updated_at: 'old', policies_json: policies }
  let writes = [], filters = [], adminChecks = 0, conflict = false
  const supabase = { from: table => {
    assert.equal(table, 'projects'); let updating = false
    const q = { select: () => updating ? Promise.resolve({ data: conflict ? [] : [{ id: row.id, updated_at: 'saved-time' }] }) : q,
      eq: (key, value) => { filters.push([key, value]); return q }, single: async () => ({ data: row }),
      update: value => { writes.push(value); updating = true; return q } }
    return q
  } }
  const api = actions({ assertAdmin: async () => { adminChecks++ }, getSessionUser: async () => ({ supabase, user: { id: 'admin' } }) })
  const first = await api.saveProjectDelivery('project', value, 'old')
  assert.equal(first.ok, true); assert.equal(first.updatedAt, 'saved-time'); assert.equal(adminChecks, 1)
  assert.equal(writes.length, 1)
  assert.deepEqual(Object.fromEntries(Object.entries(writes[0].policies_json).filter(([key]) => key !== 'project_delivery')), policies)
  assert.equal(writes[0].policies_json.project_delivery.updatedBy, 'admin')
  assert.equal(writes[0].policies_json.project_delivery.history.length, 1)
  for (const entry of [['id', 'project'], ['tenant_id', 'tenant'], ['updated_at', 'old']]) assert.ok(filters.some(filter => JSON.stringify(filter) === JSON.stringify(entry)))
  writes = []; filters = []
  assert.equal((await api.saveProjectDelivery('project', value, 'stale')).ok, false); assert.equal(writes.length, 0)
  assert.equal((await api.saveProjectDelivery('project', { ...value, year: null }, 'old')).ok, false); assert.equal(writes.length, 0)
  conflict = true
  assert.equal((await api.saveProjectDelivery('project', value, 'old')).ok, false)
})
test('an unauthorized session cannot save a delivery schedule', async () => {
  let sessionRead = false
  const denied = actions({ assertAdmin: async () => { throw Error('Forbidden') }, getSessionUser: async () => { sessionRead = true; throw Error('Unexpected') } })
  assert.equal((await denied.saveProjectDelivery('project', value, 'old')).ok, false)
  assert.equal(sessionRead, false)
  const signedOut = actions({ assertAdmin: async () => {}, getSessionUser: async () => ({ user: null }) })
  assert.equal((await signedOut.saveProjectDelivery('project', value, 'old')).ok, false)
})
