import test from 'node:test'
import assert from 'node:assert/strict'
import { loadLeadPipelineSources, readPipelinePages, readPipelineRelated } from './leadPipelineSources.service'
import { createClient } from '@supabase/supabase-js'
import * as admin from '@/lib/supabase/admin'
import * as evidence from './marketingEvidence.service'

test('PostgREST page caps do not truncate commercial totals', async () => {
  const rows = Array.from({ length: 1105 }, (_, id) => ({ id }))
  const ranges: number[][] = []
  const result = await readPipelinePages(async (from, to) => {
    ranges.push([from, to])
    return { data: rows.slice(from, to + 1), error: null }
  })
  assert.equal(result.length, 1105)
  assert.deepEqual(ranges, [[0, 999], [1000, 1999]])
})
test('a failed later page cannot masquerade as a complete pipeline', async () => {
  await assert.rejects(readPipelinePages(async from => from === 0
    ? { data: Array.from({ length: 1000 }, (_, id) => ({ id })), error: null }
    : { data: null, error: { message: 'Read failed' } }), /Read failed/)
})
test('scoped relation queries retain all lead IDs across bounded batches and skip empty scopes', async () => {
  const ids = Array.from({ length: 301 }, (_, index) => `lead-${index}`), seen: string[] = []
  const result = await readPipelineRelated(ids, async chunk => {
    assert.ok(chunk.length <= 150)
    seen.push(...chunk)
    return { data: chunk.map(id => ({ id })), error: null }
  })
  assert.deepEqual(seen, ids)
  assert.equal(result.length, ids.length)
  await readPipelineRelated([], () => { throw new Error('An empty authorized scope must not query all rows') })
})

test('server-only reservations are queried only after resolving exact RLS-visible lead IDs', async t => {
  const urls: URL[] = [], serverUrls: URL[] = []
  t.mock.method(evidence, 'readMessageEvidence', async () => ({ rows: [], available: true }))
  const server = createClient('https://server.example', 'service', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async input => {
    const url = new URL(String(input)); serverUrls.push(url)
    assert.equal(url.pathname.split('/').at(-1), 'lead_reservation_requests')
    assert.equal(url.searchParams.get('lead_id'), 'in.(allowed)')
    return Response.json([{ id: 'reservation', lead_id: 'allowed', unit_ids: ['u'], evidence: 'Reservar', source_message_id: 'm' }])
  } } })
  t.mock.method(admin, 'tryCreateAdminClient', () => server)
  let visible = true
  const client = createClient('https://caller.example', 'user', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async input => {
    const url = new URL(String(input)); urls.push(url)
    assert.notEqual(url.pathname.split('/').at(-1), 'lead_reservation_requests', 'The user client cannot read this server-only table.')
    return Response.json(url.pathname.endsWith('/leads') && visible ? [{ id: 'allowed', tenant_id: 'tenant' }] : [])
  } } })
  const result = await loadLeadPipelineSources(client, ['allowed', 'foreign'])
  assert.equal(result.reservations.length, 1)
  assert.equal(result.coverage.reservations, true)
  assert.equal(serverUrls.length, 1)
  visible = false
  await loadLeadPipelineSources(client, ['foreign'])
  assert.equal(serverUrls.length, 1, 'No authorized leads means no privileged reservation query.')
})

test('source errors keep codes and safe diagnoses and disappear after a successful retry', async t => {
  t.mock.method(admin, 'tryCreateAdminClient', () => null)
  t.mock.method(console, 'error', () => {})
  let failing = true
  const client = createClient('https://caller.example', 'user', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async input => {
    const url = new URL(String(input))
    if (url.pathname.endsWith('/leads')) return Response.json([{ id: 'allowed', tenant_id: 'tenant' }])
    if (url.pathname.endsWith('/lead_commercial_profiles') && failing) return Response.json({ code: '42501', message: 'PRIVATE SQL SECRET' }, { status: 403 })
    if (url.pathname.endsWith('/lead_commercial_stage_observations') && failing) return Response.json({ code: 'PGRST205', message: 'Missing table' }, { status: 404 })
    return Response.json([])
  } } })
  const result = await loadLeadPipelineSources(client)
  assert.equal(result.issues.find(issue => issue.source === 'metadata')?.category, 'permission')
  assert.equal(result.issues.find(issue => issue.source === 'history')?.category, 'schema')
  assert.equal(result.issues.find(issue => issue.source === 'reservations')?.category, 'configuration')
  assert.doesNotMatch(JSON.stringify(result.issues), /PRIVATE|SECRET/)
  failing = false
  const recovered = await loadLeadPipelineSources(client)
  assert.equal(recovered.coverage.metadata, true)
  assert.equal(recovered.coverage.history, true)
  assert.equal(recovered.issues.some(issue => issue.source === 'metadata' || issue.source === 'history'), false)
})
