import assert from 'node:assert/strict'
import test from 'node:test'
import { audienceAllows, audienceBoundary, audienceSourceForEvent, assertAudienceAllows } from './audience-boundary'

const cutoff = '2026-10-16T15:00:00.000Z'
const boundary = { version: 1, mode: 'future_messages', activatedAt: cutoff } as const
const old = '2026-10-16T14:59:59.999Z'
const current = '2026-10-16T15:01:00.000Z'

test('an absent boundary retains legacy behavior, without requiring newly introduced evidence', () => {
  assert.equal(audienceBoundary(undefined), null)
  assert.equal(audienceBoundary(null), null)
  assert.equal(audienceAllows(undefined, undefined), true)
  assert.equal(audienceAllows(null, old, old), true)
  assert.doesNotThrow(() => assertAudienceAllows(undefined, undefined))
})

test('a present malformed policy fails closed, including obsolete versions and incomplete configuration', () => {
  for (const policy of [false, '', 1, [], {}, { ...boundary, version: 2 }, { ...boundary, mode: 'all' },
    { ...boundary, activatedAt: 'invalid' }, { ...boundary, activatedAt: '2026-02-30T12:00:00Z' }]) {
    assert.throws(() => audienceBoundary(policy), /AUDIENCE_BOUNDARY_INVALID/)
    assert.throws(() => audienceAllows(policy, current), /AUDIENCE_BOUNDARY_INVALID/)
    assert.throws(() => assertAudienceAllows(policy, current), /AUDIENCE_BOUNDARY_INVALID/)
  }
  assert.deepEqual(audienceBoundary(boundary), boundary)
})

test('the exact cutover is admitted, earlier actions are excluded, and the contact age is irrelevant', t => {
  t.mock.method(Date, 'now', () => Date.parse(current))
  assert.equal(audienceAllows(boundary, old), false)
  assert.equal(audienceAllows(boundary, cutoff), true)
  assert.equal(audienceAllows(boundary, current), true)
  const oldContactNewMessage = { kind: 'inbound', created_at: '2025-01-01T00:00:00Z', payload: { sentAt: current } }
  assert.equal(audienceAllows(boundary, audienceSourceForEvent(oldContactNewMessage)), true)
  assert.throws(() => assertAudienceAllows(boundary, old), /AUTOMATION_AUDIENCE_EXCLUDED/)
  assert.doesNotThrow(() => assertAudienceAllows(boundary, current))
})

test('ISO instants require a real date and a time zone while equivalent offsets remain accepted', t => {
  t.mock.method(Date, 'now', () => Date.parse(current))
  for (const value of [undefined, null, 1792162800000, '', '2026-10-16', '10/16/2026',
    '2026-10-16T15:00:00', '2026-10-16T24:00:00Z', '2026-10-16T15:60:00Z',
    '2026-10-16T15:00:60Z', '2026-13-16T15:00:00Z', '2026-10-00T15:00:00Z',
    '2026-02-29T15:00:00Z', '2026-10-16T15:00:00+24:00', ' 2026-10-16T15:00:00Z']) {
    assert.equal(audienceAllows(boundary, value), false, String(value))
  }
  assert.equal(audienceAllows(boundary, '2026-10-16T10:00:00-05:00'), true)
  assert.equal(audienceAllows(boundary, '2026-10-16T10:00:00.000000-05:00'), true)
  assert.equal(audienceAllows({ ...boundary, activatedAt: '2024-02-29T00:00:00Z' }, current), true)
})

test('the five-minute source clock allowance includes its boundary but rejects further future dates', t => {
  const now = Date.parse(current)
  t.mock.method(Date, 'now', () => now)
  assert.equal(audienceAllows(boundary, new Date(now + 5 * 60_000).toISOString()), true)
  assert.equal(audienceAllows(boundary, new Date(now + 5 * 60_000 + 1).toISOString()), false)
})

test('a newly scheduled row cannot revive an old source or an old job', t => {
  t.mock.method(Date, 'now', () => Date.parse(current))
  assert.equal(audienceAllows(boundary, old, current), false)
  assert.equal(audienceAllows(boundary, current, old), false)
  assert.equal(audienceAllows(boundary, current, cutoff), true)
  assert.equal(audienceAllows(boundary, current, current), true)
  assert.equal(audienceAllows(boundary, current, undefined), true)
  assert.equal(audienceAllows(boundary, current, null), false)
  assert.equal(audienceAllows(boundary, current, 'invalid'), false)
  assert.throws(() => assertAudienceAllows(boundary, current, old), /AUTOMATION_AUDIENCE_EXCLUDED/)
})

test('inbound and delivery retry evidence uses source sentAt without any scheduling-date fallback', () => {
  for (const kind of ['inbound', 'delivery_retry']) {
    assert.equal(audienceSourceForEvent({ kind, payload: { sentAt: old, anchorAt: current }, received_at: current, available_at: current }), old)
    assert.equal(audienceSourceForEvent({ kind, payload: {}, received_at: current, scheduled_at: current }), undefined)
    assert.equal(audienceSourceForEvent({ kind, payload: { sentAt: 123 } }), undefined)
  }
})

test('all nutrition jobs retain their original customer anchor when retried after activation', t => {
  t.mock.method(Date, 'now', () => Date.parse(current))
  for (const task of ['nutrition_24h', 'nutrition_week_one', 'nutrition_week_two', 'nutrition_week_three']) {
    const job = { kind: 'maintenance', payload: { task, anchorAt: old, sentAt: current }, created_at: current, available_at: current }
    assert.equal(audienceSourceForEvent(job), old)
    assert.equal(audienceAllows(boundary, audienceSourceForEvent(job), job.created_at), false)
    assert.equal(audienceSourceForEvent({ ...job, payload: { task, sentAt: current } }), undefined)
  }
})

test('unsupported jobs and malformed payloads never gain an inferred source date', () => {
  for (const row of [{}, { kind: 'maintenance', payload: { task: 'other', anchorAt: current } },
    { kind: 'advisor_outbound', payload: { sentAt: current } },
    { kind: 'inbound', payload: JSON.stringify({ sentAt: current }) },
    { kind: 'inbound', payload: [{ sentAt: current }] }, { kind: 'inbound', payload: null },
    { kind: 'inbound', payload: { sentAt: '' } }]) {
    assert.equal(audienceSourceForEvent({ ...row, scheduled_at: current, available_at: current }), undefined)
  }
})
