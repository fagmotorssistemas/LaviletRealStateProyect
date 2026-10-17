import { object, text, type Row } from './data'
import { acceptedExtractorConfidence } from './extractor-confidence'
import { informationOnly } from './interaction-mode'

const ids = (value: unknown) => Array.isArray(value) ? value.map(text).filter(Boolean) : []
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
export function courtesyQuestionKey(pending: Row): string {
  return JSON.stringify([pending.id, pending.act,
    [...new Set([...ids(pending.target_ids), ...ids(pending.candidate_ids)])].sort(),
    pending.proposed_query || null, pending.amount_reference || null])
}

/** A social acknowledgement is not a closing instruction. Resume only a real
 * delivered decision (once), or a known selected option awaiting continuation.
 * No word recognition, new permissions or CRM-field-driven profile reminders. */
export function courtesyContinuationCandidate(info: Row): Row | null {
  const communication = object(object(info.semantica_turno).communication)
  if (communication.kind !== 'courtesy_only' || !acceptedExtractorConfidence(communication.confidence)
    || !text(communication.evidence).trim() || informationOnly(info)) return null
  if (object(info.reservation_context).active === true
    || ['collecting', 'confirmed', 'awaiting_advisor', 'awaiting_client'].includes(text(object(info.coordinacion_visita).status))
    || rows(info.propuestas).some(proposal => ['confirmed', 'awaiting_advisor', 'awaiting_client'].includes(text(proposal.status)))) return null
  const property = object(info.property_context), memory = object(info.recorrido_comercial)
  const pending = [property.pending_question, info.pregunta_pendiente, object(info.contrato_turno).pending_question]
    .map(object).find(value => text(value.id) && value.id !== 'none' && text(value.question).trim())
  const selected = ids(property.selected_ids)
  const completed = new Set(ids(memory.continued_unit_ids))
  if (pending) {
    // Profile capture has its own one-reminder/refusal policy. Courtesy alone
    // cannot supply the fresh profile declaration required to repeat it.
    if (text(pending.id).startsWith('lead_') || ['brochure_offer', 'showroom_information'].includes(text(pending.id))) return null
    if (text(pending.id).startsWith('visit_') || pending.id === 'reservation_invitation') return null
    if (text(pending.id).startsWith('financing_') && pending.id !== 'financing_invitation') {
      const finance = object(info.financiamiento)
      if (object(finance.current).explicit_consent !== true && object(finance.journey).accepted !== true) return null
    }
    if (pending.id === 'unit_choice' && pending.act === 'confirm_unit'
      && ids(pending.target_ids).length && ids(pending.target_ids).every(id => completed.has(id))) return null
    const key = courtesyQuestionKey(pending)
    if (ids(memory.courtesy_resumed_question_keys).includes(key)) return null
    return { kind: 'delivered_pending_question', key, pending }
  }
  if (selected.length === 1 && !completed.has(selected[0])) return { kind: 'selected_option', selected_unit_id: selected[0] }
  return null
}

export function courtesyPendingPlan(info: Row): Row | null {
  const candidate = courtesyContinuationCandidate(info)
  if (candidate?.kind !== 'delivered_pending_question') return null
  const pending = object(candidate.pending), targets = ids(pending.target_ids), candidates = ids(pending.candidate_ids)
  return { version: 'commercial-journey-v1', action: 'resume_pending_decision',
    communication_kind: 'courtesy_only', question_id: pending.id, question_act: pending.act,
    question: pending.question, continuation_optional: false,
    selection_scope: { unit_ids: candidates.length ? candidates : targets },
    selected_unit_id: targets.length === 1 ? targets[0] : null,
    ...(pending.proposed_query ? { proposed_query: pending.proposed_query, alternative_unit_ids: candidates } : {}),
    ...(pending.amount_reference ? { question_amount_reference: pending.amount_reference } : {}),
    courtesy_question_key: candidate.key, financing_offer_allowed: false, visit_offer_allowed: false,
    instruction: 'Reconozca brevemente el agradecimiento y retome una sola vez la decisión realmente pendiente con sus mismos referentes. Formule la pregunta con naturalidad y sin repetir la ficha del inmueble, la bienvenida, el brochure ni datos ya conocidos. Agradecer no acepta ni rechaza esa decisión y no autoriza una reserva, visita o financiamiento. No invente otro objetivo ni narre estados internos.' }
}
