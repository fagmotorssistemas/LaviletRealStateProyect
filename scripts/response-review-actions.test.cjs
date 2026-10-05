/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const root = path.resolve(__dirname, '..')
function load(file, mocks = {}) {
  const loaded = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  new Function('require', 'module', 'exports', code)(id => {
    if (id in mocks) return mocks[id]
    throw Error(`Unmocked dependency: ${id}`)
  }, loaded, loaded.exports)
  return loaded.exports
}
const settings = load('src/lib/inmobiliaria/responseReview.ts')
function harness({ authorized = true, projectAccess = true, concurrent = false, readError = false } = {}) {
  const calls = []
  const project = { id: 'project', tenant_id: 'tenant', updated_at: 'version',
    policies_json: { catalog_search: { embeddings_enabled: true }, business: { keep: true } } }
  const supabase = { from(table) {
    assert.equal(table, 'projects')
    let write
    const filters = []
    const query = {
      select: () => query,
      eq: (key, value) => { filters.push([key, value]); return query },
      update: value => { write = value; return query },
      abortSignal: () => query,
      single: async () => { calls.push({ filters }); return { data: projectAccess ? structuredClone(project) : null, error: readError } },
      then: resolve => {
        calls.push({ write, filters })
        if (!concurrent) Object.assign(project, write)
        return Promise.resolve({ data: concurrent ? [] : [{ updated_at: project.updated_at }], error: null }).then(resolve)
      },
    }
    return query
  } }
  const actions = load('src/app/inmobiliaria/automatizacion/pruebas/review-actions.ts', {
    '@/lib/auth/session': { assertAdmin: async () => { if (!authorized) throw Error('forbidden'); return { user: { id: 'admin' } } },
      getSessionUser: async () => ({ supabase }) },
    '@/lib/inmobiliaria/responseReview': settings,
    '@/lib/integrations/lavilet': { LAVILET_PROJECT_ID: 'project', LAVILET_TENANT_ID: 'tenant' },
  })
  const runtime = load('src/lib/integrations/automation/response-review-settings.ts', {
    'server-only': {}, '@/lib/inmobiliaria/responseReview': settings,
    './data': { db: () => supabase, scope: { project_id: 'project', tenant_id: 'tenant' } },
  })
  return { ...actions, ...runtime, calls, project }
}

test('global button state persists off/on for runtime without changing embeddings or other policies', async () => {
  const h = harness()
  assert.equal((await h.loadResponseReviewAction()).state.enabled, true)
  const off = await h.saveResponseReviewAction(false, 'version')
  assert.equal(off.ok, true)
  assert.equal(off.state.enabled, false)
  assert.equal((await h.loadResponseReviewPolicy()).enabled, false)
  assert.equal((await h.loadResponseReviewAction()).state.enabled, false)
  assert.equal((await h.saveResponseReviewAction(true, off.state.version)).state.enabled, true)
  assert.equal((await h.loadResponseReviewPolicy()).enabled, true)
  assert.deepEqual(h.project.policies_json.catalog_search, { embeddings_enabled: true })
  assert.deepEqual(h.project.policies_json.business, { keep: true })
  assert.equal(h.project.policies_json.response_review.updated_by, 'admin')
  for (const call of h.calls) {
    assert.ok(call.filters.some(([key, value]) => key === 'id' && value === 'project'))
    assert.ok(call.filters.some(([key, value]) => key === 'tenant_id' && value === 'tenant'))
    if (call.write) assert.ok(call.filters.some(([key]) => key === 'updated_at'))
  }
})

test('unauthorized, inaccessible, stale and invalid changes cannot overwrite project policies', async () => {
  for (const [options, version, enabled] of [[{ authorized: false }, 'version', false],
    [{ projectAccess: false }, 'version', false], [{}, 'stale', false], [{}, 'version', 'false']]) {
    const h = harness(options)
    assert.equal((await h.saveResponseReviewAction(enabled, version)).ok, false)
    assert.equal(h.calls.some(call => call.write), false)
  }
  const h = harness({ concurrent: true })
  assert.match((await h.saveResponseReviewAction(false, 'version')).error, /configuración cambió/)
  assert.equal(h.project.policies_json.response_review, undefined)
})

test('runtime cannot interpret a failed configuration read as permission to bypass review', async () => {
  for (const options of [{ readError: true }, { projectAccess: false }])
    await assert.rejects(harness(options).loadResponseReviewPolicy(), /RESPONSE_REVIEW_SETTINGS_UNAVAILABLE/)
})

test('expected access/read failures return renderable errors instead of masked Server Component exceptions', async () => {
  for (const options of [{ authorized: false }, { readError: true }, { projectAccess: false }]) {
    const result = await harness(options).loadResponseReviewAction()
    assert.equal(result.ok, false)
    assert.match(result.error, /No se pudo cargar.*Actualizar estado/)
    assert.doesNotMatch(result.error, /forbidden|SQL|digest/)
  }
})
