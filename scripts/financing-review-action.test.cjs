require('./test-typescript.cjs')
const { test } = require('node:test'), assert = require('node:assert/strict'), Module = require('node:module')
const { createClient } = require('@supabase/supabase-js')
let client, admin = true
const originalLoad = Module._load
Module._load = function(id, ...args) {
  if (id === '@/lib/auth/session') return {
    assertAdmin: async () => { if (!admin) throw Error('Solo administrador') },
    getSessionUser: async () => ({ supabase: client, user: { id: 'staff' } }),
  }
  return originalLoad.call(this, id, ...args)
}
const { saveFinancingReview } = require('../src/app/inmobiliaria/automatizacion/financing-review-actions.ts')
const { LAVILET_PROJECT_ID: project } = require('../src/lib/integrations/lavilet.ts')
Module._load = originalLoad

function database(overrides = {}) {
  const writes = [], reads = []
  client = createClient('https://example.supabase.co', 'test', { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input)), table = url.pathname.split('/').at(-1)
      if (init.method === 'PATCH') {
        assert.equal(table, 'leads')
        assert.equal(url.searchParams.get('tenant_id'), 'eq.tenant')
        assert.equal(url.searchParams.get('project_id'), `eq.${project}`)
        assert.equal(url.searchParams.get('id'), 'eq.lead')
        assert.equal(url.searchParams.get('updated_at'), 'eq.version')
        writes.push(JSON.parse(init.body))
        return Response.json(overrides.concurrent ? [] : [{ updated_at: 'new-version' }])
      }
      reads.push(table)
      const data = {
        leads: { id: 'lead', tenant_id: 'tenant', project_id: project, unit_id: 'unit', updated_at: 'version', behavior_signals: { sdr: { prioridad: 'Vista' } } },
        units: { id: 'unit', status: 'disponible', is_published: true, published_commercial_price: 310000 },
        conversations: [{ summary: JSON.stringify({ _property_context: { selected_ids: [overrides.selected || 'unit'] } }) }],
        financing_prequalifications: [{ explicit_consent: true, status: overrides.status || 'lista', updated_at: 'dossier-version' }],
      }[table]
      return Response.json(data)
    } } })
  return { writes, reads }
}
const input = { result: 'favorable', ownFunds: 50000, financingAmount: 260000, note: 'Resultado comprobado de la revisión' }

test('review action requires staff, current selection, complete dossier and sufficient coverage', async () => {
  admin = false
  let calls = database()
  await assert.rejects(saveFinancingReview('lead', 'unit', 'version', input), /administrador/)
  assert.equal(calls.reads.length, 0)
  admin = true
  for (const [override, version, data, reason] of [
    [{}, 'old-version', input, /ficha cambió/],
    [{ selected: 'another' }, 'version', input, /unidad seleccionada/],
    [{ status: 'borrador' }, 'version', input, /expediente/],
    [{}, 'version', { ...input, financingAmount: 250000 }, /cubrir/],
  ]) {
    calls = database(override)
    await assert.rejects(saveFinancingReview('lead', 'unit', version, data), reason)
    assert.equal(calls.writes.length, 0)
  }
})

test('recording a real result preserves other lead data and performs no reservation or outbound call', async () => {
  const calls = database()
  const result = await saveFinancingReview('lead', 'unit', 'version', input)
  assert.equal(result.updatedAt, 'new-version')
  assert.equal(calls.writes.length, 1)
  const signals = calls.writes[0].behavior_signals
  assert.deepEqual(signals.sdr, { prioridad: 'Vista' })
  assert.equal(signals.financing_review.reviewed_by, 'staff')
  assert.equal(signals.financing_review.qualification_updated_at, 'dossier-version')
  assert.equal(signals.financing_review.unit_price, 310000)
  assert.equal(signals.financing_review_history.length, 1)
  assert.deepEqual(Object.keys(calls.writes[0]), ['behavior_signals'])
  database({ concurrent: true })
  await assert.rejects(saveFinancingReview('lead', 'unit', 'version', input), /ficha cambió/)
})
