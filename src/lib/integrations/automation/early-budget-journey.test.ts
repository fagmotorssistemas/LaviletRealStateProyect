import assert from 'node:assert/strict'
import { test } from 'node:test'
import { commercialJourneyPlan, rememberCommercialJourney } from './commercial-journey'
import { financingStage } from './financing-stage'
import { projectContentForWriter, responseContentScope } from './response-content-scope'
import { budgetForCommercialPlan, turnBudgetAssessment } from './turn-budget'
import { object, type Row } from './data'

const inventory: Row[] = [
  { id: 'suite', category: 'suite', unit_number: '201', bedrooms: 1, floor_number: 2, published_commercial_price: 160000 },
  { id: 'department', category: 'departamento', unit_number: '202', bedrooms: 3, floor_number: 2, published_commercial_price: 250000 },
  { id: '602', category: 'penthouse', unit_number: '602', bedrooms: 3, floor_number: 6, published_commercial_price: 550000 },
  { id: '605', category: 'penthouse', unit_number: '605', bedrooms: 3, floor_number: 6, published_commercial_price: 539900 },
  { id: 'local', category: 'local', unit_number: 'L1', bedrooms: null, floor_number: 0, published_commercial_price: 50000 },
].map(unit => ({ ...unit, is_published: true, status: 'disponible' }))

function info(status = 'not_discussed', amount: number | null = null): Row {
  return {
    lead: { purchase_purpose: 'vivir' }, recorrido_comercial: {},
    property_context: { query: { group: 'residential', operation: 'search' }, selected_ids: [] },
    catalogo: inventory, catalogo_verificacion: inventory, catalog_read: { complete: true },
    politica_comercial: { precios_autorizados: true },
    financiamiento: { partners: ['Banco Pichincha', 'Cooperativa JEP'], journey: {} },
    semantica_turno: { primary_intent: 'discuss_budget', confidence: 'high',
      budget: { status, amount, evidence: status === 'not_discussed' ? '' : `Tengo ${amount ?? 'presupuesto sin definir'}`, confidence: 'high' } },
  }
}

test('known residential use asks total budget before bedrooms and units', () => {
  const data = info(), next = commercialJourneyPlan(data)
  assert.equal(next.action, 'ask_budget')
  assert.equal(next.question_id, 'budget_amount')
  assert.match(String(next.question), /presupuesto total aproximado/)
  assert.equal(next.presentation, 'budget_intake')
  assert.notEqual(next.requires_unit_presentation, true)
  assert.equal(next.financing_offer_allowed, false)
  assert.deepEqual(object(data.property_context).selected_ids, [])
})

test('unknown use is discovered first; investment asks budget then asset scope before comparing', () => {
  const data = info()
  data.lead = {}
  data.property_context = { query: {}, selected_ids: [] }
  assert.equal(commercialJourneyPlan(data).action, 'discover_use')
  data.lead = { purchase_purpose: 'invertir' }
  assert.equal(commercialJourneyPlan(data).action, 'ask_budget')
  object(data.semantica_turno).budget = { status: 'maximum_total', amount: 10000, evidence: 'Diez mil', confidence: 'high' }
  const next = commercialJourneyPlan(data)
  assert.equal(next.action, 'discover_use')
  assert.match(String(next.question), /vivienda.*local.*invertir/)
  assert.equal(object(next.budget_guidance).status, 'not_comparable')
  assert.equal(next.financing_offer_allowed, false)
})

test('below the complete residential minimum offers analysis without treating cheap local as a housing match', () => {
  const data = info('maximum_total', 100000), next = commercialJourneyPlan(data)
  const guidance = object(next.budget_guidance)
  assert.equal(next.action, 'offer_financing')
  assert.equal(next.question_id, 'financing_invitation')
  assert.equal(guidance.status, 'below_available_prices')
  assert.equal(guidance.coverage, 'none')
  assert.ok(!(guidance.candidate_unit_ids as string[]).includes('local'))
  assert.equal(financingStage(data).collection_allowed, false)
  object(data.financiamiento).journey = { accepted: true }
  const accepted = commercialJourneyPlan(data)
  assert.equal(accepted.action, 'discover_bedrooms')
  assert.equal(accepted.financing_offer_allowed, false)
  assert.equal(financingStage(data).collection_allowed, false)
})

test('commercial use compares only commercial inventory and asks budget before business purpose', () => {
  const data = info()
  data.lead = { preferred_category: 'local' }
  data.property_context = { query: { category: 'local' }, selected_ids: [],
    category_preference: { category: 'local', confirmed: true, evidence: 'Busco un local para mi negocio' } }
  assert.equal(commercialJourneyPlan(data).action, 'ask_budget')
  object(data.semantica_turno).budget = { status: 'maximum_total', amount: 60000, evidence: 'Sesenta mil', confidence: 'high' }
  const next = commercialJourneyPlan(data)
  assert.equal(next.action, 'discover_purpose')
  assert.equal(object(next.budget_guidance).coverage, 'all')
  assert.deepEqual(object(next.budget_guidance).candidate_unit_ids, ['local'])
})

test('affordability first discovers needs; it never selects the cheap suite', () => {
  const data = info('maximum_total', 200000), next = commercialJourneyPlan(data)
  assert.equal(next.action, 'discover_bedrooms')
  assert.equal(object(next.budget_guidance).coverage, 'some')
  assert.deepEqual(object(next.budget_guidance).matching_unit_ids, ['suite'])
  assert.deepEqual(object(data.property_context).selected_ids, [])
  object(data.property_context).query = { group: 'residential', operation: 'search', filters: { bedrooms: 3 } }
  const bedrooms = commercialJourneyPlan(data)
  assert.equal(bedrooms.action, 'offer_financing')
  assert.ok(!(object(bedrooms.budget_guidance).candidate_unit_ids as string[]).includes('suite'))
})

test('a legacy assessment of another scope cannot override matching or incomplete current inventory', () => {
  const data = info('maximum_total', 200000)
  data.presupuesto_del_turno = { status: 'below_available_prices', price_evidence_complete: true,
    candidate_unit_ids: ['department'], minimum_price: 250000 }
  const matching = commercialJourneyPlan(data)
  assert.equal(object(matching.budget_guidance).status, 'matching_options')
  assert.equal(matching.action, 'discover_bedrooms')
  assert.equal(matching.financing_offer_allowed, false)
  data.catalog_read = { complete: false }
  const incomplete = commercialJourneyPlan(data)
  assert.equal(object(incomplete.budget_guidance).status, 'incomplete_prices')
  assert.equal(incomplete.financing_offer_allowed, false)
})

test('some affordable matches orient presentation without changing the query; a more expensive preference remains possible', () => {
  const data = info('maximum_total', 300000)
  object(data.property_context).query = { group: 'residential', operation: 'search', filters: { bedrooms: 3 } }
  const query = structuredClone(object(data.property_context).query)
  const next = commercialJourneyPlan(data)
  assert.equal(next.question_id, 'property_category')
  assert.equal(next.question_act, 'choose_category')
  assert.match(String(next.question), /exploremos los departamentos/)
  assert.equal(object(next.proposed_query).category, 'departamento')
  assert.deepEqual(object(next.selection_scope).unit_ids, ['department'])
  assert.deepEqual(object(data.property_context).query, query)
  object(data.property_context).query = { ...query, category: 'penthouse' }
  object(data.property_context).category_preference = { category: 'penthouse', confirmed: true, evidence: 'Prefiero los penthouses aunque superen mi presupuesto' }
  const penthouse = commercialJourneyPlan(data)
  assert.equal(penthouse.action, 'offer_financing')
  assert.deepEqual(object(penthouse.budget_guidance).candidate_unit_ids, ['602', '605'])
})

test('a budget covering all prices keeps both compatible types and does not reopen prices', () => {
  const data = info('maximum_total', 600000)
  object(data.property_context).query = { group: 'residential', operation: 'search', filters: { bedrooms: 3 } }
  const next = commercialJourneyPlan(data)
  assert.equal(next.question_id, 'property_category')
  assert.deepEqual(object(next.selection_scope).categories, ['departamento', 'penthouse'])
  assert.equal(object(next.budget_guidance).coverage, 'all')
  const scope = responseContentScope('Tengo 600000', { ...data, siguiente_paso_comercial: next })
  assert.equal(object(object(scope.topics).purchase_prices).allowed, false)
})

test('budget orientation preserves explicit hard price requirements in the durable search', () => {
  const data = info('maximum_total', 600000)
  object(data.property_context).query = { group: 'residential', operation: 'search', filters: { bedrooms: 3 },
    requirements: [{ field: 'published_commercial_price', operator: 'lt', value: 260000, strength: 'required', evidence: 'Solo quiero ver unidades por debajo de 260 mil' }] }
  const before = structuredClone(data.property_context), next = commercialJourneyPlan(data)
  assert.deepEqual(object(next.selection_scope).unit_ids, ['department'])
  assert.deepEqual(data.property_context, before)
})

test('technical continuity snapshots do not leak unrequested prices into the writer prompt', () => {
  const data = info('maximum_total', 600000), next = commercialJourneyPlan(data)
  const state = rememberCommercialJourney({}, next, { id: 'property_bedrooms' }, true)
  const raw = { ...data, siguiente_paso_comercial: next, recorrido_comercial: state }
  const scope = responseContentScope('Tengo 600000', raw), projected = projectContentForWriter(raw, scope)
  assert.equal(object(projected.recorrido_comercial).budget_scope_key, undefined)
  assert.equal(object(object(projected.siguiente_paso_comercial).budget_guidance).scope_key, undefined)
  assert.equal(object(next.budget_guidance).scope_key, state.budget_scope_key)
  assert.equal(object(object(projected.semantica_turno).budget).amount, 600000)
  assert.ok((object(next.budget_guidance).prices as Row[]).some(price => price.published_commercial_price === 550000))
})

test('entry before unit selection offers analysis once and preserves the role throughout selection', () => {
  const data = info('initial_capital', 200000)
  assert.equal(commercialJourneyPlan(data).action, 'offer_financing')
  assert.equal(financingStage(data).collection_allowed, false)
  const assessment = turnBudgetAssessment(data, {})!
  assert.equal(assessment.status, 'initial_capital')
  assert.equal(assessment.continuation, 'offer_financing_for_entry')
  object(data.financiamiento).journey = { accepted: true }
  assert.equal(commercialJourneyPlan(data).action, 'discover_bedrooms')
  assert.equal(object(object(data.semantica_turno).budget).status, 'initial_capital')
})

for (const status of ['no_defined_budget', 'declines_to_disclose']) test(`${status} continues needs without automatically offering financing`, () => {
  const data = info(status), next = commercialJourneyPlan(data)
  assert.equal(next.action, 'discover_bedrooms')
  assert.equal(next.financing_offer_allowed, false)
  if (status === 'no_defined_budget') assert.equal(turnBudgetAssessment(data, {})!.continuation, 'continue_needs_discovery')
})

for (const missing of ['price', 'complete', 'authorization']) test(`missing ${missing} cannot prove global budget insufficiency`, () => {
  const data = info('maximum_total', 100000)
  if (missing === 'price') data.catalogo = data.catalogo_verificacion = inventory.map(unit => unit.id === 'suite' ? { ...unit, published_commercial_price: null } : unit)
  if (missing === 'complete') data.catalog_read = { complete: false }
  if (missing === 'authorization') data.politica_comercial = { precios_autorizados: false }
  const next = commercialJourneyPlan(data)
  assert.equal(next.action, 'discover_bedrooms')
  assert.equal(next.financing_offer_allowed, false)
  assert.equal(object(next.budget_guidance).comparison_required, false)
})

test('a selected expensive unit enables a necessary comparison once; courtesy does not reopen it', () => {
  const data = info('maximum_total', 300000)
  data.property_context = { query: { group: 'residential', category: 'penthouse', operation: 'select', filters: { bedrooms: 3 } }, selected_ids: ['602'] }
  data.referencia_unidad = { matches: [inventory[2]], needsClarification: false }
  const next = commercialJourneyPlan(data)
  assert.equal(next.action, 'offer_financing')
  assert.deepEqual(object(next.budget_guidance).candidate_unit_ids, ['602'])
  assert.equal(object(next.budget_guidance).comparison_required, true)
  assert.equal(object(object(responseContentScope('Me interesa la 602', { ...data, siguiente_paso_comercial: next }).topics).purchase_prices).allowed, true)
  data.recorrido_comercial = rememberCommercialJourney({}, next, { id: 'financing_invitation' }, true)
  data.hechos_confirmados = { budget: object(object(data.semantica_turno).budget) }
  data.semantica_turno = { primary_intent: 'other', budget: { status: 'not_discussed' } }
  const later = commercialJourneyPlan(data)
  assert.equal(object(later.budget_guidance).comparison_required, false)
  assert.equal(later.financing_offer_allowed, false)
  assert.equal(object(object(responseContentScope('Gracias', { ...data, siguiente_paso_comercial: later }).topics).purchase_prices).allowed, false)
})

test('financing refusal keeps an over-budget preference without substituting cheaper units', () => {
  const data = info('maximum_total', 300000)
  object(data.property_context).query = { group: 'residential', category: 'penthouse', operation: 'search', filters: { bedrooms: 3 } }
  object(data.property_context).category_preference = { category: 'penthouse', confirmed: true, evidence: 'Me interesan los penthouses' }
  object(data.financiamiento).journey = { status: 'declined', accepted: false }
  const before = structuredClone(data.property_context), next = commercialJourneyPlan(data)
  assert.equal(next.action, 'leave_open')
  assert.equal(next.financing_offer_allowed, false)
  assert.deepEqual(data.property_context, before)
})

test('reading the same over-budget options does not repeat the comparison or financing offer', () => {
  const data = info('maximum_total', 300000)
  object(data.property_context).query = { group: 'residential', category: 'penthouse', operation: 'search', filters: { bedrooms: 3 } }
  object(data.property_context).category_preference = { category: 'penthouse', confirmed: true, evidence: 'Revisemos los penthouses' }
  const initial = commercialJourneyPlan(data)
  assert.equal(initial.action, 'offer_financing')
  data.recorrido_comercial = rememberCommercialJourney({}, initial, { id: 'financing_invitation' }, true)
  data.hechos_confirmados = { budget: object(object(data.semantica_turno).budget) }
  data.semantica_turno = { primary_intent: 'project_information', budget: { status: 'not_discussed' } }
  object(data.property_context).offered_ids = ['605', '602']
  object(data.property_context).query = { group: 'residential', category: 'penthouse', operation: 'details', scope: 'offered', filters: { bedrooms: 3 } }
  data.catalogo_verificacion = [...inventory].reverse()
  const details = commercialJourneyPlan(data)
  assert.equal(object(details.budget_guidance).scope_key, object(initial.budget_guidance).scope_key)
  assert.equal(object(details.budget_guidance).comparison_required, false)
  assert.equal(details.financing_offer_allowed, false)
  assert.equal(object(object(responseContentScope('Deme más detalles', { ...data, siguiente_paso_comercial: details }).topics).purchase_prices).allowed, false)
})

test('newly complete price verification enables the comparison that could not be established earlier', () => {
  const data = info('maximum_total', 100000)
  data.catalog_read = { complete: false }
  const incomplete = commercialJourneyPlan(data)
  assert.equal(incomplete.financing_offer_allowed, false)
  data.recorrido_comercial = rememberCommercialJourney({}, incomplete, { id: 'property_bedrooms' }, true)
  data.hechos_confirmados = { budget: object(object(data.semantica_turno).budget) }
  data.semantica_turno = { primary_intent: 'other', budget: { status: 'not_discussed' } }
  data.catalog_read = { complete: true }
  const verified = commercialJourneyPlan(data)
  assert.equal(verified.action, 'offer_financing')
  assert.equal(object(verified.budget_guidance).comparison_required, true)
})

test('disliking affordable options asks what is missing without inventing price as the reason', () => {
  const data = info('maximum_total', 300000)
  object(data.property_context).query = { group: 'residential', operation: 'search', filters: { bedrooms: 3 } }
  object(data.semantica_turno).answer_to_previous = { kind: 'negative', confidence: 'high', question_id: 'unit_choice', evidence: 'No me gustan estas opciones' }
  const next = commercialJourneyPlan(data)
  assert.equal(next.action, 'clarify_preferences')
  assert.equal(next.question_id, 'property_requirements')
  assert.equal(next.financing_offer_allowed, false)
  assert.match(String(next.question), /qué.*opciones no ofrecen/i)
  assert.deepEqual(object(data.property_context).selected_ids, [])
})

test('a stated reason or new preference is handled without asking the customer to repeat it', () => {
  const data = info('maximum_total', 600000)
  object(data.property_context).query = { group: 'residential', category: 'penthouse', operation: 'search', filters: { bedrooms: 3 } }
  object(data.semantica_turno).answer_to_previous = { kind: 'negative', confidence: 'high', question_id: 'unit_choice', evidence: 'No me gusta, prefiero tres baños' }
  object(data.semantica_turno).property = { confidence: 'high', evidence: 'No me gusta, prefiero tres baños', filters: {} }
  object(data.semantica_turno).catalog_request = { version: 'catalog-request-v1', requirements: [{ field: 'bathrooms_full', operator: 'eq', value: 3, evidence: 'tres baños', strength: 'required' }] }
  assert.notEqual(commercialJourneyPlan(data).action, 'clarify_preferences')
})

test('one journey owns continuation even if a legacy assessment suggested another branch', () => {
  const data = info('no_defined_budget'), next = commercialJourneyPlan(data)
  const assessment = budgetForCommercialPlan(turnBudgetAssessment(data, {})!, next)
  assert.equal(next.question_id, 'property_bedrooms')
  assert.equal(assessment.continuation, 'commercial_next_step')
  assert.equal(assessment.commercial_plan_action, 'discover_bedrooms')
})
