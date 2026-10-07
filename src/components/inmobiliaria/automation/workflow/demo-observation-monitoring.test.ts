import test from 'node:test'
import assert from 'node:assert/strict'
import { isObservedReview, reviewDecision } from './reviewDecision'
import { explainStep } from './messageExplanation'
import { ARCHITECTURE_NODES, nodeState, linkObserved } from './architectureGraph'
import type { WorkflowExecution, WorkflowExecutionStep } from './executionWorkflow'

const observed = {
  status: 'review_observed', review_control: { enabled: true, observationOnly: true, source: 'project_setting' },
  observation: { status: 'rejected_review', enforcement: false },
  final_validation: { passed: false, policy: 'observation_only', issues: ['catalog_value_mismatch'] },
  semantic_review: { status: 'rejected', review_contract: 'focused-review-v1', validation_details: [
    { code: 'catalog_value_mismatch', kind: 'catalog_data', field: 'bedrooms', unit_id: 'u-202', received: 5, expected: 3, fragment: 'cinco dormitorios' },
  ] }, issues: ['catalog_value_mismatch'], final_preview: 'Borrador para demostrar', proposed_preview: 'Borrador para demostrar',
  repair_attempts: [], recovery: { pending: false },
}
const step = (order: number, key: string, output: Record<string, unknown>, input: Record<string, unknown> = {}): WorkflowExecutionStep =>
  ({ order, key, output, input, label: key, category: 'decision', status: 'succeeded', source: 'fixture', startedAt: '', completedAt: '', durationMs: 0, errorCode: null })
const execution = (steps: WorkflowExecutionStep[]): WorkflowExecution =>
  ({ id: 'fixture', workflowId: 'overview', path: [], status: 'completed', action: 'accepted', outcome: '', occurredAt: '', leadName: 'Prueba', message: '', traceAvailable: true, steps })
const node = (id: string) => ARCHITECTURE_NODES.find(item => item.id === id)!

test('observation displays rejected review evidence without reporting draft approval or replacement', () => {
  const decision = reviewDecision(observed)
  assert.equal(isObservedReview(observed), true)
  assert.equal(decision.tone, 'metadata')
  assert.match(decision.title, /demostración.*sin bloqueo/i)
  assert.match(decision.details.join(' '), /dormitorios recibido: 5; catálogo: 3/)
  assert.match(decision.explanation, /no certifica.*aprobado/)
  assert.match(decision.explanation, /Envío a Kommo/)
  assert.match(decision.explanation, /interpretación, la planificación y la ruta mantienen sus controles/)
  assert.doesNotMatch(decision.title, /aprobada|descartada/)
  assert.equal(decision.recoveryPending, false)
})

test('failed monitoring remains visible while observation does not claim a review succeeded', () => {
  const decision = reviewDecision({ ...observed, observation: { status: 'unavailable', error: 'REVIEW_TIMEOUT' },
    semantic_review: { status: 'unavailable', error_code: 'REVIEW_TIMEOUT' }, issues: [] })
  assert.match(decision.causes.join(' '), /REVIEW_TIMEOUT/)
  assert.doesNotMatch(decision.title, /aprobada/)
})

test('demonstration state must be recorded by the server policy, never inferred from its status label', () => {
  for (const control of [{}, { observationOnly: true }, { source: 'project_setting' }, { source: 'lead_message', observationOnly: true }]) {
    const output = { ...observed, review_control: control }
    assert.equal(isObservedReview(output), false)
    assert.doesNotMatch(reviewDecision(output).title, /Modo demostración/)
    assert.equal(nodeState(node('review_observed'), [step(1, 'response_coverage', output)]), 'unknown')
  }
})

test('coverage explanation preserves the actual proposed draft and separates permission from approval', () => {
  const item = step(1, 'response_coverage', observed)
  const explanation = explainStep(execution([item]), item)
  assert.match(explanation.summary, /permitió el borrador sin exigir aprobación/)
  const sections = explanation.coverageSections!
  const facts = sections.flatMap(section => section.facts)
  assert.equal(facts.find(item => item.label === 'Respuesta conservada')?.value, 'Borrador para demostrar')
  assert.match(facts.find(item => item.label === 'Decisión conjunta')!.value, /observaciones.*no bloqueó/)
  assert.match(facts.find(item => item.label === 'Alcance de la revisión')!.value, /no se usan para bloquear/)
  assert.doesNotMatch(facts.find(item => item.label === 'Decisión conjunta')!.value, /controles.*aprobados/)
})

test('observation branch records monitoring only; delivery still needs an actual provider step', () => {
  const steps = [step(4, 'response_coverage', observed)]
  assert.equal(nodeState(node('review_observed'), steps), 'observed')
  assert.equal(nodeState(node('review_checked'), steps), 'not_selected')
  assert.equal(nodeState(node('review_recovery'), steps), 'not_selected')
  assert.equal(nodeState(node('coverage'), steps), 'observed')
  assert.equal(nodeState(node('delivery'), steps), 'unknown')
  assert.equal(linkObserved({ from: 'coverage', to: 'review_observed' }, steps), true)
  assert.equal(linkObserved({ from: 'review_observed', to: 'route_selected' }, steps), false)
  steps.push(step(5, 'route_selected', { decision: { caused_by_step: 4 } }))
  assert.equal(linkObserved({ from: 'review_observed', to: 'route_selected' }, steps), true)
})

test('legacy observed source failures remain readable without claiming current extractor bypass', () => {
  for (const issue of ['non_current_evidence:property', 'non_current_evidence:requests.0']) {
    const item = step(1, 'semantic_extraction', { interpretation_recovery: {
      status: 'observed_degraded', observation_only: true, issues: [issue], actions_allowed: false,
    } })
    const explanation = explainStep(execution([item]), item)
    assert.match(explanation.summary, /interpretación limitada/)
    const section = explanation.coverageSections![0]
    assert.match(section.title, /Registro histórico/)
    assert.match(section.description, /demostración actual.*solo evita bloqueos por la revisión del borrador/)
    assert.match(section.description, /no cambia la validación del extractor/)
    assert.match(section.facts.find(item => item.label === issue)!.value, /Por ejemplo/)
    assert.match(section.facts.find(item => item.label === 'Permiso para trámites')!.value, /no autoriza reservas, citas, financiamiento/)
    assert.doesNotMatch(section.description, /asesor.*asignado|reserva.*confirmada/)
  }
})

test('historical or unverified extraction results never imply observation mode', () => {
  for (const recovery of [{ status: 'observed_degraded' }, { observation_only: true }, { status: 'recovered', observation_only: true }]) {
    const item = step(1, 'interpretation_recovery', recovery)
    const explanation = explainStep(execution([item]), item)
    assert.equal(explanation.coverageSections, null)
    assert.doesNotMatch(explanation.summary, /demostración continuó/)
  }
})


test('actual guard results in final_validation remain visible even without the legacy issues list', () => {
  const output = { ...observed, issues: undefined, observation: { status: 'rejected_guard', enforcement: false },
    semantic_review: { status: 'checked' }, final_validation: { passed: false, policy: 'observation_only', issues: ['unauthorized_link'] } }
  const decision = reviewDecision(output)
  assert.match(decision.causes.join(' '), /enlace.*no está autorizado/)
  const item = step(1, 'response_coverage', output)
  const facts = explainStep(execution([item]), item).coverageSections!.flatMap(section => section.facts)
  assert.match(facts.find(item => item.label === 'Controles registrados')!.value, /enlace.*no está autorizado/)
})
