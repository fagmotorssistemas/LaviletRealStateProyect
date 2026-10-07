/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), ts = require('typescript')
require('./test-typescript.cjs')
const model = require('../src/lib/inmobiliaria/projectAreaFacts.ts')
const id = '40b31a51-8c57-4b0b-8dc1-8e7548b3cb32', version = '2026-10-01T00:00:00.000Z'
const draft = () => ({ ...model.emptyAreaFact(), headline: 'Servicios cercanos', fact_text: 'Servicios cotidianos confirmados por el responsable.', safe_sales_text: 'El sector cuenta con servicios cotidianos confirmados.', source_name: 'Responsable del proyecto', verified_on: '2026-01-01' })
function harness(options = {}) {
  const writes = [], reads = [], row = options.newFact ? null : { ...draft(), id, project_id: 'project', tenant_id: 'tenant', fact_key: 'services', approved_for_bot: true, review_status: 'verified', updated_at: version, draft_content: null }
  let saved = row
  const sessionClient = { from(table) {
    assert.equal(table, 'projects')
    const filters = [], query = { select: () => query, eq: (key, value) => { filters.push([key, value]); return query }, single: async () => {
      assert.deepEqual(filters, [['id', 'project']]); return { data: options.deniedProject ? null : { id: 'project', tenant_id: 'tenant' }, error: options.deniedProject }
    } }; return query
  } }
  const adminClient = { from(table) {
    assert.equal(table, 'project_area_facts')
    const filters = []; let mutation, inserting = false
    const finish = async list => {
      if (mutation) {
        writes.push({ mutation, filters, inserting })
        if (options.writeError) return { data: null, error: { code: 'PRIVATE_ERROR' } }
        if (options.concurrent) return { data: null, error: null }
        saved = { ...(saved || {}), ...mutation }; return { data: list ? [saved] : saved, error: null }
      }
      reads.push(filters)
      if (options.readError) return { data: null, error: { code: options.readError } }
      return { data: list ? saved ? [saved] : [] : saved, error: null }
    }
    const query = { select: () => query, eq: (key, value) => { filters.push([key, value]); return query }, neq: (key, value) => { filters.push([key, value]); return query },
      order: () => query, limit: () => query, maybeSingle: () => finish(false), then: resolve => finish(true).then(resolve),
      update: value => { mutation = value; return query }, insert: value => { mutation = value; inserting = true; return query } }
    return query
  } }
  const fixtureModule = { exports: {} }, mocks = {
    '@/lib/auth/session': { assertAdmin: async () => { if (options.deniedAdmin) throw Error('PRIVATE_AUTH'); return { user: { id: 'admin' } } }, getSessionUser: async () => ({ supabase: sessionClient }) },
    '@/lib/supabase/admin': { createAdminClient: () => adminClient }, '@/lib/inmobiliaria/projectAreaFacts': model,
  }
  const source = fs.readFileSync(path.join(__dirname, '../src/app/inmobiliaria/automatizacion/conocimiento/area-fact-actions.ts'), 'utf8')
  new Function('require', 'module', 'exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(key => {
    assert.ok(key in mocks, key); return mocks[key]
  }, fixtureModule, fixtureModule.exports)
  return { ...fixtureModule.exports, writes, reads, saved: () => saved }
}
const command = (action = 'draft') => ({ action, id, value: draft(), expectedUpdatedAt: version, confirmed: action === 'publish' })
test('every service read and update is scoped to the session-authorized project and tenant, with a compare-and-swap', async () => {
  const h = harness(), result = await h.saveProjectAreaFact('project', command())
  assert.equal(result.status, 'published'); assert.equal(h.writes.length, 1)
  assert.deepEqual(h.reads[0], [['project_id', 'project'], ['tenant_id', 'tenant'], ['id', id]])
  assert.deepEqual(h.writes[0].filters, [['project_id', 'project'], ['tenant_id', 'tenant'], ['id', id], ['updated_at', version]])
  assert.deepEqual(Object.keys(h.writes[0].mutation).sort(), ['draft_content', 'updated_at'])
  assert.equal(h.saved().safe_sales_text, draft().safe_sales_text)
})
test('unauthorized administrators or inaccessible projects never reach a service write', async () => {
  for (const options of [{ deniedAdmin: true }, { deniedProject: true }]) {
    const h = harness(options)
    await assert.rejects(h.saveProjectAreaFact('project', command()))
    assert.equal(h.writes.length, 0); assert.equal(h.reads.length, 0)
    const load = await h.loadProjectAreaFacts('project')
    assert.equal(load.facts.length, 0); assert.doesNotMatch(load.error, /PRIVATE_AUTH/)
  }
})
test('publication requires validated source, date and explicit approval, irrespective of client-supplied flags', async () => {
  for (const invalid of [{ ...command('publish'), confirmed: false }, { ...command('publish'), value: { ...draft(), source_name: '' } },
    { ...command('publish'), value: { ...draft(), verified_on: '' } }, { ...command(), value: { ...draft(), category: 'security_guarantee' } }]) {
    const h = harness(); await assert.rejects(h.saveProjectAreaFact('project', invalid)); assert.equal(h.writes.length, 0)
  }
  const h = harness(), result = await h.saveProjectAreaFact('project', command('publish'))
  assert.equal(result.status, 'published'); assert.equal(h.saved().approved_for_bot, true); assert.equal(h.saved().review_status, 'verified')
})
test('stale versions, concurrent writes and DB failures are never reported as saved', async () => {
  const h = harness(); await assert.rejects(h.saveProjectAreaFact('project', { ...command(), expectedUpdatedAt: '2026-09-01T00:00:00Z' }), /cambió/); assert.equal(h.writes.length, 0)
  for (const options of [{ concurrent: true }, { writeError: true }, { readError: 'PRIVATE_ERROR' }])
    await assert.rejects(harness(options).saveProjectAreaFact('project', command()), /cambió|No se pudo/)
})
test('new drafts receive server-owned tenant and key, and pausing never changes published text', async () => {
  const h = harness({ newFact: true }), result = await h.saveProjectAreaFact('project', { ...command(), expectedUpdatedAt: null, value: { ...draft(), tenant_id: 'foreign', approved_for_bot: true } })
  assert.equal(result.status, 'draft'); assert.equal(h.writes[0].mutation.tenant_id, 'tenant'); assert.equal(h.writes[0].mutation.project_id, 'project')
  assert.equal(h.writes[0].mutation.approved_for_bot, false)
  const p = harness(), before = p.saved().safe_sales_text, paused = await p.saveProjectAreaFact('project', command('pause'))
  assert.equal(paused.status, 'paused'); assert.equal(p.saved().safe_sales_text, before)
})
test('missing draft migration is explained safely while load failure remains local to the environment editor', async () => {
  const h = harness({ readError: '42703' }), loaded = await h.loadProjectAreaFacts('project')
  assert.deepEqual(loaded.facts, []); assert.match(loaded.error, /20261007190000_project_area_fact_drafts.sql/)
  await assert.rejects(h.saveProjectAreaFact('project', command()), /20261007190000/)
  assert.equal(h.writes.length, 0)
})
