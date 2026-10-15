import test from 'node:test'
import assert from 'node:assert/strict'
import { object, type Row } from './data'
import { completeTurnReply } from './turn-completeness'
import { withResponseReviewPolicy } from './response-review-policy'
import { commercialJourneyPlan, journeyPendingQuestion, rememberCommercialJourney } from './commercial-journey'
import { normalizeTurnSemantics, pendingQuestionFromReply } from './turn-semantics'
import { resolvePropertyTurn } from './property-context'
import { resolveTurnIntent } from './turn-intent'
import { reservationPermission, reservationRequest, requestReservationHandoff, verifiedReservationReceipt } from './reservation-action'
import { operationalReservationInvitation, simpleReservationAcceptance } from './reservation-invitation'
import { deliveredPendingQuestion } from './continuation-question'
import { validContinuationMetadata, reconcileContinuationMetadata } from './continuation-validation'

const unit: Row = { id: 'u502', unit_number: '502', category: 'departamento', bedrooms: 3,
  bathrooms_full: 2, floor_number: 5, area_internal_m2: 120.83, area_exterior_m2: 27.03,
  published_commercial_price: 310000, status: 'disponible', is_published: true }
const budget = { status: 'maximum_total', amount: 400000, evidence: 'tengo 400 mil de presupuesto total', confidence: 'high' }
const profile = { full_name: 'Carlos', name_status: 'confirmed', residence_city: 'Cuenca', residence_status: 'confirmed',
  sources: { full_name: { source: 'lead_declaration', evidence: 'Soy Carlos' },
    residence_city: { source: 'lead_declaration', evidence: 'Vivo en Cuenca' } } }
const selected = (): Row => ({ version: 2, selected_ids: ['u502'], offered_ids: ['u502'], focused_ids: ['u502'],
  comparison_ids: [], pending_question: {}, query: { group: 'residential', category: 'departamento',
    operation: 'none', scope: 'selected', filters: {} } })
const info = (): Row => ({ lead: { purchase_purpose: 'vivir' }, perfil_lead: profile,
  catalogo: [unit], catalogo_verificacion: [unit], catalog_read: { complete: true },
  politica_comercial: { precios_autorizados: true }, hechos_confirmados: { budget },
  property_context: selected(), referencia_unidad: { matches: [unit], needsClarification: false },
  financiamiento: { partners: [], journey: {} }, recorrido_comercial: {},
  semantica_turno: { primary_intent: 'select_property', confidence: 'high',
    answer_to_previous: { question_id: 'unit_choice', kind: 'affirmative', evidence: 'si continuemos', confidence: 'high' } } })
const invitation = 'Perfecto, Carlos. ¿Le gustaría que le ayudemos a iniciar la reserva de la unidad 502?'
const incorrectQuestion = { purpose: 'choose_property', role: 'optional_continuation', missing_datum: '',
  next_decision: 'Elegir la unidad', continuation_id: 'reservation_invitation', continuation_act: 'confirm_unit' }
const correctedQuestion = { ...incorrectQuestion, purpose: 'permission_to_continue', continuation_act: 'reservation', offered_action: 'reservation' }

function answerRaw(current: string, id = 'reservation_invitation', changes: Row = {}): Row {
  return { turn_semantics: { primary_intent: 'answer_previous', primary_evidence: current, confidence: 'high',
    answer_to_previous: { question_id: id, kind: 'affirmative', evidence: current, confidence: 'high' },
    reservation: { kind: 'none', confidence: 'low', evidence: null, unit_numbers: [] },
    property: { group: 'residential', category: 'departamento', operation: 'none', query_scope: 'selected',
      reference_kind: 'explicit', unit_numbers: ['502'], evidence: current, confidence: 'high', filters: {} }, ...changes } }
}

for (const mode of ['normal', 'demonstration', 'disabled'] as const) {
  test('502 reservation invitation retains its real meaning and affirmative advances to verified handoff: '+mode, async () => {
    const verified = info(), next = commercialJourneyPlan(verified)
    assert.equal(next.action, 'offer_reservation')
    const calls: string[] = []
    const result = await withResponseReviewPolicy({ enabled: mode !== 'disabled', observationOnly: mode === 'demonstration', updatedAt: null },
      () => completeTurnReply({ current: 'Oh está bonito, si continuemos con este departamento', baseReply: invitation,
        verified: { ...verified, siguiente_paso_comercial: next },
        audit: { semantic_review_enabled: true, business_risk_review_enabled: true, commercial_journey: next } },
      async (_rules, context, _schema, _image, _file, _tone, task) => {
        calls.push(task!)
        if (task === 'writing') return { reply: invitation, question: incorrectQuestion,
          requests: (object(context).referencias_solicitud as Row[]).map(ref => ({ fragment: ref.id,
            intent: 'Continuar con la unidad elegida', request_type: 'general_information', status: 'answered', evidence: invitation, fact_key: null })) }
        return { review_contract: 'business-risk-v2', verdict: 'pass', facts: [], findings: [], question: correctedQuestion }
      }))
    assert.equal(result.needsAdvisor, false)
    assert.equal(object(result.audit.follow_up).usable, true)
    const pending = journeyPendingQuestion(result.reply, next, true, result.audit.question)
    assert.equal(pending.id, 'reservation_invitation')
    assert.equal(pending.act, 'reservation')
    assert.deepEqual(pending.target_ids, ['u502'])
    const journey = rememberCommercialJourney({}, next, pending, true)
    assert.deepEqual(journey.reservation_offered_ids, ['u502'])
    assert.equal(commercialJourneyPlan({ ...verified, recorrido_comercial: journey }).action, 'await_reservation')
    assert.deepEqual(calls, mode === 'disabled' ? ['writing'] : ['writing', 'review'])

    for (const current of ['si esta bien', 'si si me gustaria', 'sí, sí me gustaría', 'claro, por supuesto']) {
      const semantics = normalizeTurnSemantics(answerRaw(current), current, pending)
      assert.equal(object(semantics.reservation).kind, 'request', current)
      assert.equal(semantics.primary_intent, 'request_reservation', current)
      const resolved = resolvePropertyTurn([unit], current, { _property_context: { ...selected(), pending_question: pending } }, [], semantics)
      assert.deepEqual(resolved.context.selected_ids, ['u502'], current)
      const intent = resolveTurnIntent({ current, semantics, requests: [], pendingQuestion: pending,
        scope: { kind: 'property', uncertain: false } })
      assert.equal(intent.requested_action, 'reservation_handoff', current)
      // The production conversation copies the intent's normalized reservation
      // back into semantics before executing the action.
      semantics.reservation = intent.reservation
      assert.deepEqual(object(object(semantics.reservation).accepted_invitation).target_ids, ['u502'])
      const request = reservationRequest(object(semantics.reservation), [{ externalId: 'answer', text: current }], [unit], resolved.matches)
      assert.deepEqual(request?.unit_ids, ['u502'], current)
      const operations: string[] = []
      for (const status of ['assigned', 'queued']) {
        const owner = status === 'assigned' ? 'advisor' : null
        const receipt = { request_id: 'request-502', lead_id: 'lead', source_message_id: 'answer', unit_ids: ['u502'],
          request_status: 'requested', handoff_status: status, assigned_to: owner }
        const operation = await requestReservationHandoff(async (name, args) => {
          operations.push(name)
          assert.deepEqual(args.p_unit_ids, ['u502'])
          assert.equal(args.p_evidence, current)
          return receipt
        }, { p_lead_id: 'lead', p_source_message_id: request!.source_message_id,
          p_unit_ids: request!.unit_ids, p_evidence: request!.evidence, p_evidence_message_ids: request!.evidence_message_ids })
        assert.equal(operation.status, 'recorded')
        assert.equal(verifiedReservationReceipt(receipt, { id: 'lead', handoff_status: status, assigned_to: owner }, request!), true)
      }
      assert.deepEqual(operations, ['lv_request_reservation_handoff', 'lv_request_reservation_handoff'])
    }
  })
}

test('reservation information and ambiguous alternatives cannot supply permission from their question label', () => {
  for (const question of ['¿Le gustaría conocer los requisitos para reservar?', '¿Prefiere reservar o coordinar una visita?',
    '¿Cuánto tendría que pagar para iniciar la reserva?', '¿Qué le parece?', '¿Desea cancelar la reserva?']) {
    assert.equal(operationalReservationInvitation(question), false, question)
    const current = 'si esta bien', pending = { id: 'reservation_invitation', act: 'reservation', question, target_ids: ['u502'] }
    assert.equal(object(normalizeTurnSemantics(answerRaw(current), current, pending).reservation).kind, 'none', question)
  }
  assert.equal(pendingQuestionFromReply(invitation).id, 'reservation_invitation')
})

test('a yes to unit details or selection never initiates reservation, and an invitation needs one verified target', () => {
  const current = 'si esta bien'
  for (const pending of [
    { id: 'unit_choice', act: 'confirm_unit', question: '¿Desea continuar con el departamento 502?', target_ids: ['u502'] },
    { id: 'unit_choice', act: 'show_unit_details', question: '¿Desea conocer detalles de la unidad 502?', target_ids: ['u502'] },
    { id: 'reservation_invitation', act: 'reservation', question: invitation, target_ids: [] },
    { id: 'reservation_invitation', act: 'reservation', question: invitation, target_ids: ['u502', 'u402'] },
  ]) {
    const semantics = normalizeTurnSemantics(answerRaw(current, pending.id), current, pending)
    assert.equal(object(semantics.reservation).kind, 'none')
  }
  const pending = { id: 'reservation_invitation', act: 'reservation', question: invitation, target_ids: ['u502'] }
  const semantics = normalizeTurnSemantics(answerRaw(current), current, pending)
  const intent = resolveTurnIntent({ current, semantics, requests: [], pendingQuestion: pending,
    scope: { kind: 'property', uncertain: false } })
  const accepted = object(intent.reservation)
  assert.equal(reservationRequest(accepted, [{ externalId: 'answer', text: current }], [unit, { ...unit, id: 'u402', unit_number: '402' }],
    [{ ...unit, id: 'u402', unit_number: '402' }]), null, 'A stale selection must not redirect the yes to 402')
})

test('affirmative spellings do not bypass real prerequisites or negated reservation requests', () => {
  for (const current of ['Si me aprueban el crédito, quiero reservar', 'si si me gustaria, pero primero necesito saber el precio',
    'si esta bien el precio, quiero reservar', 'Quiero reservar si cuesta menos de 300 mil']) {
    assert.equal(simpleReservationAcceptance(current), false, current)
    const raw = { kind: 'request', confidence: 'high', evidence: current, unit_numbers: ['502'] }
    assert.equal(reservationPermission(raw, current).kind, 'information', current)
    assert.equal(reservationRequest(raw, [{ externalId: 'answer', text: current }], [unit], [unit]), null, current)
  }
  const current = 'No quiero reservar la unidad 502'
  assert.equal(reservationRequest({ kind: 'request', confidence: 'high', evidence: 'quiero reservar la unidad 502', unit_numbers: ['502'] },
    [{ externalId: 'answer', text: current }], [unit], [unit]), null)
})

test('a reviewer or writer label cannot turn a vague question into a reservation invitation', () => {
  const next = commercialJourneyPlan(info())
  for (const question of ['¿Qué le parece?', '¿Le gustaría conocer los requisitos para reservar?', '¿Prefiere reservar o agendar una visita?']) {
    assert.equal(validContinuationMetadata(correctedQuestion, question, next), true, question)
    assert.equal(reconcileContinuationMetadata(correctedQuestion, question, next).corrected, false, question)
    assert.deepEqual(deliveredPendingQuestion(question, { metadata: correctedQuestion, plan: next }, [unit]), {}, question)
  }
})

test('the real unit mentioned in the invitation must match its verified target', () => {
  const next = commercialJourneyPlan(info())
  const other = { ...unit, id: 'u601', unit_number: '601' }
  for (const number of ['601', '999']) {
    const question = `¿Le gustaría iniciar la reserva de la unidad ${number}?`
    assert.deepEqual(deliveredPendingQuestion(question, { metadata: correctedQuestion, plan: next }, [unit, other]), {})
    const current = 'si esta bien', pending = { id: 'reservation_invitation', act: 'reservation', question, target_ids: ['u502'] }
    const semantics = normalizeTurnSemantics(answerRaw(current), current, pending)
    const intent = resolveTurnIntent({ current, semantics, requests: [], pendingQuestion: pending, scope: { kind: 'property', uncertain: false } })
    assert.equal(reservationRequest(object(intent.reservation), [{ externalId: 'answer', text: current }], [unit, other], [unit]), null)
  }
})

test('gratitude, clipped refusal and a yes to details cannot use a model reservation label to execute', () => {
  for (const [current, evidence] of [['si', 'si'], ['No, gracias', 'gracias'], ['Me gusta este apartamento', 'apartamento']]) {
    const raw = answerRaw(current, 'unit_choice', { reservation: { kind: 'request', confidence: 'high', evidence, unit_numbers: ['502'] } })
    const pending = { id: 'unit_choice', act: 'show_unit_details', question: '¿Desea conocer detalles del departamento 502?', target_ids: ['u502'] }
    const semantics = normalizeTurnSemantics(raw, current, pending)
    assert.equal(object(semantics.reservation).kind, 'none', current)
    assert.equal(reservationRequest({ kind: 'request', confidence: 'high', evidence, unit_numbers: ['502'] },
      [{ externalId: 'answer', text: current }], [unit], [unit]), null, current)
  }
})
