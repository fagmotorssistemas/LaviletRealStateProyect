import test from 'node:test'
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
import { listAdvisorNotifications, refreshAdvisorNotifications } from './advisorNotifications.service'

test('unread reservation alerts remain reachable beyond the latest ordinary assignments and keep recipient filtering', async () => {
  const requests: Record<string, unknown>[] = []
  const recent = { id: 'new', recipient_id: 'owner', kind: 'lead_assigned', created_at: '2026-10-14' }
  const urgent = { id: 'urgent', recipient_id: 'owner', kind: 'reservation_requested', created_at: '2026-10-01', read_at: null }
  const client = { from: () => {
    const call: Record<string, unknown> = {}; requests.push(call)
    const q = { select: () => q, eq: (key: string, value: unknown) => { call[key] = value; return q },
      in: (_key: string, value: unknown) => { call.kinds = value; return q }, is: (key: string, value: unknown) => { call[key] = value; return q },
      order: () => q, limit: () => q, abortSignal: () => q,
      then: (resolve: (value: unknown) => void) => Promise.resolve({ data: call.kinds ? [urgent] : [recent], error: null }).then(resolve) }
    return q
  } } as unknown as SupabaseClient
  const result = await listAdvisorNotifications(client, 'owner')
  assert.deepEqual(result.map(item => item.id), ['new', 'urgent'])
  assert.ok(requests.every(query => query.recipient_id === 'owner'))
  assert.deepEqual(requests[1].kinds, ['reservation_requested', 'reservation_confirmed'])
  assert.equal(requests[1].read_at, null)
})

test('refresh reads after recovery so an alert created during this refresh is immediately included', async () => {
  let recovered = false
  const alert = { id: 'repaired', created_at: '2026-10-16', kind: 'reservation_requested' }
  const client = { from: () => {
    const q = { select: () => q, eq: () => q, in: () => q, is: () => q, order: () => q, limit: () => q, abortSignal: () => q,
      then: (resolve: (value: unknown) => void) => {
        assert.equal(recovered, true)
        return Promise.resolve({ data: [alert], error: null }).then(resolve)
      } }
    return q
  } } as unknown as SupabaseClient
  const result = await refreshAdvisorNotifications(client, 'owner', async () => { recovered = true; return { ok: true } })
  assert.deepEqual(result.items.map(item => item.id), ['repaired'])
  assert.equal(result.warning, '')
})

test('failed recovery keeps the inbox readable and surfaces the recovery warning', async () => {
  const client = { from: () => {
    const q = { select: () => q, eq: () => q, in: () => q, is: () => q, order: () => q, limit: () => q, abortSignal: () => q,
      then: (resolve: (value: unknown) => void) => Promise.resolve({ data: [{ id: 'existing', created_at: '2026-10-16' }], error: null }).then(resolve) }
    return q
  } } as unknown as SupabaseClient
  for (const recover of [async () => ({ ok: false }), async () => { throw Error('network') }]) {
    const result = await refreshAdvisorNotifications(client, 'owner', recover)
    assert.deepEqual(result.items.map(item => item.id), ['existing'])
    assert.match(result.warning, /alertas de reserva pendientes/)
  }
})
