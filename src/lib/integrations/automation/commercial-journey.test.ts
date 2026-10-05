import assert from 'node:assert/strict'
import { test } from 'node:test'
import { commercialJourneyPlan, interpretCommercialJourney, journeyPendingQuestion, purchaseReadiness, rememberCommercialJourney } from './commercial-journey'
import { financingStage } from './financing-stage'
import { financingInputs } from './financing'
import { financingPrerequisiteReply } from './property-selection'
import { leadBudget } from './budget-state'
import { turnBudgetAssessment } from './turn-budget'
import { normalizeTurnSemantics, normalizedPendingQuestion } from './turn-semantics'
import { reservationRequest } from './reservation-action'
import { completeTurnReply } from './turn-completeness'
import { object, type Row } from './data'

const unit = { id: 'u502', unit_number: '502', category: 'departamento', bedrooms: 3, status: 'disponible', is_published: true, published_commercial_price: 310000 }
const profile = { full_name: 'Carlos', name_status: 'confirmed', residence_city: 'Cuenca', residence_status: 'confirmed', sources: { full_name: { source: 'lead_declaration', evidence: 'Soy Carlos' }, residence_city: { source: 'lead_declaration', evidence: 'Vivo en Cuenca' } } }
const money = (amount: number): Row => ({ status: 'amount', amount, confidence: 'high', evidence: `Tengo ${amount}` })
function info(budget: Row = money(350000), selected = true): Row {
  return { lead: { purchase_purpose: 'vivir', preferred_bedrooms: 3 }, perfil_lead: profile,
    catalogo: [unit], catalog_read: { complete: true }, politica_comercial: { precios_autorizados: true },
    propiedad: {}, property_context: { selected_ids: selected ? [unit.id] : [], query: { group: 'residential', category: 'departamento', operation: 'select', filters: { bedrooms: 3 } } },
    referencia_unidad: { matches: selected ? [unit] : [], needsClarification: false }, hechos_confirmados: { budget },
    financiamiento: { partners: ['Banco Pichincha', 'Cooperativa JEP'], current: {}, journey: {} },
    recorrido_comercial: {}, politica_visitas: { allowSuggestions: true, launchDestination: 'office' }, modo_comercial: 'lanzamiento',
    semantica_turno: { primary_intent: 'select_property', budget: { status: 'not_discussed' } } }
}

test('cash buyer selects a unit: reserve first, then office on refusal, then leave chat open', () => {
  const data = info(), reserve = commercialJourneyPlan(data)
  assert.equal(reserve.action, 'offer_reservation')
  assert.equal(reserve.visit_offer_allowed, false)
  const pending = normalizedPendingQuestion(journeyPendingQuestion(String(reserve.question), reserve, true), [unit])
  assert.equal(pending.id, 'reservation_invitation')
  let state = rememberCommercialJourney({}, reserve, pending, true)
  assert.equal(commercialJourneyPlan({ ...data, recorrido_comercial: state }).action, 'await_reservation')
  state = interpretCommercialJourney(state, { answer_to_previous: { question_id: pending.id, confidence: 'high', kind: 'negative' } }, pending, [unit.id])
  const visit = commercialJourneyPlan({ ...data, recorrido_comercial: state })
  assert.equal(visit.action, 'offer_visit')
  assert.match(String(visit.question), /oficina/)
  const visitPending = journeyPendingQuestion(String(visit.question), visit, true)
  state = rememberCommercialJourney(state, visit, visitPending, true)
  state = interpretCommercialJourney(state, { answer_to_previous: { question_id: 'visit_invitation', confidence: 'high', kind: 'negative' } }, visitPending, [unit.id])
  const close = commercialJourneyPlan({ ...data, recorrido_comercial: state })
  assert.equal(close.action, 'leave_open'); assert.equal(close.question, '')
})

test('a yes to the actual reservation question requests that unit, not a visit or an inventory reservation', () => {
  const plan = commercialJourneyPlan(info()), pending = journeyPendingQuestion(String(plan.question), plan, true)
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
  [{ status: 'no_defined_budget', confidence: 'high', evidence: 'no tengo presupuesto definido' }, 'offer_financing'],
  [money(50000), 'offer_financing'],
  [{ status: 'initial_capital', amount: 350000, confidence: 'high', evidence: 'para entrada' }, 'clarify_purchase'],
  [money(350000), 'offer_reservation'],
] as [Row, string][]) test(`budget ${budget.status} / ${budget.amount ?? '-'} selects ${action}`, () => {
  const plan = commercialJourneyPlan(info(budget))
  assert.equal(plan.action, action)
  if (action !== 'offer_financing') assert.equal(plan.financing_offer_allowed, false)
})

test('50k family case offers financing; bueno continuemos returns to property selection without another rejection', () => {
  const data = info(money(50000), false)
  data.presupuesto_del_turno = turnBudgetAssessment(data, {})
  const offer = commercialJourneyPlan(data)
  assert.equal(offer.action, 'offer_financing')
  const pending = journeyPendingQuestion(String(offer.question), offer, true)
  const inputs = financingInputs({ turn_semantics: { answer_to_previous: { question_id: pending.id, kind: 'affirmative', confidence: 'high' } } },
    'bueno continuemos', String(offer.question), { partners: ['Banco Pichincha'], current: {} }, { kind: 'financing_consent', reply: offer.question })
  assert.equal(inputs.consent, true)
  data.financiamiento = { ...object(data.financiamiento), journey: { accepted: true } }
  data.etapa_financiamiento = financingStage(data)
  delete data.presupuesto_del_turno
  assert.equal(turnBudgetAssessment(data, { source: 'financing_selection_required' }), null)
  const next = commercialJourneyPlan(data)
  assert.equal(next.action, 'select_property')
  assert.match(String(next.instruction), /No repita que no alcanza/)
  assert.equal(next.financing_offer_allowed, false)
})

test('financing intake requires a chosen unit and budget answer, not necessarily a number', () => {
  for (const [status, allowed] of [['not_discussed', false], ['amount_pending', false], ['no_defined_budget', true], ['declines_to_disclose', true]] as const) {
    const data = info({ status, confidence: 'high', evidence: status })
    data.financiamiento = { ...object(data.financiamiento), journey: { accepted: true } }
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

test('writer and independent reviewer receive the same reservation step through the final pipeline', async () => {
  const data = info(), calls: string[] = [], assertions: string[] = []
  data.solicitudes_interpretadas = [{ domain: 'property', request: 'Elegir el departamento 502', evidence: 'quiero el 502', confidence: 'high' }]
  const result = await completeTurnReply({ current: 'quiero el 502', baseReply: '', verified: data,
    audit: { source: 'commercial', semantic_review_enabled: true, business_risk_review_enabled: true } },
  async (_rules, raw, _schema, _image, _file, _tone, task) => {
    const input = object(raw); calls.push(String(task))
    try {
      const obligations = (input.obligaciones_del_turno as Row[])
      assert.equal(obligations.find(o => o.id === 'commercial_next_step')?.action, 'offer_reservation')
      if (task === 'writing') return { reply: '¿Le gustaría que le ayudemos a iniciar la reserva del departamento 502?',
        requests: [{ fragment: 'R1', intent: 'Elegir unidad', status: 'answered', evidence: 'Continúa con la unidad elegida', fact_key: null, request_type: 'general_information' }],
        question: { role: 'optional_continuation', purpose: 'permission_to_continue', missing_datum: '', next_decision: 'Solicitar reserva al equipo' } }
      assert.equal(object(object(input.estado_del_turno).siguiente_paso_comercial).action, 'offer_reservation')
      return { review_contract: 'business-risk-v2', verdict: 'pass', findings: [], facts: [], question: null }
    } catch (error) { assertions.push(String(error)); throw error }
  })
  assert.deepEqual(assertions, [])
  assert.equal(result.audit.status, 'checked')
  assert.equal(object(result.audit.commercial_journey).action, 'offer_reservation')
  assert.deepEqual(calls, ['writing', 'review'])
})
