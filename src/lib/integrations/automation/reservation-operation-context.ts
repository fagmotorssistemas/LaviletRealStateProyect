import type { Row } from './data'
import { acceptedExtractorConfidence } from './extractor-confidence'

const object = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
const text = (value: unknown) => typeof value === 'string' ? value : ''
const ids = (value: unknown) => Array.isArray(value) ? [...new Set(value.map(text).filter(Boolean))] : []
const code = (value: unknown) => text(value).trim().toLocaleUpperCase('es').replace(/^LC\s*-?\s*/, 'LC-').replace(/^0+(?=\d)/, '')
const normalized = (value: unknown) => text(value).normalize('NFKC').toLocaleLowerCase('es').replace(/\s+/g, ' ').trim()

export const RESERVATION_OPERATION_VERSION = 'reservation-operation-v1'

/** Projection of verified intake data, never an inference from the bot's prose.
 * An intake records a REQUEST; it cannot confirm inventory, a payment or a sale.
 * Read failures are explicitly different from a successful read with no request. */
export function projectReservationOperation(input: {
  requests: unknown
  lead: Row
  catalog: Row[]
  readStatus?: 'available' | 'unavailable'
}): Row {
  const base: Row = { version: RESERVATION_OPERATION_VERSION, read_status: input.readStatus || 'available',
    active: false, request_id: null, request_status: null, unit_ids: [], unit_numbers: [],
    unit_id: null, unit_number: null, unit_resolution: 'unavailable',
    reservation_confirmed: false, confirmation_status: 'not_verified_by_request',
    assigned_advisor_id: text(input.lead.assigned_to) || null,
    advisor_assigned: !!text(input.lead.assigned_to), handoff_status: text(input.lead.handoff_status) || 'none',
    response_due_at: text(input.lead.seller_response_due_at) || null,
    lead_status: text(input.lead.status) || null }
  if (base.read_status === 'unavailable') return { ...base, disposition: 'read_unavailable' }
  const requests = (Array.isArray(input.requests) ? input.requests : []).map(object)
    .filter(request => text(input.lead.id) && request.lead_id === input.lead.id && text(request.id || request.request_id))
    .sort((left, right) => text(right.created_at || right.source_sent_at).localeCompare(text(left.created_at || left.source_sent_at)))
  const request = requests[0]
  if (!request) return { ...base, disposition: 'no_request' }
  const requestedIds = ids(request.unit_ids)
  const units = input.catalog.filter(unit => requestedIds.includes(text(unit.id))
    && (!text(unit.tenant_id) || !text(input.lead.tenant_id) || unit.tenant_id === input.lead.tenant_id)
    && (!text(unit.project_id) || !text(input.lead.project_id) || unit.project_id === input.lead.project_id))
  const resolved = units.length === requestedIds.length && requestedIds.length > 0
  const single = resolved && units.length === 1 ? units[0] : null
  const requested = request.request_status === 'requested'
  // These are real LeadStatus values. They stop the historical intake from
  // overriding a later commercial state; the intake itself confirms nothing.
  const advanced = ['reservado', 'vendido'].includes(text(input.lead.status))
  const closed = input.lead.status === 'no_interesado'
  return { ...base, active: requested && !advanced && !closed,
    disposition: advanced ? 'lead_status_advanced' : closed ? 'lead_closed' : requested ? 'existing_request' : 'inactive_request',
    request_id: text(request.id || request.request_id), request_status: text(request.request_status) || null,
    source_message_id: text(request.source_message_id) || null,
    source_sent_at: text(request.source_sent_at) || null, created_at: text(request.created_at) || null,
    unit_ids: requestedIds, unit_numbers: units.map(unit => text(unit.unit_number)).filter(Boolean),
    unit_id: single ? text(single.id) : null, unit_number: single ? text(single.unit_number) : null,
    unit_resolution: resolved ? units.length === 1 ? 'resolved' : 'ambiguous' : units.length ? 'partial' : 'unavailable',
    notification_status: text(request.notification_status) || null,
    notification_read: null, cancellation_recorded: false }
}

/** Keep a conversational change durable without pretending to cancel the DB
 * request. A different verified request resets the old suppression marker. */
export function reconcileReservationOperation(context: Row, previousMemory: unknown, semantics: unknown, current: string): Row {
  const previous = object(previousMemory), turn = object(semantics), reservation = object(turn.reservation)
  const property = object(turn.property), choice = object(turn.unit_choice)
  if (context.read_status === 'unavailable') return { ...previous, ...context,
    request_id: previous.request_id || context.request_id,
    disposition: previous.disposition || context.disposition,
    disposition_evidence: previous.disposition_evidence, active: false }
  const currentText = normalized(current)
  const grounded = (field: Row) => acceptedExtractorConfidence(field.confidence)
    && !!normalized(field.evidence) && currentText.includes(normalized(field.evidence))
  let next = { ...context }
  if (context.request_id && previous.request_id === context.request_id && previous.active === false
    && ['search_changed', 'unit_changed', 'declined_in_conversation'].includes(text(previous.disposition))) {
    next = { ...next, active: false, disposition: previous.disposition, disposition_evidence: previous.disposition_evidence }
  }
  if (context.read_status !== 'available' || !context.request_id || context.request_status !== 'requested') return next
  // "Declined" is the extractor's rejection/postponement of this process. It is
  // not evidence that an already recorded intake has been cancelled by staff.
  const unitNumbers = ids(context.unit_numbers).map(code)
  const declinedNumbers = ids(reservation.unit_numbers).map(code)
  const declinesThisRequest = !declinedNumbers.length || declinedNumbers.some(number => unitNumbers.includes(number))
  if (grounded(reservation) && reservation.kind === 'declined' && declinesThisRequest) return { ...next, active: false,
    disposition: 'declined_in_conversation', disposition_evidence: reservation.evidence, cancellation_recorded: false }
  const selected = grounded(choice) && choice.kind === 'selected' ? ids(choice.unit_numbers)
    : grounded(property) && property.operation === 'select' ? ids(property.unit_numbers) : []
  if (selected.length && selected.some(number => !unitNumbers.includes(code(number)))) return { ...next,
    active: false, disposition: 'unit_changed', disposition_evidence: choice.kind === 'selected' ? choice.evidence : property.evidence }
  if (grounded(property) && property.operation === 'search' && property.query_scope !== 'selected') return { ...next,
    active: false, disposition: 'search_changed', disposition_evidence: property.evidence }
  return next
}

/** Repair only a missing legacy choice from the persisted client's request.
 * Newer choices/searches and unresolved catalogues are never overwritten.
 * This creates no new reservation, consent, availability or financial approval. */
export function hydrateReservationSelection(previous: unknown, operation: Row, catalog: Row[]): Row {
  const context = object(previous), query = object(context.query)
  if (operation.version !== RESERVATION_OPERATION_VERSION || operation.read_status !== 'available'
    || operation.active !== true || operation.request_status !== 'requested' || operation.unit_resolution !== 'resolved'
    || ids(context.selected_ids).length || ids(operation.unit_ids).length !== 1
    || ['search', 'select'].includes(text(query.operation))
    || ['compare_categories', 'choose_category', 'choose_floor', 'choose_unit'].includes(text(context.phase))) return context
  const unit = catalog.find(candidate => candidate.id === operation.unit_id)
  if (!unit) return context
  const otherReferences = [...ids(context.offered_ids), ...ids(context.comparison_ids)]
  if (otherReferences.length && otherReferences.some(id => id !== unit.id)) return context
  const pending = object(context.pending_question)
  const staleSelectionQuestion = ['property_requirements', 'property_category', 'property_floor', 'property_bedrooms',
    'property_area', 'property_priority', 'unit_choice', 'reservation_invitation', 'budget_amount', 'budget_kind'].includes(text(pending.id))
  return { ...context, version: 2, selected_ids: [unit.id], phase: 'review_unit',
    ...(staleSelectionQuestion ? { pending_question: {} } : {}),
    query: { ...query, operation: 'none', scope: 'selected', selector: null, filters: {}, requirements: [] },
    selection_restoration: { source: 'verified_reservation_request', request_id: operation.request_id,
      source_message_id: operation.source_message_id, unit_id: unit.id, original_query: query } }
}
