import { object, text, type Row } from './data'
import { normalizedPendingQuestion, questionActs, questionIds } from './turn-semantics'

/** Shared by writer and reviewer. Meaning belongs to the emitted CTA, not the plan. */
export const continuationQuestionProperties = {
  comparison_categories: { type: 'array', items: { type: 'string', enum: ['suite', 'departamento', 'penthouse', 'local'] }, description: 'Solo al ofrecer comparar categorías: los tipos que efectivamente propone comparar. [] en las demás preguntas.' },
  comparison_bedrooms: { type: ['integer', 'null'], description: 'Dormitorios de las opciones que propone comparar, o null; no establece una preferencia nueva del cliente.' },
  continuation_id: { type: 'string', enum: [...questionIds, 'none'],
    description: 'Significado de la última pregunta efectivamente escrita. brochure_offer solo ofrece enviar el brochure. none si no hay una continuación identificable; no copie el ID del plan si cambió la pregunta.' },
  continuation_act: { type: 'string', enum: [...questionActs],
    description: 'Acto de esa pregunta: elegir, confirmar, explorar alternativas, recopilar, ofrecer material u otro. No autoriza una operación.' },
}
export const CONTINUATION_QUESTION_RULE = 'El redactor es responsable de que question.text, continuation_id y continuation_act describan fielmente la última pregunta o invitación que efectivamente escribió en reply, no la prevista ni el tema anterior. Copie esa pregunta en question.text; si no escribió ninguna, use text vacío y continuation_id=none. El código guarda estos metadatos estructurados y no interpreta ni corrige la redacción. Al ofrecer comparar dos tipos de inmueble use property_comparison y compare_properties, indique comparison_categories y comparison_bedrooms de esas opciones. No registre esa invitación como elegir categoría o dormitorios. Si el cliente ya aceptó, realice la comparación completa sin volver a solicitar permiso. Una invitación a ver opciones no acepta financiamiento, reserva ni selecciona una unidad. Conserve el objetivo obligatorio.'

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

const ids = (value: unknown) => Array.isArray(value) ? value.map(text).filter(Boolean) : []
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
  const amounts = candidates.map(candidate => object(candidate.amount_reference)).filter(candidate => Object.keys(candidate).length)
  if (amounts.length) result.amount_reference = new Set(amounts.map(candidate => JSON.stringify(candidate))).size === 1 ? amounts[0] : null
  return result
}
function purposeSupports(id: unknown, purpose: unknown) {
  if (!purpose) return true // Delivered legacy questions have no metadata sheet.
  if (text(id).startsWith('lead_')) return purpose === 'collect_lead_profile'
  if (id === 'financing_partner') return purpose === 'choose_financing_partner' || purpose === 'collect_financing_required'
  if (id === 'financing_data' || id === 'financing_down_payment') return purpose === 'collect_financing_required'
  if (id === 'brochure_offer') return purpose === 'offer_verified_material'
  if (text(id).startsWith('visit_')) return purpose === 'coordinate_visit' || purpose === 'permission_to_continue'
  if (['financing_invitation', 'reservation_invitation'].includes(text(id))) return purpose === 'permission_to_continue'
  return ['choose_property', 'clarify_request', 'permission_to_continue'].includes(text(purpose))
}

/** Persist the writer's typed continuation. Customer-facing prose is opaque:
 * only the writer identifies its question, meaning and act. This receipt does
 * not execute an action or turn a future affirmation into authorization. */
export function deliveredPendingQuestion(reply: string, input: { metadata?: unknown; plan?: unknown; candidates?: Row[] } = {}, catalog?: Row[]): Row {
  void reply
  const metadata = object(input.metadata), plan = object(input.plan)
  const semantic = continuationMetadata(metadata)
  const question = text(metadata.text).trim(), id = text(semantic.continuation_id), act = text(semantic.continuation_act)
  if (!question || !id || id === 'none' || id !== metadata.continuation_id || act !== metadata.continuation_act
    || !questionActs.has(act) || !purposeSupports(id, metadata.purpose)) return {}
  const matching = matchingReceiptScope([metadata, ...(input.candidates || []).filter(candidate =>
    candidate.id === id && candidate.act === act)])
  const planMatches = plan.question_id === id && plan.question_act === act
  const scope = object(plan.selection_scope)
  const scoped: Row = planMatches ? {
    ...(id === 'budget_amount' ? { budget_basis: 'total_budget' } : {}),
    target_ids: plan.selected_unit_id ? [plan.selected_unit_id] : act === 'confirm_unit' ? ids(scope.unit_ids) : [],
    candidate_ids: ids(act === 'explore_alternatives' ? plan.alternative_unit_ids : scope.unit_ids),
    ...(['explore_alternatives', 'confirm_bedrooms', 'choose_category', 'choose_floor'].includes(act)
      && plan.proposed_query ? { proposed_query: plan.proposed_query } : {}),
  } : {}
  const validIds = new Set((catalog || []).map(unit => text(unit.id)))
  const verifiedIds = (value: unknown) => ids(value).filter(value => validIds.has(value))
  const reference = object(matching.amount_reference || (planMatches ? plan.question_amount_reference : undefined))
  const amountReference = id === 'financing_down_payment' && reference.kind === 'proposed_down_payment'
    && reference.original_role === 'total_budget' && typeof reference.amount === 'number'
    && Number.isFinite(reference.amount) && reference.amount > 0 && text(reference.evidence).trim() ? {
      ...reference, question_source: question, delivered_question: question,
      resolution: 'writer_structured_total_budget_entry_proposal',
    } : undefined
  const pending = normalizedPendingQuestion({ ...scoped, ...matching,
    id, act, question, comparison_categories: metadata.comparison_categories, comparison_bedrooms: metadata.comparison_bedrooms,
    target_ids: verifiedIds(matching.target_ids ?? scoped.target_ids),
    candidate_ids: verifiedIds(matching.candidate_ids ?? scoped.candidate_ids), amount_reference: amountReference }, catalog)
  if (pending.act === 'confirm_bedrooms' && !Object.keys(object(pending.proposed_query)).length && catalog) {
    const subjectIds = ids(pending.target_ids).length ? ids(pending.target_ids) : ids(pending.candidate_ids)
    const subjects = catalog.filter(unit => subjectIds.includes(text(unit.id)))
    const bedrooms = [...new Set(subjects.map(unit => unit.bedrooms))]
    if (subjectIds.length && subjects.length === subjectIds.length && bedrooms.length === 1
      && typeof bedrooms[0] === 'number' && bedrooms[0] > 0) pending.proposed_query = {
      group: 'residential', operation: 'search', scope: 'offered', selector: null, filters: { bedrooms: bedrooms[0] },
    }
  }
  return pending
}
