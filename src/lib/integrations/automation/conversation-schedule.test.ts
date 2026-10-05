import assert from 'node:assert/strict'
import { test } from 'node:test'
import { wakeupDecision, shouldStopScheduledWorker } from './conversation-schedule'

test('grouped and rapid replies wait only for their persisted deadline, not a minute boundary', () => {
  const now = Date.parse('2026-10-05T12:00:10Z')
  const pending = { event_id: 'last', due_at: '2026-10-05T12:00:40Z' }
  assert.deepEqual(wakeupDecision(pending,'last',now), { action: 'wait', until: '2026-10-05T12:00:40.000Z' })
  assert.deepEqual(wakeupDecision(pending,'last',now+30000), { action: 'process' })
  assert.deepEqual(wakeupDecision({ ...pending,due_at:new Date(now).toISOString() },'last',now), { action: 'process' })
  assert.deepEqual(wakeupDecision(pending,'older',now), { action: 'stop' })
  assert.deepEqual(wakeupDecision(null,'last',now), { action: 'stop' })
})

test('newest deadline and runtime gates remain authoritative after sleeping', () => {
  assert.equal(wakeupDecision({ event_id:'new',due_at:'2026-10-05T12:01:10Z' },'old',0).action,'stop')
  for (const result of [{ mode:'off' },{ mode:'preview' },{ mode:'live',reason:'database_paused' },{ mode:'live',reason:'kommo_account_blocked' }])
    assert.equal(shouldStopScheduledWorker(result),true)
  assert.equal(shouldStopScheduledWorker({ mode:'live',reason:'worker_busy' }),false)
})
