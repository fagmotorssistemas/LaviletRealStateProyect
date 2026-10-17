import { plannedQuestionFixture, writerFixture } from './fixtures/writer-response.fixture'
import { financingInvitationReceipt } from './financing-invitation'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { commercialJourneyPlan, interpretCommercialJourney, journeyPendingQuestion, purchaseReadiness, rememberCommercialJourney } from './commercial-journey'
import { financingStage } from './financing-stage'
import { financingInputs } from './financing'
import { financingPrerequisiteReply } from './property-selection'
import { leadBudget, budgetKindQuestion } from './budget-state'
import { tourContinuation } from './tour-continuation'
import { turnBudgetAssessment } from './turn-budget'
import { normalizeTurnSemantics, normalizedPendingQuestion } from './turn-semantics'
import { reservationRequest } from './reservation-action'
import { completeTurnReply } from './turn-completeness'
import { object, type Row } from './data'

const unit = { id: 'u502', unit_number: '502', category: 'departamento', bedrooms: 3, status: 'disponible', is_published: true, published_commercial_price: 310000 }
const profile = { full_name: 'Carlos', name_status: 'confirmed', residence_city: 'Cuenca', residence_status: 'confirmed', sources: { full_name: { source: 'lead_declaration', evidence: 'Soy Carlos' }, residence_city: { source: 'lead_declaration', evidence: 'Vivo en Cuenca' } } }
const money = (amount: number): Row => ({ status: 'maximum_total', amount, confidence: 'high', evidence: `Mi presupuesto total para la compra es ${amount}` })

test('multiple incompatible constraints ask for a specific change rather than accepting an unspecified alternative', () => {
  const verified = residentialSelection()
  verified.property_context = { query: { group: 'residential', operation: 'search', filters: { bedrooms: 5, floor_number: 10 } } }
  const next = commercialJourneyPlan(verified)
  assert.equal(next.action, 'clarify_requirements')
  assert.equal(next.question_act, 'other')
  assert.equal(next.proposed_query, undefined)
  assert.equal(next.adjustment_requires_specific_choice, true)
  assert.match(String(next.question), /cuál podría flexibilizar/)
})
function info(budget: Row = money(350000), selected = true): Row {
  return { lead: { purchase_purpose: 'vivir', preferred_bedrooms: 3 }, perfil_lead: profile,
    catalogo: [unit], catalog_read: { complete: true }, politica_comercial: { precios_autorizados: true },
    propiedad: {}, property_context: { selected_ids: selected ? [unit.id] : [], query: { group: 'residential', category: 'departamento', operation: 'select', filters: { bedrooms: 3 } } },
    referencia_unidad: { matches: selected ? [unit] : [], needsClarification: false }, hechos_confirmados: { budget },
    financiamiento: { partners: ['Banco Pichincha', 'Cooperativa JEP'], current: {}, journey: {} },
    recorrido_comercial: {}, politica_visitas: { allowSuggestions: true, launchDestination: 'office' }, modo_comercial: 'lanzamiento',
    semantica_turno: { primary_intent: 'select_property', budget: { status: 'not_discussed' } } }
}

function residentialSelection(): Row {
  const data = info(money(200000), false)
  data.catalogo = [
    ...[2, 3, 4, 5].map(floor => ({ ...unit, id: `u${floor}02`, unit_number: `${floor}02`, floor_number: floor })),
    ...['602', '605'].map(number => ({ ...unit, id: `u${number}`, unit_number: number, category: 'penthouse', floor_number: 6, published_commercial_price: 550000 })),
    { ...unit, id: 'suite', category: 'suite', bedrooms: 1 },
    { ...unit, id: 'local', category: 'local', bedrooms: null },
  ]
  data.property_context = { selected_ids: [], excluded_categories: [], query: { group: 'residential', category: null, filters: { bedrooms: 3 } } }
  data.financiamiento = { ...object(data.financiamiento), journey: { accepted: true },
    entry: { status: 'not_defined', evidence: 'Todavía no sé cuánto pondría de entrada', source_message_id: 'entry-answer' } }
  return data
}

test('accepted financing with an answered entry keeps both compatible residential categories in the next question', () => {
  const data = residentialSelection(), next = commercialJourneyPlan(data)
  assert.equal(next.action, 'select_property')
  assert.equal(next.question_id, 'property_category')
  assert.deepEqual(object(next.selection_scope).categories, ['departamento', 'penthouse'])
  assert.deepEqual(object(next.selection_scope).unit_ids, ['u202', 'u302', 'u402', 'u502', 'u602', 'u605'])
  assert.match(String(next.question), /departamentos.*penthouses/)
  assert.match(String(next.question), /Prefiere que revisemos/)
  assert.doesNotMatch(String(next.question), /suite|comercial/)
  assert.equal(next.financing_offer_allowed, false)
  assert.equal(financingStage(data).collection_allowed, false)
  assert.match(financingPrerequisiteReply(data, 'bueno si esta bien'), /departamentos.*penthouses/)
  const pending = normalizedPendingQuestion(journeyPendingQuestion(String(next.question), next, true, plannedQuestionFixture(next)), data.catalogo as Row[])
  assert.equal(pending.act, 'choose_category')
  assert.deepEqual(pending.candidate_ids, object(next.selection_scope).unit_ids)
})

test('category choice comes from compatible inventory, including suites when they match', () => {
  const data = residentialSelection()
  data.property_context = { query: { group: 'residential', filters: { bedrooms: 1 } } }
  data.catalogo = [
    { ...unit, id: 'suite', category: 'suite', bedrooms: 1 },
    { ...unit, id: 'apartment', bedrooms: 1 },
    { ...unit, id: 'penthouse', category: 'penthouse', bedrooms: 3 },
    { ...unit, id: 'local', category: 'local', bedrooms: 1 },
  ]
  const next = commercialJourneyPlan(data)
  assert.deepEqual(object(next.selection_scope).categories, ['suite', 'departamento'])
  assert.match(String(next.question), /suites.*departamentos/)
  assert.doesNotMatch(String(next.question), /penthouse|comercial/)
})

test('an explicit category choice or exclusion does not reopen the other category', () => {
  for (const context of [
    { query: { group: 'residential', category: 'departamento', filters: { bedrooms: 3 } },
      category_preference: { category: 'departamento', confirmed: true, evidence: 'Prefiero los departamentos' } },
    { query: { group: 'residential', filters: { bedrooms: 3 } }, excluded_categories: ['penthouse'] },
  ]) {
    const data = residentialSelection()
    data.property_context = context
    const next = commercialJourneyPlan(data)
    assert.equal(next.action, 'select_property')
    assert.deepEqual(object(next.selection_scope).categories, ['departamento'])
    assert.doesNotMatch(String(next.question), /penthouse/)
    assert.notEqual(next.question_id, 'property_category')
  }
})

test('hard requirements and a scoped comparison exclude incompatible categories from the next question', () => {
  for (const context of [
    { query: { group: 'residential', filters: { bedrooms: 3 }, requirements: [{ field: 'floor_number', operator: 'eq', value: 6, strength: 'required' }] } },
    { query: { group: 'residential', scope: 'comparison', filters: { bedrooms: 3 } }, comparison_ids: ['u202', 'u502'] },
    { query: { group: 'residential', scope: 'offered', filters: { bedrooms: 3 } }, offered_ids: [] },
  ]) {
    const data = residentialSelection()
    data.property_context = context
    const categories = object(commercialJourneyPlan(data).selection_scope).categories as string[]
    assert.ok(categories.length < 2, 'A restricted query must not reopen both residential categories')
  }
  const data = residentialSelection()
  data.catalogo = (data.catalogo as Row[]).map(unit => unit.category === 'penthouse' ? { ...unit, status: 'vendido' } : unit)
  assert.deepEqual(object(commercialJourneyPlan(data).selection_scope).categories, ['departamento'])
})

test('cash buyer selects a unit: reserve first, then office on refusal, then leave chat open', () => {
  const data = info(), reserve = commercialJourneyPlan(data)
  assert.equal(reserve.action, 'offer_reservation')
  assert.equal(reserve.visit_offer_allowed, false)
  const pending = normalizedPendingQuestion(journeyPendingQuestion(String(reserve.question), reserve, true, plannedQuestionFixture(reserve)), [unit])
  assert.equal(pending.id, 'reservation_invitation')
  let state = rememberCommercialJourney({}, reserve, pending, true)
  assert.equal(commercialJourneyPlan({ ...data, recorrido_comercial: state }).action, 'await_reservation')
  state = interpretCommercialJourney(state, { answer_to_previous: { question_id: pending.id, confidence: 'high', kind: 'negative' } }, pending, [unit.id])
  const visit = commercialJourneyPlan({ ...data, recorrido_comercial: state })
  assert.equal(visit.action, 'offer_visit')
  assert.match(String(visit.question), /oficina/)
  const visitPending = journeyPendingQuestion(String(visit.question), visit, true, plannedQuestionFixture(visit))
  state = rememberCommercialJourney(state, visit, visitPending, true)
  state = interpretCommercialJourney(state, { answer_to_previous: { question_id: 'visit_invitation', confidence: 'high', kind: 'negative' } }, visitPending, [unit.id])
  const close = commercialJourneyPlan({ ...data, recorrido_comercial: state })
  assert.equal(close.action, 'leave_open'); assert.equal(close.question, '')
})

test('a yes to the actual reservation question requests that unit, not a visit or an inventory reservation', () => {
  const plan = commercialJourneyPlan(info()), pending = journeyPendingQuestion(String(plan.question), plan, true, plannedQuestionFixture(plan))
  const semantics = normalizeTurnSemantics({ turn_semantics: { primary_intent: 'request_reservation', primary_evidence: 'si claro', confidence: 'high',
    answer_to_previous: { question_id: 'reservation_invitation', kind: 'affirmative', evidence: 'si claro', confidence: 'high' },
    reservation: { kind: 'request', confidence: 'high', evidence: 'si claro', unit_numbers: ['502'] } } }, 'si claro', pending)
  const request = reservationRequest(object(semantics.reservation), [{ externalId: 'm1', text: 'si claro' }], [unit], [unit])
  assert.deepEqual(request?.unit_ids, ['u502'])
  assert.equal(object(semantics.answer_to_previous).question_id, 'reservation_invitation')
  const last = 'La revisión del crédito permite continuar. ¿Le gustaría iniciar la reserva del 502?'
  for (const [answer, kind] of [['sí', 'affirmative'], ['no', 'negative']]) {
    const financeInput = financingInputs({ turn_semantics: { answer_to_previous: { question_id: 'reservation_invitation', kind, confidence: 'high' } } },
      answer, last, { partners: ['Banco Pichincha'], current: { explicit_consent: true } }, { kind: 'commercial_question', reply: last })
    assert.equal(financeInput.consent, null)
    assert.equal(financeInput.partner, null)
    assert.notEqual(financeInput.declined, true, 'Declining reservation does not revoke the financing review')
  }
})

for (const [budget, action] of [
  [{ status: 'not_discussed' }, 'ask_budget'],
  [{ status: 'amount_pending', confidence: 'high', evidence: 'si tengo' }, 'ask_budget'],
  [{ status: 'unknown', confidence: 'high', evidence: 'no sé a qué se refiere' }, 'ask_budget'],
  [{ status: 'no_defined_budget', confidence: 'high', evidence: 'no tengo presupuesto definido' }, 'clarify_purchase'],
  [money(50000), 'offer_financing'],
  [{ status: 'initial_capital', amount: 350000, confidence: 'high', evidence: 'para entrada' }, 'clarify_purchase'],
  [money(350000), 'offer_reservation'],
] as [Row, string][]) test(`budget ${budget.status} / ${budget.amount ?? '-'} selects ${action}`, () => {
  const plan = commercialJourneyPlan(info(budget))
  assert.equal(plan.action, action)
  if (action !== 'offer_financing') assert.equal(plan.financing_offer_allowed, false)
})

test('50k family case asks entry after acceptance then resumes property selection without another rejection', () => {
  const data = info(money(50000), false)
  data.presupuesto_del_turno = turnBudgetAssessment(data, {})
  const offer = commercialJourneyPlan(data)
  assert.equal(offer.action, 'offer_financing')
  const pending = journeyPendingQuestion(String(offer.question), offer, true, plannedQuestionFixture(offer))
  const inputs = financingInputs({ turn_semantics: { answer_to_previous: { question_id: pending.id, kind: 'affirmative', confidence: 'high', evidence: 'bueno continuemos' } } },
    'bueno continuemos', String(offer.question), { partners: ['Banco Pichincha'], current: {} }, { kind: 'financing_consent', reply: offer.question,
      invitation: financingInvitationReceipt(plannedQuestionFixture(offer)) })
  assert.equal(inputs.consent, true, JSON.stringify({ offer: { id: offer.question_id, act: offer.question_act, question: offer.question },
    receipt: financingInvitationReceipt(plannedQuestionFixture(offer)), pending }))
  data.financiamiento = { ...object(data.financiamiento), journey: { accepted: true } }
  data.etapa_financiamiento = financingStage(data)
  delete data.presupuesto_del_turno
  assert.equal(turnBudgetAssessment(data, { source: 'financing_selection_required' }), null)
  const next = commercialJourneyPlan(data)
  assert.equal(next.action, 'clarify_financing_down_payment')
  assert.match(String(next.question), /presupuesto de \$50\.000.*entrada inicial/)
  assert.equal(next.financing_offer_allowed, false)
  object(data.financiamiento).entry = { status: 'amount', amount: 50000, evidence: 'Sí, ese monto para la entrada', source_message_id: 'entry-confirmed' }
  data.etapa_financiamiento = financingStage(data)
  const selection = commercialJourneyPlan(data)
  assert.equal(selection.action, 'select_property')
  assert.match(String(selection.instruction), /No repita que no alcanza/)
})

test('financing intake requires a chosen unit and budget answer, not necessarily a number', () => {
  for (const [status, allowed] of [['not_discussed', false], ['amount_pending', false], ['no_defined_budget', true], ['declines_to_disclose', true]] as const) {
    const data = info({ status, confidence: 'high', evidence: status })
    data.financiamiento = { ...object(data.financiamiento), journey: { accepted: true },
      entry: { status: 'not_defined', amount: null, evidence: 'Todavía no tengo definida la entrada', source_message_id: 'entry-answer' } }
    assert.equal(financingStage(data).collection_allowed, allowed, status)
    assert.equal(Boolean(financingPrerequisiteReply(data, 'continuemos')), !allowed, status)
  }
  const data = info(money(50000), false)
  data.financiamiento = { ...object(data.financiamiento), journey: { accepted: true } }
  assert.equal(financingStage(data).collection_allowed, false)
})

test('unknown/undefined current declarations replace a saved amount rather than restoring the old CRM budget', () => {
  const data = info(money(350000)); data.lead = { budget: 350000 }
  data.semantica_turno = { budget: { status: 'no_defined_budget', confidence: 'high', evidence: 'ya no tengo presupuesto definido' } }
  assert.equal(leadBudget(data).status, 'no_defined_budget')
  assert.equal(purchaseReadiness(data).can_offer_reservation, false)
})

test('credit collection alone is not approval; a recorded review is bound to unit, price and current dossier', () => {
  const data = info(money(50000))
  data.financiamiento = { ...object(data.financiamiento), journey: { accepted: true }, current: { explicit_consent: true, status: 'lista', updated_at: 'review-basis' } }
  assert.equal(purchaseReadiness(data).can_offer_reservation, false)
  const review = { unit_id: unit.id, unit_price: 310000, own_funds: 50000, financing_amount: 260000,
    result: 'favorable', reviewed_at: 'today', reviewed_by: 'staff', qualification_updated_at: 'review-basis' }
  data.lead = { behavior_signals: { financing_review: review } }
  assert.equal(purchaseReadiness(data).can_offer_reservation, true)
  assert.equal(commercialJourneyPlan(data).action, 'offer_reservation')
  assert.equal(purchaseReadiness({ ...data, financiamiento: { ...object(data.financiamiento), journey: { status: 'declined', accepted: false } } }).can_offer_reservation, false)
  for (const changed of [{ unit_id: 'another' }, { unit_price: 300000 }, { financing_amount: 250000 }, { qualification_updated_at: 'old' }, { result: 'pending' }]) {
    assert.equal(purchaseReadiness({ ...data, lead: { behavior_signals: { financing_review: { ...review, ...changed } } } }).can_offer_reservation, false)
  }
})

test('a visit can help an undecided comparison but price alone no longer triggers it', () => {
  const data = info(money(350000), false)
  assert.equal(commercialJourneyPlan(data).visit_offer_allowed, false)
  data.catalogo = [unit, { ...unit, id: 'u602', unit_number: '602', category: 'penthouse' }]
  data.property_context = { query: { operation: 'compare' }, comparison_ids: ['u502', 'u602'], selected_ids: [] }
  data.semantica_turno = { answer_to_previous: { kind: 'uncertain', confidence: 'high' } }
  assert.equal(commercialJourneyPlan(data).action, 'offer_visit')
  assert.equal(commercialJourneyPlan(data, { source: 'visit_intake', action: 'collecting' }).action, 'current_operation')
})

test('introduction and actual actions take precedence; failed delivery does not consume an offer', () => {
  assert.equal(commercialJourneyPlan(info(), { profile_introduction: { question_purpose: 'collect_profile' } }).action, 'introduction')
  assert.equal(commercialJourneyPlan(info(), { source: 'advisor_handoff', action: 'assigned' }).action, 'current_operation')
  const plan = commercialJourneyPlan(info())
  assert.deepEqual(rememberCommercialJourney({}, plan, { id: 'reservation_invitation' }, false), {})
  assert.deepEqual(journeyPendingQuestion(String(plan.question), plan, false), {})
})

test('writer retains the reservation step while factual review receives only operation evidence', async () => {
  const data = info(), calls: string[] = [], assertions: string[] = []
  data.solicitudes_interpretadas = [{ domain: 'property', request: 'Elegir el departamento 502', evidence: 'quiero el 502', confidence: 'high' }]
  const result = await completeTurnReply({ current: 'quiero el 502', baseReply: '', verified: data,
    audit: { source: 'commercial', semantic_review_enabled: true, business_risk_review_enabled: true } },
  async (_rules, raw, _schema, _image, _file, _tone, task) => {
    const input = object(raw); calls.push(String(task))
    try {
      const obligations = (input.obligaciones_del_turno as Row[])
      assert.equal(obligations.find(o => o.id === 'commercial_next_step')?.action, task === 'writing' ? 'offer_reservation' : undefined)
      if (task === 'writing') return writerFixture({ reply: '¿Le gustaría que le ayudemos a iniciar la reserva del departamento 502?',
        requests: [{ fragment: 'R1', intent: 'Elegir unidad', status: 'answered', evidence: 'Continúa con la unidad elegida', fact_key: null, request_type: 'general_information' }],
        question: { role: 'optional_continuation', purpose: 'permission_to_continue', missing_datum: '', next_decision: 'Solicitar reserva al equipo' } })
      assert.equal(object(input.estado_del_turno).siguiente_paso_comercial, undefined)
      return { review_contract: 'content-review-v1', verdict: 'pass', findings: [] }
    } catch (error) { assertions.push(String(error)); throw error }
  })
  assert.deepEqual(assertions, [])
  assert.equal(result.audit.status, 'checked')
  assert.equal(object(result.audit.commercial_journey).action, 'offer_reservation')
  assert.deepEqual(calls, ['writing', 'review'])
})

test('financing continuation keeps the type choice in writer and receipt without giving it to the reviewer', async () => {
  const data = residentialSelection(), calls: string[] = [], assertions: string[] = []
  const categories = ['departamento', 'penthouse']
  const reply = 'Para continuar con el financiamiento, primero elijamos su vivienda. ¿Prefiere que revisemos los departamentos o los penthouses de 3 dormitorios?'
  const result = await completeTurnReply({ current: 'bueno si esta bien', baseReply: financingPrerequisiteReply(data, 'bueno si esta bien'), verified: data,
    audit: { source: 'financing_selection_required', semantic_review_enabled: true, business_risk_review_enabled: true } },
  async (_rules, raw, _schema, _image, _file, _tone, task) => {
    const input = object(raw); calls.push(String(task))
    try {
      const next = (input.obligaciones_del_turno as Row[]).find(o => o.id === 'commercial_next_step')
      assert.deepEqual(object(next?.selection_scope).categories, task === 'writing' ? categories : undefined)
      assert.equal(next?.question_id, task === 'writing' ? 'property_category' : undefined)
      if (task === 'writing') return writerFixture({ reply, requests: [],
        question: { role: 'necessary_clarification', purpose: 'choose_property', missing_datum: 'tipo de vivienda', next_decision: 'Presentar las plantas del tipo elegido' } })
      assert.equal(object(input.estado_del_turno).siguiente_paso_comercial, undefined)
      return { review_contract: 'content-review-v1', verdict: 'pass', findings: [] }
    } catch (error) { assertions.push(String(error)); throw error }
  })
  assert.deepEqual(assertions, [])
  assert.equal(result.reply, reply)
  assert.equal(result.audit.status, 'checked')
  assert.deepEqual(object(object(result.audit.commercial_journey).selection_scope).categories, categories)
  assert.deepEqual(calls, ['writing', 'review'])
})

test('the early total-budget step stays in the writer and delivered question, outside factual review', async () => {
  const data = info({ status: 'not_discussed' }, false), calls: string[] = [], failures: string[] = []
  data.lead = { purchase_purpose: 'vivir' }
  data.property_context = { query: { group: 'residential', operation: 'search', filters: {} }, selected_ids: [] }
  data.solicitudes_interpretadas = [{ domain: 'property', request: 'Busca vivienda', evidence: 'Algo para vivienda', confidence: 'high' }]
  const reply = 'Con gusto. ¿Qué presupuesto total aproximado tiene previsto para la compra?'
  const result = await completeTurnReply({ current: 'Algo para vivienda', baseReply: '', verified: data,
    audit: { source: 'commercial', semantic_review_enabled: true, business_risk_review_enabled: true } },
  async (_rules, raw, _schema, _image, _file, _tone, task) => {
    const input = object(raw); calls.push(String(task))
    try {
      const next = (input.obligaciones_del_turno as Row[]).find(obligation => obligation.id === 'commercial_next_step')!
      if (task === 'writing') assert.equal(next.action, 'ask_budget')
      if (task === 'writing') assert.equal(next.question_id, 'budget_amount')
      if (task === 'writing') assert.equal(Boolean(next.requires_unit_presentation), false)
      if (task === 'writing') { assert.equal(next.question, undefined); assert.match(String(object(next.objetivo_conversacion).objective), /presupuesto/i) }
      if (task === 'writing') return writerFixture({ reply,
        requests: [{ fragment: 'R1', intent: 'Busca vivienda', status: 'answered', evidence: reply,
          fact_key: null, request_type: 'general_information' }],
        question: { role: 'necessary_clarification', purpose: 'choose_property', missing_datum: 'presupuesto total',
          next_decision: 'Conocer los dormitorios que necesita', continuation_id: 'budget_amount', continuation_act: 'budget' } })
      assert.equal(object(input.estado_del_turno).siguiente_paso_comercial, undefined)
      return { review_contract: 'content-review-v1', verdict: 'pass', findings: [] }
    } catch (error) { failures.push(String(error)); throw error }
  })
  assert.deepEqual(failures, [])
  assert.deepEqual(calls, ['writing', 'review'])
  assert.equal(result.reply, reply)
  assert.equal(result.audit.status, 'checked')
  const plan = object(result.audit.commercial_journey)
  const pending = journeyPendingQuestion(result.reply, plan, true, result.audit.question)
  assert.equal(pending.id, 'budget_amount')
  assert.equal(pending.act, 'budget')
  assert.equal(plan.financing_offer_allowed, false)
  assert.doesNotMatch(reply, /departamento \d|penthouse \d|financiamiento/)
})


test('an unspecified monetary amount asks its meaning before financing or reservation, with or without a unit', () => {
  for (const amount of [70000, 600000]) for (const selected of [false, true]) {
    const data = info({ status: 'amount', amount, confidence: 'high', evidence: 'Cuento con ese dinero' }, selected)
    const plan = commercialJourneyPlan(data), budget = leadBudget(data)
    assert.equal(plan.action, 'clarify_budget_kind')
    assert.equal(plan.question_id, 'budget_kind')
    assert.equal(plan.question, budgetKindQuestion(budget))
    assert.equal(plan.financing_offer_allowed, false)
    assert.equal(plan.visit_offer_allowed, false)
    assert.equal(purchaseReadiness(data).can_offer_reservation, false)
    assert.equal(purchaseReadiness(data).coverage, 'unconfirmed')
    assert.equal(tourContinuation(data, unit).question, plan.question)
    const simpleTour = { ...data, recorrido_comercial: undefined, semantica_turno: { budget }, lead: { ...object(data.lead), budget: amount } }
    assert.equal(tourContinuation(simpleTour, unit).question, plan.question)
    assert.match(String(plan.question), /total.*entrada/)
    assert.doesNotMatch(String(plan.question), /de cuánto|qué presupuesto/i)
  }
})

test('a known total or initial capital never receives an additional meaning or amount question', () => {
  for (const budget of [money(70000), money(600000), { status: 'initial_capital', amount: 70000, confidence: 'high', evidence: 'Dinero para la entrada' }]) {
    const data = info(budget), plan = commercialJourneyPlan(data)
    assert.equal(budgetKindQuestion(leadBudget(data)), '')
    assert.notEqual(plan.question_id, 'budget_kind')
    assert.notEqual(plan.question_id, 'budget_amount')
    assert.equal(purchaseReadiness(data).can_offer_reservation, budget.status === 'maximum_total' && Number(budget.amount) >= 310000)
  }
})

test('declined or deferred budget discovery does not ask the amount or meaning again', () => {
  for (const status of ['declines_to_disclose', 'no_defined_budget']) {
    const data = info({ status, confidence: 'high', evidence: 'No deseo indicar mi presupuesto' })
    data.financiamiento = { partners: [], current: {}, journey: {} }
    const plan = commercialJourneyPlan(data)
    assert.notEqual(plan.question_id, 'budget_kind')
    assert.notEqual(plan.question_id, 'budget_amount')
    assert.equal(purchaseReadiness(data).can_offer_reservation, false)
  }
  const deferred = info({ status: 'amount', amount: 70000, confidence: 'high', evidence: 'Cuento con 70 mil' })
  deferred.memoria_comercial = { deferred_fields: ['presupuesto'] }
  assert.equal(commercialJourneyPlan(deferred).question, '')
  assert.equal(commercialJourneyPlan(deferred).financing_offer_allowed, false)
  deferred.semantica_turno = { budget: { status: 'amount', amount: 600000, confidence: 'high', evidence: 'Ahora cuento con 600 mil' } }
  assert.equal(commercialJourneyPlan(deferred).question_id, 'budget_kind', 'A new explicit declaration may reopen the clarification')
})

test('an accepted financial operation is preserved and an ambiguous amount cannot authorize a cash reservation', () => {
  const data = info({ status: 'amount', amount: 600000, confidence: 'high', evidence: 'Cuento con ese dinero' })
  data.financiamiento = { ...object(data.financiamiento), journey: { accepted: true }, current: { explicit_consent: true } }
  assert.equal(commercialJourneyPlan(data).action, 'clarify_budget_kind')
  assert.equal(purchaseReadiness(data).can_offer_reservation, false)
  assert.equal(commercialJourneyPlan(data, { action: 'collecting', source: 'financing_handoff' }).action, 'current_operation')
})


test('a clarification preserves the actual prior category, floor or unit decision and its candidate scope', () => {
  for (const [id, act] of [['property_category', 'choose_category'], ['property_floor', 'choose_floor'], ['unit_choice', 'choose_unit']]) {
    const data = info(), question = '¿Cuál de las alternativas de la pregunta anterior prefiere?'
    const pending = { id, act, question, candidate_ids: ['u502', 'u605'], target_ids: [] }
    const plan = commercialJourneyPlan(data, { source: 'clarify_previous_choice', pending_question: pending })
    assert.equal(plan.action, 'clarify_choice')
    assert.equal(plan.question, question)
    assert.equal(plan.question_id, id)
    assert.equal(plan.question_act, act)
    assert.deepEqual(object(plan.selection_scope).unit_ids, pending.candidate_ids)
    assert.equal(plan.financing_offer_allowed, false)
    assert.equal(plan.visit_offer_allowed, false)
    assert.equal(journeyPendingQuestion(question, plan, true, plannedQuestionFixture(plan)).act, act)
  }
})

test('indecision requires identified compatible options rather than missing choice or informational questions', () => {
  const data = info(money(350000), false)
  data.catalogo = [unit, { ...unit, id: 'u602', unit_number: '602', category: 'penthouse' },
    { ...unit, id: 'suite', category: 'suite', bedrooms: 1 }]
  data.property_context = { query: { operation: 'compare', filters: { bedrooms: 3 } }, comparison_ids: ['u502', 'u602'], selected_ids: [] }
  data.semantica_turno = { primary_intent: 'answer_previous', answer_to_previous: { kind: 'uncertain', confidence: 'high' } }
  const next = commercialJourneyPlan(data)
  assert.equal(next.action, 'offer_visit')
  assert.deepEqual(next.comparison_unit_ids, ['u502', 'u602'])
  assert.match(String(next.instruction), /orientación|orientarle/)
  assert.match(String(next.instruction), /No prometa planos|No prometa revisar planos/)
  assert.match(String(next.instruction), /no confirme|no registra/)
  for (const primary_intent of ['ask_price', 'project_information', 'ask_financing']) {
    const other = { ...data, semantica_turno: { primary_intent,
      answer_to_previous: { kind: 'uncertain', confidence: 'high' } } }
    assert.notEqual(commercialJourneyPlan(other).action, 'offer_visit', primary_intent)
  }
  assert.notEqual(commercialJourneyPlan({ ...data, semantica_turno: {} }).action, 'offer_visit')
  for (const comparison_ids of [['u502', 'missing'], ['u502', 'suite'], []]) {
    const other = { ...data, property_context: { ...object(data.property_context), comparison_ids } }
    assert.notEqual(commercialJourneyPlan(other).action, 'offer_visit', JSON.stringify(comparison_ids))
  }
  const declined = { ...data, recorrido_comercial: { visit_declined: true } }
  assert.notEqual(commercialJourneyPlan(declined).action, 'offer_visit')
})

test('on-site office invitation preserves authorized destination without promising plans or completed units', () => {
  const data = info(money(350000), false)
  data.catalogo = [unit, { ...unit, id: 'u602', unit_number: '602', category: 'penthouse' }]
  data.property_context = { query: { operation: 'compare' }, comparison_ids: ['u502', 'u602'], selected_ids: [] }
  data.semantica_turno = { primary_intent: 'answer_previous', answer_to_previous: { kind: 'uncertain', confidence: 'high' } }
  data.politica_visitas = { allowSuggestions: true, launchDestination: 'office', readiness: {
    stage: 'not_started', progress: 'La obra aún no ha iniciado', verifiedOn: '2026-10-01',
    enabledPlaces: ['office'], primaryPlace: 'office', conditions: '', officeAtProjectSite: true } }
  const next = commercialJourneyPlan(data)
  assert.equal(next.action, 'offer_visit')
  assert.match(String(next.question), /oficina.*sitio del proyecto/)
  assert.match(String(next.question), /orientación/)
  assert.doesNotMatch(String(next.question), /planos|unidades terminadas|conocer.*departamento/)
  assert.equal(next.question_id, 'visit_invitation')
  assert.equal(String(next.question).match(/\?/g)?.length, 1)
  assert.equal(next.action === 'current_operation', false)
})
