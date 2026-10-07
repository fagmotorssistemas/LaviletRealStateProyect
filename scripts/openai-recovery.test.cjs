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
const { aiRequestPolicy } = require('../src/lib/integrations/automation/ai-request-policy.ts')
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

test('a timeout while reading the response body is retried and remains a typed generation failure', async () => {
  const timedOutBody = () => ({ ok: true, json: async () => { throw new DOMException('timed out', 'TimeoutError') } })
  const h = requests([timedOutBody(), new Response('{"status":"completed"}')])
  const result = await requestOpenAI('https://api.openai.com/v1/responses', {}, h.dependencies, response => response.json())
  assert.equal(result.status, 'completed')
  assert.equal(h.calls.length, 2)
  assert.deepEqual(h.waits, [750])

  const exhausted = requests([timedOutBody(), timedOutBody(), timedOutBody()])
  await assert.rejects(
    () => requestOpenAI('https://api.openai.com/v1/responses', {}, exhausted.dependencies, response => response.json()),
    error => error instanceof OpenAIRequestError && error.retryable && error.attempts === 3
      && error.message === 'OPENAI_TIMEOUT_RESPONSE_BODY',
  )

  const invalid = requests([{ ok: true, json: async () => { throw new SyntaxError('invalid JSON') } }])
  await assert.rejects(
    () => requestOpenAI('https://api.openai.com/v1/responses', {}, invalid.dependencies, response => response.json()),
    error => error instanceof OpenAIRequestError && !error.retryable && error.attempts === 1
      && error.message === 'OPENAI_INVALID_RESPONSE_BODY',
  )
  assert.equal(invalid.calls.length, 1)
})

test('a scope-classifier outage is propagated instead of blaming the customer message', async () => {
  const scope = load('src/lib/integrations/automation/business-scope.ts', { './ai': { aiJson: async () => { throw new OpenAIRequestError(503, true, 3) } } })
  await assert.rejects(() => scope.classifyBusinessScope('Tiene la distribución?'), OpenAIRequestError)
})

function timedRequests(sequence) {
  const calls = [], timeouts = [], waits = []; let clock = 0
  return { calls, timeouts, waits, dependencies: {
    now: () => clock, random: () => 0,
    sleep: async ms => { waits.push(ms); clock += ms },
    timeoutSignal: ms => { timeouts.push(ms); return new AbortController().signal },
    fetch: async (url, init) => {
      calls.push({ url, init })
      const next = sequence.shift()
      assert.ok(next, 'No additional provider attempt was expected')
      clock += next.elapsed || 0
      if (next.error) throw next.error
      return next.response || new Response('{"status":"completed"}')
    },
  } }
}

test('a review can finish after 45 seconds without a retry; unrelated roles retain their policy', async () => {
  const h = timedRequests([{ elapsed: 52_000 }]); let diagnostic
  const result = await requestOpenAI('https://api.openai.com/v1/responses', {}, h.dependencies, response => response.json(), {
    policy: aiRequestPolicy('reviewer'), onDiagnostics: value => { diagnostic = value },
  })
  assert.equal(result.status, 'completed')
  assert.deepEqual(h.timeouts, [60_000])
  assert.equal(diagnostic.attempts[0].duration_ms, 52_000)
  assert.equal(diagnostic.stop_reason, 'completed')
  for (const role of ['writer', 'scope', 'interpretation', 'media', 'draft']) {
    assert.deepEqual(aiRequestPolicy(role), aiRequestPolicy())
    assert.equal(aiRequestPolicy(role).totalTimeoutMs, 45_000)
  }
})

test('extractor retries with a full 30 second window and never uses a 14 second remainder', async () => {
  const h = timedRequests([{ elapsed: 30_000, error: new DOMException('timeout', 'TimeoutError') }, { elapsed: 20_000 }])
  let diagnostics
  await requestOpenAI('https://api.openai.com/v1/responses', {}, h.dependencies, response => response.json(), {
    policy: aiRequestPolicy('extractor'), onDiagnostics: value => { diagnostics = value },
  })
  assert.deepEqual(h.timeouts, [30_000, 30_000])
  assert.equal(diagnostics.stop_reason, 'completed')
  assert.equal(diagnostics.policy.totalTimeoutMs, 65_000)
  assert.equal(diagnostics.policy.maxAttempts, 2)
  const short = timedRequests([{ elapsed: 30_000, error: new DOMException('timeout', 'TimeoutError') }])
  await assert.rejects(() => requestOpenAI('https://api.openai.com/v1/responses', {}, short.dependencies, response => response.json(), {
    policy: aiRequestPolicy('extractor'), deadlineAt: 45_000,
  }), error => error.diagnostics.stop_reason === 'deadline')
  assert.equal(short.calls.length, 1)
})

test('a newer message detected before the extractor retry stops stale inference', async () => {
  const h = timedRequests([{ elapsed: 30_000, error: new DOMException('timeout', 'TimeoutError') }])
  let checks = 0
  await assert.rejects(() => requestOpenAI('https://api.openai.com/v1/responses', {}, h.dependencies, response => response.json(), {
    policy: aiRequestPolicy('extractor'), beforeAttempt: async () => { if (++checks === 2) throw new Error('NEW_INPUT_PENDING') },
  }), error => error.message === 'AI_REQUEST_GUARD_FAILED')
  assert.equal(h.calls.length, 1)
})

test('review timeout retries the identical request with a full window and renewed lease', async () => {
  const h = timedRequests([{ elapsed: 60_000, error: new DOMException('private prompt', 'TimeoutError') }, { elapsed: 50_000 }])
  let diagnostic, guards = 0
  await requestOpenAI('https://api.openai.com/v1/responses', { method: 'POST', body: '{"draft":"same"}' }, h.dependencies,
    response => response.json(), { policy: aiRequestPolicy('reviewer'), beforeAttempt: async () => { guards++ },
      onDiagnostics: value => { diagnostic = value } })
  assert.deepEqual(h.timeouts, [60_000, 60_000])
  assert.equal(guards, 2)
  assert.equal(h.calls[0].init.body, h.calls[1].init.body)
  assert.deepEqual(diagnostic.attempts.map(a => a.outcome), ['timeout', 'succeeded'])
  assert.equal(diagnostic.total_ms, 110_750)
  assert.doesNotMatch(JSON.stringify(diagnostic), /private prompt|draft|same/)
})

test('two exhausted reviewer attempts retain precise timeout diagnostics', async () => {
  const h = timedRequests(Array.from({ length: 2 }, () => ({ elapsed: 60_000, error: new DOMException('timeout', 'TimeoutError') })))
  await assert.rejects(() => requestOpenAI('https://api.openai.com/v1/responses', {}, h.dependencies, response => response.json(), {
    policy: aiRequestPolicy('reviewer'),
  }), error => {
    assert.equal(error.message, 'OPENAI_TIMEOUT')
    assert.equal(error.attempts, 2)
    assert.equal(error.diagnostics.stop_reason, 'max_attempts')
    assert.equal(error.diagnostics.total_ms, 120_750)
    return true
  })
  assert.deepEqual(h.timeouts, [60_000, 60_000])
})

test('reviewer refuses a short retry window and honors long Retry-After without extra calls', async () => {
  for (const h of [
    timedRequests([{ elapsed: 60_000, error: new DOMException('timeout', 'TimeoutError') }]),
    timedRequests([{ elapsed: 1_000, response: fail(503, '', { 'Retry-After': '120' }) }]),
  ]) {
    await assert.rejects(() => requestOpenAI('https://api.openai.com/v1/responses', {}, h.dependencies, response => response.json(), {
      policy: aiRequestPolicy('reviewer'), deadlineAt: 90_000,
    }), error => error.diagnostics.stop_reason === 'deadline')
    assert.equal(h.calls.length, 1)
    assert.equal(h.waits.length, 0)
  }
})

test('cancellation and a lost worker lease stop inference instead of starting provider recovery', async () => {
  const controller = new AbortController(); controller.abort()
  const h = timedRequests([])
  await assert.rejects(() => requestOpenAI('https://api.openai.com/v1/responses', { signal: controller.signal }, h.dependencies),
    error => error.kind === 'cancelled' && !error.retryable && error.attempts === 0)
  const { AIRequestGuardError } = require('../src/lib/integrations/automation/openai-request.ts')
  await assert.rejects(() => requestOpenAI('https://api.openai.com/v1/responses', {}, h.dependencies, undefined, {
    beforeAttempt: async () => { throw Error('WORKER_LEASE_LOST') },
  }), AIRequestGuardError)
  assert.equal(h.calls.length, 0)
})

test('HTTP failure diagnostics distinguish billing, server errors and response body failures', async () => {
  for (const [response, kind, status] of [[fail(429, 'insufficient_quota'), 'http', 429],
    [{ ok: false, status: 401, headers: new Headers(), json: async () => { throw new DOMException('timeout', 'TimeoutError') } }, 'http', 401],
    [{ ok: true, status: 200, json: async () => { throw new TypeError('private network details') } }, 'network', 0]]) {
    const h = timedRequests([{ response }])
    await assert.rejects(() => requestOpenAI('https://api.openai.com/v1/responses', {}, h.dependencies, res => res.json(), {
      policy: { ...aiRequestPolicy('reviewer'), maxAttempts: 1 },
    }), error => error.kind === kind && error.status === status && error.diagnostics.attempts[0].outcome === kind)
  }
})

function recoveryHarness(options = {}) {
  const data = require('../src/lib/integrations/automation/data.ts'), calls = []
  const lead = { ...data.scope, id: 'lead', kommo_id: 3577404, bot_enabled: !options.paused, tracking_opt_out_at: options.optedOut ? 'yes' : null }
  const conversation = { lead_id: lead.id, summary: structuredClone(options.summary || {}) }
  let stopped = !!options.paused
  function from(table) {
    const filters = {}, q = { select() { return q }, eq(k, v) { filters[k] = v; return q }, match() { return q }, gt() { return q }, in() { return q }, is() { return q }, order() { return q }, limit() { return q },
      update(values) { calls.push({ name: 'update:' + table, values }); if (table === 'leads') Object.assign(lead, values); return q },
      then(resolve) {
        const count = table === 'messages' ? (filters.role === 'bot' ? options.answered : options.human)
          : table === 'lv_outbox' ? options.uncertainOutbox : options.newer
        return Promise.resolve({ error: null, count: count ? 1 : 0, data: table === 'messages' ? options.history || [] : [] }).then(resolve)
      } }
    return q
  }
  const recovery = load('src/lib/integrations/automation/generation-recovery.ts', {
    './config': { assertLive() {}, automationSettings: () => ({ mode: 'live', testLeadId: null }) },
    './data': { ...data, db: () => ({ from }), autoConfig: async () => ({ enabled: true, dry_run: false, test_only: false }),
      one: async table => table === 'leads' ? { ...lead } : structuredClone(conversation),
      rpc: async (name, args) => {
        calls.push({ name, args })
        if (name === 'register_inbound_message') return { lead_id: lead.id, conversation_id: 'conv', is_duplicate: options.newInbound !== true }
        if (name === 'handoff_lead') { if (options.handoffFails) throw Error('HANDOFF_FAILED'); lead.handoff_status = 'queued' }
        if (name === 'register_outbound_message' && options.registrationFails) throw Error('OUTBOUND_LOG_FAILED')
        return {}
      } },
    './kommo': { botStopped: value => value.stopped, getKommoLead: async () => ({ id: 3577404, stopped, _embedded: { contacts: [{ id: 8105914 }] } }),
      getKommoContact: async () => ({ name: 'Pablo', custom_fields_values: [{ field_code: 'PHONE', values: [{ value: '+593000000000' }] }] }),
      setKommoField: async (...args) => { calls.push({ name: 'field', args }); if (args[1] === 451530) stopped = true },
      launchSalesbot: async (...args) => { calls.push({ name: 'send', args }); if (options.launchFails) throw Error('KOMMO_UNAVAILABLE') } },
    './ctwa-lead-store': { preserveCtwaForContact: async () => {} },
  })
  const texts = options.messages || [options.message || 'Tiene una distribución preliminar?']
  const rows = texts.map((text, index) => ({ payload: { externalId: texts.length === 1 ? 'source-message' : 'source-message-' + index,
    kommoId: 3577404, contactId: 8105914, text,
    sentAt: new Date(Date.now() - (options.expired ? 25 * 3600000 : 1000) + index).toISOString(), media: null } }))
  return { ...recovery, calls, conversation, lead, run: () => recovery.recoverGenerationFailure(rows, async () => {}, options.reason || 'OPENAI_HTTP_503') }
}

test('exhausted review creates an actual handoff before the notice and preserves the distinct incident reason', async () => {
  const h = recoveryHarness({ reason: 'RESPONSE_REVIEW_EXHAUSTED' })
  const result = await h.run()
  assert.equal(result.response_review_error, 'RESPONSE_REVIEW_EXHAUSTED')
  assert.equal(result.generation_error, undefined)
  assert.equal(result.delivery_status, 'accepted')
  assert.equal(h.calls.filter(c => c.name === 'send').length, 1)
  assert.ok(h.calls.findIndex(c => c.name === 'handoff_lead') < h.calls.findIndex(c => c.name === 'send'))
  const registered = h.calls.find(c => c.name === 'register_outbound_message').args
  assert.equal(registered.p_model, 'system:review-recovery')
  assert.equal(registered.p_tool_calls.source, 'review_recovery')
  for (const option of ['answered', 'human', 'paused', 'optedOut', 'newer', 'expired']) {
    const paused = recoveryHarness({ reason: 'RESPONSE_REVIEW_EXHAUSTED', [option]: true })
    await paused.run()
    assert.equal(paused.calls.some(c => c.name === 'send'), false, option)
  }
})

test('after exhausted inference the actual advisor queue is recorded before one notice is sent', async () => {
  const h = recoveryHarness()
  const result = await h.run()
  assert.equal(result.delivery_status, 'accepted')
  assert.equal(h.calls.filter(c => c.name === 'send').length, 1)
  assert.ok(h.calls.findIndex(c => c.name === 'handoff_lead') < h.calls.findIndex(c => c.name === 'send'))
  const out = h.calls.find(c => c.name === 'register_outbound_message').args
  assert.match(out.p_content, /Disculpe la demora/)
  assert.equal(out.p_tool_calls.source_message_id, 'source-message')
  assert.ok(h.calls.some(c => c.name === 'update:leads' && c.values.bot_enabled === true))
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

for (const reason of ['RESPONSE_REVIEW_EXHAUSTED', 'OPENAI_HTTP_503']) {
  test(`recovery preserves every client message and prior needs without recording an undelivered proposal (${reason})`, async () => {
    const messages = ['Me llamo Carlos', 'Busco vivienda para mi familia de cinco personas',
      'Mi presupuesto aproximado es 400 mil', 'Me interesa el departamento 504']
    const summary = { _lead_introduction: { request_sent: true, reminder_count: 1, brochure_sent: false },
      _pending_question: { id: 'property_selection', act: 'choose_unit', question: '¿Cuál desea conocer?' },
      _property_context: { offered_ids: ['u502', 'u504'], query: { category: 'departamento', filters: { bedrooms: 3 } } } }
    const h = recoveryHarness({ reason, messages, summary, newInbound: true })
    const result = await h.run()
    assert.equal(result.delivery_status, 'accepted')
    const registered = h.calls.filter(call => call.name === 'register_inbound_message')
    assert.deepEqual(registered.map(call => call.args.p_content), messages)
    assert.deepEqual(registered.map(call => call.args.p_external_message_id), messages.map((_, index) => 'source-message-' + index))
    assert.equal(h.calls.filter(call => call.name === 'update:messages').length, messages.length)
    assert.ok(registered.every(call => h.calls.indexOf(call) < h.calls.findIndex(row => row.name === 'handoff_lead')))
    const handoff = h.calls.find(call => call.name === 'handoff_lead').args.p_reason
    for (const message of messages) assert.ok(handoff.includes(message))
    assert.deepEqual(h.conversation.summary, summary)
    assert.equal(h.calls.some(call => call.name === 'update:conversations'), false)
    assert.equal(h.lead.bot_enabled, true)
    const sent = h.calls.filter(call => call.name === 'register_outbound_message')
    assert.equal(sent.length, 1)
    assert.equal(sent[0].args.p_tool_calls.source_message_id, 'source-message-3')
    assert.doesNotMatch(sent[0].args.p_content, /brochure|504|confirmad|reside|dormitorios/i)
    assert.equal(h.calls.some(call => /process_financing|request_reservation|visit_intake/.test(call.name)), false)
  })
}

test('a superseded recovery still preserves the inbound batch without sending or replacing pending needs', async () => {
  const messages = ['Prefiero no dar mi residencia', 'Quiero conocer departamentos de tres dormitorios']
  const summary = { _lead_introduction: { request_sent: true, reminder_count: 1, collection_status: 'deferred' },
    _pending_question: { id: 'property_bedrooms', act: 'choose_bedrooms', question: '¿Cuántos dormitorios necesita?' } }
  const h = recoveryHarness({ reason: 'RESPONSE_REVIEW_EXHAUSTED', newer: true, messages, summary })
  const result = await h.run()
  assert.equal(result.action, 'superseded_or_paused')
  assert.deepEqual(h.calls.filter(call => call.name === 'register_inbound_message').map(call => call.args.p_content), messages)
  assert.deepEqual(h.conversation.summary, summary)
  assert.equal(h.calls.some(call => ['send', 'handoff_lead', 'update:conversations'].includes(call.name)), false)
})

for (const message of ['Cuál es el precio?', 'Hola, cuál es el precio?', 'Gracias', 'Quiero ver el proyecto']) {
  test('initial recovery has a greeting for any incoming intent: ' + message, async () => {
    const h = recoveryHarness({ message })
    await h.run()
    const out = h.calls.find(call => call.name === 'register_outbound_message').args
    assert.match(out.p_content, /^Hola\. Disculpe la demora/)
    assert.equal(out.p_tool_calls.writer_greeting, 'Hola')
    assert.equal(h.calls.filter(call => call.name === 'send').length, 1)
  })
}

for (const role of ['bot', 'asesor']) test('recovery preserves ongoing conversation without an initial greeting after ' + role, async () => {
  const h = recoveryHarness({ history: [{ role, content: 'Respuesta anterior', sent_at: new Date(Date.now() - 5000).toISOString(),
    tool_calls: { provider_status: 'accepted' } }] })
  await h.run()
  const out = h.calls.find(call => call.name === 'register_outbound_message').args
  assert.match(out.p_content, /^Disculpe la demora/)
  assert.equal(out.p_tool_calls.writer_greeting, '')
})

test('a rejected earlier send does not suppress the first greeting in recovery', async () => {
  const h = recoveryHarness({ history: [{ role: 'bot', content: 'No enviado', sent_at: new Date(Date.now() - 5000).toISOString(),
    tool_calls: { provider_status: 'rejected' } }] })
  await h.run()
  assert.match(h.calls.find(call => call.name === 'register_outbound_message').args.p_content, /^Hola\./)
})
