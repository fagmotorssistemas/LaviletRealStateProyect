import test from 'node:test'
import assert from 'node:assert/strict'
import { aiOutputBudget, modelResponseDiagnostics } from './ai-output'
import { aiJson } from './ai'
import { AutomationExecutionTrace } from './execution-trace'
import { withAIExecutionTrace } from './ai-execution-trace'

const schema = { properties: { claims: {}, factual_values: {} } }
const input = { respuesta_propuesta: 'Hola. Los valores referenciales van desde $145.000 hasta $550.000 USD, sujetos a cambios. Para compartirle el brochure y brindarle una guía personalizada, ¿podría indicarnos su nombre y en qué ciudad o país reside actualmente?' }

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
