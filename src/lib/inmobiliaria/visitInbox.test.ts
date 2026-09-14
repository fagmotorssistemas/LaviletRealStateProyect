import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { VisitInboxItem } from '@/types/inmobiliaria'
import { prioritizeVisitInbox, visitIsOverdue, visitWaitLabel, visitUrgencyKey } from './visitInbox'

const now = Date.parse('2026-09-12T16:00:00Z')
const request = (id: string, status: string, created_at: string, escalation_due_at: string | null = null) => ({ id, status, created_at, escalation_due_at }) as VisitInboxItem
test('advisor requests come before client waits, with expired deadlines first', () => {
  const rows = [
    request('waiting', 'awaiting_client', '2026-09-10T10:00:00Z', '2026-09-10T11:00:00Z'),
    request('new', 'awaiting_advisor', '2026-09-12T15:50:00Z'),
    request('old', 'awaiting_advisor', '2026-09-12T14:00:00Z'),
    request('overdue', 'awaiting_advisor', '2026-09-12T15:00:00Z', '2026-09-12T15:30:00Z'),
  ]
  assert.deepEqual(prioritizeVisitInbox(rows, now).map(row => row.id), ['overdue', 'old', 'new', 'waiting'])
  assert.equal(rows[0].id, 'waiting', 'must not mutate the shared data')
  assert.equal(visitIsOverdue(rows[0], now), false)
})
test('an absent or future deadline is not labeled overdue', () => {
  assert.equal(visitIsOverdue(request('a', 'awaiting_advisor', '2026-09-10T10:00:00Z'), now), false)
  assert.equal(visitIsOverdue(request('b', 'awaiting_advisor', '2026-09-10T10:00:00Z', '2026-09-12T17:00:00Z'), now), false)
})
test('waiting time is readable without negative durations', () => {
  assert.equal(visitWaitLabel('2026-09-12T15:42:00Z', now), 'Hace 18 min')
  assert.equal(visitWaitLabel('2026-09-12T14:42:00Z', now), 'Hace 1 h')
  assert.equal(visitWaitLabel('2026-09-12T16:01:00Z', now), 'Hace un momento')
})

test('a rejected set of alternatives takes priority and can notify for an existing request ID', () => {
  const waiting = request('same-request', 'awaiting_client', '2026-09-12T14:00:00Z')
  const urgent = { ...waiting, status: 'awaiting_advisor' as const, coordination_urgent_at: '2026-09-12T15:59:00Z' }
  assert.equal(visitUrgencyKey(waiting), null)
  assert.equal(visitUrgencyKey(urgent), 'same-request:2026-09-12T15:59:00Z')
  assert.equal(visitUrgencyKey({ ...urgent, updated_at: '2026-09-12T16:01:00Z' }), visitUrgencyKey(urgent), 'polling must not issue duplicate alerts')
  const overdue = request('old-overdue', 'awaiting_advisor', '2026-09-10T10:00:00Z', '2026-09-11T10:00:00Z')
  assert.deepEqual(prioritizeVisitInbox([overdue, urgent], now).map(row => row.id), ['same-request', 'old-overdue'])
  assert.equal(visitUrgencyKey({ ...urgent, status: 'confirmed' }), null)
})
