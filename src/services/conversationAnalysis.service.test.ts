import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as pipeline from './leadPipelineSources.service'
import * as adminModule from '@/lib/supabase/admin'
import { loadConversationAnalysisDashboard } from './conversationAnalysis.service'
import type { AnalysisRow as Row } from '@/types/conversationAnalysis'

test('server-only reads use only RLS-authorized IDs, include cancelled incidents and preserve missing-source coverage', async () => {
  const originalLoad = pipeline.loadLeadPipelineSources, originalAdmin = adminModule.tryCreateAdminClient
  const calls: { table: string; filters: [string, unknown][] }[] = []
  let authorized = false
  const client = { from(table: string) {
    assert.equal(authorized, true, 'authorization precedes every server-only read')
    const call = { table, filters: [] as [string, unknown][] }; calls.push(call)
    const chain = { select() { return chain }, eq(k: string, v: unknown) { call.filters.push([k, v]); return chain },
      in(k: string, v: unknown) { call.filters.push([k, v]); return chain }, or(v: string) { call.filters.push(['or', v]); return chain }, order() { return chain }, range() { return chain },
      then(resolve: (value: unknown) => unknown) {
        if (table === 'lead_conversation_analysis_reviews') return Promise.resolve({ data: null, error: { message: 'missing migration' } }).then(resolve)
        const data = table === 'lv_integration_events' && call.filters.some(([k]) => k === 'or') ? [
          { id: 'cancelled-review', tenant_id: 'tenant', project_id: 'project', contact_key: '123:789', status: 'cancelled', received_at: '2026-10-16T17:00:00Z', result: { requires_review: true, delivery_status: 'not_sent' } },
          { id: 'other-scope', tenant_id: 'other', project_id: 'project', contact_key: '123:789', status: 'cancelled', received_at: '2026-10-16T17:00:00Z', result: { requires_review: true } },
        ] : []
        return Promise.resolve({ data, error: null }).then(resolve)
      } }
    return chain
  } }
  const replace = (o: object, k: string, v: unknown) => Object.assign(o, { [k]: v })
  try {
    replace(pipeline, 'loadLeadPipelineSources', async () => { authorized = true; return { leads: [{ id: 'allowed', tenant_id: 'tenant', project_id: 'project', kommo_id: 123 }],
      conversations: [], events: [], appointments: [], reservations: [], sales: [], metadata: [], units: [], profiles: [], projects: [], messages: [], history: [], warnings: [], issues: [], coverage: { messages: true } } })
    replace(adminModule, 'tryCreateAdminClient', () => client)
    const result = await loadConversationAnalysisDashboard(client as never, { id: 'advisor', role: 'asesor' })
    assert.equal(result.items.length, 1); assert.equal(result.items[0].id, 'allowed'); assert.equal(result.items[0].coverage.reviews, false)
    assert.ok(result.items[0].signals.some(s => s.key === 'incident:cancelled-review'))
    assert.equal(result.items[0].signals.some(s => s.key === 'incident:other-scope'), false)
    assert.ok(calls.some(c => c.filters.some(([key, value]) => key === 'or' && value === 'contact_key.eq.123,contact_key.like.123:%')))
    const analysisRead = calls.find(c => c.table === 'lead_conversation_analyses')!
    assert.deepEqual(analysisRead.filters.find(([key]) => key === 'lead_id')?.[1], ['allowed'])
    for (const call of calls.filter(c => c.table === 'lv_integration_events' && c.filters.some(([k]) => k === 'tenant_id'))) {
      const filters = Object.fromEntries(call.filters) as Row
      assert.equal(filters.tenant_id, 'tenant'); assert.equal(filters.project_id, 'project'); assert.deepEqual(filters.status, ['failed', 'uncertain', 'cancelled'])
    }
  } finally { replace(pipeline, 'loadLeadPipelineSources', originalLoad); replace(adminModule, 'tryCreateAdminClient', originalAdmin) }
})
