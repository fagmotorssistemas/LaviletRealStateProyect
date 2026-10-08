/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript')
require('./test-typescript.cjs')
const introduction = require('../src/lib/inmobiliaria/projectIntroduction.ts')
const readiness = require('../src/lib/inmobiliaria/projectReadiness.ts')
const delivery = require('../src/lib/inmobiliaria/projectDelivery.ts')
const version = '2026-10-08T00:00:00.000Z'
const value = { enabled: true, summary: 'Proyecto con viviendas y locales comerciales en Cuenca.', source: 'Responsable comercial' }
function harness(options = {}) {
  const writes = [], reads = [], saved = { id: 'project', tenant_id: 'tenant', name: 'La Vilet', updated_at: version,
    policies_json: { bot_visits: { allow_suggestions: false }, project_delivery: { current: { enabled: false } }, business_policies: { published: ['keep'] } } }
  const supabase = { from(table) {
    if (table === 'project_automation_config') {
      const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { mode: 'lanzamiento' }, error: null }) }; return query
    }
    assert.equal(table, 'projects')
    const filters = []; let mutation
    const query = { select: () => query, eq: (key, field) => { filters.push([key, field]); return query },
      single: async () => { reads.push(filters); return { data: options.deniedProject ? null : saved, error: options.readError ? { code: 'PRIVATE_DB' } : null } },
      update: data => { mutation = data; return query }, then: resolve => {
        writes.push({ mutation, filters });
        const result = options.writeError ? { data: null, error: { code: 'PRIVATE_WRITE' } }
          : options.concurrent ? { data: [], error: null } : { data: [{ id: 'project', updated_at: mutation.updated_at }], error: null }
        if (!result.error && result.data?.length) Object.assign(saved, mutation)
        return Promise.resolve(result).then(resolve)
      } }
    return query
  } }
  const mocks = {
    '@/lib/auth/session': { assertAdmin: async () => { if (options.deniedAdmin) throw Error('PRIVATE_AUTH') }, getSessionUser: async () => ({ supabase, user: options.noUser ? null : { id: 'admin' } }) },
    '@/lib/inmobiliaria/projectIntroduction': introduction, '@/lib/inmobiliaria/projectReadiness': readiness,
    '@/lib/inmobiliaria/projectDelivery': delivery, '@/lib/inmobiliaria/unitPrices': { launchPricesVisible: () => true },
  }
  const fixture = { exports: {} }, source = fs.readFileSync(path.join(__dirname, '../src/app/inmobiliaria/automatizacion/proyecto/actions.ts'), 'utf8')
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'module', 'exports', js)(key => { assert.ok(key in mocks, key); return mocks[key] }, fixture, fixture.exports)
  return { ...fixture.exports, writes, reads, saved }
}
test('presentation save uses the authorized project, tenant and compare-and-swap while preserving all other controls', async () => {
  const h = harness(), before = structuredClone(h.saved.policies_json)
  const result = await h.saveProjectIntroduction('project', { ...value, tenant_id: 'foreign', updatedBy: 'foreign', instruction: 'ignored' }, version)
  assert.equal(result.ok, true); assert.deepEqual(result.introduction.value, value)
  assert.deepEqual(h.reads, [[['id', 'project']]])
  assert.deepEqual(h.writes[0].filters, [['id', 'project'], ['tenant_id', 'tenant'], ['updated_at', version]])
  const saved = h.saved.policies_json
  for (const key of Object.keys(before)) assert.deepEqual(saved[key], before[key])
  assert.equal(saved.project_introduction.updatedBy, 'admin'); assert.equal(saved.project_introduction.history.length, 1)
  assert.deepEqual(Object.keys(h.writes[0].mutation).sort(), ['policies_json', 'updated_at'])
})
test('denied admin, missing session and inaccessible project never write or expose internal errors', async () => {
  for (const options of [{ deniedAdmin: true }, { noUser: true }, { deniedProject: true }, { readError: true }]) {
    const h = harness(options), result = await h.saveProjectIntroduction('project', value, version)
    assert.equal(result.ok, false); assert.equal(h.writes.length, 0); assert.doesNotMatch(result.error, /PRIVATE_/)
  }
})
test('invalid active summaries and stale versions do not write; races and DB errors are not reported as saved', async () => {
  for (const invalid of [{ ...value, summary: '' }, { ...value, source: '' }, { ...value, summary: 'x'.repeat(1201) }, { ...value, enabled: 'true' }]) {
    const h = harness(), result = await h.saveProjectIntroduction('project', invalid, version)
    assert.equal(result.ok, false); assert.equal(h.writes.length, 0)
  }
  const stale = harness(); assert.equal((await stale.saveProjectIntroduction('project', value, 'old')).ok, false); assert.equal(stale.writes.length, 0)
  for (const options of [{ concurrent: true }, { writeError: true }]) {
    const result = await harness(options).saveProjectIntroduction('project', value, version)
    assert.equal(result.ok, false); assert.doesNotMatch(result.error, /PRIVATE_/)
  }
})
test('loading and disabling preserve the approved text and do not change the test audience or review settings', async () => {
  const h = harness(); await h.saveProjectIntroduction('project', value, version)
  const loaded = await h.loadProjectReadiness('project')
  assert.deepEqual(loaded.introduction.value, value)
  const result = await h.saveProjectIntroduction('project', { ...value, enabled: false }, loaded.updatedAt)
  assert.equal(result.ok, true); assert.equal(h.saved.policies_json.project_introduction.current.summary, value.summary)
  assert.equal(introduction.projectIntroductionContext(h.saved.policies_json).available, false)
  assert.equal(h.saved.policies_json.response_review, undefined); assert.equal(h.saved.policies_json.test_only, undefined)
})
