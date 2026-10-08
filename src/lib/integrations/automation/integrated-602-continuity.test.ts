import test from 'node:test'
import assert from 'node:assert/strict'
import profileFixture from './fixtures/extractor-profile-turn.json'
import { object, text, type Row } from './data'
import { interpretConversationTurn, rememberInterpretedTurn } from './turn-interpretation'
import { resolvePropertyTurn, rememberPropertyReply } from './property-context'
import { financingInputs, financingPendingFields, financingReply } from './financing'
import { financingJourney, financingStage, selectedFinancingUnit } from './financing-stage'
import { commercialJourneyPlan, interpretCommercialJourney } from './commercial-journey'
import { tourContinuation } from './tour-continuation'
import { leadBudget } from './budget-state'
import { deliveredPendingQuestion } from './continuation-question'
import { reconcileContinuationMetadata } from './continuation-validation'

const catalog: Row[] = [
  { id: 'ph601', unit_number: '601', category: 'penthouse', floor_number: 6, bedrooms: 2, area_internal_m2: 110, published_commercial_price: 470000, status: 'disponible' },
  { id: 'ph602', unit_number: '602', category: 'penthouse', floor_number: 6, bedrooms: 3, area_internal_m2: 142.09, published_commercial_price: 550000, status: 'disponible' },
  { id: 'ph605', unit_number: '605', category: 'penthouse', floor_number: 6, bedrooms: 3, area_internal_m2: 140.53, published_commercial_price: 539900, status: 'disponible' },
]
const finance = { partners: ['Banco Pichincha', 'Cooperativa JEP'], current: {} }
function raw(current: string, semantic: Row = {}, overrides: Row = {}): Row {
  const value: Row = structuredClone(profileFixture)
  value.full_name = value.residence_city = value.residence_country = null
  value.profile_evidence = { full_name: null, residence_city: null, residence_country: null }
  const original = object(value.turn_semantics)
  value.turn_semantics = { ...original, primary_intent: 'other', primary_evidence: current,
    answer_to_previous: { question_id: 'none', kind: 'none', evidence: '', confidence: 'low' },
    property: { ...object(original.property), confidence: 'low' }, ...semantic }
  return { ...value, ...overrides }
}
function harness() {
  let summary: Row = { _property_context: { selected_ids: [], offered_ids: ['ph602', 'ph605'], focused_ids: [], pending_question: {},
    query: { group: 'residential', category: 'penthouse', operation: 'search', scope: 'offered', filters: { bedrooms: 3 } } }, _commercial_journey: {} }
  let lastReply = ''
  const history: Row[] = []
  let lastInfo: Row = {}, calls = 0
  async function advance(current: string, fixture: Row) {
    const previous = summary, pending = object(summary._pending_question)
    const interpreted = await interpretConversationTurn({ mensaje_actual: current, pregunta_pendiente: pending,
      ultima_pregunta: lastReply, resumen: summary, historial: history, contexto_propiedades: summary._property_context,
      catalogo_unidades: catalog, financiamiento: finance }, {
      activePrompt: async () => 'Local fixture; no paid API', aiJson: async () => { calls++; return structuredClone(fixture) },
    })
    const semantics = interpreted.semantics
    const reference = resolvePropertyTurn(catalog, current, previous, history, semantics)
    const extracted = { ...interpreted.extracted, turn_semantics: semantics }
    const financial = financingInputs(extracted, current, lastReply, finance, object(previous._last_operational_step))
    summary = { ...rememberInterpretedTurn(previous, current, extracted, semantics),
      _property_context: reference.context, _unit_reference: reference.memory,
      _financing_journey: financingJourney(object(previous._financing_journey), financial, String(calls)),
      _commercial_journey: interpretCommercialJourney(object(previous._commercial_journey), semantics, pending, reference.context.selected_ids) }
    history.push({ role: 'cliente', content: current })
    lastInfo = { lead: { preferred_category: 'penthouse', preferred_bedrooms: 3, purchase_purpose: 'vivir' },
      perfil_lead: { full_name: 'Carlos', residence_city: 'Cuenca' }, estado_conversacion: { brochure_sent: true },
      catalogo: reference.matches, catalogo_verificacion: catalog, catalog_read: { complete: true },
      referencia_unidad: reference, property_context: reference.context, semantica_turno: semantics,
      hechos_confirmados: summary._interpretation_memory, recorrido_comercial: summary._commercial_journey,
      solicitudes_interpretadas: interpreted.requests, politica_comercial: { precios_autorizados: true },
      financiamiento: { ...finance, journey: summary._financing_journey } }
    lastInfo.etapa_financiamiento = financingStage(lastInfo)
    return { interpreted, semantics, reference, financial, info: lastInfo, plan: commercialJourneyPlan(lastInfo) }
  }
  function deliver(reply: string, audit: Row = {}, question: Row = {}, plan: Row = commercialJourneyPlan(lastInfo)) {
    const metadata = reconcileContinuationMetadata(question, reply, plan).question
    const pending = deliveredPendingQuestion(reply, { metadata, plan, candidates: [object(audit.pending_question)] }, catalog)
    summary._property_context = rememberPropertyReply(catalog, summary._property_context, reply, { ...audit, pending_question: pending })
    summary._pending_question = pending
    summary._last_operational_step = { kind: pending.id === 'financing_invitation' ? 'financing_consent' : 'commercial_question', reply }
    lastReply = reply; history.push({ role: 'bot', content: reply })
    return pending
  }
  return { advance, deliver, get summary() { return summary }, get calls() { return calls } }
}

for (const receipt of [false, true]) test('representative chosen PH3 -> entry -> formal financing -> largest PH602 -> details -> recorded acknowledgement '+(receipt ? 'with' : 'without')+' receipt', async () => {
  const flow = harness()
  const chosen = 'quiero el penthouse 605'
  let turn = await flow.advance(chosen, raw(chosen, { primary_intent: 'select_property', property: {
    category: 'penthouse', operation: 'select', reference_kind: 'explicit', query_scope: 'selected', unit_numbers: ['605'], evidence: chosen, confidence: 'high' } }))
  assert.equal(selectedFinancingUnit(turn.info)?.id, 'ph605')
  flow.deliver('El penthouse 605 tiene tres dormitorios.', { offered_unit_ids: ['ph605'], selected_unit_ids: ['ph605'] })

  const entry = 'Tengo 200 mil para la entrada'
  turn = await flow.advance(entry, raw(entry, { primary_intent: 'discuss_budget', budget: { status: 'initial_capital', amount: 200000, evidence: entry, confidence: 'high' } },
    { financing_amounts: [{ role: 'down_payment', amount: 200000, evidence: entry }] }))
  assert.equal(turn.plan.action, 'offer_financing')
  assert.equal(leadBudget(turn.info).status, 'initial_capital')
  assert.equal(tourContinuation(turn.info, catalog[2]).budget.status, 'initial_capital')
  assert.equal(object(flow.summary._financing_amounts).down_payment && object(object(flow.summary._financing_amounts).down_payment).amount, 200000)
  const financialQuestion = text(turn.plan.question)
  flow.deliver(financialQuestion, {}, { purpose: 'permission_to_continue', role: 'optional_continuation', continuation_id: 'financing_invitation', continuation_act: 'financing', text: financialQuestion }, turn.plan)

  const consent = 'Sí, deseo iniciar la revisión financiera por este chat'
  turn = await flow.advance(consent, raw(consent, { primary_intent: 'ask_financing',
    answer_to_previous: { question_id: 'financing_invitation', kind: 'affirmative', evidence: consent, confidence: 'high' } },
    { financing_consent: true, requests: [{ domain: 'financing', request: 'Iniciar revisión financiera', evidence: consent, confidence: 'high' }] }))
  assert.equal(turn.financial.consent, true)
  assert.equal(object(flow.summary._financing_journey).accepted, true)
  assert.equal(turn.plan.action, 'continue_financing')
  assert.equal(object(turn.info.etapa_financiamiento).collection_allowed, true)

  // Representative interpretation, not a recovered raw 03:45 payload. The bot
  // displays both compatible three-bedroom PHs while the old choice remains.
  flow.deliver('Podemos comparar el penthouse 602 y el penthouse 605.', { offered_unit_ids: ['ph602', 'ph605'], comparison_unit_ids: ['ph602', 'ph605'] })
  assert.deepEqual(object(flow.summary._property_context).selected_ids, ['ph605'])
  const largest = 'la mas grande quiero explorar'
  turn = await flow.advance(largest, raw(largest, { primary_intent: 'select_property', property: { category: 'penthouse', operation: 'select',
    reference_kind: 'relative', query_scope: 'offered', selector: 'largest', unit_numbers: [], evidence: largest, confidence: 'high' } }))
  assert.deepEqual(turn.reference.context.selected_ids, ['ph602'])
  assert.equal(object(flow.summary._financing_journey).accepted, true)
  assert.equal(turn.plan.action, 'continue_financing')

  const details = 'deme más información del penthouse 602'
  turn = await flow.advance(details, raw(details, { primary_intent: 'project_information', property: { category: 'penthouse', operation: 'details',
    reference_kind: 'explicit', query_scope: 'selected', unit_numbers: ['602'], evidence: details, confidence: 'high' } },
    { requests: [{ domain: 'property', request: 'Más información del penthouse 602', evidence: details, confidence: 'high' }] }))
  assert.deepEqual(turn.reference.context.selected_ids, ['ph602'])
  assert.equal(turn.plan.action, 'continue_financing')
  assert.equal(tourContinuation(turn.info, catalog[1]).reason, 'continue_financing')
  const confirmation = 'El penthouse 602 tiene tres dormitorios. ¿Desea continuar con esta unidad?'
  const confirmPlan = { action: 'select_property', question_id: 'unit_choice', question_act: 'confirm_unit', question: '¿Desea continuar con esta unidad?',
    selected_unit_id: 'ph602', selection_scope: { unit_ids: ['ph602'] } }
  const pending = flow.deliver(confirmation, { offered_unit_ids: ['ph602'], focused_unit_ids: ['ph602'] },
    { purpose: 'none', role: 'none', continuation_id: 'unit_choice', continuation_act: 'confirm_unit' }, confirmPlan)
  assert.equal(pending.id, 'unit_choice')
  if (!receipt) flow.summary._pending_question = {}

  // Exact known raw 03:48 semantic fields: answer_previous with an inherited PH
  // category, operation none, and answer_to_previous none despite affirmation.
  const yes = 'si si me parece bien'
  turn = await flow.advance(yes, raw(yes, { primary_intent: 'answer_previous', property: {
    group: 'residential', category: 'penthouse', excluded_categories: ['suite', 'departamento', 'local'], operation: 'none',
    reference_kind: 'none', query_scope: null, selector: null, unit_numbers: [], filters: { floor_number: null, bedrooms: null,
      bedrooms_required: null, min_area_m2: null, max_area_m2: null }, evidence: yes, confidence: 'high' } }))
  assert.deepEqual(turn.reference.context.selected_ids, ['ph602'])
  assert.deepEqual(turn.reference.matches.map(unit => unit.id), ['ph602'])
  assert.equal(turn.reference.query.operation, 'none')
  assert.equal(turn.reference.query.scope, 'selected')
  assert.equal(turn.financial.consent, null, 'the answer does not grant a new financial permission')
  assert.equal(object(flow.summary._financing_journey).accepted, true, 'previous valid consent survives')
  assert.equal(turn.plan.action, 'continue_financing')
  assert.equal(leadBudget(turn.info).status, 'initial_capital')
  assert.equal(leadBudget(turn.info).amount, 200000)
  assert.equal(object(turn.info.etapa_financiamiento).collection_allowed, true)
  assert.equal(flow.calls, 6, 'one mocked extraction per turn; no real API')
  assert.equal(financingPendingFields({})[0], 'selected_partner_name')
  const bankQuestion = financingReply({ state: 'entidad_pendiente' }, finance.partners)
  const bankPending = flow.deliver(bankQuestion, {}, { purpose: 'choose_financing_partner', role: 'optional_continuation',
    continuation_id: 'financing_partner', continuation_act: 'financing', text: bankQuestion.slice(bankQuestion.indexOf('¿')) },
    { action: 'continue_financing', question_id: 'financing_partner', question_act: 'financing', question: bankQuestion })
  assert.equal(bankPending.id, 'financing_partner')
  const bank = 'Prefiero Banco Pichincha'
  turn = await flow.advance(bank, raw(bank, { primary_intent: 'ask_financing',
    answer_to_previous: { question_id: 'financing_partner', kind: 'value', evidence: bank, confidence: 'high' } },
    { financing_partner: 'Banco Pichincha', financing_partner_choice: { kind: 'select', name: 'Banco Pichincha', evidence: bank, confidence: 'high' } }))
  assert.equal(turn.financial.consent, null, 'bank choice cannot grant a new permission')
  assert.equal(turn.financial.partner, 'Banco Pichincha')
  assert.equal(object(turn.info.etapa_financiamiento).selected_partner_preference, 'Banco Pichincha')
  assert.deepEqual(turn.reference.context.selected_ids, ['ph602'])
  assert.equal(leadBudget(turn.info).status, 'initial_capital')
  assert.equal(leadBudget(turn.info).amount, 200000)
  assert.equal(turn.plan.action, 'continue_financing')
  assert.equal(flow.calls, 7)
})

test('accepting an explanation about financing does not authorize a formal review or data collection', async () => {
  const flow = harness()
  const question = '¿Desea que le explique las opciones de financiamiento?'
  flow.deliver(question, {}, { purpose: 'permission_to_continue', role: 'optional_continuation', continuation_id: 'financing_invitation', continuation_act: 'financing', text: question },
    { action: 'financing_orientation', question })
  const current = 'Sí, explíqueme esas opciones'
  const turn = await flow.advance(current, raw(current, { primary_intent: 'ask_financing',
    answer_to_previous: { question_id: 'financing_invitation', kind: 'affirmative', evidence: current, confidence: 'high' } },
    { financing_consent: true, requests: [{ domain: 'financing', request: 'Explicar financiamiento', evidence: current, confidence: 'high' }] }))
  assert.equal(turn.financial.consent, null)
  assert.notEqual(object(flow.summary._financing_journey).accepted, true)
  assert.equal(object(turn.info.etapa_financiamiento).collection_allowed, false)
})
