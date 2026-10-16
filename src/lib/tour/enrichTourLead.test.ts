import assert from 'node:assert/strict'
import test from 'node:test'
import type { SupabaseClient } from '@supabase/supabase-js'
import { enrichTourLeadAfterIdentify } from './enrichTourLead'

function harness(type: { name: string; bedrooms: number | null }, lead: Record<string, unknown> = {}) {
  const writes: { table: string; value: Record<string, unknown> }[] = []
  const reads: string[] = []
  const admin = { from(table: string) {
    reads.push(table)
    const query = {
      select() { return query }, eq() { return query }, order() { return query }, limit() { return query }, maybeSingle() { return query },
      update(value: Record<string, unknown>) { writes.push({ table, value }); return query },
      upsert(value: Record<string, unknown>) { writes.push({ table, value }); return query },
      then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
        const data = table === 'unit_types' ? type : table === 'leads' ? lead : null
        return Promise.resolve({ data, error: null }).then(resolve, reject)
      },
    }
    return query
  } } as unknown as SupabaseClient
  return { admin, writes, reads }
}

for (const type of [{ name: 'Penthouse 605', bedrooms: 3 }, { name: 'Local LC-11', bedrooms: null }, { name: 'Suite 210', bedrooms: 1 }]) {
  test(`identifying while viewing ${type.name} saves observation without declaring requirements`, async () => {
    const h = harness(type)
    await enrichTourLeadAfterIdentify(h.admin, { leadId: 'lead', visitorKey: 'visitor', unitId: 'unit', unitNumber: '605', unitTypeId: 'type' })
    const patch = h.writes.find(write => write.table === 'leads')!.value
    assert.equal(Object.hasOwn(patch, 'preferred_category'), false)
    assert.equal(Object.hasOwn(patch, 'preferred_bedrooms'), false)
    const signals = patch.behavior_signals as { showroom: Record<string, unknown> }
    assert.equal(signals.showroom.unit_id, 'unit')
    assert.equal(signals.showroom.typology, type.name)
    assert.equal(h.reads.includes('lead_units'), false, 'A view cannot create or downgrade a declared unit relationship')
  })
}

test('a showroom view preserves declared category, bedrooms and unrelated behavior signals', async () => {
  const h = harness({ name: 'Penthouse 605', bedrooms: 3 }, { preferred_category: 'local', preferred_bedrooms: 0,
    resume: 'Resumen comercial declarado', behavior_signals: { declared: { selected_unit: 'local' }, showroom: { other_context: 'keep' } } })
  await enrichTourLeadAfterIdentify(h.admin, { leadId: 'lead', visitorKey: 'visitor', unitId: 'penthouse', unitNumber: '605', unitTypeId: 'type' })
  const patch = h.writes.find(write => write.table === 'leads')!.value
  assert.equal(Object.hasOwn(patch, 'resume'), false)
  assert.equal(Object.hasOwn(patch, 'preferred_category'), false)
  assert.equal(Object.hasOwn(patch, 'preferred_bedrooms'), false)
  assert.deepEqual(patch.behavior_signals, { declared: { selected_unit: 'local' }, showroom: { other_context: 'keep',
    typology: 'Penthouse 605', unit_id: 'penthouse', unit_number: '605' } })
})
