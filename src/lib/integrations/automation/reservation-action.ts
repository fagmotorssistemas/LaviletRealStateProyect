import { object,type Row } from './data'
import { acceptedExtractorConfidence } from './extractor-confidence'
import { verifiedReservationInvitation } from './reservation-invitation'
import { actionAuthorized, normalizedActionAuthority } from './action-authority'

const value = (input: unknown) => typeof input === 'string' ? input : ''
const normalize = (input: unknown) => value(input).toLocaleLowerCase('es').replace(/\s+/g, ' ').trim()
const unitKey = (input: unknown) => {
  const match = normalize(input).match(/^(lc[- ]*)?(\d{1,4})$/)
  return match ? `${match[1] ? 'lc-' : ''}${Number(match[2])}` : ''
}
/** Validate provenance, never infer conditions or negation from wording. The
 * interpreter must classify those as information/declined, not request. */
export function reservationPermission(reservation: Row, current: string, authority?: unknown): Row {
  if (reservation.kind !== 'request' || !acceptedExtractorConfidence(reservation.confidence)) return reservation
  if (!actionAuthorized(normalizedActionAuthority(authority, current), 'reservation')) return { ...reservation, kind: 'none', permission_reason: 'current_authority_required' }
  const proof = value(reservation.evidence).trim()
  return proof && current.normalize('NFKC').toLowerCase().includes(proof.normalize('NFKC').toLowerCase())
    ? reservation : { ...reservation, kind: 'none', permission_reason: 'reservation_evidence_not_current' }
}

/** Select the persisted message supplying the proof, including batched turns. */
export function reservationRequest(reservation: Row, messages: { externalId: string; text: string }[], catalog: Row[], selected: Row[], authority?: unknown) {
  reservation = reservationPermission(reservation, messages.map(message => message.text).join('\n'), authority)
  if (reservation.kind !== 'request' || !acceptedExtractorConfidence(reservation.confidence)) return null
  const evidence = value(reservation.evidence).trim()
  if (!evidence) return null
  const persisted = [...new Map(messages.filter(message => message.externalId && normalize(message.text)).map(message => [message.externalId, message])).values()]
  let combined = ''
  const spans = persisted.map(message => {
    const start = combined.length + (combined ? 1 : 0)
    combined += `${combined ? ' ' : ''}${normalize(message.text)}`
    return { ...message, start, end: combined.length }
  })
  const normalizedEvidence = normalize(evidence)
  const start = combined.lastIndexOf(normalizedEvidence)
  if (start < 0) return null
  const proof = spans.filter(message => message.end > start && message.start < start + normalizedEvidence.length)
  if (!proof.length) return null
  const numbers = [...new Set((Array.isArray(reservation.unit_numbers) ? reservation.unit_numbers : []).map(unitKey).filter(Boolean))]
  const available = catalog.filter(unit => unit.is_published !== false && (!unit.status || unit.status === 'disponible'))
  const selectedUnits = selected.filter(unit => available.some(candidate => candidate.id === unit.id))
  // Server-derived acceptance must retain the invitation's exact verified
  // target. A stale selection cannot redirect the customer's yes elsewhere.
  if (reservation.accepted_invitation) {
    const invitation = object(reservation.accepted_invitation)
    const targets = Array.isArray(invitation.target_ids) ? invitation.target_ids.map(value).filter(Boolean) : []
    if (!verifiedReservationInvitation(invitation, targets)
      || selectedUnits.length !== 1 || selectedUnits[0].id !== targets[0]) return null
  }
  const canResolveSelection = selectedUnits.length === 1 && numbers.length === 0
    && (reservation.reference_kind === 'contextual' || !!reservation.accepted_invitation)
  // Unit identifiers have already been interpreted. Only catalogue membership,
  // current availability and the delivered invitation's target are checked here.
  const units = numbers.length ? available.filter(unit => numbers.includes(unitKey(unit.unit_number)))
    : canResolveSelection ? selectedUnits : []
  const proofIds = new Set(proof.map(message => message.externalId))
  const proofMessages = spans.filter(message => proofIds.has(message.externalId))
  return { source_message_id: proofMessages.at(-1)!.externalId, evidence, evidence_message_ids: proofMessages.map(message => message.externalId),
    unit_ids: units.map(unit => value(unit.id)), unit_numbers: units.map(unit => value(unit.unit_number)),
    unresolved_unit_numbers: numbers.filter(number => !units.some(unit => unitKey(unit.unit_number) === number)) }
}

/** An absent function did not execute the write. Do not substitute a different
 * handoff, drop evidence arguments, or replay a timeout with an uncertain result. */
export async function requestReservationHandoff(call: (name: string, args: Row) => Promise<unknown>, args: Row) {
  try {
    const result = await call('lv_request_reservation_handoff', args)
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('RESERVATION_HANDOFF_CONTRACT_MISMATCH')
    return { status: 'recorded' as const, receipt: result as Row }
  } catch (error) {
    if (!(error instanceof Error) || !/^RPC_LV_REQUEST_RESERVATION_HANDOFF_(PGRST202|42883)$/.test(error.message)) throw error
    return { status: 'unavailable' as const, error_code: error.message, action_executed: false as const }
  }
}

export function verifiedReservationReceipt(receipt: Row, lead: Row, request: NonNullable<ReturnType<typeof reservationRequest>>) {
  const units = Array.isArray(receipt.unit_ids) ? receipt.unit_ids.map(value).sort() : []
  const assigned = ['assigned', 'acknowledged'].includes(value(receipt.handoff_status))
  return Boolean(receipt.request_id) && receipt.lead_id === lead.id && receipt.source_message_id === request.source_message_id
    && receipt.request_status === 'requested' && ['assigned', 'acknowledged', 'queued'].includes(value(receipt.handoff_status))
    && JSON.stringify(units) === JSON.stringify([...request.unit_ids].sort())
    && lead.handoff_status === receipt.handoff_status
    && (assigned ? Boolean(receipt.assigned_to) && lead.assigned_to === receipt.assigned_to : !receipt.assigned_to && !lead.assigned_to)
}

/** Only an absent function permits legacy fallback; ambiguous writes are retried idempotently. */
export async function evaluateInterestDecision(call: (name: string, args: Row) => Promise<unknown>, args: Row): Promise<Row> {
  try {
    const result = await call('lv_evaluate_message_interest_v2', args)
    if (result && typeof result === 'object' && !Array.isArray(result)) return result as Row
    throw new Error('INTEREST_DECISION_CONTRACT_MISMATCH')
  } catch (error) {
    if (!(error instanceof Error) || !/^RPC_LV_EVALUATE_MESSAGE_INTEREST_V2_(PGRST202|42883)$/.test(error.message)) throw error
    await call('lv_evaluate_message_interest', args)
    return { decision_source: 'legacy_without_receipt', source_message_id: args.p_source_message_id,
      recognized_events: args.p_events, handoff_required: null, handoff_reason: null }
  }
}
