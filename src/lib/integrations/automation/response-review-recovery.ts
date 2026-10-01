import { object, type Row } from './data'

export class ResponseReviewRecoveryError extends Error {
  constructor() { super('RESPONSE_REVIEW_EXHAUSTED') }
}

/** Operational recovery is distinct from an AI-inferred commercial data gap.
 * The worker checks freshness/permissions and queues the advisor before notice. */
export function requireReviewedResponse(audit: Row) {
  if (object(audit.recovery).pending === true || object(audit.fallback_validation).passed === false)
    throw new ResponseReviewRecoveryError()
}
