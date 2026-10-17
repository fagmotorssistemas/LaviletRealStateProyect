import assert from 'node:assert/strict'
import test from 'node:test'
import { object, type Row } from './data'
import { commercialJourneyPlan } from './commercial-journey'
import { turnContinuation } from './turn-continuation'
import { finalWriterContract } from './response-plan'
import { normalizedTurnCommunication, turnCommunicationKind, type TurnCommunicationKind } from './turn-communication'

const interpretation = (kind: TurnCommunicationKind, evidence: string) =>
  normalizedTurnCommunication({ kind, evidence, confidence: 'high', greeting_present: kind === 'greeting_only' }, evidence)
const context = (kind: TurnCommunicationKind, current: string): Row => ({
  lead: {}, perfil_lead: {}, property_context: {}, hechos_confirmados: {},
  financiamiento: {}, catalogo: [], recorrido_comercial: {},
  semantica_turno: { communication: interpretation(kind, current), primary_intent: 'other', requests: [] },
  contrato_turno: { current_message: current, objective: 'other', requests: [] }, solicitudes_interpretadas: [],
})

test('social openings with hesitation and different languages follow typed meaning without a vocabulary gate', () => {
  for (const current of ['eh\nhola amigo', 'holaaaa pana', 'Hey there, good to see you', 'bonjour à vous', '您好', '👋']) {
    const info = context('greeting_only', current), before = structuredClone(info)
    const plan = commercialJourneyPlan(info, { source: 'scope_clarification' })
    assert.equal(plan.action, 'greeting_only', current)
    assert.equal(plan.communication_kind, 'greeting_only')
    assert.equal(plan.question_id, '')
    assert.equal(plan.financing_offer_allowed, false)
    assert.equal(plan.visit_offer_allowed, false)
    const continuation = turnContinuation({ commercial_journey: plan }, info)
    assert.equal(continuation.required, false)
    assert.equal(continuation.question_id, null)
    assert.equal(continuation.response_connection, null)
    assert.deepEqual(info, before)
  }
})

test('an unresolved message with an empty commercial profile asks an open clarification instead of category', () => {
  for (const info of [context('ambiguous', 'eh'), {
    semantica_turno: { primary_intent: 'other' }, contrato_turno: { objective: 'clarify_scope', requests: [] },
  }]) {
    const plan = commercialJourneyPlan(info, { source: 'scope_clarification' })
    assert.equal(plan.action, 'clarify_current_request')
    assert.equal(plan.question_id, '')
    assert.equal(plan.continuation_optional, true)
    assert.equal(object(plan).financing_offer_allowed, false)
  }
})

test('a social turn cannot inherit a stale category question from an earlier sales plan', () => {
  for (const kind of ['greeting_only', 'courtesy_only', 'reaction_only', 'ambiguous'] as const) {
    const info = context(kind, 'Intervención interpretada por el modelo')
    const stale = { action: 'discover_use', question_id: 'property_category', question: 'Pregunta histórica', instruction: 'Captura anterior' }
    const continuation = turnContinuation({ commercial_journey: stale }, info)
    assert.equal(continuation.required, false)
    assert.equal(continuation.suggested_question, null)
    assert.equal(continuation.response_connection, null)
    assert.notEqual(continuation.action, stale.action)
    const contract = finalWriterContract('', { source: 'scope_clarification', commercial_journey: stale }, { verified: info })
    assert.equal(contract.continuacion_del_turno.required, false)
    assert.equal(contract.continuacion_del_turno.question_id, null)
  }
})

test('greeting, substantive choice, courtesy and explicit continuation retain the accepted commercial state', () => {
  const current = 'Hola, busco un departamento para vivir'
  const greeting = context('greeting_only', 'eh\nhola amigo')
  assert.equal(commercialJourneyPlan(greeting).action, 'greeting_only')
  const active: Row = { ...context('substantive', current),
    perfil_lead: { full_name: 'Carlos', residence_city: 'Cuenca' },
    semantica_turno: { communication: { ...interpretation('substantive', current), greeting_present: true },
      primary_intent: 'select_property', confidence: 'high', primary_evidence: current,
      property: { category: 'departamento', group: 'residential', operation: 'search', confidence: 'high', evidence: current } },
    solicitudes_interpretadas: [{ domain: 'property', request: current, evidence: current, confidence: 'high', topics: ['property_options'] }],
    property_context: { query: { group: 'residential', category: 'departamento', operation: 'search', filters: {} } },
    catalogo: [{ id: 'u605', unit_number: '605', category: 'departamento', bedrooms: 3, status: 'disponible', is_published: true }],
  }
  const requested = commercialJourneyPlan(active)
  assert.equal(requested.action, 'ask_budget')
  assert.equal(requested.question_id, 'budget_amount')
  const saved = structuredClone(active)
  const social = { ...active, semantica_turno: { ...object(active.semantica_turno), communication: interpretation('courtesy_only', 'Muchas gracias') } }
  assert.equal(commercialJourneyPlan(social).action, 'courtesy_only')
  assert.deepEqual(active, saved)
  const resumed = commercialJourneyPlan(active)
  assert.equal(resumed.question_id, requested.question_id)
  assert.equal(object(resumed).selected_unit_id, requested.selected_unit_id)
})

test('a greeting during an existing reservation preserves the operation without reopening qualification', () => {
  const current = 'hola de nuevo', info = context('greeting_only', current)
  info.property_context = { selected_ids: ['u605'], query: { scope: 'selected', operation: 'details', category: 'penthouse' } }
  info.reservation_context = { version: 'reservation-operation-v1', read_status: 'available', active: true,
    unit_ids: ['u605'], request_id: 'request-605', request_status: 'requested' }
  const before = structuredClone(info)
  const plan = commercialJourneyPlan(info)
  assert.equal(plan.action, 'greeting_only')
  assert.equal(plan.preserve_commercial_state, true)
  assert.equal(plan.question_id, '')
  assert.deepEqual(info, before)
})

test('untrusted or low confidence metadata cannot supply a commercial intent or a literal greeting shortcut', () => {
  for (const raw of [
    { kind: 'greeting_only', evidence: 'Texto que solo dijo el bot', confidence: 'high', greeting_present: true },
    { kind: 'substantive', evidence: 'hola amigo', confidence: 'low', greeting_present: true },
    { kind: 'not_a_kind', evidence: 'hola amigo', confidence: 'high', greeting_present: true },
    { kind: 'greeting_only', evidence: 'hola amigo', confidence: 'high' },
  ]) {
    const normalized = normalizedTurnCommunication(raw, 'hola amigo')
    assert.equal(normalized.kind, 'ambiguous')
    assert.equal(normalized.confidence, 'low')
    assert.equal(turnCommunicationKind(normalized), 'ambiguous')
  }
  assert.equal(turnCommunicationKind({}), null)
  assert.equal(turnCommunicationKind({ communication: interpretation('substantive', '¿Cuál es su ubicación?') }), 'substantive')
})
