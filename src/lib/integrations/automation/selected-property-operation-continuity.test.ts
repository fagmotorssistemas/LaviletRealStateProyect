import test from 'node:test'
import assert from 'node:assert/strict'
import { object, type Row } from './data'
import { resolvePropertyTurn } from './property-context'
import { purchaseReadiness } from './commercial-journey'

const units: Row[] = [
  { id: 'u502', unit_number: '502', category: 'departamento', bedrooms: 3, floor_number: 5,
    area_internal_m2: 120.83, published_commercial_price: 310000, status: 'disponible', is_published: true },
  { id: 'u402', unit_number: '402', category: 'departamento', bedrooms: 3, floor_number: 4,
    area_internal_m2: 120.83, published_commercial_price: 290000, status: 'disponible', is_published: true },
  { id: 'u602', unit_number: '602', category: 'penthouse', bedrooms: 3, floor_number: 6,
    area_internal_m2: 142.09, published_commercial_price: 550000, status: 'disponible', is_published: true },
]

function selectedSummary(selectedIds = ['u502']): Row {
  return { _property_context: { version: 2, phase: 'review_unit', selected_ids: selectedIds,
    offered_ids: ['u502'], focused_ids: [], comparison_ids: [], pending_question: {},
    query: { group: 'residential', category: 'departamento', operation: 'none', scope: 'selected', filters: {} } } }
}

function semantics(current: string, primaryIntent: string, changes: Row = {}): Row {
  return { primary_intent: primaryIntent, primary_evidence: current, confidence: 'high',
    answer_to_previous: { question_id: 'none', kind: 'none', evidence: '', confidence: 'low' },
    reservation: { kind: 'information', evidence: current, confidence: 'high', unit_numbers: ['502'] },
    property: { group: 'residential', category: 'departamento', operation: 'none', query_scope: 'selected',
      reference_kind: 'explicit', unit_numbers: ['502'], evidence: current, confidence: 'high', filters: {}, ...changes } }
}

test('the real reservation continuation keeps 502 and its verified purchase coverage without creating consent', () => {
  const current = 'si si me gustaria', summary = selectedSummary(), original = structuredClone(summary)
  const semantic = semantics(current, 'ask_reservation'), interpretation = structuredClone(semantic)
  const resolved = resolvePropertyTurn(units, current, summary, [], semantic)
  assert.equal(resolved.reason, 'remembered')
  assert.equal(resolved.needsClarification, false)
  assert.equal(resolved.explicit, false)
  assert.equal(resolved.query.operation, 'none')
  assert.deepEqual(resolved.matches.map(unit => unit.id), ['u502'])
  assert.deepEqual(resolved.context.selected_ids, ['u502'])
  const ready = purchaseReadiness({ property_context: resolved.context, referencia_unidad: resolved,
    catalogo: units, catalogo_verificacion: units, lead: {}, politica_comercial: { precios_autorizados: true },
    hechos_confirmados: { budget: { amount: 400000, status: 'maximum_total', confidence: 'high', evidence: 'tengo 400 mil' } } })
  assert.equal(ready.selected_unit_id, 'u502')
  assert.equal(ready.can_offer_reservation, true)
  assert.deepEqual(summary, original)
  assert.deepEqual(semantic, interpretation, 'Resolving a subject cannot grant reservation permission')
})

test('descriptive categories preserve the selected subject during operational and unit information turns', () => {
  for (const [current, intent] of [
    ['Deseo iniciar la reserva', 'request_reservation'],
    ['¿Qué documentos necesitaría para el crédito?', 'ask_financing'],
    ['Quiero coordinar una visita', 'request_visit'],
    ['Solo tengo 200 mil disponibles para la entrada', 'discuss_budget'],
    ['¿Cuál es el precio de esta unidad?', 'ask_price'],
    ['¿Qué incluye este departamento?', 'project_information'],
  ]) {
    const resolved = resolvePropertyTurn(units, current, selectedSummary(), [], semantics(current, intent))
    assert.equal(resolved.reason, 'remembered', current)
    assert.deepEqual(resolved.context.selected_ids, ['u502'], current)
    assert.deepEqual(resolved.matches.map(unit => unit.id), ['u502'], current)
    assert.equal(resolved.explicit, false, current)
    assert.equal(resolved.query.operation, 'none', current)
  }
})

test('a real category change or current search refinement still clears the old selection', () => {
  const changed = resolvePropertyTurn(units, 'Prefiero los penthouses', selectedSummary(), [],
    semantics('Prefiero los penthouses', 'select_property', { category: 'penthouse', unit_numbers: [], reference_kind: 'none' }))
  assert.equal(changed.reason, 'category_change')
  assert.deepEqual(changed.context.selected_ids, [])
  const current = 'Para el financiamiento prefiero otra opción en la planta 4'
  const refined = resolvePropertyTurn(units, current, selectedSummary(), [], semantics(current, 'ask_financing', {
    operation: 'search', reference_kind: 'none', unit_numbers: [], query_scope: 'catalog',
    filters: { floor_number: 4 }, filter_evidence: { floor_number: 'planta 4' } }))
  assert.deepEqual(refined.matches.map(unit => unit.id), ['u402'])
  assert.deepEqual(refined.context.selected_ids, [])
})

test('a literal unknown or rejected unit is never replaced by the old selected unit', () => {
  const current = 'Quiero reservar la unidad 999'
  const unknown = resolvePropertyTurn(units, current, selectedSummary(), [],
    semantics(current, 'request_reservation', { unit_numbers: ['999'] }))
  assert.equal(unknown.needsClarification, true)
  assert.deepEqual(unknown.matches, [])
  assert.deepEqual(unknown.context.selected_ids, [])
  const rejected = 'No quiero el departamento 502'
  const negative = resolvePropertyTurn(units, rejected, selectedSummary(), [],
    semantics(rejected, 'select_property', { unit_numbers: ['502'] }))
  assert.equal(negative.reason, 'unit_rejected')
  assert.deepEqual(negative.context.selected_ids, [])
})

test('a missing or unavailable selected unit requires clarification without substituting an available department', () => {
  const current = 'Sí, continuemos con la reserva'
  for (const catalog of [units.filter(unit => unit.id !== 'u502'),
    units.map(unit => unit.id === 'u502' ? { ...unit, status: 'reservado' } : unit)]) {
    const resolved = resolvePropertyTurn(catalog, current, selectedSummary(), [], semantics(current, 'request_reservation'))
    assert.equal(resolved.reason, 'selected_context_unavailable')
    assert.equal(resolved.needsClarification, true)
    assert.deepEqual(resolved.matches, [])
    assert.deepEqual(resolved.context.selected_ids, ['u502'], 'Keep the old decision as unavailable, never choose a replacement')
    assert.match(resolved.clarification, /ya no aparece disponible/)
  }
})

test('an ambiguous or merely offered set cannot silently become a single chosen unit', () => {
  const current = 'Sí, deseo continuar', semantic = semantics(current, 'request_reservation', { unit_numbers: [], reference_kind: 'none' })
  const ambiguous = resolvePropertyTurn(units, current, selectedSummary(['u502', 'u402']), [], semantic)
  assert.equal(ambiguous.needsClarification, true)
  assert.deepEqual(ambiguous.matches.map(unit => unit.id), ['u502', 'u402'])
  const offered = selectedSummary([])
  const unresolved = resolvePropertyTurn(units, current, offered, [], semantic)
  assert.deepEqual(unresolved.context.selected_ids, [])
  assert.equal(unresolved.explicit, false)
  assert.deepEqual(object(semantic.reservation), object(semantics(current, 'request_reservation').reservation))
})
