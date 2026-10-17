import { object,text,type Row } from './data'
import { acceptedExtractorConfidence } from './extractor-confidence'

export const RESERVATION_INVITATION_RECEIPT_VERSION = 'reservation-invitation-v1'

/** Persist only the writer's typed act and its independently verified target.
 * The text is display context; no wording grants or removes permission. */
export function reservationInvitationReceipt(question: unknown, targetIds: string[]): Row {
  const value = object(question), targets = [...new Set(targetIds.filter(Boolean))]
  return value.continuation_id === 'reservation_invitation' && value.continuation_act === 'reservation'
    && value.purpose === 'permission_to_continue' && !!text(value.text).trim() && targets.length === 1
    ? { version: RESERVATION_INVITATION_RECEIPT_VERSION, kind: 'start_reservation_request',
      question_id: 'reservation_invitation', question_act: 'reservation', source: 'writer_metadata', unit_id: targets[0] } : {}
}

/** A legacy label or copied writer sentence is not a delivered operational act. */
export function verifiedReservationInvitation(receipt: unknown, targetIds: string[]): boolean {
  const value = object(receipt)
  return value.version === RESERVATION_INVITATION_RECEIPT_VERSION && value.kind === 'start_reservation_request'
    && value.question_id === 'reservation_invitation' && value.question_act === 'reservation' && value.source === 'writer_metadata'
    && targetIds.length === 1 && !!targetIds[0] && value.unit_id === targetIds[0]
}

/** A short acknowledgement contains no prerequisite or independent request.
 * It authorizes nothing without a verified invitation and a current answer. */
export function simpleReservationAcceptance(current: string, answerRaw: unknown = {}): boolean {
  const answer = object(answerRaw), quote = text(answer.evidence).trim()
  return answer.kind === 'affirmative' && acceptedExtractorConfidence(answer.confidence) && !!quote
    && current.normalize('NFKC').toLowerCase().includes(quote.normalize('NFKC').toLowerCase())
}

/** Recognize the invitation actually delivered, never a remembered topic or
 * an explanation of conditions. Alternative actions require clarification. */
export function operationalReservationInvitation(receipt: unknown): boolean {
  const value = object(receipt)
  return verifiedReservationInvitation(value, [text(value.unit_id)])
}

/** Codes explicitly named in the invitation must agree with its stored target. */
export function reservationInvitationUnitNumbers(_reply: string): string[] { void _reply;
  // A legacy string is not a structured unit reference.
  return []
}

/** A model's operational label cannot turn gratitude or a property answer into
 * a reservation. Contextual acknowledgements use the delivered invitation. */
export function explicitReservationAction(evidence: string, reservationRaw: unknown = {}): boolean {
  const reservation = object(reservationRaw), quote = text(reservation.evidence).trim()
  return reservation.kind === 'request' && acceptedExtractorConfidence(reservation.confidence) && !!quote
    && evidence.normalize('NFKC').toLowerCase().includes(quote.normalize('NFKC').toLowerCase())
}
