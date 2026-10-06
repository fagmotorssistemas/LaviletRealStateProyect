import assert from 'node:assert/strict'
import test from 'node:test'
import { executionCost, promptCharacters, sumPromptCharacters } from './executionCost'

const call = (model: string, input: number, cached: number, output: number) => ({ key: 'model_request',
  input: { model }, output: { token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: output } } })

test('sums mixed model usage and charges cached input at each model rate', () => {
  const result = executionCost([call('gpt-4.1', 1_000_000, 200_000, 100_000),
    call('gpt-4o-mini', 1_000_000, 200_000, 100_000)])
  assert.equal(result.inputTokens, 2_000_000)
  assert.equal(result.cachedInputTokens, 400_000)
  assert.equal(result.outputTokens, 200_000)
  assert.equal(result.totalTokens, 2_200_000)
  assert.ok(Math.abs(result.estimatedUsd - 2.695) < 1e-10)
  assert.equal(result.complete, true)
  assert.equal(result.priceVersion, '2026-09-29')
})

test('prices GPT-4.1 mini aliases and snapshots independently of GPT-4.1', () => {
  for (const model of ['gpt-4.1-mini', 'gpt-4.1-mini-2025-04-14']) {
    const result = executionCost([call(model, 1_000_000, 200_000, 100_000)])
    assert.equal(result.complete, true)
    assert.ok(Math.abs(result.estimatedUsd - 0.5) < 1e-10)
    assert.equal(result.priceVersion, '2026-09-30')
    assert.deepEqual(result.priceSnapshots, [{ model: 'gpt-4.1-mini', version: '2026-09-30',
      source: 'https://developers.openai.com/api/docs/models/gpt-4.1-mini' }])
  }
  const mixed = executionCost([call('gpt-4.1', 1_000_000, 200_000, 100_000),
    call('gpt-4.1-mini', 1_000_000, 200_000, 100_000)])
  assert.ok(Math.abs(mixed.estimatedUsd - 3) < 1e-10)
  assert.equal(mixed.priceVersion, '2026-09-29 y 2026-09-30')
  assert.equal(mixed.priceSnapshots[0].version, '2026-09-29', 'prior dated rates remain unchanged')
})

test('mini pricing does not silently include unrelated models or incomplete cache usage', () => {
  for (const model of ['gpt-4.1-mini-custom', 'gpt-4.1-nano']) {
    const result = executionCost([call(model, 100, 0, 10)])
    assert.equal(result.complete, false)
    assert.equal(result.pricedCalls, 0)
  }
  const result = executionCost([call('gpt-4.1-mini', 100, 101, 10)])
  assert.equal(result.complete, false)
  assert.equal(result.estimatedUsd, 0)
})

test('GPT-5 mini comparison uses its own current rate without changing another model', () => {
  for (const model of ['gpt-5-mini', 'gpt-5-mini-2025-08-07']) {
    const result = executionCost([call(model, 1_000_000, 200_000, 100_000)])
    assert.equal(result.complete, true)
    assert.ok(Math.abs(result.estimatedUsd - 0.405) < 1e-10)
    assert.deepEqual(result.priceSnapshots, [{ model: 'gpt-5-mini', version: '2026-09-30',
      source: 'https://developers.openai.com/api/docs/models/gpt-5-mini' }])
  }
  assert.equal(executionCost([call('gpt-5', 100, 0, 10)]).complete, false)
})

test('missing usage or unpriced models are flagged instead of shown as a complete bill', () => {
  const result = executionCost([call('gpt-4.1', 100, 0, 10), { key: 'model_request', input: { model: 'new-model' }, output: {} }])
  assert.equal(result.calls, 2)
  assert.equal(result.measuredCalls, 1)
  assert.equal(result.pricedCalls, 1)
  assert.equal(result.complete, false)
})

test('prompt character counts use pre-redaction measurements without changing billed token usage', () => {
  const step = call('gpt-4.1', 100, 0, 10)
  const measured = { ...step, input: { ...step.input, prompt_size: {
    unit: 'characters', instructions: 10000, context: 5000, schema: 900, user_prefix: 30, total: 15930 },
    prompt_snapshot: { instructions: '[dato protegido]', data: '[resumen limitado]', limited: true } } }
  assert.deepEqual(promptCharacters(measured), { instructions: 10000, context: 5000, schema: 900, user_prefix: 30, total: 15930 })
  assert.deepEqual(executionCost([measured]), executionCost([step]))
  assert.deepEqual(promptCharacters(step), { instructions: null, context: null, schema: null, user_prefix: null, total: null })
})

test('character comparisons include rewrites and do not hide missing historical measurements', () => {
  const measured = { key: 'model_request', input: { prompt_size: { unit: 'characters',
    instructions: 120, context: 50, schema: 20, user_prefix: 10, total: 200 } } }
  assert.deepEqual(sumPromptCharacters([measured, measured]), { instructions: 240, context: 100, schema: 40, user_prefix: 20, total: 400 })
  assert.deepEqual(sumPromptCharacters([measured, { key: 'model_request', input: {} }]), {
    instructions: null, context: null, schema: null, user_prefix: null, total: null })
  assert.equal(sumPromptCharacters([{ key: 'catalog_embedding_search', input: {} }]), null)
})

test('invalid or inconsistent character measurements are not converted to a plausible total', () => {
  const step = { key: 'model_request', input: { prompt_size: { unit: 'characters',
    instructions: 0, context: 50, schema: 20, user_prefix: 10, total: 100 } } }
  assert.deepEqual(promptCharacters(step), { instructions: 0, context: 50, schema: 20, user_prefix: 10, total: null })
  assert.equal(promptCharacters({ ...step, input: { prompt_size: { unit: 'tokens', context: 20 } } })?.context, null)
  assert.equal(promptCharacters({ ...step, input: { prompt_size: { unit: 'characters', context: -1 } } })?.context, null)
})
