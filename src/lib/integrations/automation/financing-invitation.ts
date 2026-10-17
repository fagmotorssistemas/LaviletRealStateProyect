import { object,text,type Row } from './data'
import { acceptedExtractorConfidence } from './extractor-confidence'

/** A short acceptance has no separate information request. The caller still
 * needs an actual process invitation; these words alone authorize nothing. */
export function simpleFinancingAcceptance(current: string, answerRaw: unknown = {}): boolean {
  const answer = object(answerRaw), quote = text(answer.evidence).trim()
  return answer.question_id === 'financing_invitation' && answer.kind === 'affirmative'
    && acceptedExtractorConfidence(answer.confidence) && !!quote
    && current.normalize('NFKC').toLowerCase().includes(quote.normalize('NFKC').toLowerCase())
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
