import { object, text, type Row } from './data'

// Unknown failures remain blocking. Only explicitly auxiliary metadata is advisory.
const auxiliaryCodes = new Set(['invalid_review_question_metadata'])
export function reviewDisposition(issues: Row[]) {
  const warnings = issues.filter(issue => auxiliaryCodes.has(text(issue.code))
    && issue.kind === 'follow_up_metadata')
  const blocking = issues.filter(issue => !warnings.includes(issue))
  return { blocking, warnings, content_approved: blocking.length === 0,
    follow_up_usable: warnings.length === 0 }
}

/** A send approval never grants permission to advance state from a faulty sheet. */
export function followUpUsable(audit: Row) {
  const delivery = object(audit.delivery_integrity)
  const coverage = delivery.status === 'revalidated' ? object(delivery.review) : object(audit.turn_completeness || audit)
  return object(coverage.follow_up).usable !== false
}

/** Prevent the next turn from rebuilding a discarded action from prose. The
 * extractor still receives the real conversation and interprets the new input. */
export function pendingFollowUpNeedsInterpretation(summary: Row, lastReply: string) {
  const tracking = object(summary._follow_up_review)
  return tracking.usable === false && tracking.reply === lastReply
}
