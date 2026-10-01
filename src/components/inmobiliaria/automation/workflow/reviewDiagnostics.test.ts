import test from 'node:test'
import assert from 'node:assert/strict'
import { reviewDiagnostics, reviewReferences, reviewStepRejected } from './reviewDiagnostics'
import { ARCHITECTURE_NODES, nodeState } from './architectureGraph'
import type { WorkflowExecutionStep } from './executionWorkflow'
const step = (output: Record<string, unknown>, input: Record<string, unknown> = {}, key = 'model_request'): WorkflowExecutionStep =>
  ({ order: 20, key, input, output, status: 'succeeded', category: 'ai', label: '', source: '', startedAt: '', completedAt: '', durationMs: 0, errorCode: null })
const review = { claims: [{ verdict: 'supported', fragment: 'S3', evidence_ids: ['E9'] }], factual_values: [], project_values: [],
  numeric_checks: [{ numeric_id: 'N4', classification: 'business_quantity', factual_value_indexes: [0], project_value_indexes: [] }] }

test('supported claim cannot conceal a dangling numeric index; exact fields are identified', () => {
  const item = step({ output_snapshot: { data: review } }, { ai_role: 'reviewer' })
  const issues = reviewDiagnostics(item)
  assert.equal(issues.length, 1)
  assert.equal(issues[0].field, 'numeric_checks[0].factual_value_indexes[0]')
  assert.equal(issues[0].numericId, 'N4')
  assert.deepEqual(issues[0].outputPaths, ['numeric_checks.0.factual_value_indexes.0', 'factual_values'])
  assert.equal(nodeState(ARCHITECTURE_NODES.find(n => n.id === 'reviewer')!, [item]), 'rejected')
  assert.deepEqual(review.claims[0].evidence_ids, ['E9'])
})
test('valid zero-based indexes and abbreviated lists are not marked as missing', () => {
  for (const factual_values of [[{ value: 24, fragment: 'S3' }], '[resumen limitado]']) {
    assert.deepEqual(reviewDiagnostics(step({ output_snapshot: { data: { ...review, factual_values } } })), [])
  }
})
test('output token exhaustion is distinguished from timeout and invalid commercial content', () => {
  const issues = reviewDiagnostics(step({ provider_diagnostics: { incomplete_reason: 'max_output_tokens', output_budget_exhausted: true, configured_max_output_tokens: 3750 } }))
  assert.equal(issues[0].code, 'max_output_tokens')
  assert.match(issues[0].message, /3750/)
  assert.match(issues[0].message, /No es un rechazo del texto/)
})
test('completed coverage with rejected review is visibly rejected; successful repair is historical', () => {
  const issue = { code: 'numeric_binding_not_in_sentence', binding: { key: 'factual_values', index: 0 }, sentence_id: 'S3', numeric_id: 'N4', received: 24, owner: 'system', repair_owner: 'reviewer' }
  const rejected = step({ status: 'rejected_review', repair_attempts: [{ issues: [issue] }], recovery: { pending: true } }, {}, 'response_coverage')
  assert.equal(reviewStepRejected(rejected), true)
  assert.equal(nodeState(ARCHITECTURE_NODES.find(n => n.id === 'coverage')!, [rejected]), 'rejected')
  assert.equal(reviewDiagnostics(rejected)[0].field, 'factual_values[0]')
  const repaired = step({ status: 'checked', repair_attempts: [{ issues: [issue] }] }, {}, 'response_coverage')
  assert.equal(reviewStepRejected(repaired), false)
  assert.equal(nodeState(ARCHITECTURE_NODES.find(n => n.id === 'coverage')!, [repaired]), 'observed')
})
test('reference legend resolves only the evidence saved for this call, retaining original IDs', () => {
  const refs = reviewReferences(step({}, { prompt_snapshot: { data: {
    oraciones_borrador: [{ id: 'S3', text: 'Seguridad 24h.' }],
    contexto_verificado: { instalaciones: [{ amenity_name: 'Sistemas de seguridad 24h' }] },
    evidencia_afirmaciones: [{ id: 'E9', path: 'contexto_verificado.instalaciones.0', value: { ref: 'contexto_verificado.instalaciones.0' } }, { id: 'E10', value: { ref: 'missing.path' } }],
    referencias_numericas: [{ id: 'N4', sentence_id: 'S3', text: '24', value: 24 }],
  } } }))
  assert.deepEqual(refs.sentences, [{ id: 'S3', text: 'Seguridad 24h.' }])
  assert.deepEqual(refs.evidence[0].value, { amenity_name: 'Sistemas de seguridad 24h' })
  assert.match(String(refs.evidence[1].value), /no se conservó/)
  assert.equal(refs.numbers[0].sentenceId, 'S3')
})
