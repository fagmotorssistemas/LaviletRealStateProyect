/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
require('./test-typescript.cjs')
const discounts = require('../src/lib/inmobiliaria/earlyPurchaseDiscounts.ts')

function harness({ admin = true, readError = false, concurrent = false, writeError = false } = {}) {
  const calls = [], project = { id: 'project', tenant_id: 'tenant', updated_at: 'version', policies_json: {
    response_review: { enabled: false }, financing_guidance: { preserve: true }, other: 'preserve' } }
  const supabase = { from(table) {
    assert.equal(table, 'projects')
    let write
    const filters = [], query = { select: () => query, eq: (key, value) => { filters.push([key, value]); return query },
      update: value => { write = value; return query }, single: async () => ({ data: readError ? null : structuredClone(project), error: readError }),
      then: resolve => {
        calls.push({ write, filters })
        if (!concurrent && !writeError) Object.assign(project, write)
        return Promise.resolve({ data: concurrent ? [] : [{ updated_at: project.updated_at }], error: writeError }).then(resolve)
      } }
    return query
  } }
  const loaded = { exports: {} }, mocks = {
    '@/lib/auth/session': { assertAdmin: async () => { if (!admin) throw Error('PRIVATE_AUTH'); return { user: { id: 'administrator' } } }, getSessionUser: async () => ({ supabase }) },
    '@/lib/inmobiliaria/earlyPurchaseDiscounts': discounts,
    '@/lib/integrations/lavilet': { LAVILET_PROJECT_ID: 'project', LAVILET_TENANT_ID: 'tenant' },
  }
  const source = fs.readFileSync(path.join(__dirname, '../src/app/inmobiliaria/automatizacion/descuentos/actions.ts'), 'utf8')
  new Function('require', 'module', 'exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(
    id => { if (!(id in mocks)) throw Error(id); return mocks[id] }, loaded, loaded.exports)
  return { ...loaded.exports, calls, project }
}

test('admin saves and reloads discount activation independently from automation testing and other policies', async () => {
  const h = harness(), draft = discounts.defaultEarlyPurchaseDiscountSettings()
  const result = await h.saveEarlyPurchaseDiscountSettings(draft, 'version')
  assert.equal(result.ok, true)
  const loaded = await h.loadEarlyPurchaseDiscountSettings()
  assert.equal(loaded.ok, true)
  assert.equal(loaded.state.settings.enabled, false)
  assert.equal(loaded.state.settings.rules[0].enabled, false)
  assert.equal(loaded.state.settings.updatedBy, 'administrator')
  assert.equal(h.project.policies_json.other, 'preserve')
  assert.deepEqual(h.project.policies_json.financing_guidance, { preserve: true })
  assert.deepEqual(h.project.policies_json.response_review, { enabled: false })
  assert.deepEqual(h.calls[0].filters, [['id', 'project'], ['tenant_id', 'tenant'], ['updated_at', 'version']])
})

test('invalid rules, denied administrators and stale versions never execute a write', async () => {
  for (const [options, version] of [[{ admin: false }, 'version'], [{ readError: true }, 'version'], [{}, 'stale'], [{}, '']]) {
    const h = harness(options)
    assert.equal((await h.saveEarlyPurchaseDiscountSettings(discounts.defaultEarlyPurchaseDiscountSettings(), version)).ok, false)
    assert.equal(h.calls.length, 0)
  }
  const h = harness()
  assert.equal((await h.saveEarlyPurchaseDiscountSettings({ enabled: 'true' }, 'version')).ok, false)
  assert.equal(h.calls.length, 0)
})

test('concurrent changes and database errors cannot be reported as a saved rule', async () => {
  for (const options of [{ concurrent: true }, { writeError: true }]) {
    const h = harness(options)
    assert.equal((await h.saveEarlyPurchaseDiscountSettings(discounts.defaultEarlyPurchaseDiscountSettings(), 'version')).ok, false)
    assert.equal(h.project.policies_json.early_purchase_discounts, undefined)
  }
})

test('load errors and malformed saved policies do not publish the draft percentage or expose private server errors', async () => {
  for (const options of [{ admin: false }, { readError: true }]) {
    const result = await harness(options).loadEarlyPurchaseDiscountSettings()
    assert.equal(result.ok, false)
    assert.match(result.error, /No se pudo cargar/)
    assert.doesNotMatch(result.error, /PRIVATE_AUTH|SQL|digest/)
  }
  const h = harness()
  h.project.policies_json.early_purchase_discounts = { enabled: true, rules: 'invalid' }
  const result = await h.loadEarlyPurchaseDiscountSettings()
  assert.equal(result.ok, true)
  assert.equal(result.state.settings.enabled, false)
  assert.equal(result.state.settings.rules.length, 0)
})
