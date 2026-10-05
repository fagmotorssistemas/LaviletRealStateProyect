/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
require('./test-typescript.cjs')
const settings = require('../src/lib/inmobiliaria/financingGuidance.ts')
function harness({ admin = true, readError = false, concurrent = false, writeError = false } = {}) {
  const calls = [], project = { id: 'project', tenant_id: 'tenant', updated_at: 'version', policies_json: { response_review: { enabled: false }, other: 'preserve' } }
  const supabase = { from(table) {
    assert.equal(table, 'projects')
    let write
    const filters = [], query = { select: () => query, eq: (k, v) => { filters.push([k, v]); return query },
      update: value => { write = value; return query },
      single: async () => ({ data: readError ? null : structuredClone(project), error: readError }),
      then: resolve => {
        calls.push({ write, filters })
        if (!concurrent && !writeError) Object.assign(project, write)
        return Promise.resolve({ data: concurrent ? [] : [{ updated_at: project.updated_at }], error: writeError }).then(resolve)
      } }
    return query
  } }
  const loaded = { exports: {} }, mocks = {
    '@/lib/auth/session': { assertAdmin: async () => { if (!admin) throw Error('PRIVATE_AUTH'); return { user: { id: 'admin' } } }, getSessionUser: async () => ({ supabase }) },
    '@/lib/inmobiliaria/financingGuidance': settings,
    '@/lib/integrations/lavilet': { LAVILET_PROJECT_ID: 'project', LAVILET_TENANT_ID: 'tenant' },
  }
  const source = fs.readFileSync(path.join(__dirname, '../src/app/inmobiliaria/automatizacion/financiamiento/actions.ts'), 'utf8')
  new Function('require', 'module', 'exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(
    id => { if (!(id in mocks)) throw Error(id); return mocks[id] }, loaded, loaded.exports)
  return { ...loaded.exports, calls, project }
}
test('admin can save, reload and independently disable lender terms without overwriting the global review switch', async () => {
  const h = harness(), draft = settings.defaultFinancingGuidance()
  draft.lenders[0].enabled = false; draft.estimatesEnabled = false
  const result = await h.saveFinancingGuidance(draft, 'version')
  assert.equal(result.ok, true)
  assert.deepEqual((await h.loadFinancingGuidance()).state.settings, draft)
  assert.equal(h.project.policies_json.other, 'preserve')
  assert.equal(h.project.policies_json.response_review.enabled, false)
  assert.equal(h.project.policies_json.financing_guidance.updatedBy, 'admin')
  assert.deepEqual(h.calls[0].filters, [['id', 'project'], ['tenant_id', 'tenant'], ['updated_at', 'version']])
})
test('denied access, invalid input, stale versions and concurrent saves cannot overwrite conditions', async () => {
  for (const [options, version] of [[{ admin: false }, 'version'], [{ readError: true }, 'version'], [{}, 'stale']]) {
    const h = harness(options)
    assert.equal((await h.saveFinancingGuidance(settings.defaultFinancingGuidance(), version)).ok, false)
    assert.equal(h.calls.length, 0)
  }
  for (const options of [{ concurrent: true }, { writeError: true }]) {
    const h = harness(options)
    assert.equal((await h.saveFinancingGuidance(settings.defaultFinancingGuidance(), 'version')).ok, false)
    assert.equal(h.project.policies_json.financing_guidance, undefined)
  }
  const h = harness()
  assert.equal((await h.saveFinancingGuidance({ enabled: 'false' }, 'version')).ok, false)
  assert.equal(h.calls.length, 0)
})
test('load failures return a renderable Spanish message without exposing server errors', async () => {
  for (const options of [{ admin: false }, { readError: true }]) {
    const result = await harness(options).loadFinancingGuidance()
    assert.equal(result.ok, false)
    assert.match(result.error, /No se pudo cargar/)
    assert.doesNotMatch(result.error, /PRIVATE_AUTH|digest|SQL/)
  }
})
