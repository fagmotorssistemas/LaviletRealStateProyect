import { object, text, type Row } from './data'
import { normalized } from './sdr-rules'
import { replyQuestionText } from './reply-question'
import { continuationMetadata } from './continuation-question'
import { pendingQuestionFromReply } from './turn-semantics'

/** A bounded recognition of the emitted question; an unknown paraphrase remains
 * unknown rather than receiving the planned meaning automatically. */
export function actualContinuation(reply: string): Row {
  const question = replyQuestionText(reply), value = normalized(question)
  if (!question) return {}
  const inferred = pendingQuestionFromReply(reply)
  const name = /\b(?:su nombre|tu nombre|como (?:se llama|te llamas)|con (?:que|cual) nombre|con quien (?:tenemos|tengo) el gusto)\b/.test(value)
  const residence = /\bresid(?:e|es|en|ir)\b|\b(?:su|tu|lugar de) residencia\b|\bresidencia (?:actual|habitual)\b|\b(?:donde|en que (?:ciudad|pais|lugar)).*\bviv(?:e|es|en|ir)\b/.test(value)
  if (name || residence) return { id: name && residence ? 'lead_profile' : name ? 'lead_profile_name'
    : /tambien.*resid|resid.*tambien/.test(value) ? 'lead_residence_confirmation' : 'lead_profile_residence', act: 'profile', question }
  if (/\bvivir\b.*\b(?:invertir|inversion)\b|\b(?:invertir|inversion)\b.*\bvivir\b/.test(value))
    return { id: 'property_purpose', act: 'choose_category', question }
  if (['property_floor', 'unit_choice', 'budget_amount', 'budget_kind', 'visit_date_time'].includes(text(inferred.id))
    || inferred.id === 'property_category' && /\bo\b/.test(value)) return inferred
  if (/dormitorios?|habitaciones?|cuartos?/.test(value) && /revis|explor|evalu|acept|consider/.test(value)
    && !/\bcual|\bque tipo|\bprefier/.test(value)) return { id: 'property_requirements', act: 'explore_alternatives', question }
  return inferred
}
function matchingMeaning(a: Row, b: Row) {
  return a.id === b.id && (a.act === b.act || ['property_purpose', 'property_bedrooms', 'property_area', 'purchase_timing'].includes(text(a.id))) || a.act === 'explore_alternatives' && b.act === 'explore_alternatives'
    && ['property_bedrooms', 'property_requirements'].includes(text(a.id)) && ['property_bedrooms', 'property_requirements'].includes(text(b.id))
}
function purposeMatches(id: string, purpose: string) {
  if (id.startsWith('lead_')) return purpose === 'collect_lead_profile'
  if (id === 'financing_partner') return ['choose_financing_partner', 'collect_financing_required'].includes(purpose)
  if (id === 'financing_data') return purpose === 'collect_financing_required'
  if (id === 'brochure_offer') return purpose === 'offer_verified_material'
  if (id.startsWith('visit_')) return ['coordinate_visit', 'permission_to_continue'].includes(purpose)
  if (['financing_invitation', 'reservation_invitation'].includes(id)) return purpose === 'permission_to_continue'
  return ['choose_property', 'clarify_request', 'permission_to_continue'].includes(purpose)
}
export function continuationMetadataIssues(raw: unknown, reply: string, plan: unknown = {}): string[] {
  const row = object(raw), semantic = continuationMetadata(row), question = replyQuestionText(reply)
  if (!question) return row.continuation_id && row.continuation_id !== 'none' ? ['question_metadata_without_question'] : []
  if (!Object.hasOwn(row, 'continuation_id')) return []
  const issues: string[] = []
  const compatibleActs: Record<string, string[]> = {
    property_purpose: ['choose_category', 'other'], property_category: ['choose_category'], property_floor: ['choose_floor'],
    property_bedrooms: ['other', 'confirm_bedrooms', 'explore_alternatives'], property_requirements: ['other', 'confirm_bedrooms', 'explore_alternatives'],
    property_area: ['other'], purchase_timing: ['other'], unit_choice: ['choose_unit', 'confirm_unit', 'show_unit_details', 'explore_quoted_options'],
  }
  if (compatibleActs[text(row.continuation_id)] && !compatibleActs[text(row.continuation_id)].includes(text(row.continuation_act)))
    issues.push('question_metadata_act_mismatch')
  if (semantic.continuation_id !== row.continuation_id || semantic.continuation_id === 'none') issues.push('question_metadata_act_mismatch')
  if (row.continuation_id !== 'none' && !purposeMatches(text(row.continuation_id), text(row.purpose))) issues.push('question_metadata_purpose_mismatch')
  const actual = actualContinuation(reply), expected = object(plan)
  // A legal financing-name collection is not the introductory profile exchange.
  const financingCollection = row.continuation_id === 'financing_data' && (expected.action === 'current_operation' || expected.action === 'continue_financing')
  if (actual.id && !financingCollection && !matchingMeaning(actual, { id: semantic.continuation_id, act: semantic.continuation_act }))
    issues.push('question_metadata_text_mismatch')
  return [...new Set(issues)]
}
export function validContinuationMetadata(raw: unknown, reply: string, plan: unknown = {}): boolean {
  const row = object(raw)
  return !!replyQuestionText(reply) && !!row.continuation_id && row.continuation_id !== 'none'
    && continuationMetadataIssues(row, reply, plan).length === 0
}
/** Validate content against the shared next step even when the reviewer passes.
 * Do not infer a decision from the tag attached to a different actual question. */
export function continuationContentIssues(reply: string, planRaw: unknown): Row[] {
  const plan = object(planRaw), expectedId = text(plan.question_id)
  if (!expectedId || !text(plan.question)) return []
  const actual = actualContinuation(reply), question = replyQuestionText(reply)
  const expected = { id: expectedId, act: text(plan.question_act) || text(object(pendingQuestionFromReply(text(plan.question))).act) }
  const different = !!actual.id && !matchingMeaning(actual, expected)
  if (question && !different) return []
  return [{ code: question ? 'commercial_next_question_mismatch' : 'commercial_next_question_missing',
    kind: 'commercial_content', owner: 'system', repair_owner: 'writer', field: 'commercial_next_step', statement: question,
    reason: question ? 'La pregunta real cambia la decisión pendiente del plan comercial compartido.' : 'El mensaje omite la decisión pendiente del plan comercial compartido.',
    instruction: 'Conserve la respuesta válida y formule una pregunta equivalente a siguiente_paso_comercial.question, sin repetir datos ya conocidos ni saltar decisiones.',
    authoritative_fact: JSON.stringify({ action: plan.action, question_id: expectedId, question_act: plan.question_act, question: plan.question }) }]
}
