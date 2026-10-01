import test from 'node:test'
import assert from 'node:assert/strict'
import { aiOutputBudget, modelResponseDiagnostics } from './ai-output'
import { aiJson } from './ai'
import { AutomationExecutionTrace } from './execution-trace'
import { withAIExecutionTrace } from './ai-execution-trace'
import * as toneSettings from './tone-settings'
import { toneDirection, type ToneSettings } from '@/lib/inmobiliaria/conversationTone'
import { ACTION_INVITATION_RULE, DIRECT_CONVERSATION_RULE } from './direct-conversation-rule'
import { OpenAIRequestError } from './openai-request'

const schema = { properties: { claims: {}, factual_values: {} } }
const input = { respuesta_propuesta: 'Hola. Los valores referenciales van desde $145.000 hasta $550.000 USD, sujetos a cambios. Para compartirle el brochure y brindarle una guía personalizada, ¿podría indicarnos su nombre y en qué ciudad o país reside actualmente?' }

test('failed reviewer call records transport policy and sanitized diagnostics even without a model result', async t => {
  const previousKey = process.env.OPENAI_API_KEY
  process.env.OPENAI_API_KEY = 'synthetic'
  t.after(() => { if (previousKey === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousKey })
  let calls = 0, guards = 0
  t.mock.method(globalThis, 'fetch', async () => {
    calls++
    return new Response(JSON.stringify({ error: { code: 'insufficient_quota', message: 'private provider detail' } }), { status: 429 })
  })
  let stored: Record<string, unknown>[] = []
  const trace = new AutomationExecutionTrace([{ id: '00000000-0000-4000-8000-000000000001' }], {
    persist: async rows => { stored = rows; return { error: null } },
  })
  const focusedSchema = { type: 'object', properties: { review_contract: { enum: ['focused-review-v1'] } } }
  await withAIExecutionTrace(trace, () => assert.rejects(
    () => aiJson('Review facts', {}, focusedSchema, undefined, undefined, undefined, 'review'), OpenAIRequestError,
  ), async () => { guards++ })
  await trace.flush()
  assert.equal(calls, 1)
  assert.equal(guards, 1)
  const request = stored.find(step => step.step_key === 'model_request')!
  const output = request.output_summary as Record<string, unknown>
  const transport = output.request_diagnostics as Record<string, unknown>
  assert.equal(request.error_code, 'OPENAI_HTTP_429_INSUFFICIENT_QUOTA')
  assert.equal((transport.policy as Record<string, unknown>).attemptTimeoutMs, 60_000)
  assert.equal(transport.stop_reason, 'non_retryable')
  assert.equal((transport.attempts as Record<string, unknown>[])[0].http_status, 429)
  assert.equal(output.output_snapshot, undefined)
  assert.equal(output.token_usage, undefined)
  assert.doesNotMatch(JSON.stringify(stored), /private provider detail|Bearer synthetic/)
})

test('review budget follows the current draft and leaves other role budgets unchanged', () => {
  const budget = aiOutputBudget(schema, 'review', input)
  assert.ok(budget > 2200 && budget <= 3500)
  assert.equal(aiOutputBudget(schema, 'review', { ...input, historial: 'x'.repeat(150000), evidencia_turno: { units: Array.from({ length: 200 }, (_, n) => ({ id: `u${n}`, unit_number: `UN${n}`, area_internal_m2: 500 })) } }), budget)
  assert.equal(aiOutputBudget({ properties: { turn_semantics: {} } }, 'data', input), 4200)
  assert.equal(aiOutputBudget(schema, 'writing', input), 2200)
  assert.equal(aiOutputBudget({ properties: { aprobada: {} } }, 'review', input), 2200)
  assert.equal(aiOutputBudget(schema, 'review', {}), 2200)
})

test('collective numeric claims reserve room for each explicit unit and remain bounded', () => {
  const units = Array.from({ length: 10 }, (_, n) => ({ id: `u${n}`, unit_number: `${201 + n}` }))
  const shared = { respuesta_propuesta: `Los departamentos ${units.map(unit => unit.unit_number).join(', ')} tienen 3 dormitorios, 2 baños, 120,83 m² interiores y 27,03 m² exteriores.`, evidencia_turno: { units } }
  const budget = aiOutputBudget(schema, 'review', shared)
  assert.ok(budget >= 8500 && budget <= 12000)
  const compact = aiOutputBudget(schema, 'review', { ...shared, respuesta_propuesta: shared.respuesta_propuesta.replaceAll(', ', ',') })
  assert.ok(compact >= 8500 && Math.abs(compact - budget) <= 250, 'compact unit lists need the same per-unit factual coverage')
  assert.equal(aiOutputBudget(schema, 'review', { ...shared, respuesta_propuesta: shared.respuesta_propuesta.repeat(50) }), 12000)
  // A price sharing a unit-number prefix is not an explicit unit selection.
  assert.equal(aiOutputBudget(schema, 'review', { ...input, evidencia_turno: { units: [{ id: 'u145', unit_number: '145' }, { id: 'u550', unit_number: '550' }] } }), aiOutputBudget(schema, 'review', input))
})

test('focused review reserves bounded output for required numeric checks, obligations and repair resolutions', () => {
  const focused = { properties: { ...schema.properties, review_contract: { enum: ['focused-review-v1'] } } }
  const current = { respuesta_propuesta: 'El departamento 202 cuesta $249.000 USD.',
    referencias_numericas: [{ id: 'N1' }, { id: 'N2' }], obligaciones_aplicables: [{ id: 'scope' }, { id: 'prices' }] }
  const budget = aiOutputBudget(focused, 'review', current)
  assert.equal(budget, 4000)
  assert.ok(budget > aiOutputBudget(focused, 'review', { ...current, referencias_numericas: [] }))
  assert.ok(budget > aiOutputBudget(focused, 'review', { ...current, obligaciones_aplicables: [] }))
  const repair = { ...current, reparacion_revision: { ficha_anterior: { claims: Array.from({ length: 4 }, (_, n) => ({ claim_id: `C${n}` })) } } }
  assert.ok(aiOutputBudget(focused, 'review', repair) > budget)
  assert.equal(aiOutputBudget(focused, 'review', { ...repair,
    historial: 'irrelevant'.repeat(10000), evidencia_turno: { units: Array.from({ length: 200 }, (_, n) => ({ unit_number: `UN${n}` })) } }),
  aiOutputBudget(focused, 'review', repair))
  assert.equal(aiOutputBudget(schema, 'review', current), aiOutputBudget(schema, 'review', { respuesta_propuesta: current.respuesta_propuesta }))
  assert.equal(aiOutputBudget(focused, 'writing', repair), 2200)
  assert.equal(aiOutputBudget(focused, 'review', { ...current, referencias_numericas: Array(1000).fill({}),
    obligaciones_aplicables: Array(1000).fill({}), reparacion_revision: { ficha_anterior: { claims: Array(1000).fill({}) } } }), 12000)
})

test('provider diagnostics distinguish output exhaustion from content filtering and exclude arbitrary data', () => {
  assert.deepEqual(modelResponseDiagnostics({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } }, 3250), {
    response_status: 'incomplete', incomplete_reason: 'max_output_tokens', configured_max_output_tokens: 3250, output_budget_exhausted: true,
  })
  assert.equal(modelResponseDiagnostics({ status: 'incomplete', incomplete_details: { reason: 'content_filter' } }, 3250).output_budget_exhausted, false)
  const diagnostics = modelResponseDiagnostics({ status: 'private-customer-text', incomplete_details: { reason: 'private-provider-text' }, output: [{ text: 'private-partial-output' }] }, 3250)
  assert.equal(diagnostics.response_status, 'unknown')
  assert.equal(diagnostics.incomplete_reason, 'unknown')
  assert.doesNotMatch(JSON.stringify(diagnostics), /private-/)
})

test('incomplete review records the request budget and safe provider reason without exposing partial output', async t => {
  for (const key of ['OPENAI_API_KEY', 'OPENAI_MODEL']) {
    const previous = process.env[key]
    process.env[key] = 'synthetic'
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous })
  }
  let requests = 0, requestBudget = 0
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    requests++
    const body = JSON.parse(String(init?.body))
    requestBudget = body.max_output_tokens
    return new Response(JSON.stringify({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' },
      usage: { input_tokens: 100, output_tokens: requestBudget, total_tokens: 100 + requestBudget },
      output: [{ content: [{ type: 'output_text', text: 'private-partial-output' }] }],
    }), { status: 200 })
  })
  let stored: Record<string, unknown>[] = []
  const trace = new AutomationExecutionTrace([{ id: '00000000-0000-4000-8000-000000000001' }], {
    persist: async rows => { stored = rows; return { error: null } },
  })
  await withAIExecutionTrace(trace, () => assert.rejects(() => aiJson('Review facts', input, schema, undefined, undefined, undefined, 'review'), { message: 'OPENAI_INCOMPLETE' }))
  await trace.flush()
  assert.equal(requests, 1)
  assert.equal(requestBudget, aiOutputBudget(schema, 'review', input))
  const request = stored.find(step => step.step_key === 'model_request')!
  assert.equal(request.error_code, 'OPENAI_INCOMPLETE')
  assert.equal((request.input_summary as Record<string, unknown>).configured_max_output_tokens, requestBudget)
  const output = request.output_summary as Record<string, unknown>
  assert.deepEqual(output.provider_diagnostics, {
    response_status: 'incomplete', incomplete_reason: 'max_output_tokens', configured_max_output_tokens: requestBudget, output_budget_exhausted: true,
  })
  assert.equal((output.token_usage as Record<string, unknown>).output_tokens, requestBudget)
  assert.doesNotMatch(JSON.stringify(stored), /private-partial-output/)
})

test('focused factual reviewer bypasses tone lookup and sends only its review contract', async t => {
  for (const key of ['OPENAI_API_KEY', 'OPENAI_MODEL']) {
    const previous = process.env[key]
    process.env[key] = 'synthetic'
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous })
  }
  const toneLookup = t.mock.method(toneSettings, 'configuredToneInstructions', async () => {
    throw new Error('TONE_LOOKUP_MUST_NOT_RUN_FOR_FOCUSED_REVIEW')
  })
  const sent: Record<string, unknown>[] = []
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    assert.equal(url, 'https://api.openai.com/v1/responses', 'no database/tone request is permitted')
    sent.push(JSON.parse(String(init?.body)))
    return new Response(JSON.stringify({ status: 'completed', output: [{ content: [{ type: 'output_text', text: '{"ok":true}' }] }] }), { status: 200 })
  })
  const focused = { properties: { review_contract: { type: 'string', enum: ['focused-review-v1'] }, claims: {}, factual_values: {} } }
  const rules = 'Revise hechos y obligaciones. No evalúe estilo, cortesía ni preguntas opcionales.'
  await aiJson(rules, input, focused, undefined, undefined, undefined, 'review')
  await aiJson(rules, input, focused, undefined, undefined, { style: 'elegante', warmth: 2, detail: 2 }, 'review')
  assert.equal(toneLookup.mock.callCount(), 0, 'bypasses the entire path that reads database tone settings')
  assert.equal(sent.length, 2)
  for (const request of sent) {
    assert.ok(String(request.instructions).startsWith(rules))
    assert.ok(!String(request.instructions).includes(ACTION_INVITATION_RULE))
    assert.ok(!String(request.instructions).includes(DIRECT_CONVERSATION_RULE))
    assert.match(String(request.instructions), /No invente acciones ni hechos/)
  }
})

test('writer and legacy reviewer retain configured tone while the new reviewer does not inherit it', async t => {
  for (const key of ['OPENAI_API_KEY', 'OPENAI_MODEL']) {
    const previous = process.env[key]
    process.env[key] = 'synthetic'
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous })
  }
  const sent: Record<string, unknown>[] = []
  t.mock.method(globalThis, 'fetch', async (_url: unknown, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)))
    return new Response(JSON.stringify({ status: 'completed', output: [{ content: [{ type: 'output_text', text: '{"ok":true}' }] }] }), { status: 200 })
  })
  const settings: ToneSettings = { style: 'elegante', warmth: 2, detail: 2 }
  const focused = { properties: { review_contract: { type: 'string', enum: ['focused-review-v1'] }, claims: {}, factual_values: {} } }
  for (const [candidate, task] of [[schema, 'writing'], [schema, 'review'], [focused, 'review']] as const)
    await aiJson('Base de la tarea.', input, candidate, undefined, undefined, settings, task)
  for (const request of sent.slice(0, 2)) {
    assert.ok(String(request.instructions).includes(toneDirection(settings)))
    assert.ok(String(request.instructions).includes(ACTION_INVITATION_RULE))
    assert.ok(String(request.instructions).includes(DIRECT_CONVERSATION_RULE))
  }
  assert.ok(!String(sent[2].instructions).includes(toneDirection(settings)))
  assert.ok(!String(sent[2].instructions).includes(ACTION_INVITATION_RULE))
})

test('GPT-5 mini reviewer sends low reasoning and traces effort and reasoning usage without enlarging output budget', async t => {
  for (const key of ['OPENAI_API_KEY', 'OPENAI_MODEL', 'OPENAI_MODEL_REVIEWER', 'OPENAI_REVIEW_REASONING_EFFORT']) {
    const previous = process.env[key]
    if (key === 'OPENAI_API_KEY') process.env[key] = 'synthetic'
    else if (key === 'OPENAI_MODEL') process.env[key] = 'gpt-4.1'
    else delete process.env[key]
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous })
  }
  const sent: Record<string, unknown>[] = []
  t.mock.method(globalThis, 'fetch', async (url: unknown, init?: RequestInit) => {
    assert.equal(url, 'https://api.openai.com/v1/responses')
    sent.push(JSON.parse(String(init?.body)))
    return new Response(JSON.stringify({ status: 'completed', usage: { input_tokens: 300, output_tokens: 400,
      total_tokens: 700, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 256 } },
    output: [{ content: [{ type: 'output_text', text: '{"ok":true}' }] }] }), { status: 200 })
  })
  let stored: Record<string, unknown>[] = []
  const trace = new AutomationExecutionTrace([{ id: '00000000-0000-4000-8000-000000000002' }], {
    persist: async rows => { stored = rows; return { error: null } },
  })
  const focused = { properties: { review_contract: { type: 'string', enum: ['focused-review-v1'] }, claims: {}, factual_values: {} } }
  await withAIExecutionTrace(trace, () => aiJson('Review facts', input, focused, undefined, undefined, undefined, 'review'))
  await trace.flush()
  assert.equal(sent[0].model, 'gpt-5-mini')
  assert.deepEqual(sent[0].reasoning, { effort: 'low' })
  assert.equal(sent[0].max_output_tokens, aiOutputBudget(focused, 'review', input))
  const step = stored.find(row => row.step_key === 'model_request')!
  assert.equal((step.input_summary as Record<string, unknown>).reasoning_effort, 'low')
  assert.equal((step.output_summary as Record<string, unknown>).reasoning_effort, 'low')
  const usage = (step.output_summary as Record<string, unknown>).token_usage as Record<string, unknown>
  assert.equal(usage.reasoning_tokens, 256)
  assert.equal(usage.output_tokens, 400, 'Reasoning tokens are already included in output tokens, not billed twice')

  process.env.OPENAI_MODEL_REVIEWER = 'gpt-4o-mini'
  process.env.OPENAI_REVIEW_REASONING_EFFORT = 'high'
  await aiJson('Review facts', input, focused, undefined, undefined, undefined, 'review')
  assert.equal(sent[1].model, 'gpt-4o-mini')
  assert.equal(sent[1].reasoning, undefined, 'Model rollback must not send unsupported reasoning options')
  await aiJson('Write reply', {}, undefined, undefined, undefined, { style: 'actual', warmth: 1, detail: 1 }, 'writing')
  assert.equal(sent[2].model, 'gpt-4.1')
  assert.equal(sent[2].reasoning, undefined, 'Reviewer reasoning settings cannot change writer requests')
})
