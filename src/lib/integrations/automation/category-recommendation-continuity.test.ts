import assert from 'node:assert/strict'
import { test } from 'node:test'
import { categoryInvitationTarget } from './category-offer'
import { commercialJourneyPlan, journeyPendingQuestion } from './commercial-journey'
import { deliveredPendingQuestion } from './continuation-question'
import { continuationContentIssues, validContinuationMetadata } from './continuation-validation'
import { object, type Row } from './data'
import { rememberPropertyReply, resolvePropertyTurn } from './property-context'
import { normalizeTurnSemantics } from './turn-semantics'

const catalog: Row[] = [
  { id: 'd202', unit_number: '202', category: 'departamento', bedrooms: 3, floor_number: 2, published_commercial_price: 250000 },
  { id: 'd302', unit_number: '302', category: 'departamento', bedrooms: 3, floor_number: 3, published_commercial_price: 270000 },
  { id: 'd402', unit_number: '402', category: 'departamento', bedrooms: 3, floor_number: 4, published_commercial_price: 290000 },
  { id: 'd502', unit_number: '502', category: 'departamento', bedrooms: 3, floor_number: 5, published_commercial_price: 310000 },
  { id: 'p602', unit_number: '602', category: 'penthouse', bedrooms: 3, floor_number: 6, published_commercial_price: 550000 },
].map(unit => ({ ...unit, is_published: true, status: 'disponible' }))

function info(amount = 300000): Row {
  return { catalogo: catalog, catalogo_verificacion: catalog, catalog_read: { complete: true },
    lead: { purchase_purpose: 'vivir' }, property_context: { query: { group: 'residential', operation: 'search', filters: { bedrooms: 3 } } },
    politica_comercial: { precios_autorizados: true }, recorrido_comercial: {},
    hechos_confirmados: { budget: { status: 'maximum_total', amount, confidence: 'high', evidence: `Mi presupuesto total es ${amount}` } },
    financiamiento: { partners: ['Banco Pichincha', 'Cooperativa JEP'], journey: {} },
    semantica_turno: { primary_intent: 'select_property', budget: { status: 'not_discussed' } } }
}
function receipt(data: Row, plan: Row, question = String(plan.question)) {
  const reply = `Considerando su presupuesto, podemos comenzar por los departamentos de tres dormitorios. ${question}`
  const pending = journeyPendingQuestion(reply, plan, true, { text: question, purpose: 'choose_property',
    continuation_id: plan.question_id, continuation_act: plan.question_act })
  return rememberPropertyReply(catalog, object(data.property_context), reply, { pending_question: pending })
}
function answer(current: string, context: Row, kind = 'affirmative', property: Row = {}) {
  const pending = object(context.pending_question)
  const semantics = normalizeTurnSemantics({ turn_semantics: {
    primary_intent: 'answer_previous', primary_evidence: current, confidence: 'high',
    property: { confidence: 'high', evidence: current, reference_kind: 'none', operation: 'none', ...property },
    answer_to_previous: { question_id: pending.id, kind, evidence: current, confidence: 'high' },
  } }, current, pending)
  return { ...resolvePropertyTurn(catalog, current, { _property_context: context, _pending_question: pending }, [], semantics), semantics }
}

for (const mode of ['normal', 'demo', 'review_disabled']) test(`${mode}: affordable category is offered before choosing a floor`, () => {
  const data = { ...info(), modo_revision: mode }, before = structuredClone(data.property_context)
  const plan = commercialJourneyPlan(data)
  assert.equal(plan.question_id, 'property_category')
  assert.equal(plan.question_act, 'choose_category')
  assert.equal(plan.presentation, 'categories')
  assert.match(String(plan.question), /exploremos los departamentos/)
  assert.deepEqual(object(plan.selection_scope).unit_ids, ['d202', 'd302', 'd402'])
  assert.equal(object(plan.proposed_query).category, 'departamento')
  assert.equal(object(object(plan.proposed_query).filters).bedrooms, 3)
  assert.equal(plan.selected_unit_id, null)
  assert.deepEqual(data.property_context, before)
})

test('yes to the delivered single category offer accepts only that type and then asks its floor', () => {
  const data = info(), plan = commercialJourneyPlan(data), context = receipt(data, plan)
  assert.equal(object(context.pending_question).act, 'choose_category')
  assert.equal(object(object(context.pending_question).proposed_query).category, 'departamento')
  const resolved = answer('Sí, está bien', context)
  assert.equal(resolved.reason, 'accepted_category_offer')
  assert.equal(resolved.query.category, 'departamento')
  assert.equal(object(resolved.query.filters).bedrooms, 3)
  assert.deepEqual(resolved.context.selected_ids, [])
  assert.equal(object(resolved.context.category_preference).confirmed, true)
  assert.equal(object(resolved.context.category_preference).evidence, 'Sí, está bien')
  const next = commercialJourneyPlan({ ...data, property_context: resolved.context, semantica_turno: resolved.semantics })
  assert.equal(next.question_id, 'property_floor')
  assert.deepEqual(object(next.selection_scope).floors, [2, 3, 4])
  assert.equal(object(object(next.readiness).budget).amount, 300000)
})

test('approved single category paraphrases preserve the offer referent and cannot masquerade as a floor question', () => {
  const data = info(), plan = commercialJourneyPlan(data)
  for (const question of ['¿Desea revisar los departamentos?', '¿Le gustaría conocer esas opciones de departamentos?']) {
    const metadata = { text: question, purpose: 'choose_property', continuation_id: 'property_category', continuation_act: 'choose_category' }
    assert.equal(validContinuationMetadata(metadata, question, plan), true)
    assert.deepEqual(continuationContentIssues(question, plan), [])
    const context = receipt(data, plan, question)
    assert.equal(object(object(context.pending_question).proposed_query).category, 'departamento')
    assert.equal(answer('Sí', context).query.category, 'departamento')
  }
  assert.equal(continuationContentIssues('¿En qué planta desea revisar los departamentos?', plan)[0].code,
    'commercial_next_question_mismatch')
})

test('choosing penthouses instead preserves that preference and evaluates financing with the known budget', () => {
  const data = info(), context = receipt(data, commercialJourneyPlan(data))
  const resolved = answer('No, prefiero los penthouses', context, 'negative', { operation: 'search', category: 'penthouse' })
  assert.equal(resolved.query.category, 'penthouse')
  assert.equal(object(resolved.query.filters).bedrooms, 3)
  assert.equal(object(resolved.context.category_preference).category, 'penthouse')
  assert.deepEqual(resolved.context.selected_ids, [])
  const next = commercialJourneyPlan({ ...data, property_context: resolved.context, semantica_turno: resolved.semantics })
  assert.equal(next.action, 'offer_financing')
  assert.equal(next.question_id, 'financing_invitation')
  assert.deepEqual(object(next.budget_guidance).candidate_unit_ids, ['p602'])
})

test('refusing the recommendation without another preference asks what is missing rather than a floor', () => {
  const data = info(), context = receipt(data, commercialJourneyPlan(data))
  const resolved = answer('No', context, 'negative')
  const next = commercialJourneyPlan({ ...data, property_context: resolved.context, semantica_turno: resolved.semantics })
  assert.equal(next.action, 'clarify_preferences')
  assert.equal(next.question_id, 'property_requirements')
  assert.deepEqual(resolved.context.selected_ids, [])
  assert.notEqual(object(resolved.context.category_preference).confirmed, true)
})

test('yes between several compatible categories does not choose one', () => {
  const data = info(600000), plan = commercialJourneyPlan(data)
  const context = receipt(data, plan)
  assert.equal(object(context.pending_question).proposed_query, undefined)
  const resolved = answer('Sí', context)
  assert.equal(resolved.reason, 'unresolved_choice')
  assert.notEqual(object(resolved.context.category_preference).confirmed, true)
  assert.deepEqual(resolved.context.selected_ids || [], [])
})

test('receipt cannot assign its proposed category when the emitted question or candidates name another target', () => {
  const data = info(), plan = commercialJourneyPlan(data)
  const question = '¿Desea revisar los penthouses?'
  const pending = deliveredPendingQuestion(question, { plan, metadata: { text: question, purpose: 'choose_property',
    continuation_id: 'property_category', continuation_act: 'choose_category' } }, catalog)
  assert.equal(pending.proposed_query, undefined)
  const malformed = { ...object(data.property_context), pending_question: { id: 'property_category', act: 'choose_category',
    question: plan.question, candidate_ids: ['p602'], proposed_query: plan.proposed_query } }
  assert.notEqual(answer('Sí', malformed).reason, 'accepted_category_offer')
})

test('genuinely sole physical type and explicitly accepted types retain their established selection route', () => {
  const data = info()
  data.catalogo = data.catalogo_verificacion = catalog.filter(unit => unit.category === 'departamento')
  assert.equal(commercialJourneyPlan(data).question_id, 'property_floor')
  const declared = info()
  object(declared.property_context).category_preference = { category: 'departamento', confirmed: true, evidence: 'Prefiero departamentos' }
  assert.equal(commercialJourneyPlan(declared).question_id, 'property_floor')
})

test('single category invitations never infer a target from mixed choices, coded units or financial procedures', () => {
  assert.equal(categoryInvitationTarget('¿Le gustaría que exploremos los departamentos?'), 'departamento')
  for (const question of ['¿Prefiere departamentos o penthouses?', '¿Desea conocer el departamento 202?',
    '¿Le gustaría explorar los departamentos o esperar otra opción?', '¿Desea continuar con el financiamiento del penthouse?',
    '¿En qué planta quiere revisar los departamentos?', '¿Le gustaría que revisemos los departamentos en Segunda planta alta?',
    '¿Desea explorar departamentos en el segundo piso?', '¿Le gustaría ver departamentos en el nivel 2?']) {
    assert.equal(categoryInvitationTarget(question), '', question)
  }
})
