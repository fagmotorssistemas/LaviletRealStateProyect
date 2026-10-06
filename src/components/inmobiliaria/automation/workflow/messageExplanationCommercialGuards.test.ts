import assert from 'node:assert/strict'
import test from 'node:test'
import { explainStep } from './messageExplanation'
import { reviewDecision } from './reviewDecision'
import type { WorkflowExecution, WorkflowExecutionStep } from './executionWorkflow'

for (const output of [
  { status: 'review_disabled', review_control: { enabled: false }, independent_review: false,
    semantic_review: { status: 'disabled' }, final_validation: { policy: 'transport_only', passed: true, issues: [] } },
  { status: 'checked', semantic_review: { status: 'disabled' }, final_validation: { policy: 'transport_only', passed: true, issues: [] } },
  { status: 'checked', final_validation: { policy: 'transport_only', passed: true, issues: [] } },
]) {
  test(`UI does not certify content from disabled review or transport-only validation: ${JSON.stringify(output)}`, () => {
    const item: WorkflowExecutionStep = { order: 1, key: 'response_coverage', label: 'Revisión de la respuesta', category: 'decision',
      status: 'succeeded', source: 'test', startedAt: '', completedAt: '', durationMs: 1, errorCode: null, input: {},
      output: { ...output, final_preview: 'Respuesta conservada del redactor.' } }
    const execution: WorkflowExecution = { id: 'test-event', workflowId: 'overview', path: [], status: 'completed', action: 'accepted',
      outcome: 'Kommo aceptó el envío', occurredAt: '', leadName: 'Consulta', message: 'Consulta', traceAvailable: true, steps: [item] }
    const decision = reviewDecision(item.output)
    assert.notEqual(decision.tone, 'accepted', 'A passed transport check does not approve commercial content.')
    assert.doesNotMatch(decision.title, /propuesta aprobada/i)
    const explanation = explainStep(execution, item)
    const sections = explanation.coverageSections!
    const selected = sections.find(section => section.title === 'Respuesta elegida en este paso')!
    const selectedText = selected.facts.find(fact => fact.label === 'Qué ocurrió')!.value
    assert.match(selectedText, /no aprobó|sin revisión|no se revis|desactivada/i)
    assert.doesNotMatch(selectedText, /superó la revisión/i)
    const controls = sections.find(section => section.title === 'Controles de validación')!
    const transport = controls.facts.find(fact => fact.label === 'Decisión conjunta')!.value
    assert.match(transport, /no se revisaron hechos ni continuidad/i)
  })
}
