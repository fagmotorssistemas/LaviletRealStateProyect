import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { getLeadAutomationDetail, getLeadNutritionJobs } from './leadAutomation.service'

test('lead detail loads its selected unit and distinguishes unavailable follow-ups from an empty list', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 500 }))
  const urls: URL[] = []
  const client = createClient('https://example.supabase.co', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async input => {
      const url = new URL(String(input)); urls.push(url)
      const table = url.pathname.split('/').at(-1)
      let data: unknown = [], status = 200
      if (table === 'vw_lead_automation_dashboard') data = { lead_id: 'lead-a', tenant_id: 'tenant-a', project_id: 'project-a' }
      if (table === 'leads') {
        assert.equal(url.searchParams.get('tenant_id'), 'in.(tenant-a)')
        if (url.searchParams.get('select')?.split(',').includes('unit_id')) {
          status = 400; data = { code: '42703', message: 'column leads.unit_id does not exist' }
        } else data = { name: 'Carlos', behavior_signals: {}, updated_at: '2026-10-05T04:00:00Z' }
      }
      if (table === 'conversations') data = [{ id: 'conversation-a', summary: JSON.stringify({
        _property_context: { selected_ids: ['unit-502'], offered_ids: ['unit-602'] },
        _financing_journey: { accepted: true },
      }) }]
      if (table === 'financing_prequalifications') data = [{ selected_partner_name: 'Cooperativa JEP', legal_name_confirmed: false }]
      if (table === 'units') {
        assert.equal(url.searchParams.get('project_id'), 'eq.project-a')
        assert.equal(url.searchParams.get('tenant_id'), 'in.(tenant-a)')
        data = [{ id: 'unit-502', unit_number: '502', category: 'departamento' }, { id: 'unit-602', unit_number: '602', category: 'penthouse' }]
      }
      assert.notEqual(table, 'lv_integration_events', 'The browser must not query operational events directly.')
      return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
    } },
  })
  const detail = await getLeadAutomationDetail(client, 'lead-a', ['tenant-a'])
  assert.equal(detail.profileCard?.selectedUnitNumber, '502')
  assert.equal(detail.profileCard?.financingAccepted, true)
  assert.ok(detail.profileCard?.groups.flatMap(group => group.fields).some(field => field.value === 'Cooperativa JEP'))
  assert.deepEqual(detail.nutritionJobs, [])
  assert.equal(detail.nutritionJobsUnavailable, true)
  assert.ok(urls.some(url => url.pathname.endsWith('/leads')))
})

test('follow-ups load through the authenticated endpoint, including a legitimate empty result', async t => {
  const jobs = [{ id: 'job-a', task: 'nutrition_24h', status: 'pending' }]
  const request = t.mock.method(globalThis, 'fetch', async input => {
    assert.equal(String(input), '/api/inmobiliaria/automation/nutrition?leadId=lead-a')
    return Response.json({ jobs })
  })
  assert.deepEqual(await getLeadNutritionJobs('lead-a'), { data: jobs, error: false })
  request.mock.mockImplementation(async () => Response.json({ jobs: [] }))
  assert.deepEqual(await getLeadNutritionJobs('lead-a'), { data: [], error: false })
})
