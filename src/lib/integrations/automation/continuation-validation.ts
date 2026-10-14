import { object, text, type Row } from './data'
import { normalized } from './sdr-rules'
import { replyQuestionText } from './reply-question'
import { continuationMetadata } from './continuation-question'
import { pendingQuestionFromReply } from './turn-semantics'
import { categoryInvitationTarget } from './category-offer'
import { operationalFinancingInvitation } from './financing-invitation'
import { actualFinancingEntryQuestion } from './financing-entry'

/** A bounded recognition of the emitted question; an unknown paraphrase remains
 * unknown rather than receiving the planned meaning automatically. */
export function actualContinuation(reply: string): Row {
  const question = replyQuestionText(reply), value = normalized(question)
  if (!question) return {}
  const entryCollection = actualFinancingEntryQuestion(reply)
  if (entryCollection) return entryCollection
  if (/\bo\b/.test(value) && /\b(?:reserva|reservar|separacion|separar)\b/.test(value)
    && /\b(?:visita|cita|financiamiento|credito)\b/.test(value)) return {}
  const inferred = pendingQuestionFromReply(reply)
  if (operationalFinancingInvitation(reply)) return { id: 'financing_invitation', act: 'financing', question }
  if (inferred.id === 'financing_down_payment') return inferred
  const name = /\b(?:su nombre|tu nombre|como (?:se llama|te llamas)|con (?:que|cual) nombre|con quien (?:tenemos|tengo) el gusto)\b/.test(value)
  const residence = /\bresid(?:e|es|en|ir)\b|\b(?:su|tu|lugar de) residencia\b|\bresidencia (?:actual|habitual)\b|\b(?:donde|en que (?:ciudad|pais|lugar)).*\bviv(?:e|es|en|ir)\b/.test(value)
  if (name || residence) return { id: name && residence ? 'lead_profile' : name ? 'lead_profile_name'
    : /tambien.*resid|resid.*tambien/.test(value) ? 'lead_residence_confirmation' : 'lead_profile_residence', act: 'profile', question }
  if (/\bvivir\b.*\b(?:invertir|inversion)\b|\b(?:invertir|inversion)\b.*\bvivir\b/.test(value))
    return { id: 'property_purpose', act: 'choose_category', question }
  if (categoryInvitationTarget(question)) return { id: 'property_category', act: 'choose_category', question }
  if (['property_floor', 'unit_choice', 'budget_amount', 'budget_kind', 'visit_date_time'].includes(text(inferred.id))
    || inferred.id === 'property_category' && /\bo\b/.test(value)) return inferred
  if (/dormitorios?|habitaciones?|cuartos?/.test(value) && /revis|explor|evalu|acept|consider/.test(value)
    && !/\bcual|\bque tipo|\bprefier/.test(value)) return { id: 'property_requirements', act: 'explore_alternatives', question }
  return inferred
}
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
  const row = object(raw), semantic = continuationMetadata(row), question = replyQuestionText(reply)
  if (!question) return row.continuation_id && row.continuation_id !== 'none' ? ['question_metadata_without_question'] : []
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
  return !!replyQuestionText(reply) && !!row.continuation_id && row.continuation_id !== 'none'
    && continuationMetadataIssues(row, reply, plan).length === 0
}
/** Repair only a meaning recognized in the emitted text. Never copy a planned ID
 * onto an unknown question, and never let this classifier execute an action. */
export function reconcileContinuationMetadata(raw: unknown, reply: string, planRaw: unknown = {}): { question: Row; corrected: boolean; original_issues: string[] } {
  const row = object(raw), plan = object(planRaw)
  const original = continuationMetadataIssues(row, reply, plan)
  if (validContinuationMetadata(row, reply, plan)) return { question: row, corrected: false, original_issues: original }
  const actual = actualContinuation(reply), id = text(actual.id)
  if (!id || !text(actual.act)) return { question: row, corrected: false, original_issues: original }
  const purpose = id.startsWith('lead_') ? 'collect_lead_profile'
    : id === 'financing_partner' ? 'choose_financing_partner'
    : id === 'financing_data' || id === 'financing_down_payment' ? 'collect_financing_required'
    : id === 'brochure_offer' ? 'offer_verified_material'
    : id.startsWith('visit_') ? 'coordinate_visit'
    : ['financing_invitation', 'reservation_invitation'].includes(id) ? 'permission_to_continue'
    : id === 'budget_kind' ? 'clarify_request' : 'choose_property'
  const role = id.startsWith('lead_') || id === 'financing_data' || id === 'financing_down_payment' ? 'required_collection'
    : id === 'budget_kind' ? 'necessary_clarification' : 'optional_continuation'
  const question = { ...row, text: text(actual.question), purpose, role,
    missing_datum: role === 'optional_continuation' ? '' : id,
    next_decision: 'Continuar según la respuesta a la pregunta realmente enviada.',
    continuation_id: id, continuation_act: actual.act }
  if (!validContinuationMetadata(question, reply, plan)) return { question: row, corrected: false, original_issues: original }
  return { question, corrected: true, original_issues: original }
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
