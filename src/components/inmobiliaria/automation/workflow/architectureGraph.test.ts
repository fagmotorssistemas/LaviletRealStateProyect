import test from 'node:test'
import assert from 'node:assert/strict'
import { ARCHITECTURE_NODES as nodes, ARCHITECTURE_LINKS as links, nodeEvidence, nodeState, linkObserved } from './architectureGraph'
import type { WorkflowExecutionStep } from './executionWorkflow'
const node = (id: string) => nodes.find(n => n.id === id)!
const step = (key: string, output: Record<string, unknown> = {}, input: Record<string, unknown> = {}, order = 1, status = 'succeeded'): WorkflowExecutionStep =>
  ({ key, output, input, order, status, label: key, category: 'decision', source: 'fixture', startedAt: '', completedAt: '', durationMs: 0, errorCode: null })

test('all functional branches have unique nodes and resolvable connections', () => {
  assert.equal(new Set(nodes.map(n => n.id)).size, nodes.length)
  for (const link of links) { assert.ok(node(link.from), link.from); assert.ok(node(link.to), link.to) }
  assert.ok(nodes.every(n => n.title && n.description && n.owner && n.source))
})
test('price objective does not prove a price was found, a writer ran or delivery happened', () => {
  const steps = [step('turn_intent', { objective: 'ask_price', needs_reference: true })]
  assert.equal(nodeState(node('intent_ask_price'), steps), 'observed')
  assert.equal(nodeState(node('intent_discuss_budget'), steps), 'not_selected')
  assert.equal(nodeState(node('reference_missing'), steps), 'observed')
  for (const id of ['catalog', 'writer', 'reviewer', 'delivery']) assert.equal(nodeState(node(id), steps), 'unknown')
  assert.equal(linkObserved({ from: 'intent', to: 'intent_ask_price' }, steps), true)
})
test('missing, abbreviated and failed decisions never imply a branch was skipped', () => {
  for (const steps of [[], [step('turn_intent', {})], [step('turn_intent', { objective: '[resumen limitado]' })], [step('turn_intent', { objective: 'ask_price' }, {}, 1, 'failed')]]) {
    assert.equal(nodeState(node('intent_ask_price'), steps), 'unknown')
    assert.equal(nodeState(node('intent_discuss_budget'), steps), 'unknown')
  }
})
test('a directly resolved scope is not a classifier call; paused reason is explicit evidence', () => {
  assert.equal(nodeState(node('scope_property'), [step('scope_classification', { scope: 'property' })]), 'observed')
  assert.equal(nodeState(node('scope_ai'), [step('scope_classification', { scope: 'property' })]), 'unknown')
  const steps = [step('response_permission', { reason: 'MANUAL_STOP' }, {}, 1, 'paused')]
  assert.equal(nodeState(node('permission_MANUAL_STOP'), steps), 'paused')
  assert.equal(nodeState(node('permission_OPT_OUT'), steps), 'not_selected')
})
test('two observed agents do not prove a causal edge; every retry remains accessible', () => {
  const steps = [step('model_request', {}, { ai_role: 'writer' }, 2), step('model_request', {}, { ai_role: 'reviewer' }, 3), step('model_request', {}, { ai_role: 'writer' }, 4)]
  assert.equal(linkObserved({ from: 'writer', to: 'reviewer' }, steps), false)
  assert.deepEqual(nodeEvidence(node('writer'), steps).map(s => s.order), [2, 4])
  steps[1].input.caused_by_step = 2
  assert.equal(linkObserved({ from: 'writer', to: 'reviewer' }, steps), true)
})
test('recovery is read from its structured result, never inferred from an error string', () => {
  assert.equal(nodeState(node('review_recovery'), [step('response_coverage', { recovery: { pending: true } })]), 'rejected')
  assert.equal(nodeState(node('review_recovery'), [step('response_coverage', { issues: ['invalid_review_metadata'] })]), 'unknown')
  const steps = [step('response_coverage', { repair_attempts: [{ target: 'review_metadata' }] })]
  assert.equal(nodeEvidence(node('repair_metadata'), steps).length, 1)
  assert.equal(nodeEvidence(node('repair_draft'), steps).length, 0)
})
test('budget decision distinguishes incomplete evidence from verified unaffordability', () => {
  const steps = [step('budget_resolution', { status: 'incomplete_prices' })]
  assert.equal(nodeState(node('budget_incomplete_prices'), steps), 'observed')
  assert.equal(nodeState(node('budget_below_available_prices'), steps), 'not_selected')
  assert.equal(nodeState(node('budget_incomplete_prices'), []), 'unknown')
})
