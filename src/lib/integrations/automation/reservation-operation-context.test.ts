import test from 'node:test'
import assert from 'node:assert/strict'
import { hydrateReservationSelection, projectReservationOperation, reconcileReservationOperation } from './reservation-operation-context'

const lead = { id: 'lead', tenant_id: 'tenant', project_id: 'project', assigned_to: null, handoff_status: 'queued' }
const unit = { id: 'u605', unit_number: '605', category: 'penthouse', bedrooms: 3, tenant_id: 'tenant', project_id: 'project' }
const catalog = [unit, { ...unit, id: 'u602', unit_number: '602' }]
const request = { id: 'request605', lead_id: lead.id, request_status: 'requested', unit_ids: [unit.id],
  source_message_id: 'customer-reserve', created_at: '2026-10-16T05:49:00.000Z', assigned_to: null,
  handoff_status: 'queued', notification_status: 'created' }
const projected = () => projectReservationOperation({ requests: [request], lead, catalog })

test('queued request is a known existing request, never a confirmed reservation', () => {
  const context = projected()
  assert.equal(context.active, true)
  assert.equal(context.request_id, request.id)
  assert.equal(context.unit_id, unit.id)
  assert.equal(context.unit_number, '605')
  assert.equal(context.reservation_confirmed, false)
  assert.equal(context.handoff_status, 'queued')
  assert.equal(context.notification_read, null)
})

test('live ownership overrides stale intake assignment snapshot without claiming contact', () => {
  const context = projectReservationOperation({ requests: [request], lead: { ...lead, assigned_to: 'advisor', handoff_status: 'assigned' }, catalog })
  assert.equal(context.assigned_advisor_id, 'advisor')
  assert.equal(context.handoff_status, 'assigned')
  assert.equal(context.advisor_assigned, true)
  assert.equal(context.advisor_contacted, undefined)
})

test('a recorded later lead status prevents an old intake from remaining the current requested operation', () => {
  for (const status of ['reservado', 'vendido', 'no_interesado']) {
    const context = projectReservationOperation({ requests: [request], lead: { ...lead, status }, catalog })
    assert.equal(context.active, false)
    assert.equal(context.lead_status, status)
    assert.equal(context.request_status, 'requested', 'Preserve the intake fact separately from later lead state')
    assert.equal(context.reservation_confirmed, false, 'The request table cannot attest confirmation')
    assert.equal(context.confirmation_status, 'not_verified_by_request')
    assert.deepEqual(hydrateReservationSelection({ selected_ids: [] }, context, catalog).selected_ids, [])
  }
})

test('failed read, no request, foreign request and inactive newest request remain distinct', () => {
  assert.equal(projectReservationOperation({ requests: [], lead, catalog, readStatus: 'unavailable' }).disposition, 'read_unavailable')
  assert.equal(projectReservationOperation({ requests: [], lead, catalog }).disposition, 'no_request')
  assert.equal(projectReservationOperation({ requests: [{ ...request, lead_id: 'other' }], lead, catalog }).active, false)
  const context = projectReservationOperation({ requests: [request, { ...request, id: 'new', created_at: '2026-10-17', request_status: 'cancelled' }], lead, catalog })
  assert.equal(context.request_id, 'new')
  assert.equal(context.active, false)
})

test('ambiguous, missing and foreign catalogue units are not silently restored', () => {
  for (const context of [
    projectReservationOperation({ requests: [{ ...request, unit_ids: ['u605', 'u602'] }], lead, catalog }),
    projectReservationOperation({ requests: [request], lead, catalog: [] }),
    projectReservationOperation({ requests: [request], lead, catalog: [{ ...unit, tenant_id: 'other' }] }),
  ]) assert.deepEqual(hydrateReservationSelection({ selected_ids: [] }, context, catalog).selected_ids, [])
})

test('restore missing legacy605 selection from request without reinterpreting writer words or inventing requirements', () => {
  const context = hydrateReservationSelection({ selected_ids: [], query: {}, last_reply: 'any arbitrary wording' }, projected(), catalog)
  assert.deepEqual(context.selected_ids, [unit.id])
  assert.deepEqual(context.query, { operation: 'none', scope: 'selected', selector: null, filters: {}, requirements: [] })
  assert.equal((context.selection_restoration as Record<string, unknown>).source, 'verified_reservation_request')
  assert.equal(context.exploration_state, undefined)
})

test('preserve later chosen unit, ongoing search and offered alternatives', () => {
  for (const previous of [
    { selected_ids: ['u602'] },
    { selected_ids: [], query: { operation: 'search', scope: 'catalog' } },
    { selected_ids: [], phase: 'choose_floor' },
    { selected_ids: [], offered_ids: ['u602'] },
  ]) assert.deepEqual(hydrateReservationSelection(previous, projected(), catalog), previous)
})

test('restore removes stale selection invitations but preserves a current financial or visit question', () => {
  for (const id of ['property_requirements', 'property_category', 'property_floor', 'unit_choice',
    'reservation_invitation', 'budget_amount', 'budget_kind']) {
    const context = hydrateReservationSelection({ selected_ids: [], pending_question: { id, question: 'old question' } }, projected(), catalog)
    assert.deepEqual(context.pending_question, {})
  }
  for (const id of ['financing_data', 'financing_partner', 'financing_down_payment', 'visit_date_time', 'visit_destination']) {
    const pending = { id, question: 'current operational question' }
    const context = hydrateReservationSelection({ selected_ids: [], pending_question: pending }, projected(), catalog)
    assert.deepEqual(context.pending_question, pending)
  }
})

test('tracking clarification and information about alternatives preserve request605', () => {
  for (const semantics of [
    { primary_intent: 'answer_previous', confidence: 'high', property: { operation: 'none' } },
    { property: { operation: 'compare', evidence: 'compare con el 602', confidence: 'high', unit_numbers: ['602', '605'] } },
    { property: { operation: 'details', evidence: 'quiero detalles del 602', confidence: 'high', unit_numbers: ['602'] } },
  ]) assert.equal(reconcileReservationOperation(projected(), {}, semantics,
    'compare con el 602, quiero detalles del 602, nadie se ha comunicado').active, true)
})

test('explicit new search persists across later acknowledgements without cancelling stored request', () => {
  const changed = reconcileReservationOperation(projected(), {}, { property: {
    operation: 'search', query_scope: 'catalog', evidence: 'quiero buscar suites', confidence: 'high',
  } }, 'Ahora quiero buscar suites')
  assert.equal(changed.active, false)
  assert.equal(changed.disposition, 'search_changed')
  assert.equal(changed.request_status, 'requested')
  assert.equal(reconcileReservationOperation(projected(), changed, {}, 'gracias').active, false)
  assert.deepEqual(hydrateReservationSelection({ selected_ids: [] }, changed, catalog).selected_ids, [])
})

test('changing selected unit persists but asking its price alone does not change request', () => {
  const changed = reconcileReservationOperation(projected(), {}, { unit_choice: {
    kind: 'selected', unit_numbers: ['602'], evidence: 'prefiero el 602', confidence: 'medium',
  } }, 'prefiero el 602')
  assert.equal(changed.disposition, 'unit_changed')
  assert.equal(changed.active, false)
  const same = reconcileReservationOperation(projected(), {}, { unit_choice: {
    kind: 'selected', unit_numbers: ['605'], evidence: 'me quedo con el 605', confidence: 'high',
  } }, 'me quedo con el 605')
  assert.equal(same.active, true)
})

test('rejection pauses conversational continuation without claiming a database cancellation', () => {
  const declined = reconcileReservationOperation(projected(), {}, { reservation: {
    kind: 'declined', evidence: 'ya no quiero reservar', confidence: 'high',
  } }, 'ya no quiero reservar')
  assert.equal(declined.active, false)
  assert.equal(declined.disposition, 'declined_in_conversation')
  assert.equal(declined.cancellation_recorded, false)
  assert.equal(declined.request_status, 'requested')
  const newer = projectReservationOperation({ requests: [{ ...request, id: 'new-request' }], lead, catalog })
  assert.equal(reconcileReservationOperation(newer, declined, {}, 'gracias').active, true)
})

test('declining a reservation for602 does not revoke an existing request for605', () => {
  const context = reconcileReservationOperation(projected(), {}, { reservation: {
    kind: 'declined', unit_numbers: ['602'], evidence: 'no quiero reservar el 602', confidence: 'high',
  } }, 'no quiero reservar el 602')
  assert.equal(context.active, true)
  assert.equal(context.disposition, 'existing_request')
  const matching = reconcileReservationOperation(projected(), {}, { reservation: {
    kind: 'declined', unit_numbers: ['605'], evidence: 'no quiero reservar el 605', confidence: 'high',
  } }, 'no quiero reservar el 605')
  assert.equal(matching.active, false)
  assert.equal(matching.disposition, 'declined_in_conversation')
})

test('ungrounded, low-confidence or quoted historical changes cannot suppress current operation', () => {
  for (const [evidence, confidence] of [['quiero buscar suites', 'low'], ['texto de otro turno', 'high'], ['', 'high']]) {
    assert.equal(reconcileReservationOperation(projected(), {}, { property: {
      operation: 'search', query_scope: 'catalog', evidence, confidence,
    } }, 'quiero buscar suites').active, true)
  }
})

test('a temporary read failure cannot erase the durable suppression of an older request', () => {
  const changed = reconcileReservationOperation(projected(), {}, { property: {
    operation: 'search', query_scope: 'catalog', evidence: 'quiero buscar suites', confidence: 'high',
  } }, 'quiero buscar suites')
  const unavailable = projectReservationOperation({ requests: [], lead, catalog, readStatus: 'unavailable' })
  const failed = reconcileReservationOperation(unavailable, changed, {}, 'gracias')
  assert.equal(failed.read_status, 'unavailable')
  assert.equal(failed.request_id, request.id)
  assert.equal(failed.active, false)
  assert.equal(reconcileReservationOperation(projected(), failed, {}, 'hola').active, false)
})
