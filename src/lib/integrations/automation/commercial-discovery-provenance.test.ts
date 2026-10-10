import assert from 'node:assert/strict'
import test from 'node:test'
import { commercialJourneyPlan, commercialSelectionQuery } from './commercial-journey'
import { resolvePropertyTurn } from './property-context'
import { object, type Row } from './data'
import { normalizeTurnSemantics } from './turn-semantics'

const catalog: Row[] = [
  { id: 'd202', unit_number: '202', category: 'departamento', bedrooms: 3, floor_number: 2, published_commercial_price: 250000 },
  { id: 'd302', unit_number: '302', category: 'departamento', bedrooms: 3, floor_number: 3, published_commercial_price: 270000 },
  { id: 'p602', unit_number: '602', category: 'penthouse', bedrooms: 3, floor_number: 6, published_commercial_price: 550000 },
  { id: 'local', unit_number: 'LC-1', category: 'local', bedrooms: null, floor_number: 1, published_commercial_price: 50000 },
].map(unit => ({ ...unit, is_published: true, status: 'disponible' }))

function info(): Row {
  return { lead: {}, recorrido_comercial: {},
    perfil_lead: { full_name: 'Carlos', residence_city: 'Cuenca', residence_status: 'confirmed' },
    property_context: { query: {}, selected_ids: [] }, catalogo: catalog, catalogo_verificacion: catalog,
    catalog_read: { complete: true }, politica_comercial: { precios_autorizados: true },
    financiamiento: { partners: ['Banco Pichincha', 'Cooperativa JEP'], journey: {} },
    semantica_turno: { primary_intent: 'answer_previous', confidence: 'high',
      answer_to_previous: { question_id: 'lead_residence_confirmation', kind: 'affirmative', evidence: 'sí, yo vivo en Cuenca', confidence: 'high' },
      property: { group: null, category: null, operation: 'none', confidence: 'high', evidence: '' },
      budget: { status: 'not_discussed' } } }
}

for (const [name, lead, query, preference] of [
  ['empty scope', {}, {}, null],
  ['inherited residential retrieval', {}, { group: 'residential', operation: 'none' }, null],
  ['inherited complete-project retrieval', {}, { group: 'all', operation: 'search' }, null],
  ['inherited category query', {}, { category: 'departamento', group: 'residential', operation: 'search' }, null],
  ['old CRM apartment category', { preferred_category: 'departamento' }, {}, null],
  ['old CRM local category', { preferred_category: 'local' }, { group: 'commercial' }, null],
  ['old context preference label', {}, { group: 'residential' }, 'suite'],
] as const) test('profile completion discovers use instead of treating a technical or CRM scope as a choice: ' + name, () => {
  const data = info()
  data.lead = lead
  data.property_context = { query, preference_category: preference, selected_ids: [] }
  const before = structuredClone(data), plan = commercialJourneyPlan(data), effective = commercialSelectionQuery(data)
  assert.equal(plan.action, 'discover_use')
  assert.equal(plan.question_id, 'property_category')
  assert.match(String(plan.question), /vivienda.*local/)
  assert.equal(effective.group, null)
  assert.equal(effective.category, null)
  assert.equal(object(plan.budget_guidance).status, 'not_comparable')
  assert.equal(plan.financing_offer_allowed, false)
  assert.deepEqual(data, before, 'Discovery must not mutate retrieval or persisted facts')
})

for (const evidence of ['si yo vivo en cuenca', 'Saludos, quiero informacion por favor'])
  test('a legacy purpose and property group supported only by passive evidence cannot authorize budget: ' + evidence, () => {
    const data = info()
    data.lead = { purchase_purpose: 'vivir', preferred_category: 'departamento' }
    data.property_context = { query: { group: 'residential', category: 'departamento', operation: 'none' }, selected_ids: [] }
    data.hechos_confirmados = { qualification: { proposito: evidence },
      property: { group: 'residential', category: null, evidence, confidence: 'high' } }
    const plan = commercialJourneyPlan(data)
    assert.equal(plan.action, 'discover_use')
    assert.equal(plan.question_id, 'property_category')
    assert.equal(commercialSelectionQuery(data).group, null)
  })

for (const evidence of ['si yo vivo en cuenca', 'Saludos, quiero informacion por favor'])
  test('passive current evidence does not become a declaration merely because its property label is confident: ' + evidence, () => {
    const data = info()
    object(data.semantica_turno).property = { group: 'residential', category: null, operation: 'none', evidence, confidence: 'high' }
    assert.equal(commercialJourneyPlan(data).action, 'discover_use')
  })

for (const purpose of ['vivir', 'segunda_vivienda', 'negocio', 'invertir'])
  test('an actual known purpose asks the missing budget before further discovery: ' + purpose, () => {
    const data = info()
    data.lead = { purchase_purpose: purpose, preferred_category: 'suite' }
    const plan = commercialJourneyPlan(data)
    assert.equal(plan.action, 'ask_budget')
    assert.equal(plan.question_id, 'budget_amount')
    assert.equal(commercialSelectionQuery(data).category, null, 'An unrelated CRM category does not choose the next type')
    assert.equal(commercialSelectionQuery(data).group, purpose === 'invertir' ? null : purpose === 'negocio' ? 'commercial' : 'residential')
  })

for (const [group, category, evidence] of [
  ['residential', null, 'me interesa algo para vivienda'],
  ['commercial', null, 'Busco un espacio para mi negocio'],
  ['residential', 'penthouse', 'Me interesa un penthouse'],
] as const) test('accepted current interpretation establishes the scope without requiring an extra use question: ' + evidence, () => {
  const data = info()
  object(data.semantica_turno).property = { group, category, operation: 'none', evidence, confidence: 'high' }
  const plan = commercialJourneyPlan(data)
  assert.equal(plan.action, 'ask_budget')
  assert.equal(commercialSelectionQuery(data).group, group)
  assert.equal(commercialSelectionQuery(data).category, category)
})

for (const source of ['memory', 'confirmed_category', 'accepted_exploration'] as const)
  test('a residence-only follow-up preserves a real previously established housing scope: ' + source, () => {
    const data = info()
    if (source === 'memory') data.hechos_confirmados = { property: { group: 'residential', category: null,
      confidence: 'high', evidence: 'Estoy buscando una vivienda para mi familia' } }
    else data.property_context = { query: { group: 'residential' }, selected_ids: [],
      ...(source === 'confirmed_category' ? { category_preference: { category: 'penthouse', confirmed: true, evidence: 'Prefiero los penthouses' } }
        : { exploration_state: { authorized: true, evidence: 'Sí, revisemos las alternativas de tres dormitorios' } }) }
    assert.equal(commercialJourneyPlan(data).action, 'ask_budget')
    assert.equal(commercialSelectionQuery(data).group, 'residential')
  })

test('a real mixed residence and purchase statement keeps its declared purpose', () => {
  const data = info()
  data.lead = { purchase_purpose: 'vivir' }
  data.hechos_confirmados = { qualification: { proposito: 'Vivo en Cuenca y busco una vivienda para mi familia' } }
  assert.equal(commercialJourneyPlan(data).action, 'ask_budget')
})

test('a real housing purpose does not turn an inherited penthouse query into a confirmed type choice', () => {
  const data = info()
  data.lead = { purchase_purpose: 'vivir', preferred_bedrooms: 3 }
  data.property_context = { query: { group: 'residential', category: 'penthouse', filters: { bedrooms: 3 } }, selected_ids: [] }
  data.hechos_confirmados = { budget: { status: 'maximum_total', amount: 600000, evidence: 'Tengo 600000 para la compra', confidence: 'high' } }
  assert.equal(commercialSelectionQuery(data).category, null)
  assert.equal(commercialJourneyPlan(data).question_id, 'property_category')
  assert.deepEqual(object(commercialJourneyPlan(data).selection_scope).categories, ['departamento', 'penthouse'])
})

test('a volunteered budget is retained while discovering unknown use and is not requested after use is established', () => {
  const data = info()
  data.property_context = { query: { group: 'residential' }, selected_ids: [] }
  data.hechos_confirmados = { budget: { status: 'maximum_total', amount: 600000, evidence: 'Mi presupuesto total es de 600000', confidence: 'high' } }
  assert.equal(commercialJourneyPlan(data).action, 'discover_use')
  data.lead = { purchase_purpose: 'vivir' }
  assert.equal(commercialJourneyPlan(data).action, 'discover_bedrooms')
  assert.equal(object(data.hechos_confirmados).budget && object(object(data.hechos_confirmados).budget).amount, 600000)
})

test('investment without an asset choice cannot acquire housing scope from an inherited catalogue query', () => {
  const data = info()
  data.lead = { purchase_purpose: 'invertir', preferred_category: 'suite' }
  data.property_context = { query: { group: 'residential', category: 'suite' }, selected_ids: [] }
  assert.equal(commercialJourneyPlan(data).action, 'ask_budget')
  data.hechos_confirmados = { budget: { status: 'maximum_total', amount: 600000, evidence: 'Tengo 600000 para la compra', confidence: 'high' } }
  const plan = commercialJourneyPlan(data)
  assert.equal(plan.action, 'discover_use')
  assert.match(String(plan.question), /vivienda.*local.*invertir/)
  assert.equal(object(plan.budget_guidance).status, 'not_comparable')
})

test('known bedroom needs establish housing scope without discarding a response supplied ahead of the questions', () => {
  const data = info()
  data.property_context = { query: { filters: { bedrooms: 3 } }, selected_ids: [] }
  data.hechos_confirmados = { property: { filters: { bedrooms: 3 }, category: null, group: null,
    evidence: 'Necesito una vivienda de tres dormitorios', confidence: 'high' } }
  assert.equal(commercialJourneyPlan(data).action, 'ask_budget')
  assert.equal(commercialSelectionQuery(data).filters.bedrooms, 3)
})

test('legacy advanced category decisions retain their scope without reopening initial use', () => {
  const data = info()
  data.property_context = { phase: 'choose_floor', query: { category: 'departamento', group: 'residential', filters: { bedrooms: 3 } }, selected_ids: [] }
  assert.equal(commercialJourneyPlan(data).action, 'ask_budget')
  data.hechos_confirmados = { budget: { status: 'maximum_total', amount: 600000, evidence: 'Tengo 600000 para la compra', confidence: 'high' } }
  assert.equal(commercialJourneyPlan(data).question_id, 'property_purpose', 'A known asset is preserved while its purchase purpose is still missing')
  data.lead = { purchase_purpose: 'vivir' }
  assert.equal(commercialJourneyPlan(data).question_id, 'property_floor')
})

test('an explicitly selected unit does not restart use discovery when the missing datum is budget', () => {
  const data = info()
  data.property_context = { query: { scope: 'selected' }, selected_ids: ['p602'] }
  const plan = commercialJourneyPlan(data)
  assert.equal(plan.action, 'ask_budget')
  assert.equal(plan.selected_unit_id, 'p602')
  assert.match(String(plan.instruction), /Conserve la unidad/)
})

test('the residence confirmation preserves technical retrieval state without promoting it to a purchase declaration', () => {
  const current = 'si yo vivo en cuenca', data = info()
  const previous = { _property_context: { query: { group: 'residential', operation: 'search', scope: 'catalog' }, selected_ids: [] },
    _pending_question: { id: 'lead_residence_confirmation', act: 'profile', question: '¿Es Cuenca también su lugar de residencia actual?' } }
  const resolved = resolvePropertyTurn(catalog, current, previous, [], data.semantica_turno)
  assert.equal(object(resolved.context.query).group, 'residential', 'Retrieval continuity is still preserved')
  data.property_context = resolved.context
  assert.equal(commercialJourneyPlan(data).action, 'discover_use')
})

for (const [chosenCategory, chosenGroup, inventedCategory] of [
  ['local', 'commercial', 'departamento'], ['departamento', 'residential', 'local'],
] as const) test('a floor answer rejects the group derived from an invented type while preserving ' + chosenCategory, () => {
  const current = 'Prefiero el primer piso'
  const pending = { id: 'property_floor', act: 'choose_floor', question: '¿En qué piso quiere revisar las opciones?' }
  for (const inventedGroup of [null, inventedCategory === 'local' ? 'commercial' : 'residential']) {
    const semantics = normalizeTurnSemantics({ catalog_request: { purpose: 'search', metric: null, confidence: 'high',
      requirements: [{ field: 'floor_number', operator: 'eq', value: 1, upper_value: null, strength: 'required', evidence: current }],
      semantic_preferences: [], evidence: current }, turn_semantics: {
      primary_intent: 'select_property', primary_evidence: current, confidence: 'high',
      property: { group: inventedGroup, category: inventedCategory, operation: 'search', reference_kind: 'none',
        filters: { floor_number: 1 }, filter_evidence: { floor_number: current }, evidence: current, confidence: 'high' },
      answer_to_previous: { question_id: pending.id, kind: 'value', evidence: current, confidence: 'high' },
    } }, current, pending)
    assert.equal(object(semantics.property).category, null)
    assert.equal(object(semantics.property).group, null)
    const inventory = [...catalog, { id: 'd101', unit_number: '101', category: 'departamento', floor_number: 1, bedrooms: 2 }]
    const resolved = resolvePropertyTurn(inventory, current, { _pending_question: pending, _property_context: {
      query: { group: chosenGroup, category: chosenCategory, operation: 'search', filters: {} }, selected_ids: [],
      category_preference: { category: chosenCategory, confirmed: true, evidence: 'Prefiero ' + chosenCategory },
    } }, [], semantics)
    assert.equal(resolved.query.group, chosenGroup)
    assert.equal(resolved.query.category, chosenCategory)
    assert.deepEqual(resolved.matches.map(unit => unit.id), [chosenCategory === 'local' ? 'local' : 'd101'])
  }
})

test('independent housing evidence survives rejecting an invented category in a floor preference', () => {
  const current = 'Busco una vivienda en el primer piso'
  const semantics = normalizeTurnSemantics({ turn_semantics: {
    primary_intent: 'select_property', primary_evidence: current, confidence: 'high',
    property: { group: 'commercial', category: 'local', operation: 'search', reference_kind: 'none',
      filters: { floor_number: 1 }, filter_evidence: { floor_number: current }, evidence: current, confidence: 'high' },
  } }, current, {})
  assert.equal(object(semantics.property).category, null)
  assert.equal(object(semantics.property).group, 'residential')
  assert.equal(object(object(semantics.property).filters).floor_number, 1)
})
