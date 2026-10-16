import assert from 'node:assert/strict'
import { test } from 'node:test'
import { commercialJourneyPlan } from './commercial-journey'
import { object, type Row } from './data'
import { responseContentScope } from './response-content-scope'
import { budgetForCommercialPlan, turnBudgetAssessment } from './turn-budget'

const unit = { id: 'lc11', unit_number: 'LC-11', category: 'local', floor_number: 1,
  status: 'disponible', is_published: true, published_commercial_price: 145000 }

function objectionInfo(current: string, topics: string[] = []): Row {
  const requests = [{ domain: 'property', request: current, evidence: current,
    confidence: 'high', topics: ['value_objection', ...topics] }]
  return {
    lead: { purchase_purpose: 'negocio', preferred_category: 'local' },
    perfil_lead: { full_name: 'Carlos', residence_city: 'Cuenca' },
    catalogo: [unit], catalog_read: { complete: true }, politica_comercial: { precios_autorizados: true },
    property_context: { selected_ids: [], category_preference: { category: 'local', confirmed: true },
      query: { category: 'local', group: 'commercial', operation: 'search', filters: {} },
      pending_question: { id: 'budget_amount', act: 'budget', question: '¿Qué presupuesto tiene previsto?' } },
    hechos_confirmados: {}, financiamiento: { partners: ['Banco Pichincha'], current: {}, journey: {} },
    recorrido_comercial: {}, semantica_turno: { primary_intent: 'project_information', confidence: 'high',
      primary_evidence: current, budget: { status: 'not_discussed' }, requests },
    solicitudes_interpretadas: requests, contrato_turno: { current_message: current, requests },
  }
}

for (const [current, topics] of [
  ['¿Por qué tan caro?', ['property_features']],
  ['La ubicación me queda lejos', ['location']],
  ['Esa zona me parece insegura', ['property_features']],
  ['En otro proyecto me ofrecen más por menos', ['property_features']],
  ['Me preocupa que el local no se rente', ['property_features']],
] as [string, string[]][]) {
  test(`an objection gets useful attention without repeating discovery: ${current}`, () => {
    const data = objectionInfo(current, topics), before = structuredClone(data)
    const next = commercialJourneyPlan(data)
    assert.equal(next.action, 'answer_current_question')
    assert.equal(next.question, '')
    assert.equal(next.question_id, '')
    assert.equal(object(next.deferred_question).id, 'budget_amount')
    assert.equal(object(next.deferred_question).act, 'budget')
    assert.equal(next.financing_offer_allowed, false)
    assert.equal(next.visit_offer_allowed, false)
    assert.deepEqual(data, before, 'Deferring a question must not change preferences, money or permissions')
  })
}

test('a remembered budget gap does not turn a new value objection into an automatic financing offer', () => {
  const data = objectionInfo('¿Por qué ese valor tan alto?', ['property_features'])
  data.hechos_confirmados = { budget: { status: 'maximum_total', amount: 100000,
    evidence: 'Mi presupuesto para la compra es de 100000', confidence: 'high' } }
  const next = commercialJourneyPlan(data)
  assert.equal(next.action, 'answer_current_question')
  assert.equal(next.financing_offer_allowed, false)
  assert.equal(object(next.deferred_question).id, 'financing_invitation')
})

test('a remembered gap on the selected unit remains internal while answering its value objection', () => {
  const current = '¿Por qué ese valor tan alto?', data = objectionInfo(current, ['property_features'])
  data.property_context = { ...object(data.property_context), selected_ids: [unit.id],
    query: { category: 'local', group: 'commercial', operation: 'details', scope: 'selected', filters: {} } }
  data.referencia_unidad = { matches: [unit], needsClarification: false }
  data.hechos_confirmados = { budget: { status: 'maximum_total', amount: 100000,
    evidence: 'Mi presupuesto para la compra es de 100000', confidence: 'high' } }
  const next = commercialJourneyPlan(data)
  const requests = (data.solicitudes_interpretadas as Row[]).map(request => ({ ...request,
    topics: (request.topics as string[]).filter(topic => topic !== 'value_objection') }))
  const assessment = turnBudgetAssessment({ ...data, solicitudes_interpretadas: requests,
    contrato_turno: { current_message: current, requests },
    semantica_turno: { ...object(data.semantica_turno), requests } }, {})
  assert.ok(assessment)
  assert.equal(turnBudgetAssessment(data, {}), null, 'The objection creates no new budget evaluation')
  assert.equal(next.action, 'answer_current_question')
  assert.equal(next.selected_unit_id, unit.id)
  assert.equal(object(next.budget_guidance).comparison_required, false)
  assert.equal(object(next.budget_guidance).mention_required, false)
  assert.equal(object(next.budget_guidance).amount, 100000, 'The budget evaluation is retained')
  const verified = { ...data, siguiente_paso_comercial: next,
    presupuesto_del_turno: budgetForCommercialPlan(assessment, next) }
  assert.equal(object(verified.presupuesto_del_turno).mention_required, false)
  assert.equal(object(object(responseContentScope(current, verified).topics).purchase_prices).allowed, false)
})

test('none is not a pending-question answer that can bypass objection handling', () => {
  const data = objectionInfo('¿Por qué tan caro?', ['property_features'])
  data.semantica_turno = { ...object(data.semantica_turno), answer_to_previous: {
    question_id: 'none', kind: 'value', confidence: 'high', evidence: '¿Por qué tan caro?' } }
  const next = commercialJourneyPlan(data)
  assert.equal(next.action, 'answer_current_question')
  assert.equal(next.continuation_optional, true)
  assert.equal(next.financing_offer_allowed, false)
})

test('an explicit current financing question survives a simultaneous value objection', () => {
  const current = 'Me parece caro. ¿Puedo financiar la compra?', data = objectionInfo(current, ['property_features'])
  const financing = { domain: 'financing', request: '¿Puedo financiar la compra?', evidence: '¿Puedo financiar la compra?',
    confidence: 'high', topics: ['financing'] }
  const requests = [...data.solicitudes_interpretadas as Row[], financing]
  data.solicitudes_interpretadas = requests
  data.contrato_turno = { current_message: current, requests }
  data.semantica_turno = { ...object(data.semantica_turno), primary_intent: 'ask_financing', requests }
  const withoutObjection = structuredClone(data)
  withoutObjection.solicitudes_interpretadas = [financing]
  withoutObjection.contrato_turno = { current_message: current, requests: [financing] }
  withoutObjection.semantica_turno = { ...object(data.semantica_turno), requests: [financing] }
  assert.deepEqual(commercialJourneyPlan(data), commercialJourneyPlan(withoutObjection),
    'The independent financial inquiry keeps its normal plan')
})

test('a new stated budget is kept as a current decision alongside the objection', () => {
  const current = 'Me parece caro y mi presupuesto para la compra es 100000', data = objectionInfo(current)
  data.semantica_turno = { ...object(data.semantica_turno), budget: { status: 'maximum_total', amount: 100000,
    evidence: 'mi presupuesto para la compra es 100000', confidence: 'high' } }
  const withoutObjection = structuredClone(data)
  withoutObjection.solicitudes_interpretadas = []
  withoutObjection.contrato_turno = { current_message: current, requests: [] }
  withoutObjection.semantica_turno = { ...object(data.semantica_turno), requests: [] }
  assert.equal(commercialJourneyPlan(data).action, commercialJourneyPlan(withoutObjection).action)
  assert.notEqual(commercialJourneyPlan(data).action, 'answer_current_question')
})

test('an explicit selection is not deferred because its message also contains an objection', () => {
  const current = 'Me parece caro, pero elijo el LC-11', data = objectionInfo(current)
  data.property_context = { ...object(data.property_context), selected_ids: [unit.id],
    query: { category: 'local', group: 'commercial', operation: 'select', filters: {} } }
  data.referencia_unidad = { matches: [unit], needsClarification: false }
  data.hechos_confirmados = { budget: { status: 'maximum_total', amount: 200000,
    evidence: 'Mi presupuesto para la compra es de 200000', confidence: 'high' } }
  data.semantica_turno = { ...object(data.semantica_turno), primary_intent: 'select_property',
    property: { operation: 'select', confidence: 'high', evidence: 'elijo el LC-11', unit_numbers: ['LC-11'] } }
  assert.equal(commercialJourneyPlan(data).action, 'offer_reservation')
})

test('a pending operational action retains its plan while answering an objection', () => {
  const data = objectionInfo('Está lejos, pero quiero una cita para conocerlos', ['location'])
  const next = commercialJourneyPlan(data, { source: 'visit_coordination', action: 'collecting' })
  assert.equal(next.action, 'current_operation')
  assert.equal(next.deferred_question, undefined)
})

test('an ungrounded or historical topic cannot defer the current commercial step', () => {
  const data = objectionInfo('¿Qué opciones hay?')
  data.hechos_confirmados = { budget: { status: 'maximum_total', amount: 100000,
    evidence: 'Mi presupuesto para la compra es de 100000', confidence: 'high' } }
  const unrelated = [{ domain: 'property', request: '¿Por qué tan caro?', evidence: '¿Por qué tan caro?',
    confidence: 'high', topics: ['value_objection'] }]
  data.solicitudes_interpretadas = unrelated
  data.contrato_turno = { current_message: '¿Qué opciones hay?', requests: unrelated }
  data.semantica_turno = { ...object(data.semantica_turno), requests: unrelated }
  assert.equal(commercialJourneyPlan(data).action, 'offer_financing')
})
