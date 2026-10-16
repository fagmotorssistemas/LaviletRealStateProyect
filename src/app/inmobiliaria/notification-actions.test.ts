import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { SupabaseClient } from '@supabase/supabase-js'
import * as auth from '@/lib/auth/session'
import * as clients from '@/lib/supabase/admin'
import * as data from '@/lib/integrations/automation/data'
import * as config from '@/lib/integrations/automation/config'
import { recoverReservationNotifications } from './notification-actions'

function setup(t: TestContext, options: { role?: string; loggedOut?: boolean; active?: boolean; access?: boolean; member?: boolean;
  paused?: boolean; testOnly?: boolean; allowed?: string[]; single?: string; rpcError?: string } = {}) {
  const calls: { table: string; filters: Record<string, unknown> }[] = [], repairs: Record<string, unknown>[] = []
  let adminReads = 0
  const role = options.role || 'asesor'
  function from(table: string) {
    const call = { table, filters: {} as Record<string, unknown> }; calls.push(call)
    const result = () => ({ error: null, data: table === 'projects' ? options.access === false ? null : { id: data.scope.project_id }
      : table === 'profiles' ? { role, is_active: options.active !== false }
        : table === 'project_salespeople' ? options.member === false ? null : { id: 'membership' } : null })
    const query = { select: () => query, eq: (key: string, value: unknown) => { call.filters[key] = value; return query },
      match: (value: Record<string, unknown>) => { Object.assign(call.filters, value); return query }, abortSignal: () => query,
      maybeSingle: async () => result() }
    return query
  }
  const client = { from, rpc: (name: string, args: Record<string, unknown>) => {
    repairs.push({ name, ...args })
    return { abortSignal: async () => ({ data: options.rpcError ? null : 1, error: options.rpcError ? { code: options.rpcError } : null }) }
  } } as unknown as SupabaseClient
  t.mock.method(auth, 'getSessionProfile', async () => options.loggedOut ? null : { user: { id: 'owner' }, profile: { role } })
  t.mock.method(auth, 'getSessionUser', async () => ({ supabase: client, user: { id: 'owner' } }))
  t.mock.method(clients, 'createAdminClient', () => { adminReads++; return client })
  t.mock.method(config, 'automationSettings', () => ({ live: true, mode: 'live', testLeadId: options.single || null, globalMaintenance: false, activatedAt: '2020-01-01' }))
  t.mock.method(data, 'autoConfig', async () => ({ enabled: !options.paused, dry_run: false, test_only: options.testOnly || false, test_lead_ids: options.allowed }))
  return { calls, repairs, adminReads: () => adminReads }
}

test('unauthenticated and non-sales accounts cannot trigger recovery', async t => {
  for (const options of [{ loggedOut: true }, { role: 'marketing' }]) {
    const h = setup(t, options)
    assert.deepEqual(await recoverReservationNotifications(), { ok: false, reason: 'forbidden' })
    assert.equal(h.adminReads(), 0)
    assert.equal(h.repairs.length, 0)
  }
})

test('missing project access never enumerates private reservation requests', async t => {
  const h = setup(t, { access: false })
  assert.equal((await recoverReservationNotifications()).reason, 'no_project_access')
  assert.equal(h.adminReads(), 0)
  assert.equal(h.repairs.length, 0)
  assert.deepEqual(h.calls[0].filters, { id: data.scope.project_id, tenant_id: data.scope.tenant_id })
})

test('inactive profiles and advisors outside the project cannot recover alerts', async t => {
  for (const options of [{ active: false }, { member: false }]) {
    const h = setup(t, options)
    await recoverReservationNotifications()
    assert.equal(h.repairs.length, 0)
  }
})

test('an authorized advisor recovers only the fixed project through the idempotent internal RPC', async t => {
  const h = setup(t)
  assert.deepEqual(await recoverReservationNotifications(), { ok: true, processed: 1 })
  assert.deepEqual(h.repairs, [{ name: 'lv_retry_reservation_alerts', p_project_id: data.scope.project_id, p_lead_ids: null }])
  assert.deepEqual(h.calls.find(call => call.table === 'project_salespeople')?.filters,
    { ...data.scope, salesperson_id: 'owner' })
  assert.ok(h.calls.every(call => ['projects', 'profiles', 'project_salespeople'].includes(call.table)))
})

test('test audience and the environment restriction intersect; paused automation performs no recovery', async t => {
  for (const options of [{ paused: true }, { testOnly: true, allowed: [] }, { testOnly: true, allowed: ['other'], single: 'test' }]) {
    const h = setup(t, options)
    assert.equal((await recoverReservationNotifications()).ok, true)
    assert.equal(h.repairs.length, 0)
  }
  const h = setup(t, { testOnly: true, allowed: ['test', 'other'], single: 'test' })
  await recoverReservationNotifications()
  assert.deepEqual(h.repairs[0].p_lead_ids, ['test'])
})

test('a missing migration or failed alert is reported rather than presented as recovered', async t => {
  for (const [code, reason] of [['PGRST202', 'migration_required'], ['23514', 'recovery_failed']]) {
    setup(t, { rpcError: code })
    assert.deepEqual(await recoverReservationNotifications(), { ok: false, reason })
  }
})
