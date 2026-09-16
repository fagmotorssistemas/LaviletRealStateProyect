/* eslint-disable @typescript-eslint/no-require-imports */
const test = require('node:test'), assert = require('node:assert/strict')
const fs = require('node:fs'), path = require('node:path'), Module = require('node:module'), ts = require('typescript')
const root = path.resolve(__dirname, '..'), original = Module._load
Module._load = function (id, parent, main) {
  if (id === 'server-only') return {}
  if (id.startsWith('@/')) id = path.join(root, 'src', id.slice(2))
  return original.call(this, id, parent, main)
}
require('./test-typescript.cjs')
function load(file, mocks) {
  const filename = path.join(root, file), mod = { exports: {} }, req = Module.createRequire(filename)
  const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  new Function('require', 'module', 'exports', source)(id => id in mocks ? mocks[id] : req(id), mod, mod.exports)
  return mod.exports
}
const { requestOpenAI, OpenAIRequestError } = require('../src/lib/integrations/automation/openai-request.ts')
function requests(sequence) {
  const calls = [], waits = []; let clock = 0
  return { calls, waits, dependencies: { now: () => clock, random: () => 0, sleep: async ms => { waits.push(ms); clock += ms },
    fetch: async (url, init) => { calls.push({ url, init }); const next = sequence.shift(); if (next instanceof Error) throw next; return next } } }
}
const fail = (status, code, headers) => new Response(JSON.stringify({ error: { code } }), { status, headers })

test('503 retries only the same inference request and succeeds without replaying actions', async () => {
  const h = requests([fail(503), fail(503), new Response('{}')])
  const response = await requestOpenAI('https://api.openai.com/v1/responses', { method: 'POST', body: '{"input":"test"}' }, h.dependencies)
  assert.equal(response.status, 200)
  assert.equal(h.calls.length, 3)
  assert.deepEqual(h.waits, [750, 1500])
  assert.ok(h.calls.every(call => call.init.body === h.calls[0].init.body && call.url.endsWith('/responses')))
})

test('transient failures are bounded, honor Retry-After, and do not retry billing errors', async () => {
  for (const code of [500, 502, 503, 504, 408]) {
    const h = requests([fail(code), fail(code), fail(code)])
    await assert.rejects(() => requestOpenAI('https://api.openai.com/v1/responses', {}, h.dependencies), e => e instanceof OpenAIRequestError && e.attempts === 3 && e.retryable)
  }
  for (const [status, code] of [[401, 'invalid_api_key'], [400, 'invalid_request'], [429, 'insufficient_quota'], [429, 'organization_spend_limit_exceeded'], [402, 'billing']]) {
    const h = requests([fail(status, code)])
    await assert.rejects(() => requestOpenAI('https://api.openai.com/v1/responses', {}, h.dependencies), e => !e.retryable && e.attempts === 1)
    assert.equal(h.waits.length, 0)
  }
  const h = requests([fail(503, '', { 'Retry-After': '2' }), new Response('{}')])
  await requestOpenAI('https://api.openai.com/v1/responses', {}, h.dependencies)
  assert.deepEqual(h.waits, [2000])
  const long = requests([fail(503, '', { 'Retry-After': '120' })])
  await assert.rejects(() => requestOpenAI('https://api.openai.com/v1/responses', {}, long.dependencies), OpenAIRequestError)
  assert.equal(long.calls.length, 1)
  assert.equal(long.waits.length, 0)
})

test('network faults and a genuine rate limit can recover', async () => {
  const h = requests([new TypeError('fetch failed with sensitive body'), fail(429, 'rate_limit_exceeded'), new Response('{}')])
  await requestOpenAI('https://api.openai.com/v1/responses', {}, h.dependencies)
  assert.equal(h.calls.length, 3)
  const broken = requests([new TypeError('secret'), new TypeError('secret'), new TypeError('secret')])
  await assert.rejects(() => requestOpenAI('https://api.openai.com/v1/responses', {}, broken.dependencies), e => e.message === 'OPENAI_NETWORK_ERROR')
})

test('a scope-classifier outage is propagated instead of blaming the customer message', async () => {
  const scope = load('src/lib/integrations/automation/business-scope.ts', { './ai': { aiJson: async () => { throw new OpenAIRequestError(503, true, 3) } } })
  await assert.rejects(() => scope.classifyBusinessScope('Tiene la distribución?'), OpenAIRequestError)
})

function recoveryHarness(options = {}) {
  const data = require('../src/lib/integrations/automation/data.ts'), calls = []
  const lead = { ...data.scope, id: 'lead', kommo_id: 3577404, bot_enabled: !options.paused, tracking_opt_out_at: options.optedOut ? 'yes' : null }
  let stopped = !!options.paused
  function from(table) {
    const filters = {}, q = { select() { return q }, eq(k, v) { filters[k] = v; return q }, match() { return q }, gt() { return q }, in() { return q },
      update(values) { calls.push({ name: 'update:' + table, values }); if (table === 'leads') Object.assign(lead, values); return q },
      then(resolve) {
        const count = table === 'messages' ? (filters.role === 'bot' ? options.answered : options.human)
          : table === 'lv_outbox' ? options.uncertainOutbox : options.newer
        return Promise.resolve({ error: null, count: count ? 1 : 0 }).then(resolve)
      } }
    return q
  }
  const module = load('src/lib/integrations/automation/generation-recovery.ts', {
    './config': { assertLive() {}, automationSettings: () => ({ mode: 'live', testLeadId: null }) },
    './data': { ...data, db: () => ({ from }), autoConfig: async () => ({ enabled: true, dry_run: false, test_only: false }),
      one: async table => table === 'leads' ? { ...lead } : { lead_id: lead.id },
      rpc: async (name, args) => {
        calls.push({ name, args })
        if (name === 'register_inbound_message') return { lead_id: lead.id, conversation_id: 'conv', is_duplicate: true }
        if (name === 'handoff_lead') { if (options.handoffFails) throw Error('HANDOFF_FAILED'); lead.handoff_status = 'queued' }
        if (name === 'register_outbound_message' && options.registrationFails) throw Error('OUTBOUND_LOG_FAILED')
        return {}
      } },
    './kommo': { botStopped: value => value.stopped, getKommoLead: async () => ({ id: 3577404, stopped, _embedded: { contacts: [{ id: 8105914 }] } }),
      getKommoContact: async () => ({ name: 'Pablo', custom_fields_values: [{ field_code: 'PHONE', values: [{ value: '+593000000000' }] }] }),
      setKommoField: async (...args) => { calls.push({ name: 'field', args }); if (args[1] === 451530) stopped = true },
      launchSalesbot: async (...args) => { calls.push({ name: 'send', args }); if (options.launchFails) throw Error('KOMMO_UNAVAILABLE') } },
  })
  const rows = [{ payload: { externalId: 'source-message', kommoId: 3577404, contactId: 8105914, text: options.message || 'Tiene una distribución preliminar?', sentAt: new Date(Date.now() - (options.expired ? 25 * 3600000 : 1000)).toISOString(), media: null } }]
  return { ...module, calls, run: () => module.recoverGenerationFailure(rows, async () => {}, 'OPENAI_HTTP_503') }
}

test('after exhausted inference the actual advisor queue is recorded before one notice is sent', async () => {
  const h = recoveryHarness()
  const result = await h.run()
  assert.equal(result.delivery_status, 'accepted')
  assert.equal(h.calls.filter(c => c.name === 'send').length, 1)
  assert.ok(h.calls.findIndex(c => c.name === 'handoff_lead') < h.calls.findIndex(c => c.name === 'send'))
  const out = h.calls.find(c => c.name === 'register_outbound_message').args
  assert.match(out.p_content, /Disculpe la demora/)
  assert.equal(out.p_tool_calls.source_message_id, 'source-message')
  assert.ok(h.calls.some(c => c.name === 'update:leads' && c.values.bot_enabled === false))
})

test('recovery respects duplicates, humans, stop flags, newer messages and the reply window', async () => {
  for (const option of ['answered', 'human', 'paused', 'optedOut', 'newer', 'expired']) {
    const h = recoveryHarness({ [option]: true })
    await h.run()
    assert.equal(h.calls.some(c => c.name === 'send'), false, option)
    assert.equal(h.calls.some(c => c.name === 'handoff_lead'), false, option)
  }
  const optOut = recoveryHarness({ message: 'No me envíen más mensajes' })
  await optOut.run()
  assert.ok(optOut.calls.some(c => c.name === 'set_tracking_preference'))
  assert.equal(optOut.calls.some(c => c.name === 'send'), false)
})

test('failed queueing cannot promise handoff and uncertain notices are never automatically repeated', async () => {
  for (const [option, uncertain] of [['handoffFails', false], ['uncertainOutbox', false], ['launchFails', true], ['registrationFails', true]]) {
    const h = recoveryHarness({ [option]: true })
    await assert.rejects(h.run, e => e.deliveryUncertain === uncertain)
    assert.equal(h.calls.filter(c => c.name === 'send').length, uncertain ? 1 : 0)
  }
})
