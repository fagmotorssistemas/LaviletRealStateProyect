import { normalized } from './sdr-rules'
import { object, text, type Row } from './data'

/** A short acceptance has no separate information request. The caller still
 * needs an actual process invitation; these words alone authorize nothing. */
export function simpleFinancingAcceptance(current: string): boolean {
  const message = normalized(current)
  if (/[¿?]/.test(current) || /\b(?:pero|solo|siempre que|a condicion|antes de|si me (?:aprueban|aseguran|garantizan))\b/.test(message)) return false
  if (/^(si|si claro|claro|si por favor|si esta bien|si me parece bien|esta bien|bueno esta bien|adelante|de acuerdo|continuemos|si continuemos|por supuesto|si por supuesto|hagamoslo|me gustaria)$/.test(message)) return true
  return /^(?:(?:si|claro|bueno|de acuerdo|adelante|por supuesto) )?(?:continuemos|sigamos|avancemos)(?: (?:por favor|con (?:el |la |banco |cooperativa )?[a-z .'-]+))?$/.test(message)
    && !/\b(?:cuanto|cual|como|que|entrada|cuotas?|tasa|porcentaje|plazo|mensualidad|requisitos|saber|explicar|informacion)\b/.test(message)
}

export const FINANCING_INVITATION_RECEIPT_VERSION = 'financing-invitation-v1'

/** The writer identifies the delivered act. Its wording is opaque to code. */
export function financingInvitationReceipt(question: unknown): Row {
  const value = object(question)
  return value.continuation_id === 'financing_invitation' && value.continuation_act === 'financing'
    && value.purpose === 'permission_to_continue' && !!text(value.text).trim()
    ? { version: FINANCING_INVITATION_RECEIPT_VERSION, kind: 'preliminary_review',
      question_id: 'financing_invitation', question_act: 'financing', source: 'writer_metadata' } : {}
}

/** A topic, legacy label or message string never authorizes an invitation. */
export function operationalFinancingInvitation(receipt: unknown): boolean {
  const value = object(receipt)
  return value.version === FINANCING_INVITATION_RECEIPT_VERSION && value.kind === 'preliminary_review'
    && value.question_id === 'financing_invitation' && value.question_act === 'financing' && value.source === 'writer_metadata'
}
