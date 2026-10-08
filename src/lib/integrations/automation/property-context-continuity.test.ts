import test from 'node:test'
import assert from 'node:assert/strict'
import { object, type Row } from './data'
import { normalizeTurnSemantics, pendingQuestionFromReply } from './turn-semantics'
import { propertyContext, rememberPropertyReply, resolvePropertyTurn } from './property-context'
import { selectedFinancingUnit } from './financing-stage'

const catalog: Row[] = [
  { id: 'p601', unit_number: '601', category: 'penthouse', floor_number: 6, bedrooms: 2, area_internal_m2: 110, status: 'disponible' },
  { id: 'p602', unit_number: '602', category: 'penthouse', floor_number: 6, bedrooms: 3, area_internal_m2: 142.09, status: 'disponible' },
  { id: 'p605', unit_number: '605', category: 'penthouse', floor_number: 6, bedrooms: 3, area_internal_m2: 140.53, status: 'disponible' },
  { id: 'd502', unit_number: '502', category: 'departamento', floor_number: 5, bedrooms: 3, area_internal_m2: 120.83, status: 'disponible' },
]
const state = (changes: Row = {}): Row => ({ version: 2, selected_ids: ['p602'], offered_ids: ['p602'],
  comparison_ids: [], focused_ids: ['p602'], pending_question: {}, query: {
    group: 'residential', category: 'penthouse', operation: 'details', scope: 'selected', filters: { bedrooms: 3 },
  }, ...changes })
const interpreted = (current: string, property: Row = {}, pending: Row = {}, primary = 'answer_previous', answer: Row = {}) =>
  normalizeTurnSemantics({ turn_semantics: {
    primary_intent: primary, primary_evidence: current, confidence: 'high', housing_quantities: [],
    property: { group: 'residential', category: 'penthouse', excluded_categories: ['suite', 'departamento', 'local'],
      operation: 'none', reference_kind: 'none', query_scope: null, selector: null, unit_numbers: [],
      filters: { floor_number: null, bedrooms: null, bedrooms_required: null, min_area_m2: null, max_area_m2: null },
      evidence: current, confidence: 'high', ...property },
    answer_to_previous: { kind: 'none', question_id: 'none', confidence: 'low', evidence: '', ...answer },
  } }, current, pending)

test('the recorded acknowledgement with inherited penthouse category does not reopen two-bedroom options', () => {
  const current = 'si si me parece bien'
  const semantic = interpreted(current)
  const property = object(semantic.property)
  assert.equal(property.operation, 'none')
  assert.equal(property.category, null)
  assert.deepEqual(property.excluded_categories, [])
  assert.equal(object(semantic.answer_to_previous).kind, 'none', 'missing receipt does not create consent')
  const result = resolvePropertyTurn(catalog, current, { _property_context: state() }, [], semantic)
  assert.deepEqual(result.context.selected_ids, ['p602'])
  assert.deepEqual(result.matches.map(unit => unit.id), ['p602'])
  assert.equal(result.query.operation, 'none')
  assert.equal(result.query.scope, 'selected')
  assert.equal(result.query.filters.bedrooms, 3)
  assert.equal(result.explicit, false)
  assert.equal(result.needsClarification, false)
})

test('a bare answer without a prior client selection cannot choose from displayed alternatives', () => {
  const current = 'si si me parece bien'
  const result = resolvePropertyTurn(catalog, current, { _property_context: state({ selected_ids: [],
    offered_ids: ['p601', 'p602', 'p605'], focused_ids: [] }) }, [], interpreted(current))
  assert.deepEqual(result.context.selected_ids, [])
  assert.equal(result.explicit, false)
})

test('a genuine current category or new constraints still refine the search instead of freezing selection', () => {
  const category = 'departamentos'
  const changed = resolvePropertyTurn(catalog, category, { _property_context: state() }, [], interpreted(category,
    { category: 'departamento', excluded_categories: [] }))
  assert.deepEqual(changed.context.selected_ids, [])
  assert.equal(changed.query.category, 'departamento')
  const current = 'busco penthouses de dos dormitorios'
  const semantic = normalizeTurnSemantics({ turn_semantics: { primary_intent: 'select_property', primary_evidence: current, confidence: 'high',
    housing_quantities: [{ dimension: 'bedrooms', values: [2], role: 'requirement', count_basis: 'unspecified', evidence: 'dos dormitorios', confidence: 'high' }],
    property: { category: 'penthouse', operation: 'search', query_scope: 'catalog', reference_kind: 'none',
      filters: { bedrooms: 2 }, filter_evidence: { bedrooms: 'dos dormitorios' }, evidence: current, confidence: 'high' },
  } }, current, {})
  const searched = resolvePropertyTurn(catalog, current, { _property_context: state() }, [], semantic)
  assert.deepEqual(searched.matches.map(unit => unit.id), ['p601'])
  assert.equal(searched.query.filters.bedrooms, 2)
  assert.equal(object(searched.context.preference_transition).active, true, 'exploring a replacement does not claim it was chosen')
})

test('choosing 602, asking for its details, and answering its real confirmation keeps the same choice', () => {
  const choose = 'quiero el penthouse 602'
  const selected = resolvePropertyTurn(catalog, choose, {}, [], interpreted(choose,
    { operation: 'select', reference_kind: 'explicit', unit_numbers: ['602'], excluded_categories: [] }, {}, 'select_property'))
  assert.deepEqual(selected.context.selected_ids, ['p602'])
  const current = 'deme detalles del penthouse 602'
  const details = resolvePropertyTurn(catalog, current, { _property_context: selected.context }, [], interpreted(current,
    { operation: 'details', reference_kind: 'explicit', unit_numbers: ['602'], query_scope: 'selected', excluded_categories: [] }, {}, 'project_information'))
  assert.deepEqual(details.context.selected_ids, ['p602'])
  const reply = 'El penthouse 602 tiene tres dormitorios. ¿Desea continuar con esta unidad?'
  const pending = { ...pendingQuestionFromReply(reply), target_ids: ['p602'], candidate_ids: ['p602'] }
  assert.equal(pending.act, 'confirm_unit')
  const stored = rememberPropertyReply(catalog, details.context, reply, { offered_unit_ids: ['p602'], focused_unit_ids: ['p602'],
    selected_unit_ids: [], pending_question: pending, catalog_query: details.query })
  assert.deepEqual(stored.selected_ids, ['p602'])
  const accepted = 'sí, me parece bien'
  const result = resolvePropertyTurn(catalog, accepted, { _property_context: stored, _pending_question: pending }, [], interpreted(accepted,
    {}, pending, 'answer_previous', { question_id: 'unit_choice', kind: 'affirmative', confidence: 'high', evidence: accepted }))
  assert.deepEqual(result.context.selected_ids, ['p602'])
  assert.deepEqual(result.matches.map(unit => unit.id), ['p602'])
  assert.equal(result.needsClarification, false)
})

test('details and new bot offers cannot select a different unit or revoke a chosen one', () => {
  const current = 'qué incluye el penthouse 601'
  const details = resolvePropertyTurn(catalog, current, { _property_context: state() }, [], interpreted(current,
    { operation: 'details', reference_kind: 'explicit', unit_numbers: ['601'], excluded_categories: [] }, {}, 'project_information'))
  assert.deepEqual(details.matches.map(unit => unit.id), ['p601'])
  assert.deepEqual(details.context.selected_ids, ['p602'])
  for (const audit of [{}, { offered_unit_ids: ['p601'], selected_unit_ids: [], pending_question: {} },
    { source: 'unit_alternative_journey', alternative_phase: 'choose_category', offered_unit_ids: ['p601'], pending_question: {} }]) {
    const stored = rememberPropertyReply(catalog, state(), 'Podemos revisar el penthouse 601.', audit)
    assert.deepEqual(stored.selected_ids, ['p602'])
    const legacy = propertyContext(catalog, stored, [{ role: 'bot', content: 'El penthouse 605 tiene tres dormitorios.' }])
    assert.deepEqual(legacy.selected_ids, ['p602'])
  }
  const replaced = resolvePropertyTurn(catalog, 'quiero el penthouse 601', { _property_context: state() }, [], interpreted('quiero el penthouse 601',
    { operation: 'select', reference_kind: 'explicit', unit_numbers: ['601'], excluded_categories: [] }, {}, 'select_property'))
  assert.deepEqual(replaced.context.selected_ids, ['p601'])
  const rejected = resolvePropertyTurn(catalog, 'no quiero el penthouse 602', { _property_context: state() }, [], {})
  assert.deepEqual(rejected.context.selected_ids, [])
})

test('unit confirmation is recognized from its own question without interpreting a financial question as unit choice', () => {
  for (const reply of ['El penthouse 602 cuenta con tres dormitorios. ¿Desea continuar con esta unidad?',
    '¿Desea continuar con el penthouse 602?',
    'El penthouse 602 tiene tres dormitorios. ¿Continuamos con esta unidad?',
    '¿Le parece bien seguir con el penthouse 602?',
    'El penthouse 602 cuenta con tres dormitorios. Quisiera confirmar si desea continuar con esta unidad.']) {
    const pending = pendingQuestionFromReply(reply)
    assert.equal(pending.id, 'unit_choice', reply)
    assert.equal(pending.act, 'confirm_unit', reply)
  }
  for (const reply of ['El penthouse 602 cuesta $550.000. ¿Desea continuar con financiamiento?',
    'El penthouse 602 cuesta $550.000. ¿Desea continuar con la financiación de esta unidad?',
    'El penthouse 602 está disponible. ¿Desea continuar con la reserva de esta unidad?',
    'El penthouse 602 está disponible. ¿Desea continuar con esta unidad mediante crédito?',
    'El penthouse 602 está disponible. ¿Cómo continuar con esta unidad?',
    'El penthouse 602 está disponible. ¿Qué le parece?',
    'El penthouse 602 cuesta $550.000. ¿Le parece bien seguir con el financiamiento?']) {
    assert.notEqual(pendingQuestionFromReply(reply).id, 'unit_choice', reply)
  }
})

test('an unavailable chosen subject requires clarification and never substitutes an available penthouse', () => {
  const current = 'si si me parece bien'
  for (const units of [catalog.filter(unit => unit.id !== 'p602'), catalog.map(unit => unit.id === 'p602' ? { ...unit, status: 'reservado' } : unit)]) {
    const result = resolvePropertyTurn(units, current, { _property_context: state() }, [], interpreted(current))
    assert.deepEqual(result.context.selected_ids, ['p602'])
    assert.deepEqual(result.matches, [])
    assert.equal(result.needsClarification, true)
    assert.equal(result.explicit, false)
  }
})

test('financing resolves a confirmed selection from the full verification catalogue despite reduced context', () => {
  for (const reduced of [[], [catalog[0]]]) {
    assert.equal(selectedFinancingUnit({ property_context: state(), catalogo: reduced, catalogo_verificacion: catalog,
      referencia_unidad: { matches: [], needsClarification: false } })?.id, 'p602')
  }
  assert.equal(selectedFinancingUnit({ property_context: state(), catalogo: [catalog[1]], referencia_unidad: {} })?.id, 'p602', 'legacy callers retain availability checks')
})

test('full verification cannot be bypassed by stale reduced offers, CRM preference, ambiguity or multiple choices', () => {
  for (const full of [[], catalog.filter(unit => unit.id !== 'p602'), catalog.map(unit => unit.id === 'p602' ? { ...unit, status: 'reservado' } : unit),
    catalog.map(unit => unit.id === 'p602' ? { ...unit, is_published: false } : unit)]) {
    assert.equal(selectedFinancingUnit({ property_context: state(), catalogo: catalog, catalogo_verificacion: full,
      referencia_unidad: { matches: [catalog[1]] }, lead: { unit_id: 'p602' } }), null)
  }
  for (const context of [state({ selected_ids: [] }), state({ selected_ids: ['p602', 'p605'] })]) {
    assert.equal(selectedFinancingUnit({ property_context: context, catalogo_verificacion: catalog, lead: { unit_id: 'p602' } }), null)
  }
  assert.equal(selectedFinancingUnit({ property_context: state(), catalogo_verificacion: catalog, referencia_unidad: { needsClarification: true } }), null)
})

test('a negative answer revokes only a real confirmation of the chosen unit, never financing or residence', () => {
  for (const pending of [
    { id: 'unit_choice', act: 'confirm_unit', question: '¿Desea continuar con el penthouse 602?', target_ids: ['p602'] },
    { id: 'financing_invitation', act: 'financing', question: '¿Desea continuar con financiamiento?', target_ids: ['p602'] },
    { id: 'lead_profile_residence', act: 'profile', question: '¿Puede indicar su residencia?', target_ids: [] },
  ]) {
    const current = 'No, gracias'
    const semantic = interpreted(current, {}, pending, 'answer_previous', { question_id: pending.id, kind: 'negative', confidence: 'high', evidence: current })
    const result = resolvePropertyTurn(catalog, current, { _property_context: state({ pending_question: pending }), _pending_question: pending }, [], semantic)
    assert.deepEqual(result.context.selected_ids, pending.id === 'unit_choice' ? [] : ['p602'], pending.id)
    assert.equal(result.explicit, false, pending.id)
  }
})
