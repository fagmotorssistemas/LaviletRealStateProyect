import { object, text, type Row } from './data'

const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const categories = ['suite', 'departamento', 'penthouse', 'local']

/** Follow-up relevance comes from the already interpreted conversation. A word
 * in a refusal is not a fresh request, and tracking consent is not contact
 * permission for an explicitly postponed purchase. */
export function nutritionIntent(lead: Row, summary: Row = {}) {
  const turn = object(summary._turn_intent), journey = object(summary._commercial_journey)
  const sales = object(summary._sales_memory), financing = object(summary._financing_journey)
  const visit = object(summary._visit_dialogue)
  const mode = object(summary._interaction_mode || sales.interaction_mode)
  const requests = rows(turn.requests)
  const topics = new Set(requests.flatMap(request => Array.isArray(request.topics) ? request.topics.map(text) : []))
  const informational = mode.mode === 'information_only'
  const financingDeclined = financing.status === 'declined' || financing.accepted === false
  const visitsDeclined = visit.status === 'declined' || visit.status === 'cancellation_requested'
    || journey.visit_declined === true || sales.visit_declined === true
  const property = object(object(summary._interpretation_memory).property)
  const category = [object(turn.subject).category, property.category, lead.preferred_category]
    .map(text).find(value => categories.includes(value)) || ''
  return {
    informational, topics, category,
    financing: !informational && !financingDeclined && (turn.objective === 'ask_financing'
      || requests.some(request => request.domain === 'financing')
      || ['financing', 'monthly_payment', 'financing_process', 'credit_approval'].some(topic => topics.has(topic))),
    visits: !informational && !visitsDeclined && (turn.objective === 'request_visit'
      || requests.some(request => request.domain === 'visit')),
    budget: !informational && turn.objective === 'discuss_budget'
      && !['declines_to_disclose', 'amount_pending', 'no_defined_budget'].includes(text(object(turn.budget).status)),
    purchasePurpose: text(lead.purchase_purpose),
  }
}

export function nutritionUnitLabel(category: unknown) {
  return ({ suite: 'la suite', local: 'el local', penthouse: 'el penthouse', departamento: 'el departamento' } as Record<string, string>)[text(category)] || 'la unidad'
}

/** An explicit future horizon is a pause, even before contact permission has
 * been granted. Only a separately saved valid timestamp can schedule a return;
 * free text such as "next year" is never converted into an invented date. */
export function nutritionContactPolicy(raw: unknown) {
  const state = object(raw)
  const explicitDecline = state.contact_consent === false && !!text(state.contact_evidence).trim()
  if (explicitDecline) return { reason: 'contact_permission_declined', resumeAt: null }
  const paused = state.future_interest === true || state.active === true
  const hasDate = state.resume_at != null && text(state.resume_at).trim() !== ''
  if (!paused && !hasDate) return { reason: '', resumeAt: null }
  if (state.contact_consent !== true) return { reason: 'future_contact_permission_required', resumeAt: null }
  const resumeAt = Date.parse(text(state.resume_at))
  if (!Number.isFinite(resumeAt)) return { reason: 'future_contact_date_required', resumeAt: null }
  return { reason: '', resumeAt }
}

export function nutritionAnchorTime(anchor: number, resumeAt: number | null, week: 0 | 1 | 2 | 3) {
  const routine = anchor + (week === 0 ? 1 : week * 7) * 86_400_000
  return resumeAt === null ? routine : Math.max(routine, resumeAt + Math.max(0, week - 1) * 7 * 86_400_000)
}
