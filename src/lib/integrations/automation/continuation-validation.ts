import { continuationMetadata } from './continuation-question'
import { object,text,type Row } from './data'

/** Retired language classifier; the writer supplies typed question metadata. */
export function actualContinuation(_reply: string): Row { void _reply;  return {} }
function purposeMatches(id: string, purpose: string) {
  if (id.startsWith('lead_')) return purpose === 'collect_lead_profile'
  if (id === 'financing_partner') return ['choose_financing_partner', 'collect_financing_required'].includes(purpose)
  if (id === 'financing_data' || id === 'financing_down_payment') return purpose === 'collect_financing_required'
  if (id === 'brochure_offer') return purpose === 'offer_verified_material'
  if (id.startsWith('visit_')) return ['coordinate_visit', 'permission_to_continue'].includes(purpose)
  if (['financing_invitation', 'reservation_invitation'].includes(id)) return purpose === 'permission_to_continue'
  return ['choose_property', 'clarify_request', 'permission_to_continue'].includes(purpose)
}
export function continuationMetadataIssues(raw: unknown, reply: string, _plan: unknown = {}): string[] {
  void _plan
  const row = object(raw), semantic = continuationMetadata(row), question = text(row.text).trim()
  if (!question || !reply.includes(question)) return row.continuation_id && row.continuation_id !== 'none' ? ['question_metadata_without_delivered_text'] : []
  if (!Object.hasOwn(row, 'continuation_id')) return []
  const issues: string[] = []
  const compatibleActs: Record<string, string[]> = {
    property_purpose: ['choose_category', 'other'], property_category: ['choose_category'], property_floor: ['choose_floor'],
    property_bedrooms: ['other', 'confirm_bedrooms', 'explore_alternatives'], property_requirements: ['other', 'confirm_bedrooms', 'explore_alternatives'],
    property_area: ['other'], property_priority: ['confirm_priority'], purchase_timing: ['other'], unit_choice: ['choose_unit', 'confirm_unit', 'show_unit_details', 'explore_quoted_options'],
  }
  if (compatibleActs[text(row.continuation_id)] && !compatibleActs[text(row.continuation_id)].includes(text(row.continuation_act)))
    issues.push('question_metadata_act_mismatch')
  if (semantic.continuation_id !== row.continuation_id || semantic.continuation_id === 'none') issues.push('question_metadata_act_mismatch')
  if (row.continuation_id !== 'none' && !purposeMatches(text(row.continuation_id), text(row.purpose))) issues.push('question_metadata_purpose_mismatch')
  return [...new Set(issues)]
}
export function validContinuationMetadata(raw: unknown, reply: string, plan: unknown = {}): boolean {
  const row = object(raw)
  return !!text(row.text).trim() && !!row.continuation_id && row.continuation_id !== 'none'
    && continuationMetadataIssues(row, reply, plan).length === 0
}
/** Validate metadata without interpreting or repairing writer language. */
export function reconcileContinuationMetadata(raw: unknown, reply: string, planRaw: unknown = {}): { question: Row; corrected: boolean; original_issues: string[] } {
  const row = object(raw)
  return { question: row, corrected: false, original_issues: continuationMetadataIssues(row, reply, planRaw) }
}

/** Historical API retained without lexical conversational vetoes. */
export function continuationContentIssues(_reply: string, _planRaw: unknown): Row[] {
  void _reply; void _planRaw
  // Compatibility for diagnostic consumers of older executions. The server
  // no longer judges a writer's question with its limited vocabulary.
  return []
}

/** Historical API retained without automatic additions to customer messages. */
export function completeRequiredContinuation(reply: string, _planRaw: unknown): { reply: string; audit: Row | null } {
  void _planRaw
  return { reply, audit: null }
}
