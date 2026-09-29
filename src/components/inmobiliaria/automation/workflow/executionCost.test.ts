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
})

test('missing usage or unpriced models are flagged instead of shown as a complete bill', () => {
  const result = executionCost([call('gpt-4.1', 100, 0, 10), { key: 'model_request', input: { model: 'new-model' }, output: {} }])
  assert.equal(result.calls, 2)
  assert.equal(result.measuredCalls, 1)
  assert.equal(result.pricedCalls, 1)
  assert.equal(result.complete, false)
})
