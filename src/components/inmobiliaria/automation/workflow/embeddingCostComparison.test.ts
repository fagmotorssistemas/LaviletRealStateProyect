import assert from 'node:assert/strict'
import test from 'node:test'
import { executionCost } from './executionCost'
import { callCatalogMode, comparisonCandidates, normalCallEstimate, normalExecutionEstimate } from './embeddingCostComparison'
import type { WorkflowExecution, WorkflowExecutionStep } from './executionWorkflow'

const call = (order: number, input = 10000, cached = 2000): WorkflowExecutionStep => ({ order, key: 'model_request', input: {
  model: 'gpt-4.1', task: 'writing', prompt_snapshot: { data: { contexto_verificado: { catalog_context_scope: { kind: 'semantic_candidates' } } } },
  context_cost_comparison: { version: 'context-size-v1', actual_prompt_characters: 40000, normal_prompt_characters: 80000 },
}, output: { token_usage: { input_tokens: input, cached_input_tokens: cached, output_tokens: 1000 } },
label: 'Redactor', status: 'succeeded', category: 'ai', source: '', startedAt: '', completedAt: '', durationMs: 0, errorCode: null })
const embedding = (applied: boolean, tokens: number): WorkflowExecutionStep => ({ ...call(1), key: 'catalog_embedding_search', input: {},
  output: { model: 'text-embedding-3-small', applied, embedding_input_tokens: tokens } })
const execution = (id: string, steps: WorkflowExecutionStep[]): WorkflowExecution => ({ id, steps, message: 'Busco local con exterior',
  workflowId: 'overview', path: [], status: 'completed', action: '', outcome: '', occurredAt: '2026-10-03T10:00:00Z', leadName: 'Prueba', traceAvailable: true })

test('charges embeddings including paid queries whose retrieval falls back, without double counting cache', () => {
  for (const applied of [true, false]) {
    const result = executionCost([call(2), embedding(applied, 10)])
    assert.equal(result.calls, 2)
    assert.equal(result.totalTokens, 11010)
    assert.equal(result.embeddingTokens, 10)
    assert.ok(Math.abs(result.embeddingUsd - 0.0000002) < 1e-15)
    assert.ok(Math.abs(result.estimatedUsd - 0.0250002) < 1e-10)
    assert.equal(result.complete, true)
  }
  assert.equal(executionCost([embedding(false, 0)]).calls, 0)
  const unknown = embedding(false, 0)
  unknown.output.embedding_requested = true
  unknown.output.embedding_usage_recorded = false
  assert.equal(executionCost([unknown]).complete, false)
  assert.equal(executionCost([unknown]).calls, 1)
})

test('hypothetical size is calibrated to real input and holds output/cache ratio constant, not total cost percentage', () => {
  const result = normalCallEstimate(call(2))!
  assert.equal(result.inputTokens, 20000)
  assert.equal(result.totalTokens, 21000)
  assert.equal(result.cost.cachedInputTokens, 4000)
  assert.equal(result.outputTokens, 1000)
  assert.ok(Math.abs(result.cost.estimatedUsd - 0.042) < 1e-10)
  assert.ok(result.allCachedUsd < result.cost.estimatedUsd)
  assert.ok(result.noCacheUsd > result.cost.estimatedUsd)
  const run = execution('on', [embedding(true, 10), call(2), call(3)])
  assert.equal(normalExecutionEstimate(run)?.totalTokens, 42000)
  assert.equal(normalExecutionEstimate(run)?.changed, 2)
  assert.equal(normalCallEstimate(call(2, 100, 101)), null)
  const unknown = call(3); unknown.output = {}
  assert.equal(normalExecutionEstimate(execution('partial', [embedding(true, 10), call(2), unknown])), null)
})

test('old traces and missing snapshots never fabricate hypothetical savings', () => {
  const old = call(2); delete old.input.context_cost_comparison
  assert.equal(normalCallEstimate(old), null)
  assert.equal(normalExecutionEstimate(execution('old', [embedding(true, 10), old])), null)
  const off = call(3); off.input.prompt_snapshot = { data: { contexto_verificado: {} } }
  assert.equal(callCatalogMode(off), 'Recorrido normal')
  assert.equal(normalExecutionEstimate(execution('off', [off])), null)
})

test('successful retry cannot hide unmeasured usage of a timed-out provider request', () => {
  const step = call(2)
  step.output.request_diagnostics = { attempts: [{ outcome: 'timeout' }, { outcome: 'succeeded' }] }
  const result = executionCost([step])
  assert.equal(result.complete, false)
  assert.equal(result.unmeasuredTransportAttempts, 1)
  assert.equal(result.measuredCalls, 1)
  assert.equal(normalCallEstimate(step), null)
})

test('real comparison excludes same batch and deduplicates its repeated event traces', () => {
  const current = { ...execution('now', [call(2)]), batchId: 'batch-now' }
  const previous = { ...execution('previous', [call(2)]), batchId: 'previous-batch' }
  const duplicate = { ...previous, id: 'duplicate' }
  const sibling = { ...current, id: 'same-execution' }
  const other = { ...execution('different', [call(3)]), message: 'Busco otra cosa' }
  const choices = comparisonCandidates(current, [current, sibling, previous, duplicate, other])
  assert.equal(choices.length, 2)
  assert.equal(choices[0].sameMessage, true)
  assert.equal(choices[1].sameMessage, false)
})
