import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import * as pipelineActions from '@/app/inmobiliaria/leads/pipeline-actions'
import { projectLeadPipeline } from '@/lib/inmobiliaria/leadPipeline'
import { EMPTY_AUTOMATION_FILTERS } from '@/lib/inmobiliaria/leadAutomation'
import { getLeadAutomationKpis, getLeadAutomationRow, listLeadAttentionQueue, listLeadAutomationDashboard } from './leadAutomation.service'
import type { LeadPipelineStage } from '@/types/leadPipeline'

const id = (index: number) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
const rows = Array.from({ length: 530 }, (_, index) => ({
  lead_id: id(index), tenant_id: 'tenant-a', name: `Lead ${index}`, stage: 'nutricion',
  created_at: '2026-10-15T12:00:00Z', last_interaction_at: '2026-10-15T13:00:00Z', latest_conversation_id: null,
}))

function snapshot(index: number) {
  const stage: LeadPipelineStage = index >= 500 ? 'interes_comercial' : 'contacto_inicial'
  return { ...projectLeadPipeline({ lead: { id: id(index), name: `Lead ${index}` } }), stage, stageLabel: stage, stageReason: 'Evidencia del servidor' }
}

function clientFor(urls: URL[]) {
  return createClient('https://example.supabase.co', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async input => {
      const url = new URL(String(input)); urls.push(url)
      if (url.pathname.endsWith('/get_lead_automation_kpis')) return Response.json({ leads_new: 17, leads_by_stage: [{ stage: 'nutricion', count: 530 }] })
      if (url.pathname.endsWith('/vw_lead_automation_dashboard')) {
        assert.equal(url.searchParams.get('stage'), null, 'Canonical stages must never be applied to the historical database column.')
        if (url.searchParams.get('lead_id')) return Response.json(rows[0])
        const from = Number(url.searchParams.get('offset') || 0)
        const size = Number(url.searchParams.get('limit') || 530)
        return Response.json(rows.slice(from, from + size))
      }
      return Response.json([])
    } },
  })
}

test('canonical stage filtering and totals include results beyond the first 500 rows before pagination', async t => {
  const batches: string[][] = []
  t.mock.method(pipelineActions, 'readLeadPipelineSnapshotsAction', async (ids: string[]) => {
    batches.push(ids)
    return { ok: true as const, data: ids.map(leadId => ({ leadId, pipeline: snapshot(rows.findIndex(row => row.lead_id === leadId)) })) }
  })
  const urls: URL[] = []
  const result = await listLeadAutomationDashboard(clientFor(urls), {
    tenantId: 'tenant-a', filters: { ...EMPTY_AUTOMATION_FILTERS, stage: 'interes_comercial' }, page: 2, pageSize: 25,
  })
  assert.equal(result.total, 30)
  assert.equal(result.data.length, 5)
  assert.equal(result.data[0].lead_id, id(525))
  assert.ok(result.data.every(row => row.stage === 'interes_comercial' && row.pipeline?.stage === row.stage))
  assert.deepEqual(batches.map(batch => batch.length), [200, 200, 130])
  assert.equal(urls.filter(url => url.pathname.endsWith('/vw_lead_automation_dashboard')).length, 2)
})

test('canonical stage KPIs replace historical counts using all project-period rows', async t => {
  t.mock.method(pipelineActions, 'readLeadPipelineSnapshotsAction', async (ids: string[]) => ({
    ok: true as const, data: ids.map(leadId => ({ leadId, pipeline: snapshot(rows.findIndex(row => row.lead_id === leadId)) })),
  }))
  const urls: URL[] = []
  const kpis = await getLeadAutomationKpis(clientFor(urls), {
    tenantId: 'tenant-a', from: '2026-10-01T05:00:00.000Z', to: '2026-10-16T04:59:59.999Z',
  })
  assert.equal(kpis.leads_new, 17)
  assert.equal(kpis.leads_by_stage.reduce((sum, row) => sum + row.count, 0), 530)
  assert.equal(kpis.leads_by_stage.find(row => row.stage === 'interes_comercial')?.count, 30)
  assert.equal(kpis.leads_by_stage.find(row => row.stage === 'contacto_inicial')?.count, 500)
  assert.equal(kpis.leads_by_stage.some(row => row.stage === 'nutricion'), false)
  const dashboardRequest = urls.find(url => url.pathname.endsWith('/vw_lead_automation_dashboard'))
  assert.equal(dashboardRequest?.searchParams.get('created_at'), 'gte.2026-10-01T05:00:00.000Z')
})

test('detail and attention rows use the same projection and reject an unavailable projection', async t => {
  const reader = t.mock.method(pipelineActions, 'readLeadPipelineSnapshotsAction', async (ids: string[]) => ({
    ok: true as const, data: ids.map(leadId => ({ leadId, pipeline: snapshot(rows.findIndex(row => row.lead_id === leadId)) })),
  }))
  const client = clientFor([])
  const row = await getLeadAutomationRow(client, id(0), ['tenant-a'])
  assert.equal(row.stage, 'contacto_inicial')
  assert.equal(row.stage_reason, row.pipeline?.stageReason)
  const queue = await listLeadAttentionQueue(client, ['tenant-a'])
  assert.ok(queue.every(item => item.stage === item.pipeline?.stage))
  reader.mock.mockImplementation(async () => ({ ok: false as const, error: 'Etapa no disponible' }))
  await assert.rejects(getLeadAutomationRow(client, id(0), ['tenant-a']), /Etapa no disponible/)
  await assert.rejects(listLeadAutomationDashboard(client, { tenantId: 'tenant-a', filters: EMPTY_AUTOMATION_FILTERS }), /Etapa no disponible/)
})
