import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { tourContinuation } from './tour-continuation'
import { commercialJourneyPlan, purchaseReadiness } from './commercial-journey'
import { financingStage } from './financing-stage'
import { leadBudget } from './budget-state'
import { object, type Row } from './data'

const unit = { id: 'p602', category: 'penthouse', unit_number: '602', bedrooms: 3, floor_number: 6,
  status: 'disponible', is_published: true, published_commercial_price: 539900 }
const policy = { politica_comercial: { precios_autorizados: true } }
const declaration = (status: string, amount: number | null, evidence = 'Declaración validada del cliente'): Row =>
  ({ status, amount, confidence: 'high', evidence })
const saved = (budget: Row): Row => ({ hechos_confirmados: { budget } })
function selected(budget: Row, accepted = false): Row {
  return { ...policy, ...saved(budget), lead: { purchase_purpose: 'vivir', preferred_bedrooms: 3 },
    catalogo: [unit], catalog_read: { complete: true },
    perfil_lead: { full_name: 'Carlos', residence_city: 'Cuenca' },
    property_context: { selected_ids: [unit.id], query: { group: 'residential', category: 'penthouse', operation: 'select', filters: { bedrooms: 3 } } },
    referencia_unidad: { matches: [unit], query: { operation: 'select' } },
    financiamiento: { partners: ['Banco Pichincha', 'Cooperativa JEP'], current: {}, journey: { accepted } },
    recorrido_comercial: {}, semantica_turno: { primary_intent: 'select_property', budget: { status: 'not_discussed' } } }
}

describe('shared continuation after a selected unit tour', () => {
  it('asks the missing budget once without introducing other properties', () => {
    const answer = tourContinuation({ perfil_lead: { full_name: 'Carlos', residence_city: 'Cuenca' } }, unit)
    assert.equal(answer.question, '¿Qué presupuesto aproximado tiene previsto para la compra?')
    assert.equal(answer.pending_question.id, 'budget_amount')
    assert.equal(answer.pending_question.act, 'budget')
    assert.equal(answer.reply.match(/\?/g)?.length, 1)
  })

  it('clarifies a known amount without assigning a total or down-payment role', () => {
    const answer = tourContinuation({ lead: { budget: 70000 } }, unit)
    assert.equal(answer.pending_question.id, 'budget_kind')
    assert.equal(answer.budget.amount, 70000)
    assert.doesNotMatch(answer.reply, /diferencia|no alcanza|otra opción/i)
  })

  it('uses explicit current budget semantics ahead of old declarations', () => {
    const answer = tourContinuation({ ...policy, ...saved(declaration('initial_capital', 70000)), semantica_turno: {
      budget: declaration('maximum_total', 600000, 'Mi presupuesto total es 600 mil'),
    } }, unit)
    assert.equal(answer.budget.amount, 600000)
    assert.equal(answer.budget.source, 'current_lead_statement')
    assert.match(answer.reply, /dentro del presupuesto total/)
    assert.doesNotMatch(answer.question, /presupuesto|entrada|otra/)
  })

  it('retains validated total-budget memory and checks only authorized prices', () => {
    const info = saved(declaration('maximum_total', 500000, 'Mi presupuesto total es 500 mil dólares'))
    assert.doesNotMatch(tourContinuation(info, unit).reply, /supera/)
    const answer = tourContinuation({ ...policy, ...info }, unit)
    assert.equal(answer.budget.status, 'maximum_total')
    assert.match(answer.reply, /supera el presupuesto total/)
    assert.doesNotMatch(answer.reply, /financiamiento|otra opción/)
  })

  it('treats an entry as entry and offers only verified financing information', () => {
    const info = { ...policy, ...saved(declaration('initial_capital', 70000, 'Tengo 70 mil dólares para la entrada')) }
    const answer = tourContinuation({ ...info, financiamiento: { partners: ['Banco Pichincha'] } }, unit)
    assert.equal(answer.budget.status, 'initial_capital')
    assert.match(answer.question, /conocer las opciones de financiamiento para esta unidad/)
    assert.equal(answer.pending_question.id, undefined)
    assert.doesNotMatch(answer.reply, /presupuesto total|aprobado|diferencia/)
    assert.doesNotMatch(tourContinuation(info, unit).reply, /financiamiento/)
  })

  it('consumes a validated role clarification without asking for the amount again', () => {
    const answer = tourContinuation({ ...saved(declaration('amount', 70000)), semantica_turno: {
      budget: declaration('initial_capital', 70000, 'Para la entrada'),
    } }, unit)
    assert.equal(answer.budget.amount, 70000)
    assert.equal(answer.budget.status, 'initial_capital')
    assert.doesNotMatch(answer.question, /presupuesto|entrada/)
  })

  it('never extracts another budget from history, unit codes, quoted prices or family counts', () => {
    for (const current of ['El 602 por favor', 'Tengo 5 hijos y caben dos camas', 'El 602 cuesta 539900', 'Cuento con 70 mil dólares']) {
      const answer = tourContinuation({ historial: [
        { role: 'bot', content: 'El valor es USD 539900. ¿Cuál es su presupuesto?' },
        { role: 'cliente', content: current },
      ], conversacion: { datos_conocidos: { presupuesto_texto: current } } }, unit, current)
      assert.equal(answer.budget.status, 'not_discussed', current)
      assert.equal(answer.budget.amount, null, current)
    }
    assert.equal(tourContinuation({ lead: { behavior_signals: { sdr: { presupuesto_texto: 'Tengo 70 mil para la entrada' } } } }, unit).budget.status, 'not_discussed')
  })

  it('respects refusal, uncertainty and deferred budget memory', () => {
    for (const info of [
      { semantica_turno: { budget: declaration('declines_to_disclose', null, 'Prefiero no compartirlo') } },
      { memoria_comercial: { deferred_fields: ['presupuesto'] } },
      saved(declaration('declines_to_disclose', null, 'Prefiero no compartirlo')),
      saved(declaration('unknown', null, 'No lo he pensado')),
    ]) {
      const answer = tourContinuation(info, unit)
      assert.doesNotMatch(answer.question, /presupuesto|entrada|otra opción/)
      assert.equal(answer.question, '¿Qué le gustaría revisar con más detalle de esta opción?')
    }
  })

  it('uses a new declaration over deferred memory and distinguishes missing amount from no defined budget', () => {
    const answer = tourContinuation({ memoria_comercial: { deferred_fields: ['presupuesto'] },
      semantica_turno: { budget: declaration('amount_pending', null, 'Sí tengo presupuesto') } }, unit)
    assert.equal(answer.reason, 'budget_amount_missing')
    assert.equal(answer.pending_question.id, 'budget_amount')
    assert.match(answer.question, /De cuánto/)
    assert.equal(tourContinuation({ semantica_turno: { budget: declaration('no_defined_budget', null, 'Aún no lo he definido') } }, unit).budget.amount, null)
  })

  it('keeps a typed down payment distinct from income, loan requests and unit numbers', () => {
    const answer = tourContinuation({ semantica_turno: { financing_amounts: [
      { role: 'down_payment', amount: 200000, evidence: 'Tengo 200 mil para la entrada' },
      { role: 'income', amount: 2000, evidence: 'Mi sueldo es dos mil al mes' },
      { role: 'loan_request', amount: 339900, evidence: 'Necesitaría financiar el resto' },
    ] } }, unit)
    assert.equal(answer.budget.status, 'initial_capital')
    assert.equal(answer.budget.amount, 200000)
    assert.equal(answer.budget.source, 'current_lead_statement')
    const irrelevant = tourContinuation({ semantica_turno: { financing_amounts: [
      { role: 'loan_request', amount: 200000, evidence: 'Quisiera un crédito de 200 mil' },
      { role: 'income', amount: 2000, evidence: 'Ingreso dos mil al mes' },
    ] } }, unit)
    assert.equal(irrelevant.budget.status, 'not_discussed')
  })

  it('does not add a discovery question when the client has requested another action', () => {
    for (const primary_intent of ['request_visit', 'ask_financing']) {
      const answer = tourContinuation({ semantica_turno: { primary_intent, confidence: 'high' } }, unit)
      assert.equal(answer.reply, '')
      assert.equal(answer.reason, 'requested_action_pending')
    }
  })

  it('does not restart a financial review already underway', () => {
    const answer = tourContinuation({ ...saved(declaration('initial_capital', 70000)),
      financiamiento: { partners: ['Banco Pichincha'], current: { explicit_consent: true } } }, unit)
    assert.equal(answer.reason, 'financing_already_started')
    assert.doesNotMatch(answer.question, /financiamiento|presupuesto|entrada/)
  })

  it('respects accepted financing memory even when the legacy tour caller has no commercial plan', () => {
    const answer = tourContinuation({ ...saved(declaration('initial_capital', 200000)),
      financiamiento: { partners: ['Banco Pichincha'], current: {}, journey: { accepted: true } } }, unit)
    assert.equal(answer.reason, 'financing_already_started')
    assert.doesNotMatch(answer.question, /financiamiento|presupuesto|entrada/)
  })

  it('shares one entry declaration and consent step with the selected-unit commercial planner', () => {
    const info = selected(declaration('initial_capital', 200000, 'Tengo 200 mil para la entrada'))
    const step = commercialJourneyPlan(info), next = tourContinuation(info, unit)
    assert.equal(step.action, 'offer_financing')
    assert.equal(step.selected_unit_id, unit.id)
    assert.equal(next.reason, step.action)
    assert.equal(next.question, step.question)
    assert.equal(next.pending_question.id, 'financing_invitation')
    assert.equal(next.pending_question.act, 'financing')
    assert.equal(next.budget.amount, leadBudget(info).amount)
    assert.equal(next.budget.status, leadBudget(info).status)
    assert.equal(purchaseReadiness(info).can_offer_reservation, false)
    assert.equal(financingStage(info).collection_allowed, false)
    assert.doesNotMatch(String(step.instruction), /reabra las opciones|elija otra unidad/)
    assert.match(String(step.instruction), /Conserve la unidad elegida/)
  })

  it('resumes accepted financing on the same unit before asking for personal data or offering a visit', () => {
    const info = selected(declaration('initial_capital', 200000), true)
    const step = commercialJourneyPlan(info), next = tourContinuation(info, unit), stage = financingStage(info)
    assert.equal(step.action, 'continue_financing')
    assert.equal(step.selected_unit_id, unit.id)
    assert.equal(next.reason, 'continue_financing')
    assert.equal(next.pending_question.id, undefined)
    assert.equal(stage.stage, 'continue_financing')
    assert.equal(stage.collection_allowed, true)
    assert.equal(stage.selected_unit_id, unit.id)
    assert.match(String(stage.instruction), /entidad y el siguiente dato pendiente/)
    assert.equal(step.visit_offer_allowed, false)
    assert.doesNotMatch(next.question, /presupuesto|entrada|confirme|otra opción/)
  })

  it('orientation does not authorize collection and unavailable or sufficient prices do not invent a financing need', () => {
    const info = selected(declaration('initial_capital', 200000))
    info.financing_quote = { orientation_only: true }
    assert.equal(commercialJourneyPlan(info).action, 'financing_orientation')
    assert.equal(financingStage(info).collection_allowed, false)
    const unauthorized = selected(declaration('initial_capital', 200000))
    unauthorized.politica_comercial = { precios_autorizados: false }
    assert.notEqual(commercialJourneyPlan(unauthorized).action, 'offer_financing')
    const paid = selected(declaration('initial_capital', 600000))
    assert.notEqual(commercialJourneyPlan(paid).action, 'offer_financing')
    assert.equal(object(purchaseReadiness(paid).budget).status, 'initial_capital')
    assert.equal(purchaseReadiness(paid).can_offer_reservation, false)
  })
})
