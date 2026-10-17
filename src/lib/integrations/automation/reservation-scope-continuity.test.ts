import test from 'node:test'
import assert from 'node:assert/strict'
import profileFixture from './fixtures/extractor-profile-turn.json'
import { object, type Row } from './data'
import { interpretConversationTurn, rememberInterpretedTurn } from './turn-interpretation'
import { resolvePropertyTurn, rememberPropertyReply } from './property-context'
import { commercialJourneyPlan, commercialSelectionQuery, interpretCommercialJourney, rememberCommercialJourney } from './commercial-journey'
import { resolveTurnIntent } from './turn-intent'
import { completeTurnReply } from './turn-completeness'
import { withResponseReviewPolicy } from './response-review-policy'
import { WRITER_CONTENT_REVIEW_VERSION } from './writer-content-review'
import { projectReservationOperation, hydrateReservationSelection, reconcileReservationOperation } from './reservation-operation-context'
import { scopePolicyContext } from './scope-response'

const units: Row[] = [
  { id: 'ph605', unit_number: '605', category: 'penthouse', bedrooms: 3, floor_number: 6,
    area_internal_m2: 140.53, published_commercial_price: 337272, status: 'disponible', is_published: true },
  { id: 'ph602', unit_number: '602', category: 'penthouse', bedrooms: 3, floor_number: 6,
    area_internal_m2: 142.09, published_commercial_price: 341016, status: 'disponible', is_published: true },
  { id: 'd304', unit_number: '304', category: 'departamento', bedrooms: 2, floor_number: 3,
    area_internal_m2: 105, published_commercial_price: 270000, status: 'disponible', is_published: true },
]

function selectedContext(): Row {
  return { version: 2, phase: 'review_unit', selected_ids: ['ph605'], offered_ids: ['ph605', 'ph602'],
    focused_ids: ['ph605'], comparison_ids: [], pending_question: {},
    category_preference: { category: 'penthouse', confirmed: true, evidence: 'Me quedo con los penthouses' },
    original_query: { group: 'residential', filters: { bedrooms: 5 }, operation: 'search', scope: 'catalog' },
    query: { group: 'residential', category: 'penthouse', filters: { bedrooms: 3 }, operation: 'none', scope: 'selected' },
    exploration_state: { authorized: true, evidence: 'Sí, quiero ver esas opciones de tres dormitorios',
      accepted_filters: { bedrooms: 3 }, original_filters: { bedrooms: 5 } } }
}

const reservation = (): Row => projectReservationOperation({
  requests: [{ id: 'reservation605', lead_id: 'lead605', request_status: 'requested', unit_ids: ['ph605'],
    source_message_id: 'reservation-message', created_at: '2026-10-16T05:49:00Z' }],
  lead: { id: 'lead605', handoff_status: 'queued' }, catalog: units,
})

function extraction(current: string, semantic: Row = {}, domain = 'tracking'): Row {
  const value = structuredClone(profileFixture) as Row
  value.full_name = value.residence_city = value.residence_country = null
  value.profile_evidence = { full_name: null, residence_city: null, residence_country: null }
  value.requests = [{ request: current, evidence: current, domain, topics: [], confidence: 'high' }]
  value.turn_semantics = { ...object(value.turn_semantics), primary_intent: 'other', primary_evidence: current,
    answer_to_previous: { question_id: 'none', kind: 'none', evidence: '', confidence: 'high' }, ...semantic }
  return value
}

/** Real extraction normalization, property resolution, persistence and planner;
 * only the external extractor/writer/reviewer are fixtures. No DB or provider. */
function flow(initialContext: Row = selectedContext(), operation = reservation()) {
  let summary: Row = { _property_context: initialContext,
    _interpretation_memory: { property: { group: 'residential', filters: { bedrooms: 5 },
      evidence: 'Me gustaría tener unas cinco habitaciones', confidence: 'high' } },
    _commercial_journey: { selected_unit_id: 'ph605', last_action: 'current_operation',
      reservation_offered_ids: ['ph605'] } }
  const history: Row[] = [
    { role: 'cliente', content: 'Entonces el 605 me gusta más' },
    { role: 'cliente', content: 'Sí, quiero iniciar la reserva del 605' },
    { role: 'bot', content: 'La solicitud de reserva del 605 quedó registrada y está pendiente de atención.' },
  ]
  let calls = 0, lastInfo: Row = {}, lastPlan: Row = {}, lastIntent: Row = {}, lastAudit: Row = {}
  async function advance(current: string, raw: Row, scope: 'neutral' | 'property' = 'neutral', uncertain = false, audit: Row = {}) {
    const previous = structuredClone(summary)
    previous._property_context = hydrateReservationSelection(previous._property_context, operation, units)
    const pending = object(previous._pending_question)
    const interpreted = await interpretConversationTurn({ mensaje_actual: current, pregunta_pendiente: pending,
      ultima_pregunta: history.at(-1)?.content, resumen: previous, historial: history,
      contexto_propiedades: previous._property_context, catalogo_unidades: units }, {
      activePrompt: async () => 'Isolated reservation continuity fixture',
      aiJson: async () => { calls++; return structuredClone(raw) },
    })
    const reference = resolvePropertyTurn(units, current, previous, history, interpreted.semantics)
    lastIntent = resolveTurnIntent({ current, history, semantics: interpreted.semantics,
      requests: interpreted.requests, scope: { kind: scope, uncertain }, pendingQuestion: pending })
    const currentOperation = reconcileReservationOperation(operation, previous._reservation_operation, interpreted.semantics, current)
    summary = { ...rememberInterpretedTurn(previous, current, interpreted.extracted, interpreted.semantics),
      _property_context: reference.context,
      _reservation_operation: currentOperation,
      _commercial_journey: interpretCommercialJourney(object(previous._commercial_journey), interpreted.semantics,
        pending, reference.context.selected_ids) }
    lastInfo = { mensaje_actual: current, lead: { purchase_purpose: 'vivir' },
      perfil_lead: { full_name: 'Carlos', residence_city: 'Cuenca' },
      estado_conversacion: { brochure_sent: true },
      catalogo: reference.matches, catalogo_verificacion: units, catalog_read: { complete: true },
      property_context: reference.context, referencia_unidad: reference,
      hechos_confirmados: summary._interpretation_memory, recorrido_comercial: summary._commercial_journey,
      financiamiento: { partners: [], journey: {} }, politica_comercial: { precios_autorizados: true },
      reservation_context: currentOperation, semantica_turno: interpreted.semantics,
      solicitudes_interpretadas: interpreted.requests, contrato_turno: { ...lastIntent, current_message: current } }
    if (uncertain) lastInfo = { ...scopePolicyContext(lastInfo,
      { kind: scope, property_message: current, reply: '', uncertain }), contrato_turno: lastInfo.contrato_turno }
    lastAudit = audit
    lastPlan = commercialJourneyPlan(lastInfo, audit)
    history.push({ role: 'cliente', content: current })
    return { interpreted, reference, intent: lastIntent, info: lastInfo, plan: lastPlan }
  }
  async function deliver(current: string, reply: string, source: string, review: boolean) {
    const tasks: string[] = []
    const result = await withResponseReviewPolicy({ enabled: review, observationOnly: false, updatedAt: null },
      () => completeTurnReply({ current, baseReply: reply, verified: { ...lastInfo, siguiente_paso_comercial: lastPlan },
        history, audit: { ...lastAudit, source, commercial_journey: lastPlan, resolved_turn_intent: lastIntent,
          semantic_review_enabled: true, business_risk_review_enabled: true } },
      async (_rules, context, _schema, _image, _file, _tone, task) => {
        tasks.push(task || '')
        if (task === 'review') {
          const receipt = object(object(context.estado_del_turno).reserva)
          assert.equal(receipt.request_id, 'reservation605')
          assert.equal(receipt.request_status, 'requested')
          assert.notEqual(receipt.reservation_confirmed, true)
          assert.notEqual(receipt.inventory_reserved, true)
          return { review_contract: WRITER_CONTENT_REVIEW_VERSION, verdict: 'pass', findings: [] }
        }
        const verified = object(context.contexto_verificado)
        assert.equal(object(verified.siguiente_paso_comercial).action, 'current_operation')
        assert.equal(object(verified.reservation_context).request_id, 'reservation605')
        assert.equal(object(verified.reservation_context).unit_number, '605')
        return { reply, question: { text: '', purpose: 'none', role: 'none', missing_datum: '', next_decision: '',
          continuation_id: 'none', continuation_act: 'other' }, requests: [], writer_receipts: { presented_unit_ids: [] } }
      }))
    assert.equal(result.reply, reply, 'The code preserves the complete freely worded writer message')
    assert.equal(result.needsAdvisor, false)
    assert.deepEqual(tasks, review ? ['writing', 'review'] : ['writing'])
    summary._property_context = rememberPropertyReply(units, summary._property_context, result.reply,
      { ...result.audit, source, pending_question: {} })
    summary._commercial_journey = rememberCommercialJourney(object(summary._commercial_journey), lastPlan, {}, true)
    summary._pending_question = {}
    history.push({ role: 'bot', content: result.reply })
    return result
  }
  return { advance, deliver, get summary() { return summary }, get calls() { return calls } }
}

for (const review of [false, true]) test('reservation 605 survives scope clarification then corrected error without bedroom qualification; review '+review, async () => {
  const conversation = flow()
  const first = 'Disculpe fue un error, pero no se me ha confirmado nada, ¿qué pasó?'
  let turn = await conversation.advance(first, extraction(first), 'neutral', true)
  assert.equal(turn.intent.objective, 'clarify_scope', 'Reproduce the neutral routing that previously erased the choice')
  assert.equal(turn.plan.action, 'current_operation')
  assert.equal(turn.plan.question_id || '', '')
  assert.equal(turn.intent.requested_action, null, 'Following up an existing request cannot create another reservation')
  await conversation.deliver(first, 'Su solicitud del 605 sigue pendiente. ¿A qué mensaje se refiere cuando menciona el error?', 'scope_clarification', review)
  const saved = object(conversation.summary._property_context)
  assert.deepEqual(saved.selected_ids, ['ph605'])
  assert.equal(object(object(saved.exploration_state).accepted_filters).bedrooms, 3)
  assert.equal(object(object(conversation.summary._interpretation_memory).property).filters
    && object(object(object(conversation.summary._interpretation_memory).property).filters).bedrooms, 5,
    'The original need may remain as background; it must not drive a new qualification')

  const clarification = 'Oh no, disculpe: aún nadie se ha comunicado conmigo. Lo que fue un error es el mensaje que envié antes.'
  turn = await conversation.advance(clarification, extraction(clarification, { primary_intent: 'answer_previous' }))
  assert.deepEqual(turn.reference.context.selected_ids, ['ph605'])
  assert.equal(object(commercialSelectionQuery(turn.info).filters).bedrooms, 3)
  assert.equal(turn.plan.action, 'current_operation')
  assert.equal(turn.plan.selected_unit_id, 'ph605')
  assert.equal(turn.plan.question_id || '', '')
  assert.equal(turn.plan.proposed_query, undefined)
  assert.equal(turn.plan.financing_offer_allowed, false)
  assert.equal(turn.intent.requested_action, null)
  const reply = 'Comprendo. La solicitud de reserva del 605 continúa pendiente de atención; su aclaración no la cancela.'
  await conversation.deliver(clarification, reply, 'commercial', review)
  assert.deepEqual(object(conversation.summary._property_context).selected_ids, ['ph605'])
  assert.equal(conversation.calls, 2, 'One simulated extraction per real turn; no repair calls or external requests')
})

test('an existing recorded request prevents rediscovery even when an older reply already erased property memory', async () => {
  const conversation = flow({ version: 2, selected_ids: [], offered_ids: [], comparison_ids: [],
    focused_ids: [], pending_question: {}, query: {} })
  const current = 'Aún nadie me llama sobre la reserva que solicité'
  const turn = await conversation.advance(current, extraction(current))
  assert.equal(turn.plan.action, 'current_operation')
  assert.equal(turn.plan.selected_unit_id, 'ph605')
  assert.equal(turn.plan.question_id || '', '')
  assert.equal(turn.plan.proposed_query, undefined)
  assert.deepEqual(object(conversation.summary._property_context).selected_ids, ['ph605'])
  assert.equal(object(object(conversation.summary._property_context).selection_restoration).source, 'verified_reservation_request',
    'A stored client request repairs the missing legacy choice with explicit provenance')
})

for (const review of [false, true]) test('reservation information route retains an already recorded 605 operation; review '+review, async () => {
  const conversation = flow()
  const current = '¿Qué requisitos faltan para continuar con la reserva del 605?'
  const turn = await conversation.advance(current, extraction(current, { primary_intent: 'ask_reservation',
    reservation: { kind: 'information', evidence: current, unit_numbers: ['605'], confidence: 'high' } }, 'property'),
  'property', false, { source: 'reservation_information', action: 'information_only', reservation: { kind: 'information' } })
  assert.equal(turn.plan.action, 'current_operation')
  assert.equal(object(turn.plan.reservation_context).request_id, 'reservation605')
  assert.equal(turn.plan.selected_unit_id, 'ph605')
  assert.equal(turn.plan.question_id || '', '')
  assert.equal(turn.intent.requested_action, null)
  await conversation.deliver(current, 'Su solicitud del 605 ya está registrada y pendiente de atención. Podemos revisar lo que falta para continuar con el equipo.',
    'reservation_information', review)
})

test('a genuinely new search can leave the reservation follow-up without being trapped in its prior state', async () => {
  const conversation = flow()
  const current = 'Ahora prefiero un departamento de dos dormitorios; muéstreme nuevas opciones'
  const turn = await conversation.advance(current, extraction(current, { primary_intent: 'select_property',
    housing_quantities: [{ dimension: 'bedrooms', role: 'requirement', values: [2], count_basis: 'total',
      evidence: 'dos dormitorios', confidence: 'high' }],
    property: { group: 'residential', category: 'departamento', operation: 'search', query_scope: 'catalog',
      reference_kind: 'none', unit_numbers: [], selector: null, filters: { bedrooms: 2 },
      filter_evidence: { bedrooms: 'dos dormitorios' }, evidence: current, confidence: 'high' } }, 'property'), 'property')
  assert.deepEqual(turn.reference.matches.map(unit => unit.id), ['d304'])
  assert.equal(turn.reference.query.category, 'departamento')
  assert.notEqual(turn.plan.action, 'current_operation')
  assert.equal(object(commercialSelectionQuery(turn.info).filters).bedrooms, 2)
})

test('an explicit reservation refusal is handled as a new decision, not dismissed as mere follow-up', async () => {
  const conversation = flow()
  const current = 'No quiero continuar con la reserva del 605'
  const turn = await conversation.advance(current, extraction(current, { primary_intent: 'ask_reservation',
    reservation: { kind: 'declined', evidence: current, unit_numbers: ['605'], confidence: 'high' } }, 'property'), 'property')
  assert.equal(object(turn.interpreted.semantics.reservation).kind, 'declined')
  assert.notEqual(turn.plan.action, 'current_operation')
  assert.notEqual(turn.plan.action, 'offer_reservation')
  assert.equal(object(conversation.summary._reservation_operation).disposition, 'declined_in_conversation')
  assert.equal(object(conversation.summary._reservation_operation).cancellation_recorded, false,
    'A conversational refusal is not a completed staff cancellation')
})

test('a new explicit unit choice remains effective while an earlier reservation request exists', async () => {
  const conversation = flow()
  const current = 'Prefiero cambiar al penthouse 602'
  const turn = await conversation.advance(current, extraction(current, { primary_intent: 'select_property',
    unit_choice: { kind: 'selected', unit_numbers: ['602'], evidence: current, confidence: 'high' },
    property: { group: 'residential', category: 'penthouse', operation: 'select', query_scope: 'selected',
      reference_kind: 'explicit', unit_numbers: ['602'], selector: null, filters: {},
      evidence: current, confidence: 'high' } }, 'property'), 'property')
  assert.deepEqual(turn.reference.context.selected_ids, ['ph602'])
  assert.deepEqual(turn.reference.matches.map(unit => unit.id), ['ph602'])
  assert.notEqual(turn.plan.action, 'current_operation')
  assert.notEqual(turn.intent.requested_action, 'reservation_handoff', 'A different choice alone does not execute a second reservation')
  const question = '¿Qué precio tiene el penthouse 602?'
  const followup = await conversation.advance(question, extraction(question, { primary_intent: 'ask_price',
    property: { group: 'residential', category: 'penthouse', operation: 'details', query_scope: 'selected',
      reference_kind: 'explicit', unit_numbers: ['602'], evidence: question, confidence: 'high', filters: {} } }, 'property'), 'property')
  assert.deepEqual(followup.reference.context.selected_ids, ['ph602'])
  assert.equal(object(followup.info.reservation_context).disposition, 'unit_changed')
  assert.equal(object(followup.info.reservation_context).active, false)
  assert.notEqual(followup.plan.action, 'current_operation', 'The following turn cannot reactivate the old 605 request over the new choice')
})
