import { object, text, type Row } from './data'
import { asksUnitPrice } from './price-reply'

const rows = (value: unknown) => (Array.isArray(value) ? value : []).map(object)

/** Shared interpretation, not permission to execute an appointment or financing action. */
export function resolveTurnIntent(input: { current: string; history?: unknown; semantics: Row; requests: Row[]; scope: Row; previous?: unknown; profilePending?: boolean; pendingQuestion?: unknown }) {
  const previous = object(input.previous), property = object(input.semantics.property)
  const answer = object(input.semantics.answer_to_previous), pending = object(input.pendingQuestion)
  const interpretedProperty = input.semantics.confidence === 'high' && input.requests.some(request => request.domain === 'property' && request.confidence === 'high')
  const inScope = !input.scope.uncertain && (['property', 'mixed'].includes(text(input.scope.kind)) || input.scope.kind === 'neutral' && interpretedProperty)
  const explicitPrice = inScope && (input.semantics.primary_intent === 'ask_price' || asksUnitPrice(input.current, true))
  const requestsPrice = input.requests.some(request => request.domain === 'property' && request.confidence === 'high' && asksUnitPrice(text(request.request), true))
  const categoryAnswer = ['select_property', 'answer_previous'].includes(text(input.semantics.primary_intent))
    && property.confidence === 'high' && (text(property.category) || Array.isArray(property.unit_numbers) && property.unit_numbers.length > 0)
    && !input.requests.some(request => request.confidence === 'high' && !['property', 'courtesy'].includes(text(request.domain)))
  // A legacy conversation may predate the durable contract. Require both the
  // current interpreted price request and a recent customer's price request.
  const recentClients = rows(input.history).filter(row => ['cliente', 'user'].includes(text(row.role)) && text(row.content) !== input.current).slice(-2)
  const historicalPrice = requestsPrice && recentClients.some(row => asksUnitPrice(text(row.content)))
  const answersPropertyReference = answer.kind === 'value' && answer.question_id === pending.id
    && ['property_category', 'unit_choice', 'property_floor', 'property_bedrooms', 'property_area'].includes(text(pending.id))
  const inheritedPrice = inScope && !explicitPrice && categoryAnswer
    && (previous.continuation_goal === 'ask_price' || historicalPrice)
    && (input.semantics.primary_intent === 'select_property' || answersPropertyReference || requestsPrice)
  const objective = !inScope ? input.scope.uncertain ? 'clarify_scope' : text(input.scope.kind)
    : explicitPrice || inheritedPrice ? 'ask_price' : text(input.semantics.primary_intent) || 'other'
  const requiredFacts = inScope && (objective === 'ask_price' || requestsPrice) ? ['price'] : []
  const preserveDuringProfile = inScope && input.profilePending && !requiredFacts.length
    && ['other', 'answer_previous'].includes(objective)
    && !input.requests.some(request => ['visit', 'financing'].includes(text(request.domain)))
  return {
    version: 'turn-intent-v1', objective, required_facts: requiredFacts,
    current_message: input.current,
    interpretation_source: inheritedPrice ? 'clarification_of_price_request' : 'current_turn',
    continuation_goal: preserveDuringProfile ? text(previous.continuation_goal) : objective === 'ask_price' ? 'ask_price' : null,
    subject: { category: property.category || null, unit_numbers: property.unit_numbers || [], filters: object(property.filters) },
    needs_reference: objective === 'ask_price' && !property.category && !(Array.isArray(property.unit_numbers) && property.unit_numbers.length),
    requests: input.requests,
    scope: { kind: inScope && input.scope.kind === 'neutral' ? 'property' : input.scope.kind, reason: input.scope.reason || null, outside_evidence: input.scope.outside_evidence || null },
    pending_question: input.pendingQuestion || null,
    profile_pending: input.profilePending === true,
    action_policy: 'Only separately validated current consent and operational state authorize actions; a price request never authorizes a visit or financing.',
  }
}

export const TURN_INTENT_RULES = `CONTRATO COMPARTIDO DEL TURNO: contrato_turno conserva el objetivo y las solicitudes actuales. Una categoría o unidad que aclara una consulta de precio sigue solicitando ese precio. Responda los required_facts antes de proponer la siguiente pregunta. El catálogo de medidas no sustituye una respuesta de precio. Si no hay un precio autorizado, explique esa limitación o pida la referencia necesaria; no invente valores. Una pregunta incompleta no demuestra un negocio ajeno. La captura inicial de nombre y residencia se agrega después de atender la consulta. Ninguna intención inferida acredita consentimiento para una cita o revisión financiera.`

export function turnIntentIssues(reply: string, contract: unknown, verifiedPrice: unknown): string[] {
  const intent = object(contract)
  if (!Array.isArray(intent.required_facts) || !intent.required_facts.includes('price')) return []
  // The price provider is the authority on whether a value was actually found.
  // Without it, do not force invented amounts or turn uncertainty into a handoff.
  const price = text(verifiedPrice)
  const amount = /(?:\$|USD)\s*\d|\d[\d.,]*\s*(?:USD|d[oó]lares)\b/i
  if (!amount.test(price)) return []
  return amount.test(reply) ? [] : ['turn_price_unanswered']
}
