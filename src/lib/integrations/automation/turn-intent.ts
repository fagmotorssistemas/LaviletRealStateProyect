import { object, text, type Row } from './data'
import { asksUnitPrice } from './price-reply'
import { normalizedReservation } from './turn-semantics'

const rows = (value: unknown) => (Array.isArray(value) ? value : []).map(object)

/** Resolve duplicate classifiers only when both cite the same current fragment.
 * A neutral scope is not contrary evidence, but mixed/foreign/uncertain scope,
 * pending requests and multiple requests must retain their independent domains. */
function reconciledInformationRequest(input: { current: string; semantics: Row; requests: Row[]; scope: Row }, reservation: Row): Row | null {
  if (input.semantics.primary_intent !== 'project_information' || input.semantics.confidence !== 'high'
    || !['neutral', 'property'].includes(text(input.scope.kind)) || input.scope.uncertain !== false
    || text(input.scope.outside_evidence).trim() || reservation.kind !== 'none' || input.requests.length !== 1) return null
  const request = input.requests[0]
  if (request.domain !== 'other' || request.confidence !== 'high' || request.source === 'pending' || request.source_message_id) return null
  const primaryEvidence = text(input.semantics.primary_evidence).trim(), requestEvidence = text(request.evidence).trim()
  const normalizedLiteral = (value: string) => value.normalize('NFKC').toLowerCase()
  if (!primaryEvidence || primaryEvidence.length > 240 || !requestEvidence || requestEvidence.length > 500
    || normalizedLiteral(primaryEvidence) !== normalizedLiteral(requestEvidence)
    || !normalizedLiteral(input.current).includes(normalizedLiteral(primaryEvidence))) return null
  return { ...request, domain: 'property' }
}

/** Shared interpretation, not permission to execute an appointment or financing action. */
export function resolveTurnIntent(input: { current: string; history?: unknown; semantics: Row; requests: Row[]; scope: Row; previous?: unknown; profilePending?: boolean; pendingQuestion?: unknown }) {
  const previous = object(input.previous), property = object(input.semantics.property)
  const answer = object(input.semantics.answer_to_previous), pending = object(input.pendingQuestion)
  const confidentIntent = input.semantics.confidence === 'high' && !['', 'other'].includes(text(input.semantics.primary_intent))
  const reservation = normalizedReservation(input.semantics.reservation, input.current)
  const reconciledRequest = reconciledInformationRequest(input, reservation)
  const requests = reconciledRequest ? [reconciledRequest] : input.requests
  const reservationObjective = reservation.kind === 'request' ? 'request_reservation' : reservation.kind === 'information' ? 'ask_reservation' : null
  const lexicalPrice = asksUnitPrice(input.current, true)
  const propertyPriceFallback = !confidentIntent && lexicalPrice && /\b(?:suites?|departamentos?|apartamentos?|penthouses?|local(?:es)?(?: comerciales?)?)\b/i.test(input.current)
  const interpretedProperty = input.semantics.confidence === 'high' && (reservationObjective
    || requests.some(request => request.domain === 'property' && request.confidence === 'high'))
  const inScope = !input.scope.uncertain && (['property', 'mixed'].includes(text(input.scope.kind))
    || input.scope.kind === 'neutral' && (interpretedProperty || propertyPriceFallback))
  const explicitPrice = inScope && (input.semantics.primary_intent === 'ask_price' || !confidentIntent && lexicalPrice)
  const requestsPrice = requests.some(request => request.domain === 'property' && request.confidence === 'high' && asksUnitPrice(text(request.request), true))
  const categoryAnswer = ['select_property', 'answer_previous'].includes(text(input.semantics.primary_intent))
    && property.confidence === 'high' && (text(property.category) || Array.isArray(property.unit_numbers) && property.unit_numbers.length > 0)
    && !requests.some(request => request.confidence === 'high' && !['property', 'courtesy'].includes(text(request.domain)))
  // A legacy conversation may predate the durable contract. Require both the
  // current interpreted price request and a recent customer's price request.
  const recentClients = rows(input.history).filter(row => ['cliente', 'user'].includes(text(row.role)) && text(row.content) !== input.current).slice(-2)
  const historicalPrice = requestsPrice && recentClients.some(row => asksUnitPrice(text(row.content)))
  const answersPropertyReference = answer.kind === 'value' && answer.question_id === pending.id
    && ['property_category', 'unit_choice', 'property_floor', 'property_bedrooms', 'property_area'].includes(text(pending.id))
  const inheritedPrice = inScope && !explicitPrice && categoryAnswer
    && pending.act !== 'explore_quoted_options'
    && (previous.continuation_goal === 'ask_price' || historicalPrice)
    && (input.semantics.primary_intent === 'select_property' || answersPropertyReference || requestsPrice)
  const objective = !inScope ? input.scope.uncertain ? 'clarify_scope' : text(input.scope.kind)
    : reservationObjective || (explicitPrice || inheritedPrice ? 'ask_price' : text(input.semantics.primary_intent) || 'other')
  const requiredFacts = inScope && (objective === 'ask_price' || requestsPrice) ? ['price'] : []
  const preserveDuringProfile = inScope && input.profilePending && !requiredFacts.length
    && ['other', 'answer_previous'].includes(objective)
    && !requests.some(request => ['visit', 'financing'].includes(text(request.domain)))
  const interpretationSource = reservationObjective && inScope ? 'current_reservation' : inheritedPrice ? 'clarification_of_price_request'
    : confidentIntent ? 'extractor' : explicitPrice ? 'lexical_fallback' : 'current_turn'
  const decisions = [...rows(object(input.semantics.interpretation).decisions)]
  if (reconciledRequest) decisions.push({ code: 'request_domain_reconciled_from_current_project_information',
    source: 'primary_intent', original_domain: 'other', canonical_domain: 'property',
    canonical_intent: objective, evidence: reconciledRequest.evidence })
  if (inScope && propertyPriceFallback && input.scope.kind === 'neutral') decisions.push({ code: 'neutral_scope_property_price_fallback', canonical_intent: objective })
  if (confidentIntent && lexicalPrice && input.semantics.primary_intent !== 'ask_price') decisions.push({ code: 'extractor_intent_precedes_price_keywords',
    extractor_intent: input.semantics.primary_intent, canonical_intent: objective })
  if (inheritedPrice && !reservationObjective) decisions.push({ code: 'property_reference_answers_pending_price',
    extractor_intent: input.semantics.primary_intent, canonical_intent: objective })
  if (inScope && reservationObjective && input.semantics.primary_intent !== reservationObjective) decisions.push({ code: 'current_reservation_takes_priority',
    extractor_intent: input.semantics.primary_intent, canonical_intent: objective })
  if (!inScope && reservationObjective) decisions.push({ code: 'reservation_outside_authorized_scope', canonical_intent: objective })
  return {
    version: 'turn-intent-v2', objective, required_facts: requiredFacts,
    current_message: input.current,
    ...(object(input.semantics.budget).status && object(input.semantics.budget).status !== 'not_discussed' ? { budget: input.semantics.budget } : {}),
    interpretation_source: interpretationSource,
    interpretation: { extractor_primary_intent: object(input.semantics.interpretation).extractor_primary_intent || input.semantics.primary_intent || 'other',
      canonical_primary_intent: objective, decisions },
    reservation,
    requested_action: inScope && reservation.kind === 'request' ? 'reservation_handoff' : null,
    continuation_goal: preserveDuringProfile ? text(previous.continuation_goal) : objective === 'ask_price' ? 'ask_price' : null,
    subject: { category: property.category || null,
      unit_numbers: reservationObjective && Array.isArray(reservation.unit_numbers) && reservation.unit_numbers.length ? reservation.unit_numbers : property.unit_numbers || [],
      filters: object(property.filters) },
    needs_reference: objective === 'ask_price' && !property.category && !(Array.isArray(property.unit_numbers) && property.unit_numbers.length),
    requests,
    scope: { kind: inScope && input.scope.kind === 'neutral' ? 'property' : input.scope.kind, reason: input.scope.reason || null, outside_evidence: input.scope.outside_evidence || null },
    pending_question: input.pendingQuestion || null,
    profile_pending: input.profilePending === true,
    action_policy: 'Only separately validated current consent and operational state authorize actions; a price request never authorizes a visit or financing. A current reservation request initiates advisor handoff, never a confirmed reservation, payment or appointment.',
  }
}

export const TURN_INTENT_RULES = `CONTRATO COMPARTIDO DEL TURNO: contrato_turno conserva el objetivo y TODAS las solicitudes actuales. Su interpretación canónica prevalece sobre palabras sueltas y plantillas de una etapa anterior. Una negativa a la propuesta previa puede coexistir con una acción nueva; responda ambas sin convertir «por ahora no» en negativa global. request_reservation solicita iniciar separación con un asesor, ask_reservation solo pide información del proceso; la selección identifica el inmueble y no obliga a volver a presentar el tour. Describa únicamente el resultado operativo comprobado: no afirme asignación, disponibilidad ni reserva confirmada solo porque se solicitó. Una categoría o unidad que aclara una consulta de precio sigue solicitando ese precio. Responda los required_facts y las demás solicitudes antes de proponer la siguiente pregunta. El catálogo de medidas no sustituye una respuesta de precio. Si no hay un precio autorizado, explique esa limitación o pida la referencia necesaria; no invente valores. Una pregunta incompleta no demuestra un negocio ajeno. La captura inicial de nombre y residencia se agrega después de atender la consulta. Ninguna intención inferida acredita consentimiento para una cita o revisión financiera.`

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
