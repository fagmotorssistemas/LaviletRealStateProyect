import { object, text, type Row } from './data'
import { replyQuestions } from './reply-question'
import { normalizedPendingQuestion, pendingQuestionFromReply, questionActs, questionIds } from './turn-semantics'

/** Shared by writer and reviewer. Meaning belongs to the emitted CTA, not the plan. */
export const continuationQuestionProperties = {
  continuation_id: { type: 'string', enum: [...questionIds, 'none'],
    description: 'Significado de la última pregunta efectivamente escrita. brochure_offer solo ofrece enviar el brochure. none si no hay una continuación identificable; no copie el ID del plan si cambió la pregunta.' },
  continuation_act: { type: 'string', enum: [...questionActs],
    description: 'Acto de esa pregunta: elegir, confirmar, explorar alternativas, recopilar, ofrecer material u otro. No autoriza una operación.' },
}
export const CONTINUATION_QUESTION_RULE = 'question.continuation_id y continuation_act describen la última pregunta real de reply, no la pregunta prevista ni el tema del párrafo anterior. Una invitación a ver opciones no acepta financiamiento, reserva ni selecciona una unidad. Conserve el objetivo obligatorio; el revisor corrige estos metadatos según el texto.'

export function continuationMetadata(raw: unknown): Row {
  const row = object(raw)
  if (!Object.hasOwn(row, 'continuation_id')) return {}
  const id = questionIds.includes(row.continuation_id as typeof questionIds[number]) ? text(row.continuation_id) : 'none'
  const act = questionActs.has(text(row.continuation_act)) ? text(row.continuation_act) : 'other'
  const requiredAct = id.startsWith('lead_') ? 'profile' : id.startsWith('financing_') ? 'financing'
    : id.startsWith('budget_') ? 'budget' : id.startsWith('visit_') ? 'visit'
    : id === 'reservation_invitation' ? 'reservation' : id === 'brochure_offer' ? 'material' : null
  return { continuation_id: requiredAct && act !== requiredAct ? 'none' : id, continuation_act: act }
}

const same = (a: unknown, b: unknown) => text(a).replace(/\s+/g, ' ').trim().toLocaleLowerCase() === text(b).replace(/\s+/g, ' ').trim().toLocaleLowerCase()
const ids = (value: unknown) => Array.isArray(value) ? value.map(text).filter(Boolean) : []
const collectionIds = new Set(['lead_profile', 'lead_profile_name', 'lead_profile_residence', 'lead_residence_confirmation', 'financing_data'])
/** Semantic metadata can identify a question without carrying its referent.
 * Combine only receipts for that same emitted question and meaning; an empty
 * semantic receipt must not hide the catalogue receipt's verified scope. */
function matchingReceiptScope(candidates: Row[]): Row {
  const result: Row = {}
  for (const key of ['target_ids', 'candidate_ids'] as const) {
    const values = candidates.map(candidate => ids(candidate[key])).filter(value => value.length)
    if (!values.length) continue
    const signatures = new Set(values.map(value => JSON.stringify([...value].sort())))
    // Contradictory non-empty receipts cannot silently choose or widen a set.
    result[key] = signatures.size === 1 ? values[0] : []
  }
  const queries = candidates.map(candidate => object(candidate.proposed_query)).filter(query => Object.keys(query).length)
  if (queries.length) result.proposed_query = new Set(queries.map(query => JSON.stringify(query))).size === 1 ? queries[0] : {}
  const residences = candidates.map(candidate => object(candidate.residence_candidate)).filter(candidate => Object.keys(candidate).length)
  if (residences.length) result.residence_candidate = new Set(residences.map(candidate => JSON.stringify(candidate))).size === 1 ? residences[0] : null
  return result
}
function purposeSupports(id: unknown, purpose: unknown) {
  if (!purpose) return true // Delivered legacy questions have no metadata sheet.
  if (text(id).startsWith('lead_')) return purpose === 'collect_lead_profile'
  if (id === 'financing_partner') return purpose === 'choose_financing_partner' || purpose === 'collect_financing_required'
  if (id === 'financing_data') return purpose === 'collect_financing_required'
  if (id === 'brochure_offer') return purpose === 'offer_verified_material'
  if (text(id).startsWith('visit_')) return purpose === 'coordinate_visit' || purpose === 'permission_to_continue'
  if (['financing_invitation', 'reservation_invitation'].includes(text(id))) return purpose === 'permission_to_continue'
  return ['choose_property', 'clarify_request', 'permission_to_continue'].includes(text(purpose))
}

/** Resolve once, after final formatting; only a successfully sent receipt is persisted. */
export function deliveredPendingQuestion(reply: string, input: { metadata?: unknown; plan?: unknown; candidates?: Row[] } = {}, catalog?: Row[]): Row {
  const questions = replyQuestions(reply)
  if (!questions.length) return {}
  const question = questions.join(' '), metadata = object(input.metadata), plan = object(input.plan)
  const semantic = continuationMetadata(metadata)
  if (Object.keys(semantic).length && metadata.text && !same(metadata.text, question)) return {}
  const matchingQuestions = (input.candidates || []).filter(candidate =>
    (same(candidate.question, question) || questions.length > 1 && same(candidate.question, questions.at(-1)))
    && purposeSupports(candidate.id, metadata.purpose))
    .map(candidate => normalizedPendingQuestion({ ...candidate, question }, catalog))
    .filter(candidate => candidate.id)
  const matchingQuestion = matchingQuestions.find(candidate => !Object.keys(semantic).length
    || candidate.id === semantic.continuation_id && candidate.act === semantic.continuation_act) || {}
  // Several fields may share one required collection (legal name, document,
  // employment). Keep that collection, never infer consent to several actions.
  if (questions.length > 1 && !collectionIds.has(text(Object.keys(semantic).length
    ? semantic.continuation_id : matchingQuestion.id))) return {}
  let pending: Row
  if (Object.keys(semantic).length && (!metadata.text || same(metadata.text, question))) {
    if (semantic.continuation_id === 'none') return {}
    pending = normalizedPendingQuestion({ id: semantic.continuation_id, act: semantic.continuation_act, question })
  } else {
    // Compatibility for historical/transport-only drafts: never label arbitrary
    // prose with the planned ID. Exact planned wording or actual-text meaning is required.
    const inferred = pendingQuestionFromReply(question)
    const planned = same(plan.question, question) ? { id: plan.question_id, act: plan.question_act, question } : {}
    pending = normalizedPendingQuestion(Object.keys(planned).length ? planned : Object.keys(matchingQuestion).length
      ? { ...matchingQuestion, question } : inferred)
  }
  if (!pending.id || !purposeSupports(pending.id, metadata.purpose)) return {}
  const matching = matchingReceiptScope(matchingQuestions.filter(candidate => candidate.id === pending.id && candidate.act === pending.act))
  const planMatches = plan.question_id === pending.id && (!plan.question_act || plan.question_act === pending.act)
  const scope = object(plan.selection_scope)
  const scoped: Row = planMatches ? {
    target_ids: plan.selected_unit_id ? [plan.selected_unit_id] : pending.act === 'confirm_unit' ? ids(scope.unit_ids) : [],
    candidate_ids: ids(pending.act === 'explore_alternatives' ? plan.alternative_unit_ids : scope.unit_ids),
    ...(pending.act === 'explore_alternatives' && plan.proposed_query ? { proposed_query: plan.proposed_query } : {}),
  } : {}
  return normalizedPendingQuestion({ ...scoped, ...pending, ...matching,
    target_ids: matching.target_ids ?? scoped.target_ids ?? pending.target_ids,
    candidate_ids: matching.candidate_ids ?? scoped.candidate_ids ?? pending.candidate_ids }, catalog)
}
