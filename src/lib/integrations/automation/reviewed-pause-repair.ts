import { object, text, type Row } from './data'

/** One-off repair of a reviewed, exact historical decision. This is not a
 * runtime classifier: no phrase pattern decides whether a customer paused. */
export function reviewedPauseRepair(summary: Row, reviewed: { evidence: string; sourceEventId: string }, at: string) {
  const prior = object(summary._interaction_mode), sales = object(summary._sales_memory)
  const nested = object(sales.interaction_mode)
  const paused = [prior, nested].filter(mode => mode.mode === 'information_only')
  if (!reviewed.evidence || !reviewed.sourceEventId || !paused.length)
    return { applicable: false, reason: 'no_reviewed_pause', summary }
  if (object(summary._lead_nurture).active === true)
    return { applicable: false, reason: 'active_nurture', summary }
  if (paused.some(mode => mode.qualification_decision === 'pause' || text(mode.evidence) !== reviewed.evidence))
    return { applicable: false, reason: 'pause_changed_since_review', summary }
  const repaired: Row = { version: 'interaction-mode-v2', mode: 'guided_search', qualification_decision: 'unchanged', evidence: null,
    correction: { reason: 'reviewed_information_request_misclassified', source_event_id: reviewed.sourceEventId,
      previous_evidence: reviewed.evidence, corrected_at: at } }
  return { applicable: true, reason: 'reviewed_information_request', summary: { ...summary,
    _interaction_mode: repaired,
    ...(Object.keys(sales).length ? { _sales_memory: { ...sales, interaction_mode: repaired,
      ...(nested.mode === 'information_only' ? { passive_sales: false } : {}) } } : {}) } }
}
