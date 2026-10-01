import assert from 'node:assert/strict'
import test from 'node:test'
import { executionCost } from './executionCost'

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
