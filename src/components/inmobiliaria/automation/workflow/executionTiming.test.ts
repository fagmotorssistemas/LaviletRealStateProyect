import test from 'node:test'
import assert from 'node:assert/strict'
import { executionTiming, durationLabel } from './executionTiming'
import type { WorkflowExecution } from './executionWorkflow'

const at = (second: number) => new Date(Date.UTC(2026, 9, 4, 20, 0, second)).toISOString()
function execution(overrides: Partial<WorkflowExecution> = {}): WorkflowExecution {
  return { id: 'test', workflowId: 'overview', path: [], status: 'succeeded', action: '', outcome: '',
    occurredAt: at(35), receivedAt: at(0), leadName: 'Test', message: 'Hola', traceAvailable: true,
    steps: [{ order: 1, key: 'response_review', label: '', category: '', status: 'succeeded', source: '',
      startedAt: at(5), completedAt: at(28), durationMs: 23000, input: {}, output: {}, errorCode: null },
    { order: 2, key: 'model_request', label: '', category: '', status: 'succeeded', source: '',
      startedAt: at(6), completedAt: at(20), durationMs: 14000, input: {}, output: {}, errorCode: null },
    { order: 3, key: 'message_delivery', label: '', category: '', status: 'succeeded', source: '',
      startedAt: at(28), completedAt: at(30), durationMs: 2000, input: {}, output: {}, errorCode: null }], ...overrides }
}
test('time to send uses receipt and accepted delivery endpoints without double counting parent and model steps', () => {
  assert.deepEqual(executionTiming(execution()), { responseMs: 30000, elapsedMs: 30000, processingMs: 25000, waitingMs: 5000, sent: true })
})
test('a failed delivery shows elapsed execution time without claiming a response was sent', () => {
  const input = execution(); input.steps[2].status = 'failed'
  assert.deepEqual(executionTiming(input), { responseMs: null, elapsedMs: 35000, processingMs: 30000, waitingMs: 5000, sent: false })
})
test('missing or invalid timestamps are unknown rather than zero or negative time', () => {
  const missing = executionTiming(execution({ receivedAt: undefined, steps: [] }))
  assert.equal(missing.responseMs, null)
  assert.equal(missing.elapsedMs, null)
  assert.equal(missing.processingMs, null)
  assert.equal(executionTiming(execution({ receivedAt: at(40) })).responseMs, null)
  for (const invalid of [null, undefined, NaN, -10]) assert.equal(durationLabel(invalid), 'Sin dato')
  assert.equal(durationLabel(0), '0 ms')
  assert.match(durationLabel(84217), /^1 min 24/)
})
