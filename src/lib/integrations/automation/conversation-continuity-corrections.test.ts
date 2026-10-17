import { plannedQuestionFixture, writerFixture } from './fixtures/writer-response.fixture'
import { financingInvitationReceipt } from './financing-invitation'
import assert from 'node:assert/strict'
import test from 'node:test'
import { object, type Row } from './data'
import { normalizeTurnSemantics, emptyPropertyFilters } from './turn-semantics'
import { rememberInterpretationFacts } from './interpretation-memory'
import { resolvePropertyTurn, rememberPropertyReply } from './property-context'
import { commercialJourneyPlan, journeyPendingQuestion, commercialSelectionQuery } from './commercial-journey'
import { catalogDialogueReply } from './catalog-dialogue'
import { deliveredPendingQuestion } from './continuation-question'
import { financingInputs } from './financing'
import { financingJourney, financingStage } from './financing-stage'
import { supportedFindingRechecks, BUSINESS_RISK_REVIEW_VERSION } from './business-risk-review'
import { WRITER_CONTENT_REVIEW_VERSION } from './writer-content-review'
import { completeTurnReply } from './turn-completeness'
import { propertyPurchasePriceLimit } from './budget-state'
import { withResponseReviewPolicy } from './response-review-policy'

const catalog: Row[] = [
  { id: 'd202', unit_number: '202', category: 'departamento', bedrooms: 3, bathrooms_full: 2, floor_number: 2, area_internal_m2: 120.83, published_commercial_price: 250000 },
  { id: 'p602', unit_number: '602', category: 'penthouse', bedrooms: 3, bathrooms_full: 2, floor_number: 6, area_internal_m2: 142.09, area_exterior_m2: 25.3, published_commercial_price: 550000 },
  { id: 'p605', unit_number: '605', category: 'penthouse', bedrooms: 3, bathrooms_full: 3, floor_number: 6, area_internal_m2: 140.53, area_exterior_m2: 23.01, published_commercial_price: 539900 },
  { id: 'p604', unit_number: '604', category: 'penthouse', bedrooms: 2, bathrooms_full: 2, floor_number: 6, area_internal_m2: 99.71, published_commercial_price: 389750 },
]
const entry = { status: 'amount', amount: 50000, evidence: 'si esta bien usare los 50 como entrada', source_message_id: 'entry' }
const finance = { partners: ['Banco Pichincha', 'Cooperativa JEP'], current: {}, entry, journey: { status: 'accepted', accepted: true } }
const total = { status: 'maximum_total', amount: 50000, evidence: 'Tengo unos 50 mil', confidence: 'high' }
function info(context: Row = {}, memory: Row = {}, semantics: Row = {}): Row {
  return { catalogo: catalog, catalogo_verificacion: catalog, catalog_read: { complete: true }, catalog_verification_read: { complete: true },
    politica_comercial: { precios_autorizados: true }, perfil_lead: { full_name: 'Carlos', residence_city: 'Guayaquil' },
    lead: { purchase_purpose: 'vivir' }, property_context: context, hechos_confirmados: { budget: total, ...memory },
    financiamiento: finance, semantica_turno: semantics }
}
function semantic(current: string, pending: Row, property: Row = {}, answer = 'none', extra: Row = {}) {
  return normalizeTurnSemantics({ turn_semantics: { primary_intent: answer === 'none' ? 'select_property' : 'answer_previous',
    primary_evidence: current, confidence: 'high', property: { filters: emptyPropertyFilters(), evidence: current, confidence: 'high', ...property },
    answer_to_previous: { question_id: pending.id || 'none', kind: answer, evidence: answer === 'none' ? '' : current, confidence: 'high' }, ...extra } }, current, pending)
}

test('five bedrooms -> accept three -> grouped penthouse choice -> more bathrooms and price -> acknowledgement preserves 605 and financing', () => {
  let summary: Row = { _interpretation_memory: { budget: total } }
  const current = 'necesitaria unos 5 cuartos mas o menos\ntengo una familia grande'
  const first = semantic(current, {}, { group: 'residential', operation: 'search', query_scope: 'catalog', filters: { bedrooms: 5 } })
  let reference = resolvePropertyTurn(catalog, current, summary, [], first)
  let plan = commercialJourneyPlan(info(reference.context, {}, first))
  assert.equal(plan.action, 'clarify_requirements')
  assert.equal(object(object(plan.proposed_query).filters).bedrooms, 3)
  assert.deepEqual(new Set(plan.alternative_unit_ids as string[]), new Set(['d202', 'p602', 'p605']))
  const offer = `No contamos con cinco dormitorios, pero tenemos departamentos y penthouses de tres que podemos comparar por su amplitud. ${plan.question}`
  let pending = journeyPendingQuestion(offer, plan, true, plannedQuestionFixture(plan))
  let context = rememberPropertyReply(catalog, reference.context, offer, { pending_question: pending, original_query: plan.requested_query })
  let turn = semantic('si me parece bien', pending, { operation: 'none', reference_kind: 'followup' }, 'affirmative')
  reference = resolvePropertyTurn(catalog, 'si me parece bien', { ...summary, _property_context: context, _pending_question: pending }, [], turn)
  assert.equal(object(reference.query.filters).bedrooms, 3)
  context = reference.context
  plan = commercialJourneyPlan(info(context, {}, turn))
  assert.notEqual(plan.action, 'discover_bedrooms')
  const typeReply = `Podemos revisar departamentos o penthouses de tres dormitorios. ${plan.question}`
  pending = journeyPendingQuestion(typeReply, plan, true, plannedQuestionFixture(plan))
  context = rememberPropertyReply(catalog, context, typeReply, { pending_question: pending })
  const grouped = 'penthouse\nson mas espaciosos\ny considerando que mi familia es grande es mejor para mi'
  turn = semantic(grouped, pending, { category: 'penthouse', group: 'residential', operation: 'select', reference_kind: 'none', query_scope: 'offered', evidence: 'penthouse' })
  reference = resolvePropertyTurn(catalog, grouped, { ...summary, _property_context: context, _pending_question: pending }, [], turn)
  context = reference.context
  assert.deepEqual(reference.matches.map(unit => unit.id), ['p602', 'p605'], JSON.stringify({ pending, turn, reference }))
  assert.equal(object(reference.query.filters).bedrooms, 3)
  summary = { ...summary, _interpretation_memory: rememberInterpretationFacts(summary, grouped, {}, turn) }
  plan = commercialJourneyPlan(info(context, object(summary._interpretation_memory), turn))
  assert.notEqual(plan.action, 'discover_bedrooms')
  const choiceReply = `El penthouse 602 tiene dos baños y el penthouse 605 tiene tres baños. ${plan.question}`
  pending = journeyPendingQuestion(choiceReply, plan, true, plannedQuestionFixture(plan))
  context = rememberPropertyReply(catalog, context, choiceReply, { pending_question: pending })
  const relative = 'mmm prefiero el que tiene mas baños mejor\ny que precio tiene?'
  turn = semantic(relative, pending, { operation: 'select', reference_kind: 'relative', query_scope: 'offered', unit_numbers: ['605'], evidence: 'prefiero el que tiene mas baños mejor' }, 'value')
  reference = resolvePropertyTurn(catalog, relative, { ...summary, _property_context: context, _pending_question: pending }, [], turn)
  assert.deepEqual(reference.context.selected_ids, ['p605'])
  assert.equal(reference.matches[0].published_commercial_price, 539900)
  plan = commercialJourneyPlan(info(reference.context, object(summary._interpretation_memory), turn))
  assert.equal(plan.action, 'continue_financing')
  assert.equal(plan.selected_unit_id, 'p605')
  context = rememberPropertyReply(catalog, reference.context, 'Con gusto. El penthouse 605 cuesta USD 539.900.', {})
  turn = semantic('si si est abien', {}, { operation: 'none', reference_kind: 'followup', query_scope: 'selected' }, 'affirmative')
  reference = resolvePropertyTurn(catalog, 'si si est abien', { ...summary, _property_context: context }, [], turn)
  assert.deepEqual(reference.context.selected_ids, ['p605'])
  const next = info(reference.context, object(summary._interpretation_memory), turn)
  assert.equal(commercialJourneyPlan(next).action, 'continue_financing')
  assert.equal(financingStage(next).entry_status, 'amount')
})

test('category updates preserve individual preferences; a change to commerce clears housing needs', () => {
  const summary = { _interpretation_memory: { property: { group: 'residential', category: 'departamento',
    filters: { bedrooms: 3, floor_number: 5 }, evidence: 'Tres dormitorios en la quinta', confidence: 'high' } } }
  const turn = semantic('Prefiero penthouse', {}, { category: 'penthouse', group: 'residential', operation: 'select' })
  const memory = rememberInterpretationFacts(summary, 'Prefiero penthouse', {}, turn)
  assert.equal(object(object(memory.property).filters).bedrooms, 3)
  assert.equal(object(object(memory.property).filters).floor_number, 5)
  assert.equal(object(memory.property).category, 'penthouse')
  assert.equal(commercialSelectionQuery(info({}, memory)).filters.bedrooms, 3)
  const commerce = semantic('Ahora quiero un local', {}, { category: 'local', group: 'commercial', operation: 'search' })
  const changed = rememberInterpretationFacts({ _interpretation_memory: memory }, 'Ahora quiero un local', {}, commerce)
  assert.equal(object(object(changed.property).filters).bedrooms, undefined)
  assert.equal(commercialSelectionQuery(info({}, changed)).filters.bedrooms, null)
})

test('a bedroom confirmation carries its quantity and selected subject, and a yes cannot erase the choice', () => {
  const reply = 'El penthouse 605 tiene tres dormitorios. ¿Le funciona esa cantidad de dormitorios?'
  const plan = { question_id: 'property_bedrooms', question_act: 'confirm_bedrooms', selected_unit_id: 'p605',
    selection_scope: { unit_ids: ['p605'] } }
  const pending = deliveredPendingQuestion(reply, { plan, metadata: writerFixture({ reply: reply, question: { purpose: 'choose_property', continuation_id: 'property_bedrooms', continuation_act: 'confirm_bedrooms' }, requests: [] }).question }, catalog)
  assert.equal(object(object(pending.proposed_query).filters).bedrooms, 3)
  assert.deepEqual(pending.target_ids, ['p605'])
  const turn = semantic('si si esta bien', pending, { operation: 'none', reference_kind: 'followup' }, 'affirmative')
  const reference = resolvePropertyTurn(catalog, 'si si esta bien', { _property_context: { selected_ids: ['p605'], offered_ids: ['p605'],
    query: { category: 'penthouse', group: 'residential' } }, _pending_question: pending }, [], turn)
  assert.deepEqual(reference.context.selected_ids, ['p605'])
  assert.notEqual(commercialJourneyPlan(info(reference.context)).action, 'discover_bedrooms')
})

test('a new floor filter retrieves the accepted bedroom count even after the transient query lost it', () => {
  const current = 'Prefiero la quinta planta'
  const turn = semantic(current, {}, { operation: 'search', query_scope: 'catalog', group: 'residential', filters: { floor_number: 5 } })
  const units = [...catalog, { ...catalog[0], id: 'd502', unit_number: '502', floor_number: 5 },
    { ...catalog[0], id: 'd504', unit_number: '504', floor_number: 5, bedrooms: 2 }]
  const reference = resolvePropertyTurn(units, current, { _property_context: { query: { group: 'residential', category: 'departamento' } },
    _interpretation_memory: { property: { group: 'residential', category: 'departamento', filters: { bedrooms: 3 },
      evidence: 'Tres dormitorios', confidence: 'high' } } }, [], turn)
  assert.deepEqual(reference.matches.map(unit => unit.id), ['d502'])
  assert.equal(object(reference.query.filters).bedrooms, 3)
})

test('lost offered references require clarification rather than a false stock absence', () => {
  const context = { offered_ids: [], query: { category: 'penthouse', group: 'residential', operation: 'search', scope: 'offered', filters: { bedrooms: 3 } } }
  const result = catalogDialogueReply(info(context))!
  assert.equal(object(result.audit.catalog_results).complete, false)
  assert.equal(object(result.audit.catalog_coverage).status, 'clarification')
  assert.doesNotMatch(result.reply, /no contamos|no encontr|no hay/i)
})

test('confirmed entry is not a purchase ceiling, and an independent/current total ceiling is preserved', () => {
  assert.equal(propertyPurchasePriceLimit(info()), null)
  assert.equal(propertyPurchasePriceLimit({ ...info(), semantica_turno: { budget: total } }), 50000)
  assert.equal(propertyPurchasePriceLimit(info({}, { budget: { ...total, amount: 300000 } })), 300000)
  assert.equal(propertyPurchasePriceLimit({ ...info(), financiamiento: { ...finance, journey: { accepted: false } } }), 50000)
})

test('relative selections cannot choose an unoffered, unavailable or ambiguous unit', () => {
  const current = 'Prefiero el que tiene más baños'
  for (const [numbers, candidates] of [[['604'], ['p602', 'p605']], [['605'], ['p602', 'missing']], [['602', '605'], ['p602', 'p605']]]) {
    const pending = { id: 'unit_choice', act: 'choose_unit', candidate_ids: candidates }
    const turn = semantic(current, pending, { operation: 'select', reference_kind: 'relative', query_scope: 'offered', unit_numbers: numbers })
    const reference = resolvePropertyTurn(catalog, current, { _pending_question: pending, _property_context: { offered_ids: candidates } }, [], turn)
    assert.deepEqual(reference.context.selected_ids, [])
  }
})

test('acceptance plus a process question persists consent, while a conditional approval request does not', () => {
  const invitation = '¿Le gustaría continuar con el financiamiento?'
  const current = 'Si esta bien, pero como funciona el financiamiento?'
  const raw = { financing_consent: true, turn_semantics: { primary_intent: 'ask_financing', primary_evidence: current, confidence: 'high',
    answer_to_previous: { question_id: 'financing_invitation', kind: 'affirmative', evidence: 'Si esta bien', confidence: 'high' } } }
  const receipt = financingInvitationReceipt({ text: invitation, continuation_id: 'financing_invitation',
    continuation_act: 'financing', purpose: 'permission_to_continue' })
  const input = financingInputs(raw, current, invitation, { partners: finance.partners, current: {} },
    { kind: 'financing_consent', reply: invitation, invitation: receipt })
  assert.equal(input.consent, true)
  const saved = financingJourney({}, input, 'yes-process')
  assert.equal(financingJourney(saved, { consent: null }, 'doubt').accepted, true)
  assert.equal(financingInputs(raw, 'Si esta bien solo si me garantizan la aprobación', invitation, { partners: finance.partners, current: {} }).consent, null)
})

test('consecutive doubts and cash inquiries suspend capture, but the first acceptance with an explanation advances to entry', () => {
  const financeWithoutEntry = { ...finance, entry: {} }
  const pending = { id: 'financing_down_payment', act: 'financing', question: '¿Qué monto tiene para la entrada?' }
  const base = { ...info({ pending_question: pending, query: { group: 'residential' } }), financiamiento: financeWithoutEntry }
  for (const topic of ['financing_process', 'credit_approval', 'cash_payment']) {
    const semantics = { requests: [{ domain: 'financing', topics: [topic], evidence: 'Duda actual', confidence: 'high' }] }
    const plan = commercialJourneyPlan({ ...base, semantica_turno: semantics })
    assert.equal(plan.action, 'answer_current_question', topic)
    assert.equal(plan.question_id, '')
    assert.equal(object(plan.deferred_question).id, 'financing_down_payment')
  }
  const plan = commercialJourneyPlan({ ...base, semantica_turno: { answer_to_previous: { question_id: 'financing_invitation', kind: 'affirmative' },
    requests: [{ domain: 'financing', topics: ['financing_process'], evidence: 'Como funciona?', confidence: 'high' }] } })
  assert.equal(plan.question_id, 'financing_down_payment')
  const resumed = commercialJourneyPlan(base)
  assert.equal(resumed.question_id, 'financing_down_payment')
  const cashBeforeAcceptance = commercialJourneyPlan({ ...base,
    financiamiento: { ...financeWithoutEntry, journey: {} },
    semantica_turno: { primary_intent: 'ask_financing', requests: [{ domain: 'financing', topics: ['cash_payment'], evidence: 'Y al contado?', confidence: 'high' }] } })
  assert.equal(cashBeforeAcceptance.action, 'answer_current_question')
  assert.equal(cashBeforeAcceptance.question_id, '')
})

for (const observationOnly of [false, true]) test(`an AI verdict stays authoritative without server reinterpretation of its wording (observation=${observationOnly})`, async () => {
  const reply = 'El penthouse 605 tiene 140,53 m² interiores.'
  const fact = { kind: 'catalog_value', unit: 'm2', field: 'area_internal_m2', scope: null, value: 140.53,
    relation: 'eq', statement: reply, subject_id: 'p605', upper_value: null }
  const rejected = { review_contract: WRITER_CONTENT_REVIEW_VERSION, verdict: 'block', findings: [{ category: 'hard_fact', statement: reply, reason: 'La ficha respalda el área. No hay datos falsos.', authoritative_fact: 'p605: 140,53 m²' }] }
  const diagnostic = { ...rejected, review_contract: BUSINESS_RISK_REVIEW_VERSION, facts: [fact], question: null }
  assert.equal(supportedFindingRechecks(diagnostic, [{ index: 0, fact, status: 'verified' }]).length, 1)
  assert.equal(supportedFindingRechecks(diagnostic, [{ index: 0, fact, status: 'contradiction' }]).length, 0)
  let reviews = 0, writes = 0
  const result = await withResponseReviewPolicy({ enabled: true, observationOnly, updatedAt: null }, () => completeTurnReply({ current: 'Que superficie tiene el 605?', baseReply: reply,
    verified: info({ selected_ids: ['p605'] }), audit: { semantic_review_enabled: true, business_risk_review_enabled: true } },
    async (_rules, raw, _schema, _image, _file, _tone, task) => {
      const data = object(raw)
      if (task === 'review') { reviews++; assert.equal(data.borrador, reply)
        return reviews === 1 ? rejected : { ...rejected, verdict: 'pass', findings: [] } }
      writes++
      return writerFixture({ reply, question: { purpose: 'none', role: 'none', missing_datum: '', next_decision: '', continuation_id: 'none', continuation_act: 'other' },
        requests: (data.referencias_solicitud as Row[]).map(ref => ({ fragment: ref.id, intent: 'Informar superficie', request_type: 'general_information', status: 'answered', evidence: reply, fact_key: null })) })
    }))
  assert.equal(result.audit.status, observationOnly ? 'review_observed' : 'checked', JSON.stringify(result.audit))
  assert.equal(result.reply, reply)
  assert.equal(writes, observationOnly ? 1 : 2)
  assert.equal(reviews, observationOnly ? 1 : 2)
  assert.equal(object(result.audit.semantic_review).metadata_retries, 0)
  assert.equal((result.audit.repair_attempts as Row[]).length, observationOnly ? 0 : 1)
  assert.equal(object(object(result.audit.semantic_review).acceptance).content_approved, !observationOnly)
})
