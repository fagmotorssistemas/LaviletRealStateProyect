import assert from 'node:assert/strict'
import { test } from 'node:test'
import { leadProfileCard } from './leadProfileCard'
import { validateFinancingReview } from './financingReviewResult'

test('card distinguishes undefined budget from old CRM amount and preserves all current preferences', () => {
  const card = leadProfileCard({ name: 'Alias', budget: 50000, purchase_purpose: 'vivir' }, {
    _lead_profile: { full_name: 'Ana', name_status: 'confirmed', residence_city: 'Cuenca' },
    _interpretation_memory: { budget: { status: 'no_defined_budget', evidence: 'No lo tengo definido' }, housing_quantities: [{ dimension: 'people', values: [4], count_basis: 'excluding_speaker' }] },
    _property_context: { selected_ids: ['u'], query: { filters: { bedrooms: 3, bedrooms_any: [], floor_number: 5 } } },
    _commercial_journey: { stage: 'continue_financing', next_step: 'Preguntar entidad' },
  }, { national_id: '0101234567', legal_name: 'Ana Pérez', legal_name_confirmed: true }, [{ id: 'u', unit_number: '502', category: 'departamento' }])
  const values = Object.fromEntries(card.groups.flatMap(group => group.fields).map(f => [f.label, f.value]))
  assert.equal(values['Situación del presupuesto'], 'No tiene presupuesto definido')
  assert.equal(values.Monto, 'Sin confirmar')
  assert.equal(values.Personas, '5'); assert.equal(values.Dormitorios, '3')
  assert.equal(values['Unidad elegida'], 'departamento 502')
  assert.equal(values.Cédula, '••••••4567')
  assert.doesNotMatch(JSON.stringify(card), /0101234567/)
})

test('commercial profile does not claim financial readiness without an actual result', () => {
  const card = leadProfileCard({}, {}, { status: 'lista', explicit_consent: true }, [])
  assert.equal(card.groups.flatMap(g => g.fields).find(f => f.label === 'Resultado de revisión')?.value, 'Sin revisión registrada')
  assert.equal(card.selectedUnitId, null)
})

test('favorable review needs supporting note and enough coverage, other results do not authorize reservation', () => {
  const input = { result: 'favorable' as const, ownFunds: 200000, financingAmount: 100000, note: 'Resultado comprobado por el equipo' }
  assert.throws(() => validateFinancingReview(input, 310000), /cubrir/)
  assert.doesNotThrow(() => validateFinancingReview({ ...input, financingAmount: 110000 }, 310000))
  assert.throws(() => validateFinancingReview({ ...input, ownFunds: -1 }, 310000), /importes/)
  assert.throws(() => validateFinancingReview({ ...input, note: '' }, 310000), /respaldo/)
  assert.doesNotThrow(() => validateFinancingReview({ ...input, result: 'pending' }, 310000))
})
