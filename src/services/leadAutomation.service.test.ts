import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createClient } from '@supabase/supabase-js'
import { getLeadAutomationDetail } from './leadAutomation.service'

test('lead detail loads its selected unit from conversation memory without a leads.unit_id column', async () => {
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
      // An optional maintenance log without browser permission must not hide the card.
      if (table === 'lv_integration_events') { status = 403; data = { message: 'permission denied' } }
      return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
    } },
  })
  const detail = await getLeadAutomationDetail(client, 'lead-a', ['tenant-a'])
  assert.equal(detail.profileCard?.selectedUnitNumber, '502')
  assert.equal(detail.profileCard?.financingAccepted, true)
  assert.ok(detail.profileCard?.groups.flatMap(group => group.fields).some(field => field.value === 'Cooperativa JEP'))
  assert.deepEqual(detail.nutritionJobs, [])
  assert.ok(urls.some(url => url.pathname.endsWith('/leads')))
})
