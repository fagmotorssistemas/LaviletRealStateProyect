import test from 'node:test'
import assert from 'node:assert/strict'
import { completeTurnReply } from './turn-completeness'
import { withResponseReviewPolicy } from './response-review-policy'
import { projectContentForWriter, responseContentScope } from './response-content-scope'
import { object, type Row } from './data'

const unit = { id: 'd502', unit_number: '502', category: 'departamento', bedrooms: 3, bathrooms_full: 2,
  floor_number: 5, area_internal_m2: 120.83, area_exterior_m2: 27.03, spaces: ['sala', 'comedor', 'cocina'],
  description: 'Departamento con tres dormitorios y dos baños.', published_commercial_price: 310000,
  status: 'disponible', is_published: true }
const history = [
  { role: 'user', content: 'Prefiero la unidad 502 y tengo 400 mil para toda la compra.' },
  { role: 'bot', content: 'La unidad 502 tiene 120.83 m² y dos baños. ¿Le gustaría continuar con esta unidad?' },
]
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []

function verified(current: string, topics: string[] = ['property_options'], action = 'offer_reservation'): Row {
  const request = { domain: 'property', request: current, evidence: current, confidence: 'high', topics }
  const question = '¿Le gustaría que le ayudemos a iniciar la reserva de la unidad 502?'
  return { catalogo: [unit], catalogo_verificacion: [unit], catalog_read: { complete: true },
    politica_comercial: { precios_autorizados: true }, historial: history,
    perfil_lead: { full_name: 'Carlos', residence_city: 'Cuenca' },
    property_context: { selected_ids: ['d502'], focused_ids: ['d502'], query: { scope: 'selected', operation: 'none', category: 'departamento' } },
    pregunta_pendiente: { id: 'unit_choice', act: 'confirm_unit', target_ids: ['d502'], question: '¿Le gustaría continuar con esta unidad?' },
    siguiente_paso_comercial: { action, selected_unit_id: 'd502', question_id: 'reservation_invitation', question_act: 'reservation',
      question, continuation_required: true, instruction: 'Ofrezca iniciar la solicitud de reserva de la unidad elegida.' },
    hechos_confirmados: { budget: { status: 'maximum_total', amount: 400000, evidence: history[0].content, confidence: 'high' } },
    solicitudes_interpretadas: [request],
    contrato_turno: { objective: 'answer_previous', requests: [request], required_facts: [] },
    semantica_turno: { primary_intent: 'answer_previous', primary_evidence: current, confidence: 'high',
      answer_to_previous: { question_id: 'unit_choice', kind: 'affirmative', evidence: current, confidence: 'high' },
      property: { operation: 'none', reference_kind: 'none', unit_numbers: [] },
      budget: { status: 'not_discussed' }, catalog_request: { purpose: 'none' } } }
}

for (const mode of ['normal', 'demonstration', 'disabled'] as const) {
  test(`confirming an already presented unit advances to reservation without another feature sheet: ${mode}`, async () => {
    const current = 'sí está bien', input = verified(current), original = structuredClone(input)
    const reply = 'Perfecto. ¿Le gustaría que le ayudemos a iniciar la reserva de la unidad 502?'
    const metadata = { purpose: 'permission_to_continue', role: 'optional_continuation', missing_datum: '',
      next_decision: 'Iniciar la solicitud de reserva', continuation_id: 'reservation_invitation', continuation_act: 'reservation' }
    const contexts: Row[] = [], tasks: string[] = []
    const result = await withResponseReviewPolicy({ enabled: mode !== 'disabled', observationOnly: mode === 'demonstration', updatedAt: null },
      () => completeTurnReply({ current, baseReply: 'La unidad 502 tiene 120.83 m² y dos baños. ' + object(input.siguiente_paso_comercial).question,
        verified: input, history, audit: { source: 'property_unit_selected', semantic_review_enabled: true, business_risk_review_enabled: true,
          selected_unit_ids: ['d502'], commercial_journey: input.siguiente_paso_comercial } },
      async (_rules, raw, _schema, _image, _file, _tone, task) => {
        contexts.push(object(raw)); tasks.push(task || '')
        if (task === 'writing') return { reply, question: metadata, requests: rows(object(raw).referencias_solicitud).map(ref => ({
          fragment: ref.id, intent: 'Continuar con la unidad elegida', request_type: 'general_information', status: 'answered', evidence: reply, fact_key: null })) }
        return { review_contract: 'business-risk-v2', verdict: 'pass', facts: [], findings: [], question: { ...metadata, offered_action: 'none' } }
      }))
    assert.equal(result.reply, reply, JSON.stringify(result.audit.final_validation))
    assert.equal(result.needsAdvisor, false)
    assert.deepEqual(tasks, mode === 'disabled' ? ['writing'] : ['writing', 'review'])
    const writer = contexts[0], scope = object(writer.response_content_scope)
    assert.equal(object(scope.property_presentation).kind, 'progression_brief')
    assert.equal(object(scope.property_presentation).unit_features_allowed, false)
    const selected = rows(object(writer.evidencia_turno).units).find(item => item.unit_number === '502')!
    assert.ok(selected)
    assert.equal(selected.unit_number, '502')
    for (const field of ['area_internal_m2', 'area_exterior_m2', 'bedrooms', 'bathrooms_full', 'floor_number', 'spaces', 'description'])
      assert.equal(selected[field], undefined, field)
    assert.deepEqual(object(writer.property_context).selected_ids, ['502'])
    assert.equal(object(object(writer.contexto_verificado).presupuesto_del_turno).amount, 400000)
    assert.deepEqual(rows(writer.historial_reciente), [history[0], { role: 'bot', content: '¿Le gustaría continuar con esta unidad?' }])
    if (contexts.length > 1) {
      const reviewedUnit = rows(object(contexts[1].fuentes_autorizadas).unidades).find(item => item.unit_number === '502')
      assert.equal(reviewedUnit?.area_internal_m2, 120.83)
      assert.equal(reviewedUnit?.bathrooms_full, 2)
    }
    assert.deepEqual(input, original)
  })
}

test('an acceptance with a current price or feature question keeps the requested facts and the pending reservation step', () => {
  for (const topic of ['purchase_price', 'property_features', 'visualization']) {
    const current = topic === 'purchase_price' ? 'sí, pero ¿cuál es el precio de esa unidad?'
      : topic === 'property_features' ? 'sí, pero ¿cuántos baños tiene esa unidad?'
        : 'sí, pero envíeme el recorrido de esa unidad, por favor'
    const input = verified(current, ['property_options', topic])
    const original = structuredClone(input), scope = responseContentScope(current, input)
    const projected = projectContentForWriter({ contexto_verificado: input, historial_reciente: history }, scope)
    assert.equal(object(scope.property_presentation).kind, 'relevant_details')
    assert.equal(rows(object(projected.contexto_verificado).catalogo)[0].area_internal_m2, 120.83)
    assert.equal(rows(object(projected.contexto_verificado).catalogo)[0].bathrooms_full, 2)
    if (topic === 'purchase_price') assert.equal(rows(object(projected.contexto_verificado).catalogo)[0].published_commercial_price, 310000)
    assert.deepEqual(projected.historial_reciente, history)
    assert.deepEqual(object(object(projected.contexto_verificado).property_context).selected_ids, ['d502'])
    assert.equal(object(object(projected.contexto_verificado).siguiente_paso_comercial).question_id, 'reservation_invitation')
    assert.deepEqual(input, original)
  }
})

test('waiting for reservation or communicating its verified handoff retains the operation without reciting features', () => {
  for (const action of ['await_reservation', 'current_operation']) {
    const current = 'sí, me gustaría', input = verified(current, [], action)
    const audit = { source: 'reservation_handoff', reservation: { request_id: 'r-1', request_status: 'requested',
      handoff_verified: true, handoff_status: 'queued', inventory_reserved: false }, commercial_journey: input.siguiente_paso_comercial }
    object(input.semantica_turno).primary_intent = 'request_reservation'
    const scope = responseContentScope(current, input, audit)
    const raw = { response_content_scope: scope, contexto_verificado: input, estado_operativo: audit,
      evidencia_turno: { units: [unit], groups: [{ id: 'group:bathrooms', field: 'bathrooms_full', value: 2 }] },
      contrato_redaccion: { hechos_protegidos: [unit], resultado_operativo: audit.reservation } }
    const original = structuredClone(raw), projected = projectContentForWriter(raw, scope)
    assert.equal(object(scope.property_presentation).kind, 'progression_brief')
    assert.equal(rows(object(projected.evidencia_turno).units)[0].bathrooms_full, undefined)
    assert.deepEqual(object(projected.evidencia_turno).groups, [])
    assert.equal(rows(object(projected.contrato_redaccion).hechos_protegidos)[0].spaces, undefined)
    assert.deepEqual(object(projected.estado_operativo).reservation, audit.reservation)
    assert.deepEqual(object(projected.contrato_redaccion).resultado_operativo, audit.reservation)
    assert.deepEqual(raw, original)
  }
})

test('a legacy untyped information request cannot be converted into a brief acceptance by its stage alone', () => {
  const current = 'sí, ¿cuál es el valor de reserva?', input = verified(current)
  delete rows(input.solicitudes_interpretadas)[0].topics
  assert.equal(object(responseContentScope(current, input).property_presentation).kind, 'relevant_details')
})

test('accepting details or a confirmation without current evidence does not suppress a unit presentation', () => {
  const current = 'sí está bien', input = verified(current, ['property_options'], 'leave_open')
  const pending = object(input.pregunta_pendiente)
  pending.act = 'show_unit_details'
  assert.equal(object(responseContentScope(current, input).property_presentation).kind, 'relevant_details')
  pending.act = 'confirm_unit'
  object(object(input.semantica_turno).answer_to_previous).evidence = 'Una respuesta de otro turno'
  assert.equal(object(responseContentScope(current, input).property_presentation).kind, 'relevant_details')
})
