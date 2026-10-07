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
function harness({ authorized = true, projectAccess = true, concurrent = false, readError = false, policies = null, testContact = false } = {}) {
  const calls = []
  const project = { id: 'project', tenant_id: 'tenant', updated_at: 'version',
    policies_json: policies || { catalog_search: { embeddings_enabled: true }, business: { keep: true } } }
  const supabase = { from(table) {
    if (table === 'lv_test_contacts_state') {
      const filters = []
      const query = { select: () => query, abortSignal: () => query,
        match: value => { filters.push(...Object.entries(value)); return query },
        eq: (key, value) => { filters.push([key, value]); return query },
        then: resolve => { calls.push({ filters, table });
          return Promise.resolve({ data: testContact ? [{ lead_id: 'test-lead' }] : [], error: null }).then(resolve) },
      }
      return query
    }
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


test('demonstration preserves general review state and scopes observation to enrolled contacts only', async () => {
  const h = harness({ testContact: true, policies: { response_review: { enabled: false, note: 'keep' }, catalog_search: { embeddings_enabled: true } } })
  const observing = await h.saveResponseReviewObservationAction(true, 'version')
  assert.equal(observing.ok, true)
  assert.equal(observing.state.enabled, false)
  assert.equal(observing.state.observationOnly, true)
  assert.equal((await h.loadResponseReviewPolicy()).observationOnly, false)
  assert.equal((await h.loadResponseReviewPolicy()).enabled, false)
  assert.equal((await h.loadResponseReviewPolicy(123)).observationOnly, true)
  assert.equal((await h.loadResponseReviewPolicy(123)).enabled, false)
  assert.deepEqual(h.project.policies_json.catalog_search, { embeddings_enabled: true })
  assert.equal(h.project.policies_json.response_review.note, 'keep')
  assert.equal(h.project.policies_json.response_review.updated_by, 'admin')
  assert.equal(h.calls.filter(call => call.write).length, 1)
  const normal = await h.saveResponseReviewObservationAction(false, observing.state.version)
  assert.equal(normal.ok, true)
  assert.equal(normal.state.enabled, false)
  assert.equal(normal.state.observationOnly, false)
})

test('disabling general review clears demonstration; re-enabling does not silently reactivate it', async () => {
  const h = harness()
  const observing = await h.saveResponseReviewObservationAction(true, 'version')
  const disabled = await h.saveResponseReviewAction(false, observing.state.version)
  assert.equal(disabled.state.enabled, false)
  assert.equal(disabled.state.observationOnly, false)
  const enabled = await h.saveResponseReviewAction(true, disabled.state.version)
  assert.equal(enabled.state.enabled, true)
  assert.equal(enabled.state.observationOnly, false)
})

test('demonstration requires administrator access, valid boolean, accessible project and current version', async () => {
  for (const [options, version, value] of [[{ authorized: false }, 'version', true],
    [{ projectAccess: false }, 'version', true], [{ readError: true }, 'version', true],
    [{}, 'stale', true], [{}, 'version', 'true'], [{}, '', true]]) {
    const h = harness(options)
    assert.equal((await h.saveResponseReviewObservationAction(value, version)).ok, false)
    assert.equal(h.calls.some(call => call.write), false)
  }
  const h = harness({ concurrent: true })
  assert.match((await h.saveResponseReviewObservationAction(true, 'version')).error, /configuración cambió/)
  assert.equal(h.project.policies_json.response_review, undefined)
})

test('only explicit boolean enables observation without overwriting general review state', () => {
  for (const value of [undefined, null, false, 'true', 1, {}, []])
    assert.equal(settings.responseReviewSettings({ response_review: { observation_only: value } }).observationOnly, false)
  assert.deepEqual(settings.responseReviewSettings({ response_review: { enabled: false, observation_only: true } }),
    { enabled: false, observationOnly: true, updatedAt: null })
  assert.throws(() => settings.changeResponseReviewObservation({}, 'true', 'admin', 'now'))
  const previous = { response_review: { enabled: false }, unrelated: { keep: true } }
  const observing = settings.changeResponseReviewObservation(previous, true, 'admin', 'now')
  assert.deepEqual(previous, { response_review: { enabled: false }, unrelated: { keep: true } })
  assert.deepEqual(observing.unrelated, previous.unrelated)
})

test('observed continuity remembers a usable question without treating failed business review as approval', () => {
  const audit = { status: 'review_observed', review_control: { observationOnly: true, source: 'project_setting' },
    transport_validation: { passed: true }, final_validation: { passed: false, policy: 'observation_only', enforcement: false } }
  assert.equal(settings.responseSupportsContinuity(audit), true)
  assert.equal(settings.responseSupportsContinuity({ ...audit, transport_validation: { passed: false } }), false)
  assert.equal(settings.responseSupportsContinuity({ ...audit, review_control: { observationOnly: true, source: 'model' } }), false)
  assert.equal(settings.responseSupportsContinuity({ ...audit, review_control: { source: 'project_setting' } }), false)
})


test('observation applies only to a trusted test contact and defaults remain enforced', () => {
  const observing = settings.responseReviewSettings({ response_review: { observation_only: true } })
  const production = settings.scopeResponseReview(observing, false)
  assert.equal(production.observationOnly, false)
  assert.equal(production.enabled, true)
  assert.equal(settings.scopeResponseReview(observing, true).observationOnly, true)
  assert.equal(settings.scopeResponseReview(observing, 'true').observationOnly, false)
  assert.equal(settings.scopeResponseReview(settings.responseReviewSettings(null), true).observationOnly, false)
  assert.equal(settings.scopeResponseReview({ enabled: false, updatedAt: null }, true).enabled, false)
  assert.equal(observing.observationOnly, true)
  const generalOff = { enabled: false, observationOnly: true, updatedAt: null }
  assert.equal(settings.scopeResponseReview(generalOff, true).enabled, false)
  assert.equal(settings.scopeResponseReview(generalOff, false).enabled, false)
  assert.equal(settings.scopeResponseReview(settings.responseReviewSettings(settings.changeResponseReviewObservation({ response_review: { enabled: false } }, false, 'admin', 'now')), false).observationOnly, false)
})
