import assert from 'node:assert/strict'
import { test } from 'node:test'
import { commercialJourneyPlan, journeyPendingQuestion } from './commercial-journey'
import { resolvePropertyTurn, rememberPropertyReply } from './property-context'
import { normalizedPendingQuestion, normalizeTurnSemantics } from './turn-semantics'
import { resolvedCatalogQuery } from './resolved-catalog-query'
import { completeCatalogResult } from './catalog-result'
import { object, type Row } from './data'

const catalog: Row[] = [
  { id: 'd302', unit_number: '302', category: 'departamento', bedrooms: 3, bathrooms_full: 2, floor_number: 3, area_internal_m2: 120.83, area_exterior_m2: 27.03, published_commercial_price: 270000 },
  { id: 'p602', unit_number: '602', category: 'penthouse', bedrooms: 3, bathrooms_full: 2, floor_number: 6, area_internal_m2: 142.09, area_exterior_m2: 25.3, published_commercial_price: 550000 },
  { id: 'd304', unit_number: '304', category: 'departamento', bedrooms: 2, bathrooms_full: 2, floor_number: 3, area_internal_m2: 109.69, published_commercial_price: 270000 },
  { id: 's303', unit_number: '303', category: 'suite', bedrooms: 1, bathrooms_full: 1, floor_number: 3, area_internal_m2: 70, published_commercial_price: 210000 },
]
const bedroomRequirement = { field: 'bedrooms', operator: 'eq', value: 5, strength: 'required', evidence: 'si es posible, de cinco dormitorios' }
function info(budget: Row = { status: 'not_discussed' }): Row {
  return { catalogo: catalog, catalog_read: { complete: true }, catalog_search: { embeddingsEnabled: false },
    politica_comercial: { precios_autorizados: true }, lead: { purchase_purpose: 'vivir', preferred_bedrooms: 5 },
    property_context: { query: { group: 'residential', operation: 'search', filters: { bedrooms: 5 }, requirements: [bedroomRequirement] } },
    semantica_turno: { primary_intent: 'select_property', budget, household: { occupants: 6, confidence: 'high' } },
    financiamiento: { partners: ['Banco Pichincha', 'Cooperativa JEP'], journey: {} }, recorrido_comercial: {} }
}
function offered(input = info()) {
  const plan = commercialJourneyPlan(input)
  const reply = `No encontramos coincidencias confirmadas con los requisitos actuales. ${String(plan.question)}`
  const pending = normalizedPendingQuestion(journeyPendingQuestion(reply, plan, true), catalog)
  const context = rememberPropertyReply(catalog, object(input.property_context), reply,
    { pending_question: pending, original_query: plan.requested_query })
  return { plan, pending, context }
}
function answer(current: string, pending: Row, kind = 'affirmative', operation = 'none') {
  return normalizeTurnSemantics({ turn_semantics: { primary_intent: 'answer_previous', primary_evidence: current, confidence: 'high',
    property: { operation, reference_kind: 'followup', evidence: current, confidence: 'high' },
    answer_to_previous: { question_id: pending.id, kind, evidence: current, confidence: 'high' } } }, current, pending)
}

test('an unavailable requirement is clarified before every budget state and already accepted financing', () => {
  for (const budget of [
    { status: 'not_discussed' },
    { status: 'amount_pending', evidence: 'sí tengo presupuesto', confidence: 'high' },
    { status: 'no_defined_budget', evidence: 'aún no lo tengo definido', confidence: 'high' },
    { status: 'amount', amount: 400000, evidence: 'estimo 400 mil', confidence: 'high' },
  ]) for (const accepted of [false, true]) {
    const input = info(budget)
    object(input.financiamiento).journey = { accepted }
    const plan = commercialJourneyPlan(input)
    assert.equal(plan.action, 'clarify_requirements')
    assert.equal(plan.question_id, 'property_requirements')
    assert.match(String(plan.question), /3 dormitorios/)
    assert.equal(plan.financing_offer_allowed, false)
    assert.equal(object(object(plan.proposed_query).filters).bedrooms, 3)
    assert.deepEqual(plan.alternative_unit_ids, ['d302', 'p602'])
    assert.equal(object(object(plan.requested_query).filters).bedrooms, 5)
    assert.equal(object(object(plan.readiness).budget).status, budget.status)
  }
})

test('planning uses the full verification snapshot when retrieval has no matching units', () => {
  const input = { ...info(), catalogo: [], catalogo_verificacion: catalog }
  const plan = commercialJourneyPlan(input, { verified_catalog: true, catalog_results: { units: [], complete: true, unknown_unit_ids: [] } })
  assert.equal(plan.action, 'clarify_requirements')
  assert.equal(plan.match_complete, true)
  assert.deepEqual(plan.alternative_unit_ids, ['d302', 'p602'])
  assert.match(String(plan.question), /3 dormitorios/)
})

test('six people alone never creates a bedroom requirement', () => {
  const input = info()
  input.lead = { purchase_purpose: 'vivir' }
  input.property_context = { query: { group: 'residential', operation: 'search', filters: {} } }
  assert.equal(commercialJourneyPlan(input).action, 'discover_bedrooms')
})

test('accepting the explicit alternative changes only the exploration query, retaining original needs', () => {
  for (const operation of ['none', 'search', 'select']) {
    const { plan, pending, context } = offered()
    const before = structuredClone(context)
    assert.equal(pending.act, 'explore_alternatives')
    assert.equal(object(object(pending.proposed_query).filters).bedrooms, 3)
    const current = 'Sí, por favor, revisemos esas alternativas'
    const result = resolvePropertyTurn(catalog, current, { _property_context: context, _pending_question: pending }, [], answer(current, pending, 'affirmative', operation))
    assert.equal(result.reason, 'accepted_alternative_query', operation)
    assert.equal(object(result.query.filters).bedrooms, 3)
    assert.equal(result.query.operation, 'search')
    assert.equal(result.explicit, false)
    assert.deepEqual(result.context.selected_ids, [])
    assert.deepEqual(result.matches.map(unit => unit.id), ['d302', 'p602'])
    assert.equal(object(object(result.context.original_query).filters).bedrooms, 5)
    assert.ok(!Array.isArray(result.query.requirements) || !result.query.requirements.some((r: Row) => r.field === 'bedrooms' && r.value === 5))
    assert.deepEqual(context, before, 'Resolution must not mutate the stored original context')
    const resumed = { ...info(), property_context: result.context, semantica_turno: answer(current, pending) }
    assert.equal(commercialJourneyPlan(resumed).action, 'ask_budget')
    assert.equal(plan.selected_unit_id, null)
  }
})

test('a declined change preserves the original query and is not offered again', () => {
  const { pending, context } = offered()
  const current = 'No, gracias; necesito los cinco dormitorios'
  const result = resolvePropertyTurn(catalog, current, { _property_context: context, _pending_question: pending }, [], answer(current, pending, 'negative'))
  assert.equal(result.reason, 'alternative_query_declined')
  assert.equal(object(result.query.filters).bedrooms, 5)
  assert.deepEqual(result.context.selected_ids, [])
  const next = commercialJourneyPlan({ ...info(), property_context: result.context, semantica_turno: answer(current, pending, 'negative') })
  assert.equal(next.action, 'clarify_requirements')
  assert.equal(next.question, '')
  assert.equal(next.proposed_query, undefined)
  assert.match(String(next.instruction), /rechazó ajustar/)
})

test('a generic willingness to adjust cannot invent a proposal, and obsolete alternatives need clarification', () => {
  const { pending, context } = offered()
  const current = 'sí, está bien'
  const generic = { ...pending, act: 'other', proposed_query: undefined, candidate_ids: [] }
  const unresolved = resolvePropertyTurn(catalog, current, { _property_context: context, _pending_question: generic }, [], answer(current, generic))
  assert.equal(object(unresolved.query.filters).bedrooms, 5)
  assert.deepEqual(unresolved.context.selected_ids, [])
  const unavailable = resolvePropertyTurn(catalog.filter(unit => unit.bedrooms !== 3), current,
    { _property_context: context, _pending_question: pending }, [], answer(current, pending))
  assert.equal(unavailable.reason, 'alternative_query_unavailable')
  assert.equal(unavailable.needsClarification, true)
  assert.equal(object(unavailable.query.filters).bedrooms, 5)
  assert.deepEqual(unavailable.context.selected_ids, [])
})

test('a bedroom proposal preserves other requirements and never substitutes a physically incompatible alternative', () => {
  const input = info()
  object(object(input.property_context).query).requirements = [bedroomRequirement,
    { field: 'floor_number', operator: 'eq', value: 3, strength: 'required', evidence: 'tercera planta' }]
  const { pending, context } = offered(input)
  assert.deepEqual(pending.candidate_ids, ['d302'])
  assert.ok((object(pending.proposed_query).requirements as Row[]).some(r => r.field === 'floor_number' && r.value === 3))
  const current = 'sí, revisemos'
  const result = resolvePropertyTurn(catalog, current, { _property_context: context, _pending_question: pending }, [], answer(current, pending))
  assert.deepEqual(result.matches.map(unit => unit.id), ['d302'])
  assert.ok((result.query.requirements as Row[]).some(r => r.field === 'floor_number' && r.value === 3))
  const incompatible = info()
  object(object(incompatible.property_context).query).requirements = [bedroomRequirement,
    { field: 'bathrooms_full', operator: 'gte', value: 3, strength: 'required', evidence: 'al menos tres baños' }]
  const plan = commercialJourneyPlan(incompatible)
  assert.equal(plan.action, 'clarify_requirements')
  assert.equal(plan.proposed_query, undefined)
  assert.doesNotMatch(String(plan.question), /3 dormitorios/)
})

test('unknown or partial inventory limits the conclusion, while indispensable bedrooms are respected', () => {
  for (const input of [
    { ...info(), catalog_read: { complete: false } },
    { ...info(), catalogo: [...catalog, { id: 'unknown', category: 'departamento', bedrooms: null }] },
  ]) {
    const plan = commercialJourneyPlan(input)
    assert.equal(plan.match_complete, false)
    assert.match(String(plan.instruction), /faltan fichas o datos/)
    assert.match(String(plan.question), /alternativas de 3 dormitorios/)
  }
  const strict = info()
  object(object(object(strict.property_context).query).filters).bedrooms_required = true
  const plan = commercialJourneyPlan(strict)
  assert.equal(plan.action, 'clarify_requirements')
  assert.equal(plan.question, '')
  assert.equal(plan.proposed_query, undefined)
  assert.match(String(plan.instruction), /indispensable/)
})

test('another modeled physical dimension can be relaxed without dropping unrelated constraints', () => {
  const input = info()
  input.lead = { purchase_purpose: 'vivir', preferred_bedrooms: 3 }
  input.property_context = { query: { group: 'residential', operation: 'search', filters: { bedrooms: 3 }, requirements: [
    { field: 'area_exterior_m2', operator: 'gte', value: 100, strength: 'required', evidence: 'al menos 100 metros exteriores' },
    { field: 'floor_number', operator: 'eq', value: 3, strength: 'required', evidence: 'tercera planta' },
    { field: 'published_commercial_price', operator: 'lte', value: 300000, strength: 'required', evidence: 'hasta 300 mil' },
  ] } }
  const { pending, context, plan } = offered(input)
  assert.equal(object(plan.requirement_change).field, 'area_exterior_m2')
  assert.deepEqual(pending.candidate_ids, ['d302'])
  const current = 'Sí, podemos revisar esas alternativas'
  const result = resolvePropertyTurn(catalog, current, { _property_context: context, _pending_question: pending }, [], answer(current, pending))
  assert.deepEqual(result.matches.map(unit => unit.id), ['d302'])
  assert.ok((result.query.requirements as Row[]).some(r => r.field === 'published_commercial_price' && r.value === 300000))
  assert.ok((result.query.requirements as Row[]).some(r => r.field === 'floor_number' && r.value === 3))
  assert.deepEqual(result.context.selected_ids, [])
})

test('missing evidence for an unmodeled requirement is not presented as a need to change it', () => {
  const input = info()
  input.lead = { purchase_purpose: 'vivir', preferred_bedrooms: 3 }
  input.property_context = { query: { group: 'residential', operation: 'search', filters: { bedrooms: 3 }, requirements: [
    { field: 'unmodeled', operator: 'contains', value: 'acceso adaptado', strength: 'required', evidence: 'necesito acceso adaptado' },
  ] } }
  const plan = commercialJourneyPlan(input)
  assert.equal(plan.match_complete, false)
  assert.equal(plan.proposed_query, undefined)
  assert.equal(plan.question, '')
  assert.match(String(plan.instruction), /ausencia no se ha confirmado/)
})

test('retrieval after consent does not inherit superseded optimized requirements', () => {
  const remaining = { field: 'floor_number', operator: 'eq', value: 3, strength: 'required', evidence: 'tercera planta' }
  for (const constraints of [[bedroomRequirement], [bedroomRequirement, remaining]]) for (const status of [undefined, 'not_requested']) {
    const input = info()
    const context = object(input.property_context)
    object(context.query).requirements = constraints
    context.optimized_catalog_request = { category: null, group: 'residential', requirements: constraints }
    const { pending, context: stored } = offered(input)
    const current = 'Sí, revisemos esas alternativas'
    const semantics = { ...answer(current, pending), catalog_request: null, ...(status ? { catalog_request_status: status } : {}) }
    const accepted = resolvePropertyTurn(catalog, current, { _property_context: stored, _pending_question: pending }, [], semantics)
    const optimized = object(accepted.context.optimized_catalog_request)
    assert.deepEqual(optimized.requirements, constraints.filter(r => r.field !== 'bedrooms'))
    assert.deepEqual(object(accepted.context.original_query).requirements, constraints)
    assert.equal(object(object(accepted.context.original_query).filters).bedrooms, 5)
    const retrievalInput = { ...input, property_context: accepted.context, referencia_unidad: accepted,
      semantica_turno: semantics, solicitudes_interpretadas: [{ domain: 'property', confidence: 'high', evidence: current, request: current }] }
    const resolved = resolvedCatalogQuery(retrievalInput)
    assert.equal(resolved.reason, 'eligible')
    assert.equal(resolved.query.filters.bedrooms, 3)
    assert.ok(!(resolved.request.requirements as Row[]).some(r => r.field === 'bedrooms' && r.value === 5))
    const matches = completeCatalogResult(retrievalInput, resolved.query, resolved.request)
    assert.deepEqual(matches.units.map(unit => unit.id), constraints.length > 1 ? ['d302'] : ['d302', 'p602'])
    assert.deepEqual(accepted.context.selected_ids, [])
  }
})
