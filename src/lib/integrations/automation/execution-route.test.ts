import test from 'node:test'
import assert from 'node:assert/strict'
import { executionOutcome, executionRoute } from './execution-route'
import { workflowFromExecution } from '@/components/inmobiliaria/automation/workflow/executionWorkflow'

const step = (order: number, key: string, output: Record<string, unknown> = {}, status = 'succeeded') => ({ order, key, output, status, errorCode: null })

test('observed paths include only actual steps and preserve legacy route_selected compatibility', () => {
  const observed = [step(4, 'message_delivery', { action: 'accepted' }), step(1, 'execution_version', { model: 'test-model' }),
    step(3, 'route_selected', { source: 'minimal_greeting' }), step(2, 'message_received')]
  const result = executionRoute(observed, 'inbound', {}, { action: 'accepted' })
  assert.equal(result.traceSource, 'recorded')
  assert.deepEqual(result.path, ['step-1', 'step-2', 'step-3', 'step-4'])
  assert.ok(!result.path.includes('extractor'))
  assert.equal(result.versions.model, 'test-model')
})

test('dialogue decision and stop reasons come from trace rather than a contradictory legacy result', () => {
  const result = executionRoute([
    step(1, 'message_received'), step(2, 'dialogue_decision', { source: 'financing_question' }),
    step(3, 'message_delivery', { reason: 'NEW_INPUT_PENDING' }, 'paused'),
  ], 'inbound', {}, { source: 'visit_intake' })
  assert.equal(result.workflowId, 'financing')
  assert.equal(result.stopReason, 'NEW_INPUT_PENDING')
})

test('missing trace remains an inference and does not manufacture extraction or a confirmed visit', () => {
  const result = executionRoute([], 'inbound', {}, { action: 'duplicate' })
  assert.equal(result.workflowId, 'overview')
  assert.equal(result.traceSource, 'inferred')
  assert.deepEqual(result.path, ['inbound'])
  assert.deepEqual(result.versions, {})
  assert.equal(executionOutcome('completed', 'accepted'), 'Kommo aceptó el envío')
})

test('workflow nodes show the recorded order and distinguish provider acceptance from delivery', () => {
  const steps = [step(2, 'message_delivery', { action: 'accepted' }), step(1, 'message_received')]
    .map(item => ({ ...item, label: item.key, category: 'output', source: 'conversation.ts', startedAt: '', completedAt: '', durationMs: 0, input: {} }))
  const definition = workflowFromExecution({ id: 'example', workflowId: 'overview', path: [], status: 'completed',
    action: 'accepted', outcome: 'Kommo aceptó el envío', occurredAt: '', leadName: 'Ejemplo', message: '', traceAvailable: true, steps })!
  assert.deepEqual(definition.nodes.map(node => node.id), ['step-1', 'step-2'])
  assert.equal(definition.nodes[1].data.title, 'Aceptación de Kommo')
  assert.match(definition.nodes[1].data.result, /entrega al teléfono sin confirmar/)
  assert.equal(definition.edges.length, 1)
})
