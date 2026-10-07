import { object, type Row } from './data'
import { responseReviewObservationOnly } from './response-review-policy'

export class ResponseReviewRecoveryError extends Error {
  constructor() { super('RESPONSE_REVIEW_EXHAUSTED') }
}

/** Operational recovery is distinct from an AI-inferred commercial data gap.
 * The worker checks freshness/permissions and queues the advisor before notice. */
export function requireReviewedResponse(audit: Row) {
  // Only the immutable server setting can waive review enforcement. A model
  // cannot opt itself out by copying observation labels into an audit.
  if (responseReviewObservationOnly() && audit.status === 'review_observed'
    && object(audit.review_enforcement).blocking === false) return
  if (object(audit.recovery).pending === true || object(audit.fallback_validation).passed === false)
    throw new ResponseReviewRecoveryError()
}
