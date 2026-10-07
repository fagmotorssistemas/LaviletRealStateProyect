import assert from 'node:assert/strict'
import { test } from 'node:test'
import { catalogDialogueReply, catalogQuery, catalogRequirementAlternative } from './catalog-dialogue'
import { commercialJourneyPlan, journeyPendingQuestion, rememberCommercialJourney } from './commercial-journey'
import { object, type Row } from './data'
import { rememberPropertyReply, resolvePropertyTurn, unitsInPropertyReply } from './property-context'
import { normalizeTurnSemantics } from './turn-semantics'
import { taskVerifiedContext, taskModelEvidence, addTaskQueryEvidence } from './task-context'
import { turnEvidence } from './turn-evidence'

const catalog: Row[] = [
  { id: 'd202', unit_number: '202', category: 'departamento', bedrooms: 3, floor_number: 2, area_internal_m2: 120.83, area_exterior_m2: 27.03, bathrooms_full: 2, published_commercial_price: 250000 },
  { id: 'd205', unit_number: '205', category: 'departamento', bedrooms: 3, floor_number: 2, area_internal_m2: 118, area_exterior_m2: 25, bathrooms_full: 2, published_commercial_price: 255000 },
  { id: 'd302', unit_number: '302', category: 'departamento', bedrooms: 3, floor_number: 3, area_internal_m2: 120.83, area_exterior_m2: 27.03, bathrooms_full: 2, published_commercial_price: 270000 },
  { id: 'd502', unit_number: '502', category: 'departamento', bedrooms: 3, floor_number: 5, area_internal_m2: 120.83, area_exterior_m2: 27.03, bathrooms_full: 2, published_commercial_price: 310000 },
  { id: 'p602', unit_number: '602', category: 'penthouse', bedrooms: 3, floor_number: 6, area_internal_m2: 140.53, area_exterior_m2: 23.01, bathrooms_full: 2, published_commercial_price: 539900 },
  { id: 'p605', unit_number: '605', category: 'penthouse', bedrooms: 3, floor_number: 6, area_internal_m2: 142.09, area_exterior_m2: 25.3, bathrooms_full: 3, published_commercial_price: 550000 },
  { id: 's201', unit_number: '201', category: 'suite', bedrooms: 1, floor_number: 2, area_internal_m2: 65, published_commercial_price: 210000 },
]
function info(query: Row = { group: 'residential', operation: 'search', filters: { bedrooms: 3 } }): Row {
  return { catalogo: catalog, catalog_read: { complete: true }, politica_comercial: { precios_autorizados: true },
    lead: { purchase_purpose: 'vivir' }, property_context: { query }, recorrido_comercial: {},
    financiamiento: { partners: ['Banco Pichincha', 'Cooperativa JEP'], journey: {} },
    semantica_turno: { primary_intent: 'select_property', budget: { status: 'not_discussed' } } }
}
function delivered(context: Row, plan: Row, reply: string): Row {
  const pending = journeyPendingQuestion(reply, plan, true, { purpose: 'choose_property',
    continuation_id: plan.question_id, continuation_act: plan.question_act })
  return rememberPropertyReply(catalog, context, reply, { pending_question: pending,
    ...(plan.requested_query ? { original_query: plan.requested_query } : {}) })
}
function resolve(current: string, context: Row, property: Row, kind = 'value') {
  const pending = object(context.pending_question)
  const semantics = normalizeTurnSemantics({ turn_semantics: { primary_intent: 'select_property', primary_evidence: current, confidence: 'high',
    property: { confidence: 'high', evidence: current, reference_kind: 'followup', ...property },
    answer_to_previous: { question_id: pending.id, kind, evidence: current, confidence: 'high' } } }, current, pending)
  return resolvePropertyTurn(catalog, current, { _property_context: context, _pending_question: pending }, [], semantics)
}

test('five bedrooms proceeds through consent, type, floor, displayed units and only then budget', () => {
  const original = { group: 'residential', operation: 'search', filters: { bedrooms: 5 },
    requirements: [{ field: 'bedrooms', operator: 'eq', value: 5, strength: 'required', evidence: 'busco cinco dormitorios' }] }
  let data = info(original), plan = commercialJourneyPlan(data)
  assert.equal(plan.question_id, 'property_requirements')
  assert.match(String(plan.question), /3 dormitorios/)
  assert.deepEqual(plan.alternative_unit_ids, catalog.filter(unit => unit.bedrooms === 3).map(unit => unit.id))
  assert.match(String(plan.instruction), /Recomiende brevemente/)
  assert.match(String(plan.instruction), /No garantice/)
  const offer = `No tenemos viviendas de cinco dormitorios. Podemos valorar las opciones de tres dormitorios por sus espacios. ${plan.question}`
  let context = delivered(object(data.property_context), plan, offer)
  const accepted = resolve('Sí, revisemos esas alternativas', context, { operation: 'none' }, 'affirmative')
  assert.equal(object(accepted.query.filters).bedrooms, 3)
  assert.equal(object(object(accepted.context.original_query).filters).bedrooms, 5)
  assert.deepEqual(accepted.context.selected_ids, [])
  data = { ...data, property_context: accepted.context }
  plan = commercialJourneyPlan(data)
  assert.equal(plan.question_id, 'property_category')
  assert.equal(plan.presentation, 'categories')
  assert.deepEqual(object(plan.selection_scope).categories, ['departamento', 'penthouse'])
  assert.doesNotMatch(String(plan.question), /presupuesto|planta|unidad/)
  context = delivered(accepted.context, plan, `Tenemos departamentos y penthouses de tres dormitorios. ${plan.question}`)
  const apartments = resolve('Me interesan más los departamentos', context, { operation: 'search', category: 'departamento' })
  data = { ...data, property_context: apartments.context }
  plan = commercialJourneyPlan(data)
  assert.equal(plan.question_id, 'property_floor')
  assert.deepEqual(object(plan.selection_scope).floors, [2, 3, 5])
  assert.doesNotMatch(String(plan.question), /penthouse|presupuesto|unidad/)
  assert.match(String(plan.instruction), /superficie interior y exterior/)
  context = delivered(apartments.context, plan, `Estos departamentos están en las plantas 2, 3 y 5. ${plan.question}`)
  const floor = resolve('La segunda planta', context, { operation: 'search', category: 'departamento', filters: { floor_number: 2 } })
  data = { ...data, property_context: floor.context }
  plan = commercialJourneyPlan(data)
  assert.equal(plan.question_id, 'budget_amount')
  assert.equal(plan.presentation, 'units_before_budget')
  assert.equal(plan.requires_unit_presentation, true)
  assert.deepEqual(object(plan.selection_scope).unit_ids, ['d202', 'd205'])
  const reply = `El departamento 202 tiene 120.83 m² interiores y el departamento 205 tiene 118 m² interiores. ${plan.question}`
  const actualIds = unitsInPropertyReply(catalog, reply).map(unit => unit.id)
  data.recorrido_comercial = rememberCommercialJourney({}, plan, {}, true, actualIds)
  data.hechos_confirmados = { budget: { status: 'maximum_total', amount: 300000, confidence: 'high', evidence: 'Mi presupuesto total es 300000' } }
  plan = commercialJourneyPlan(data)
  assert.equal(plan.question_id, 'unit_choice')
  assert.equal(plan.requires_unit_presentation, false)
  assert.deepEqual(object(plan.selection_scope).unit_ids, ['d202', 'd205'])
  assert.equal(object(object(data.property_context).query).category, 'departamento')
  assert.equal(object(object(object(data.property_context).query).filters).floor_number, 2)
  assert.deepEqual(object(data.property_context).selected_ids, [])
})

test('one compatible floor is explained rather than asked, while its units precede budget', () => {
  const data = info({ group: 'residential', category: 'penthouse', operation: 'search', filters: { bedrooms: 3 } })
  const plan = commercialJourneyPlan(data)
  assert.deepEqual(object(plan.selection_scope).floors, [6])
  assert.equal(plan.question_id, 'budget_amount')
  assert.equal(plan.presentation, 'units_before_budget')
  assert.deepEqual(object(plan.selection_scope).unit_ids, ['p602', 'p605'])
  assert.match(String(plan.instruction), /Presente primero los números/)
})

test('one compatible unit is shown with its authorized tour before budget without selecting it', () => {
  const data = info({ group: 'residential', category: 'departamento', operation: 'search', filters: { bedrooms: 3, floor_number: 5 } })
  const plan = commercialJourneyPlan(data), reply = catalogDialogueReply(data)!
  assert.equal(plan.presentation, 'single_unit_before_budget')
  assert.equal(plan.question_id, 'budget_amount')
  assert.equal(plan.selected_unit_id, null)
  assert.match(reply.reply, /departamento 502/i)
  assert.match(reply.reply, /360/)
  assert.match(String(object(reply.audit.unit_model).url), /unidad=502/)
  assert.deepEqual(reply.audit.selected_unit_ids, [])
  assert.equal(plan.requires_unit_presentation, true)
})

test('a budget given voluntarily is preserved and does not remove type or floor decisions', () => {
  const data = info()
  data.hechos_confirmados = { budget: { status: 'maximum_total', amount: 600000, confidence: 'high', evidence: 'Presupuesto total 600000' } }
  let plan = commercialJourneyPlan(data)
  assert.equal(plan.question_id, 'property_category')
  assert.equal(object(object(plan.readiness).budget).amount, 600000)
  data.property_context = { query: { group: 'residential', category: 'departamento', operation: 'search', filters: { bedrooms: 3 } } }
  plan = commercialJourneyPlan(data)
  assert.equal(plan.question_id, 'property_floor')
  object(object(data.property_context).query).filters = { bedrooms: 3, floor_number: 2 }
  plan = commercialJourneyPlan(data)
  assert.equal(plan.question_id, 'unit_choice')
  assert.equal(plan.requires_unit_presentation, true, 'Known money does not prove that unit numbers have been shown.')
})

test('declined and deferred budgets do not reopen the amount after a floor is chosen', () => {
  for (const status of ['declines_to_disclose', 'not_discussed']) {
    const data = info({ group: 'residential', category: 'departamento', operation: 'search', filters: { bedrooms: 3, floor_number: 2 } })
    if (status !== 'not_discussed') data.hechos_confirmados = { budget: { status, confidence: 'high', evidence: 'Prefiero no dar presupuesto' } }
    else data.memoria_comercial = { deferred_fields: ['presupuesto'] }
    const plan = commercialJourneyPlan(data)
    assert.equal(plan.question_id, 'unit_choice')
    assert.equal(plan.financing_offer_allowed, false)
  }
})

test('unit exposure is recorded only from delivered actual IDs and authorized current scope', () => {
  const data = info({ group: 'residential', category: 'departamento', operation: 'search', filters: { bedrooms: 3, floor_number: 2 } })
  const plan = commercialJourneyPlan(data), previous = { presented_unit_ids: ['d502'] }
  assert.deepEqual(rememberCommercialJourney(previous, plan, {}, false, ['d202']), previous)
  assert.deepEqual(rememberCommercialJourney(previous, plan, {}, true).presented_unit_ids, ['d502'])
  assert.deepEqual(rememberCommercialJourney(previous, plan, {}, true, ['d202', 'p602', 'invented']).presented_unit_ids, ['d502', 'd202'])
  data.recorrido_comercial = rememberCommercialJourney(previous, plan, {}, true, ['d202'])
  assert.equal(commercialJourneyPlan(data).requires_unit_presentation, true, 'One displayed option does not expose another option in the same plant.')
  data.recorrido_comercial = rememberCommercialJourney(object(data.recorrido_comercial), plan, {}, true, ['d205'])
  const next = commercialJourneyPlan(data)
  assert.equal(next.presentation, 'known_units')
  assert.equal(next.requires_unit_presentation, false)
})

test('requested informational continuations can clarify options without commercial qualification or offers', () => {
  const data = info()
  data._sales_memory = { passive_sales: true }
  data.commercial_engagement = { passive: true, property_continuation_allowed: true }
  let plan = commercialJourneyPlan(data)
  assert.equal(plan.question_id, 'property_category')
  data.property_context = { query: { group: 'residential', category: 'departamento', operation: 'search', filters: { bedrooms: 3 } } }
  plan = commercialJourneyPlan(data)
  assert.equal(plan.question_id, 'property_floor')
  object(object(data.property_context).query).filters = { bedrooms: 3, floor_number: 2 }
  data.hechos_confirmados = { budget: { status: 'maximum_total', amount: 1000, confidence: 'high', evidence: 'Total 1000' } }
  data.presupuesto_del_turno = { status: 'below_available_prices' }
  plan = commercialJourneyPlan(data)
  assert.equal(plan.question_id, 'unit_choice')
  assert.equal(plan.financing_offer_allowed, false)
  assert.equal(plan.visit_offer_allowed, false)
})

test('general details of three-bedroom homes keep both compatible types and never ask a unit first', () => {
  for (const operation of ['search', 'details']) {
    const data = info({ group: 'residential', operation, filters: { bedrooms: 3 } })
    const answer = catalogDialogueReply(data, 'Indíqueme lo de los 3 dormitorios')!
    assert.match(answer.reply, /departamentos.*penthouses/is)
    assert.equal(object(answer.audit.pending_question).id, 'property_category')
    assert.equal(object(answer.audit.pending_question).act, 'choose_category')
    assert.doesNotMatch(answer.reply, /\b(?:202|205|302|502|602|605)\b/)
    assert.doesNotMatch(String(object(answer.audit.pending_question).question), /unidad|planta|presupuesto/)
  }
})

test('type details show exact known ranges and actual floors without inventing an intermediate plant', () => {
  const data = info({ group: 'residential', category: 'departamento', operation: 'details', filters: { bedrooms: 3 } })
  const answer = catalogDialogueReply(data)!
  assert.match(answer.reply, /desde 118 hasta 120,83 m² interiores/)
  assert.match(answer.reply, /desde 25 hasta 27,03 m² exteriores/)
  assert.match(answer.reply, /planta 2, planta 3 y planta 5/)
  assert.doesNotMatch(answer.reply, /planta 4|\b(?:202|205|302|502)\b/)
  assert.equal(object(answer.audit.pending_question).id, 'property_floor')
})

test('one changed requirement preserves typed floor and budget limits instead of relaxing all filters', () => {
  const query = catalogQuery({ group: 'residential', operation: 'search', filters: { bedrooms: 5 }, requirements: [
    { field: 'bedrooms', operator: 'eq', value: 5, strength: 'required' },
    { field: 'floor_number', operator: 'eq', value: 2, strength: 'required' },
    { field: 'published_commercial_price', operator: 'lte', value: 255000, strength: 'required' },
  ] })
  const proposal = catalogRequirementAlternative(catalog, query, new Set())!
  assert.equal(proposal.field, 'bedrooms')
  assert.deepEqual(proposal.units.map(unit => unit.id), ['d202', 'd205'])
  assert.ok(proposal.query.requirements?.some(r => r.field === 'floor_number' && r.value === 2))
  assert.ok(proposal.query.requirements?.some(r => r.field === 'published_commercial_price' && r.value === 255000))
  const data = info(query), answer = catalogDialogueReply(data)!
  assert.equal(object(answer.audit.pending_question).id, 'property_requirements')
  assert.deepEqual(object(answer.audit.alternative_results).unit_ids, ['d202', 'd205'])
  assert.match(String(object(answer.audit.pending_question).question), /3 dormitorios/)
  assert.doesNotMatch(answer.reply, /penthouse|suite|adicionales|ampliar|remodelar/)
})

test('an indispensable count or several independently viable changes cannot create a made-up recommendation', () => {
  const indispensable = catalogQuery({ group: 'residential', operation: 'search', filters: { bedrooms: 5, bedrooms_required: true } })
  assert.equal(catalogRequirementAlternative(catalog, indispensable, new Set()), null)
  assert.equal(object(catalogDialogueReply(info(indispensable))!.audit.pending_question).id, 'none')
  const conflicting = catalogQuery({ group: 'residential', operation: 'search', filters: { bedrooms: 5, floor_number: 4 } })
  assert.equal(catalogRequirementAlternative(catalog, conflicting, new Set()), null)
})

test('a bedroom recommendation preserves rejected types and never offers a suite as a three-bedroom option', () => {
  const query = catalogQuery({ group: 'residential', category: 'departamento', operation: 'search', filters: { bedrooms: 5 } })
  const compatible = catalogRequirementAlternative(catalog, query, new Set())!
  assert.equal(compatible.query.category, null)
  assert.deepEqual([...new Set(compatible.units.map(unit => unit.category))], ['departamento', 'penthouse'])
  assert.ok(compatible.units.every(unit => unit.bedrooms === 3))
  for (const excluded of ['departamento', 'penthouse']) {
    const proposal = catalogRequirementAlternative(catalog, query, new Set([excluded]))!
    assert.ok(proposal.units.every(unit => unit.category !== excluded && unit.bedrooms === 3))
  }
  const data = info(query)
  data.property_context = { ...object(data.property_context), excluded_categories: ['penthouse'] }
  const answer = catalogDialogueReply(data)!
  assert.doesNotMatch(answer.reply, /penthouse|suite/i)
  assert.ok(object(answer.audit.alternative_results).unit_ids.every((id: string) => id.startsWith('d')))
})

test('a directly identified unit bypasses type and floor discovery without skipping the budget response', () => {
  const data = info({ group: 'residential', category: 'penthouse', operation: 'select', scope: 'selected', filters: { bedrooms: 3, floor_number: 6 } })
  data.property_context = { ...object(data.property_context), selected_ids: ['p602'] }
  data.referencia_unidad = { explicit: true, hasUnitMention: true, matches: [catalog.find(unit => unit.id === 'p602')], query: object(data.property_context).query }
  const plan = commercialJourneyPlan(data), answer = catalogDialogueReply(data, 'Quiero el penthouse 602')!
  assert.equal(plan.question_id, 'budget_amount')
  assert.equal(plan.selected_unit_id, 'p602')
  assert.match(answer.reply, /penthouse 602/i)
  assert.match(String(object(answer.audit.unit_model).url), /unidad=602/)
  assert.deepEqual(answer.audit.selected_unit_ids, ['p602'])
})

test('the reduced writer evidence retains the actual floor units before the budget question', () => {
  for (const floor of [2, 5]) {
    const data = info({ group: 'residential', category: 'departamento', operation: 'search', filters: { bedrooms: 3, floor_number: floor } })
    const answer = catalogDialogueReply(data)!
    data.siguiente_paso_comercial = commercialJourneyPlan(data)
    const projected = taskVerifiedContext(data, answer.audit, `Me interesa la planta ${floor}`)
    const evidence = taskModelEvidence(addTaskQueryEvidence(turnEvidence(data, answer.audit), projected), projected)
    const expected = catalog.filter(unit => unit.category === 'departamento' && unit.bedrooms === 3 && unit.floor_number === floor)
    assert.equal(object(data.siguiente_paso_comercial).requires_unit_presentation, true)
    assert.equal(object(data.siguiente_paso_comercial).question_id, 'budget_amount')
    assert.deepEqual(evidence.units.map(unit => unit.id), expected.map(unit => unit.id))
    assert.deepEqual(evidence.units.map(unit => unit.unit_number), expected.map(unit => unit.unit_number))
    assert.deepEqual(evidence.units.map(unit => unit.area_internal_m2), expected.map(unit => unit.area_internal_m2))
    assert.deepEqual(evidence.units.map(unit => unit.area_exterior_m2), expected.map(unit => unit.area_exterior_m2))
    assert.deepEqual(object(object(projected.siguiente_paso_comercial).selection_scope).unit_ids, expected.map(unit => unit.id))
    assert.ok(evidence.units.every(unit => unit.floor_number === floor && unit.bedrooms === 3))
  }
})

test('operations and accepted financing retain their authorization through the new selection order', () => {
  const data = info()
  for (const audit of [{ source: 'visit_intake' }, { source: 'advisor_handoff' }, { financing_collection: { next_question: 'Cédula pendiente' } }, { reservation: { kind: 'request' } }])
    assert.equal(commercialJourneyPlan(data, audit).action, 'current_operation')
  data.financiamiento = { ...object(data.financiamiento), journey: { accepted: true } }
  const plan = commercialJourneyPlan(data)
  assert.equal(plan.question_id, 'property_category')
  assert.equal(plan.financing_offer_allowed, false)
  assert.match(String(plan.instruction), /No repita que no alcanza/)
})
