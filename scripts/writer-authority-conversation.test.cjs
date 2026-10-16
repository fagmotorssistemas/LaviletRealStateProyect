/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

const root = path.resolve(__dirname, '..')
const originalLoad = Module._load
Module._load = function (id, parent, main) {
  if (id === 'server-only') return {}
  if (id.startsWith('@/')) id = path.join(root, 'src', id.slice(2))
  return originalLoad.call(this, id, parent, main)
}
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText, filename)

const data = require('../src/lib/integrations/automation/data.ts')
const scope = data.scope

function load(relative, mocks) {
  const filename = path.join(root, relative)
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const loaded = { exports: {} }, localRequire = Module.createRequire(filename)
  if (relative === 'src/lib/integrations/automation/conversation.ts') {
    const rpc = mocks['./data'].rpc
    mocks = {
      ...mocks,
      // The older harness did not mock these transitive services. This fixture
      // has no credentials and must never initialize a production DB client.
      './showroom-contact': { applyShowroomEntry: async (_lead, summary) => summary },
      './whatsapp-typing': { showWhatsAppTyping: async () => ({ status: 'disabled', reason: 'isolated_test' }) },
      './ctwa-lead-store': { preserveCtwaForContact: async () => ({ ok: true, code: 'CTWA_NOOP' }) },
      '@/lib/meta/waLeadSubmittedTurn': {
        applyWhatsappAdsConsentFromClientMessage: async () => ({}),
        evaluateWaLeadSubmittedForCurrentTurn: async () => ({}),
      },
      './reply-registration': {
        AcceptedReplyRegistrationError: class AcceptedReplyRegistrationError extends Error {},
        prepareReplyRegistration: async input => ({ id: 'test-checkpoint', key: 'test-key', data: {
          args: input.args,
          summary_before: input.summaryBefore,
          summary_after: JSON.stringify(input.summaryAfter),
        } }),
        markReplyDispatchStarted: async () => {},
        registerAcceptedReply: async checkpoint => rpc('register_outbound_message', checkpoint.data.args),
        markReplyMemorySaved: async () => {},
      },
      './catalog-dialogue': {
        ...require('../src/lib/integrations/automation/catalog-dialogue.ts'),
        validateCatalogReply: () => { throw new Error('SERVER_PROSE_VALIDATOR_MUST_NOT_RUN') },
      },
    }
  }
  new Function('require', 'module', 'exports', source)(id => Object.hasOwn(mocks, id) ? mocks[id] : localRequire(id), loaded, loaded.exports)
  return loaded.exports
}

// Reuse only the existing fixture function, never execute or register the large
// integration suite. Explicit boundaries make fixture changes fail visibly.
const integrationSource = fs.readFileSync(path.join(root, 'scripts/integrations.test.cjs'), 'utf8')
const start = integrationSource.indexOf('function conversationHarness(options = {}) {')
const end = integrationSource.indexOf('\nfunction traceRows(', start)
assert.ok(start >= 0 && end > start, 'The integration fixture boundaries must exist')
const oldPolicyFixture = 'return { enabled: options.reviewEnabled !== false, updatedAt: null }'
const harnessSource = integrationSource.slice(start, end)
assert.ok(harnessSource.includes(oldPolicyFixture), 'The inherited review fixture must be adapted explicitly')
const scopedHarnessSource = harnessSource.replace(oldPolicyFixture,
  'return { enabled: options.reviewEnabled !== false, observationOnly: options.reviewObservationOnly === true, updatedAt: null }')
const conversationHarness = new Function('load', 'data', 'scope', 'require',
  `${scopedHarnessSource}; return conversationHarness`)(load, data, scope, require)

function isolatedLive(t) {
  const previousFetch = global.fetch
  global.fetch = async () => { throw new Error('NETWORK_FORBIDDEN_IN_WRITER_AUTHORITY_TEST') }
  t.after(() => { global.fetch = previousFetch })
  for (const [key, value] of Object.entries({
    AUTOMATION_MODE: 'live', AUTOMATION_N8N_DISABLED: 'true', AUTOMATION_ACTIVATED_AT: '2026-01-01T00:00:00Z',
    KOMMO_BASE_URL: 'https://example.invalid', KOMMO_ACCESS_TOKEN: 'synthetic-test-token',
    OPENAI_API_KEY: '',
  })) {
    const previous = process.env[key]
    process.env[key] = value
    t.after(() => previous === undefined ? delete process.env[key] : process.env[key] = previous)
  }
}

for (const mode of ['disabled', 'enabled', 'observation']) {
  test(`processConversation delivers and records the exact writer output in ${mode} review mode`, async t => {
    isolatedLive(t)
    const reply = 'Buenas. El penthouse 605 tiene espacios exteriores entre nueve y veintidós metros cuadrados.\n\n'
      + 'Puede consultar este enlace: https://example.invalid/material. ¿Le gustaría conocer más?'
    const status = mode === 'disabled' ? 'review_disabled' : mode === 'observation' ? 'review_observed' : 'checked'
    let completed = 0
    const harness = conversationHarness({
      reviewEnabled: mode !== 'disabled',
      reviewObservationOnly: mode === 'observation',
      commercialResult: { reply: 'Información preparada para el redactor.', audit: {
        source: 'catalog_search', verified_catalog: true,
        catalog_query: { category: 'suite', operation: 'search', scope: 'catalog' },
        catalog_results: { units: [], unit_ids: [], complete: true },
      } },
      turnComplete: () => {
        completed++
        return { reply, changed: true, needsAdvisor: false, unresolved: [], audit: {
          status,
          review_control: { enabled: mode !== 'disabled', observationOnly: mode === 'observation', source: 'project_setting' },
          server_semantic_validation: false,
          final_validation: { passed: true, policy: 'transport_only', issues: [] },
          transport_validation: { passed: true, policy: 'nonempty_and_length' },
          follow_up: { usable: true, source: 'writer_metadata' },
          semantic_review: { status: mode === 'observation' ? 'rejected' : mode === 'disabled' ? 'disabled' : 'checked',
            authority: 'ai_reviewer' },
          question: { text: '¿Le gustaría conocer más?', continuation_id: 'none', continuation_act: 'other' },
          writer_receipts: { presented_unit_ids: [], brochure_shared: false, price_notice_included: false,
            brand_introduced: true, offered_action: 'information' },
          repair_attempts: [], recovery: { pending: false },
        } }
      },
    })
    harness.rows[0].payload.text = 'Quisiera más información sobre una suite'
    const result = await harness.process([harness.rows[0]], async () => {})
    assert.equal(result.action, 'accepted')
    assert.equal(completed, 1)
    const fieldWrites = harness.calls.filter(call => call.name === 'patch' && call.args[1] === 457014)
    assert.equal(fieldWrites.length, 1)
    assert.equal(fieldWrites[0].args[2], reply)
    const registered = harness.calls.filter(call => call.name === 'register_outbound_message')
    assert.equal(registered.length, 1)
    assert.equal(registered[0].args.p_content, reply)
    assert.equal(registered[0].args.p_tool_calls.turn_completeness.status, status)
    assert.equal(harness.calls.filter(call => call.name === 'launch').length, 1)
    assert.equal(harness.calls.some(call => ['handoff_lead', 'lv_request_reservation_handoff', 'lv_collect_visit_intake',
      'process_financing_message_v3'].includes(call.name)), false)
  })
}
