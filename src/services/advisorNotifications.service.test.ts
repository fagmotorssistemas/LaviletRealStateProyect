import test from 'node:test'
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
import { listAdvisorNotifications } from './advisorNotifications.service'

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
