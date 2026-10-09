import assert from 'node:assert/strict'
import { test } from 'node:test'
import { commercialJourneyPlan, commercialSelectionQuery, journeyPendingQuestion } from './commercial-journey'
import { object, type Row } from './data'
import { catalogQuery, filterCatalog } from './catalog-dialogue'
import { normalizeCatalogRequest } from './catalog-request'
import { rememberPropertyReply, resolvePropertyTurn } from './property-context'
import { normalizedPendingQuestion, normalizeTurnSemantics } from './turn-semantics'
import { resolvedCatalogQuery } from './resolved-catalog-query'
import { completeCatalogResult } from './catalog-result'
import { compactTurnPromptContext } from './turn-prompt-context'

const catalog: Row[] = [
  ...[2, 3, 4, 5].map(floor => ({ id: `d${floor}02`, unit_number: `${floor}02`, category: 'departamento', bedrooms: 3,
    floor_number: floor, area_internal_m2: 120.83, published_commercial_price: 250000 + (floor - 2) * 20000 })),
  { id: 'p602', unit_number: '602', category: 'penthouse', bedrooms: 3, floor_number: 6, area_internal_m2: 142.09, published_commercial_price: 550000 },
  { id: 'd304', unit_number: '304', category: 'departamento', bedrooms: 2, floor_number: 3, area_internal_m2: 109.69, published_commercial_price: 270000 },
]
const candidateIds = catalog.filter(unit => unit.bedrooms === 3).map(unit => unit.id)
const original = (strict = false): Row => ({ group: 'residential', category: null, scope: 'catalog', operation: 'search',
  filters: { bedrooms: 5, bedrooms_required: strict }, requirements: [{ field: 'bedrooms', operator: 'eq', value: 5, strength: 'required', evidence: 'necesito 5' }] })
const proposed: Row = { group: 'residential', category: null, operation: 'search', scope: 'catalog', filters: { bedrooms: 3 } }
const pending: Row = { id: 'property_requirements', act: 'explore_alternatives',
  question: '¿Le gustaría revisar las opciones de tres dormitorios?', candidate_ids: candidateIds, proposed_query: proposed }
const context = (strict = false): Row => ({ query: original(strict), original_query: original(strict), pending_question: pending,
  selected_ids: [], comparison_ids: [], offered_ids: [], focused_ids: [], last_reply: '' })
const info = (resolved: ReturnType<typeof resolvePropertyTurn>, semantic: Row, purpose = ''): Row => ({
  lead: { purchase_purpose: purpose }, catalogo: catalog, catalogo_verificacion: catalog, catalog_read: { complete: true },
  property_context: resolved.context, referencia_unidad: resolved, semantica_turno: semantic,
  recorrido_comercial: {}, financiamiento: { partners: [] }, politica_comercial: { precios_autorizados: true },
  solicitudes_interpretadas: [{ domain: 'property', confidence: 'high', evidence: semantic.primary_evidence }],
})
function semantic(current: string, changes: Row = {}, request?: Row): Row {
  const raw: Row = { primary_intent: 'project_information', primary_evidence: current, confidence: 'high',
    property: { group: 'residential', category: null, operation: 'details', reference_kind: 'followup', query_scope: 'offered',
      filters: {}, evidence: current, confidence: 'high', ...changes },
    ...(request ? { catalog_request: request } : {}) }
  return { ...normalizeTurnSemantics({ turn_semantics: raw, ...(request ? { catalog_request: request } : {}) }, current, pending),
    ...(request ? { catalog_request: normalizeCatalogRequest(request, current), catalog_request_status: 'validated' } : {}) }
}
const request = (current: string, purpose = 'details', target = 3): Row => ({ purpose,
  metric: purpose === 'range' ? 'published_commercial_price' : null,
  requirements: [{ field: 'bedrooms', operator: 'eq', value: target, strength: 'required', upper_value: null, evidence: current }],
  semantic_preferences: [], evidence: current, confidence: 'high' })

for (const current of ['Bueno gracias, ¿cómo puedo ver el departamento?', 'Bueno gracias', 'Busco vivir ahí']) {
  test('an interruption preserves the proposed adjustment without accepting or restarting it: ' + current, () => {
    const sem = semantic(current, { category: current.includes('departamento') ? 'departamento' : null })
    const resolved = resolvePropertyTurn(catalog, current, { _property_context: context(), _pending_question: pending }, [], sem)
    assert.equal(object(object(resolved.context.query).filters).bedrooms, 5)
    assert.equal(object(resolved.context.pending_question).act, 'explore_alternatives')
    assert.deepEqual(resolved.context.selected_ids, [])
    const plan = commercialJourneyPlan(info(resolved, sem, current.includes('vivir') ? 'vivir' : ''))
    assert.equal(plan.action, 'clarify_requirements')
    assert.equal(plan.question_id, 'property_requirements')
    assert.equal(plan.question_act, 'explore_alternatives')
    assert.deepEqual(plan.alternative_unit_ids, candidateIds)
    assert.equal(object(object(plan.proposed_query).filters).bedrooms, 3)
    const reply = `Puede revisar el recorrido general. ${String(plan.question)}`
    const after = rememberPropertyReply(catalog, resolved.context, reply, {
      pending_question: journeyPendingQuestion(reply, plan, true), unit_model: { unit_id: null },
    })
    assert.equal(object(object(after.query).filters).bedrooms, 5)
    assert.equal(object(after.pending_question).act, 'explore_alternatives')
    assert.deepEqual(after.selected_ids, [])
  })
}

for (const strict of [false, true]) {
  test('explicit exploration of three is separate from the original five, including strict needs: ' + strict, () => {
    const current = 'Como le mencioné necesito 5 pero bueno quiero saber de los de 3 dormitorios'
    const raw = { primary_intent: 'project_information', primary_evidence: 'quiero saber de los de 3 dormitorios', confidence: 'high',
      housing_quantities: [{ dimension: 'bedrooms', role: 'requirement', values: [5], count_basis: 'unspecified', evidence: 'necesito 5', confidence: 'high' }],
      property: { operation: 'details', group: 'residential', category: 'departamento', reference_kind: 'followup', query_scope: 'offered',
        filters: { bedrooms: 3 }, filter_evidence: { bedrooms: 'quiero saber de los de 3 dormitorios' }, evidence: current, confidence: 'high' },
      catalog_request: request('quiero saber de los de 3 dormitorios') }
    const sem = { ...normalizeTurnSemantics({ turn_semantics: raw, catalog_request: raw.catalog_request }, current, pending),
      catalog_request: normalizeCatalogRequest(raw.catalog_request, current), catalog_request_status: 'validated' }
    assert.equal(object(object(sem.property).filters).bedrooms, null, 'The guarded need is not silently rewritten')
    const saved = context(strict)
    object(saved.query).category = 'departamento' // former visualization inquiry, not an affirmed preference
    const resolved = resolvePropertyTurn(catalog, current, { _property_context: saved, _pending_question: pending }, [], sem)
    assert.equal(object(resolved.context.exploration_state).authorized, true)
    assert.equal(object(object(resolved.context.original_query).filters).bedrooms, 5)
    assert.equal(object(object(resolved.context.original_query).filters).bedrooms_required, strict)
    assert.deepEqual(resolved.context.selected_ids, [])
    assert.equal(resolved.query.category, null)
    assert.deepEqual(resolved.matches.map(unit => unit.id), candidateIds)
    const input = info(resolved, sem)
    input.hechos_confirmados = { budget: { status: 'maximum_total', amount: 600000, confidence: 'high', evidence: 'Mi presupuesto total es 600 mil' } }
    input.lead = { purchase_purpose: 'vivir', preferred_category: 'departamento', preferred_bedrooms: 5 }
    assert.equal(commercialSelectionQuery(input).category, null, 'An inherited CRM category is not the current type choice')
    const plan = commercialJourneyPlan(input)
    assert.equal(plan.question_act, 'choose_category')
    assert.equal(plan.question_id, 'property_category')
    assert.deepEqual(object(plan.selection_scope).categories, ['departamento', 'penthouse'])
    assert.doesNotMatch(String(plan.question), /cuántos dormitorios|vivir|inversión/i)
    const retrieved = resolvedCatalogQuery(input)
    assert.equal(retrieved.reason, 'eligible')
    assert.deepEqual(completeCatalogResult(input, retrieved.query, retrieved.request, retrieved.scopedIds).units.map(unit => unit.id),
      filterCatalog(catalog, commercialSelectionQuery(input)).map(unit => unit.id))
    const projected = compactTurnPromptContext({ ...input,
      contexto_verificado: { prompt_context_selection: { version: 'task-context-v1' } },
      evidencia_turno: { units: resolved.matches } }, { preserveUnitIds: true })
    assert.deepEqual(object(projected.property_context).query, resolved.context.query)
    assert.deepEqual(object(projected.property_context).original_query, resolved.context.original_query)
    assert.deepEqual(object(projected.property_context).exploration_state, resolved.context.exploration_state)
    assert.equal(object(projected.property_context).selected_ids instanceof Array, true)
  })
}

test('a direct price question about three does not accept the proposed change', () => {
  const current = '¿Qué precios tienen los de 3 dormitorios?'
  const sem = semantic(current, { operation: 'search', reference_kind: 'none', query_scope: 'catalog' }, request(current, 'range'))
  sem.primary_intent = 'ask_price'
  const resolved = resolvePropertyTurn(catalog, current, { _property_context: context(), _pending_question: pending }, [], sem)
  assert.equal(resolved.reason, 'pending_proposal_information')
  assert.equal(resolved.context.exploration_state, undefined)
  assert.equal(object(object(resolved.context.query).filters).bedrooms, 5)
  assert.equal(object(resolved.context.pending_question).act, 'explore_alternatives')
  assert.deepEqual(resolved.context.selected_ids, [])
})

test('a price inquiry mislabeled as search does not relax the original strict requirement', () => {
  const current = 'Necesito cinco dormitorios obligatoriamente, pero quiero saber los precios de los de 3 dormitorios'
  const sem = semantic(current, { operation: 'search', reference_kind: 'none', query_scope: 'catalog' }, request('quiero saber los precios de los de 3 dormitorios', 'search'))
  const resolved = resolvePropertyTurn(catalog, current, { _property_context: context(true), _pending_question: pending }, [], sem)
  assert.equal(resolved.reason, 'pending_proposal_information')
  assert.equal(resolved.context.exploration_state, undefined)
  assert.equal(object(object(resolved.context.query).filters).bedrooms, 5)
  assert.equal(object(object(resolved.context.original_query).filters).bedrooms_required, true)
  assert.equal(object(resolved.context.pending_question).act, 'explore_alternatives')
  assert.deepEqual(resolved.context.selected_ids, [])
  assert.ok(resolved.matches.every(unit => unit.bedrooms === 3))
})

test('a legacy query recovers the original bedroom need while preserving the active alternative consultation', () => {
  const current = 'Como le mencioné necesito 5 pero bueno quiero saber de los de 3 dormitorios'
  const raw: Row = { primary_intent: 'project_information', primary_evidence: 'quiero saber de los de 3 dormitorios', confidence: 'high',
    housing_quantities: [{ dimension: 'bedrooms', role: 'requirement', values: [5], count_basis: 'unspecified', evidence: 'necesito 5', confidence: 'high' }],
    property: { operation: 'details', group: 'residential', category: 'departamento', reference_kind: 'followup', query_scope: 'offered',
      filters: { bedrooms: 3 }, filter_evidence: { bedrooms: 'quiero saber de los de 3 dormitorios' }, evidence: current, confidence: 'high' } }
  const typed = request('quiero saber de los de 3 dormitorios')
  const sem = { ...normalizeTurnSemantics({ turn_semantics: raw, catalog_request: typed }, current),
    catalog_request: normalizeCatalogRequest(typed, current), catalog_request_status: 'validated' }
  const legacy = { query: { group: 'residential', category: 'departamento', filters: {}, operation: 'search' },
    optimized_catalog_request: { group: 'residential', category: 'departamento', requirements: typed.requirements },
    pending_question: { id: 'property_bedrooms', act: 'choose_category' }, selected_ids: [], offered_ids: [], comparison_ids: [] }
  const resolved = resolvePropertyTurn(catalog, current, { _property_context: legacy }, [], sem)
  assert.equal(object(object(resolved.context.original_query).filters).bedrooms, 5)
  assert.equal(object(resolved.context.exploration_state).authorized, true)
  assert.equal(resolved.query.category, null)
  assert.deepEqual(resolved.matches.map(unit => unit.id), candidateIds)
  assert.deepEqual(object(resolved.context.optimized_catalog_request).requirements, resolved.query.requirements)
  assert.equal(object(resolved.context.optimized_catalog_request).category, null)
  const plan = commercialJourneyPlan({ ...info(resolved, sem, 'vivir'),
    hechos_confirmados: { budget: { status: 'maximum_total', amount: 600000, confidence: 'high', evidence: 'Mi presupuesto total es 600 mil' } } })
  assert.equal(plan.question_id, 'property_category')
  assert.deepEqual(object(plan.selection_scope).categories, ['departamento', 'penthouse'])
  assert.doesNotMatch(String(plan.question), /cuántos dormitorios|finalmente/i)
  assert.deepEqual(resolved.context.selected_ids, [])
})

test('legacy family-size context is never recovered as an original bedroom requirement', () => {
  const current = 'Somos 5 personas pero quiero saber de los de 3 dormitorios'
  const sem = semantic(current, { operation: 'search', reference_kind: 'none', query_scope: 'catalog' }, request('quiero saber de los de 3 dormitorios'))
  sem.housing_quantities = [{ dimension: 'people', role: 'context', values: [5], evidence: 'Somos 5 personas', confidence: 'high' }]
  const resolved = resolvePropertyTurn(catalog, current, { _property_context: { query: { group: 'residential', filters: {} } } }, [], sem)
  assert.equal(resolved.context.original_query, undefined)
  assert.equal(resolved.context.exploration_state, undefined)
  assert.deepEqual(resolved.context.selected_ids, [])
})

for (const operation of ['none', 'search', 'details']) {
  test('a visual follow-up retains the verified selected unit and pending budget despite operation variance: ' + operation, () => {
    const current = '¿Cómo puedo ver el departamento?'
    const saved = { query: { group: 'residential', category: 'departamento', scope: 'selected', operation: 'select', filters: { bedrooms: 3 } },
      selected_ids: ['d202'], focused_ids: ['d202'], offered_ids: ['d202'], comparison_ids: [],
      pending_question: { id: 'budget_amount', act: 'budget', question: '¿Tiene un presupuesto establecido?' } }
    const sem = semantic(current, { category: 'departamento', operation, reference_kind: 'followup', query_scope: 'selected' })
    const resolved = resolvePropertyTurn(catalog, current, { _property_context: saved, _pending_question: saved.pending_question }, [], sem)
    assert.equal(resolved.reason, 'selected_visual_followup')
    assert.deepEqual(resolved.context.selected_ids, ['d202'])
    assert.deepEqual(resolved.context.focused_ids, ['d202'])
    assert.deepEqual(resolved.matches.map(unit => unit.id), ['d202'])
    assert.equal(resolved.query.operation, 'details')
    assert.equal(resolved.query.scope, 'selected')
    assert.equal(object(resolved.context.pending_question).id, 'budget_amount')
  })
}

test('a visual question with a new bedroom requirement uses its own search subject', () => {
  const current = '¿Cómo puedo ver un departamento de 2 dormitorios?'
  const saved = { query: { group: 'residential', category: 'departamento', scope: 'selected', operation: 'select', filters: { bedrooms: 3 } },
    selected_ids: ['d202'], focused_ids: ['d202'], offered_ids: ['d202'], pending_question: {} }
  const sem = semantic(current, { category: 'departamento', operation: 'search', reference_kind: 'none', query_scope: 'catalog' }, request(current, 'search', 2))
  const resolved = resolvePropertyTurn(catalog, current, { _property_context: saved }, [], sem)
  assert.notEqual(resolved.reason, 'selected_visual_followup')
  assert.deepEqual(resolved.matches.map(unit => unit.id), ['d304'])
})

test('a typed bedroom condition prevents rediscovery even if the guarded optional filter is empty', () => {
  const query = { group: 'residential', category: 'departamento', operation: 'details', filters: {}, requirements: request('tres dormitorios').requirements }
  const plan = commercialJourneyPlan({ lead: { purchase_purpose: 'vivir' }, catalogo: catalog, catalog_read: { complete: true },
    property_context: { query }, financiamiento: { partners: [] },
    hechos_confirmados: { budget: { status: 'no_defined_budget', confidence: 'high', evidence: 'Aún no tengo presupuesto definido' } } })
  assert.equal(plan.question_id, 'property_floor')
  assert.deepEqual(object(plan.selection_scope).unit_ids, candidateIds.filter(id => id.startsWith('d')))
})

test('planning preserves matching explicit bedroom filters but never restores deliberately omitted or conflicting ones', () => {
  for (const { bedrooms, target, expected } of [
    { bedrooms: 5, target: 5, expected: 5 },
    { bedrooms: null, target: 3, expected: null },
    { bedrooms: 5, target: 3, expected: null },
  ]) {
    const input = { property_context: { query: { group: 'residential', filters: { bedrooms },
      requirements: request(`${target} dormitorios`, 'details', target).requirements } }, lead: { preferred_bedrooms: 5 } }
    const query = commercialSelectionQuery(input)
    assert.equal(object(query.filters).bedrooms, expected)
    assert.equal(object((query.requirements as Row[])[0]).value, target)
  }
})

test('accepted alternatives recover early budget before type, floor and presented units', () => {
  const current = 'Sí, revisemos esas alternativas'
  const sem = semantic(current)
  sem.answer_to_previous = { question_id: pending.id, kind: 'affirmative', evidence: current, confidence: 'high' }
  const accepted = resolvePropertyTurn(catalog, current, { _property_context: context(), _pending_question: pending }, [], sem)
  const budget = { status: 'maximum_total', amount: 600000, evidence: 'Mi presupuesto total es 600 mil', confidence: 'high' }
  const withBudget = (resolved: ReturnType<typeof resolvePropertyTurn>, turn: Row) => ({ ...info(resolved, turn), hechos_confirmados: { budget } })
  let plan = commercialJourneyPlan(info(accepted, sem, 'vivir'))
  assert.equal(plan.question_id, 'budget_amount')
  assert.equal(Boolean(plan.requires_unit_presentation), false)
  assert.deepEqual(accepted.context.selected_ids, [])
  plan = commercialJourneyPlan(withBudget(accepted, sem))
  assert.equal(plan.question_act, 'choose_category')
  const typeQuestion = normalizedPendingQuestion(journeyPendingQuestion(String(plan.question), plan, true), catalog)
  const remembered = rememberPropertyReply(catalog, accepted.context, String(plan.question), { pending_question: typeQuestion })
  const preference = 'Me interesan más los departamentos'
  const typeSem = semantic(preference, { category: 'departamento', operation: 'search' })
  const type = resolvePropertyTurn(catalog, preference, { _property_context: remembered, _pending_question: typeQuestion }, [], typeSem)
  plan = commercialJourneyPlan(withBudget(type, typeSem))
  assert.equal(plan.question_act, 'choose_floor', JSON.stringify({ plan, context: type.context, query: type.query }))
  assert.deepEqual(object(plan.selection_scope).floors, [2, 3, 4, 5])
  assert.ok((object(plan.selection_scope).unit_ids as string[]).every(id => id.startsWith('d')))
  const floorQuestion = normalizedPendingQuestion(journeyPendingQuestion(String(plan.question), plan, true), catalog)
  const afterType = rememberPropertyReply(catalog, type.context, String(plan.question), { pending_question: floorQuestion })
  const floorSem = semantic('La tercera planta', { operation: 'search', filters: { floor_number: 3 } })
  const floor = resolvePropertyTurn(catalog, 'La tercera planta', { _property_context: afterType, _pending_question: floorQuestion }, [], floorSem)
  plan = commercialJourneyPlan(withBudget(floor, floorSem))
  assert.equal(plan.action, 'select_property')
  assert.equal(plan.question_act, 'confirm_unit')
  assert.equal(plan.requires_unit_presentation, true)
  assert.deepEqual(object(plan.selection_scope).unit_ids, ['d302'])
  assert.deepEqual(floor.context.selected_ids, [])
  assert.equal(object(object(floor.context.original_query).filters).bedrooms, 5)
})

test('the current category inquiry does not become a category preference', () => {
  const current = 'Me interesa el precio de los departamentos de 3 dormitorios'
  const sem = semantic(current, { category: 'departamento', operation: 'details' }, request(current, 'range'))
  sem.primary_intent = 'ask_price'
  const resolved = resolvePropertyTurn(catalog, current, { _property_context: context(), _pending_question: pending }, [], sem)
  assert.equal(resolved.context.category_preference, undefined)
  assert.equal(object(resolved.context.pending_question).act, 'explore_alternatives')
})

test('declining alternatives and a new incompatible search cannot be treated as acceptance', () => {
  const current = 'No, necesito exactamente cinco dormitorios'
  const sem = semantic(current, { operation: 'search', filters: { bedrooms: 5, bedrooms_required: true } }, request(current, 'search', 5))
  sem.answer_to_previous = { question_id: pending.id, kind: 'negative', evidence: 'No', confidence: 'high' }
  const resolved = resolvePropertyTurn(catalog, current, { _property_context: context(true), _pending_question: pending }, [], sem)
  assert.equal(resolved.context.exploration_state, undefined)
  assert.deepEqual(resolved.context.selected_ids, [])
  assert.equal(filterCatalog(catalog, catalogQuery(resolved.query)).length, 0)
})
