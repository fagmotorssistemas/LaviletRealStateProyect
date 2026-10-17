import { object,text,type Row } from './data'
import { acceptedExtractorConfidence } from './extractor-confidence'
import { asksUnitPrice } from './price-reply'
import { normalizedRequestTopics } from './request-topics'
import { reservationPermission } from './reservation-action'
import { normalizedReservation } from './turn-semantics'

const rows = (value: unknown) => (Array.isArray(value) ? value : []).map(object)
const normalizedLiteral = (value: unknown) => text(value).trim().normalize('NFKC').toLowerCase()
const currentEvidence = (request: Row, current: string) => !!normalizedLiteral(request.evidence)
  && normalizedLiteral(current).includes(normalizedLiteral(request.evidence))

/** Resolve duplicate classifiers only when both cite the same current fragment.
 * A neutral scope is not contrary evidence, but mixed/foreign/uncertain scope,
 * pending requests and multiple requests must retain their independent domains. */
function reconciledInformationRequest(input: { current: string; semantics: Row; requests: Row[]; scope: Row }, reservation: Row): Row | null {
  if (input.semantics.primary_intent !== 'project_information' || !acceptedExtractorConfidence(input.semantics.confidence)
    || !['neutral', 'property'].includes(text(input.scope.kind)) || input.scope.uncertain !== false
    || text(input.scope.outside_evidence).trim() || reservation.kind !== 'none' || input.requests.length !== 1) return null
  const request = input.requests[0]
  if (request.domain !== 'other' || !acceptedExtractorConfidence(request.confidence) || request.source === 'pending' || request.source_message_id) return null
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
  const confidentIntent = acceptedExtractorConfidence(input.semantics.confidence) && !['', 'other'].includes(text(input.semantics.primary_intent))
  const reservation = reservationPermission(normalizedReservation(input.semantics.reservation, input.current, pending, answer, input.semantics.action_authority), input.current, input.semantics.action_authority)
  const reconciledRequest = reconciledInformationRequest(input, reservation)
  const interaction = object(input.semantics.interaction_goal)
  const modeDeclarationOnly = interaction.mode === 'information_only' && interaction.specific_topic !== true
    && acceptedExtractorConfidence(interaction.confidence) && !!text(interaction.mode_evidence)
  const requests = (reconciledRequest ? [reconciledRequest] : input.requests).filter(request =>
    // Declaring a conversational goal is not a request for a project recital.
    // Preserve pending questions and every independent, specific request.
    !(modeDeclarationOnly && request.source !== 'pending' && request.domain === 'property'
      && Array.isArray(request.topics) && request.topics.length === 1 && request.topics[0] === 'project_overview'))
    .map(request => {
    const proof = text(request.evidence).trim(), permission = text(reservation.evidence).trim()
    // Securing an option subject to an unanswered prerequisite is information,
    // even if extraction put that wish in the advisor domain. An independently
    // evidenced request to speak with a person retains its separate action.
    return reservation.request_deferred === true && request.domain === 'advisor' && proof && permission
      && (proof.includes(permission) || permission.includes(proof))
      && object(input.semantics.action_authority).advisor == null
      ? { ...request, domain: 'property', action_deferred: true } : request
  })
  const reservationObjective = reservation.kind === 'request' ? 'request_reservation' : reservation.kind === 'information' ? 'ask_reservation' : null
  const lexicalPrice = false
  const propertyPriceFallback = false
  const interpretedProperty = acceptedExtractorConfidence(input.semantics.confidence) && (reservationObjective
    || requests.some(request => request.domain === 'property' && acceptedExtractorConfidence(request.confidence)))
  const inScope = !input.scope.uncertain && (['property', 'mixed'].includes(text(input.scope.kind))
    || input.scope.kind === 'neutral' && (interpretedProperty || propertyPriceFallback))
  const currentTyped = requests.filter(request => request.source !== 'pending' && acceptedExtractorConfidence(request.confidence)
    && request.domain !== 'courtesy' && Array.isArray(request.topics) && currentEvidence(request, input.current))
  const typedPrice = currentTyped.some(request => normalizedRequestTopics(request.topics)?.includes('purchase_price'))
  const explicitPrice = inScope && (currentTyped.length ? typedPrice && (!confidentIntent || input.semantics.primary_intent === 'ask_price')
    : input.semantics.primary_intent === 'ask_price' || !confidentIntent && lexicalPrice)
  const requestsPrice = requests.some(request => request.domain === 'property' && acceptedExtractorConfidence(request.confidence)
    && (Array.isArray(request.topics)
      ? normalizedRequestTopics(request.topics)?.includes('purchase_price')
        && (request.source === 'pending' ? !!text(request.evidence).trim() : currentEvidence(request, input.current))
      : !currentTyped.length && (!text(request.evidence).trim() || request.source === 'pending' || currentEvidence(request, input.current))
        && asksUnitPrice(text(request.request), true)))
  const categoryAnswer = ['select_property', 'answer_previous'].includes(text(input.semantics.primary_intent))
    && acceptedExtractorConfidence(property.confidence) && (text(property.category) || Array.isArray(property.unit_numbers) && property.unit_numbers.length > 0)
    && !requests.some(request => acceptedExtractorConfidence(request.confidence) && !['property', 'courtesy'].includes(text(request.domain)))
  // A legacy conversation may predate the durable contract. Require both the
  // current interpreted price request and a recent customer's price request.
  const historicalPrice = false
  const answersPropertyReference = answer.kind === 'value' && answer.question_id === pending.id
    && (!currentTyped.length || acceptedExtractorConfidence(answer.confidence) && currentEvidence(answer, input.current))
    && ['property_category', 'unit_choice', 'property_floor', 'property_bedrooms', 'property_area'].includes(text(pending.id))
  const inheritedPrice = inScope && !explicitPrice && categoryAnswer
    && pending.act !== 'explore_quoted_options'
    && previous.price_request_status !== 'answered'
    && (previous.continuation_goal === 'ask_price' || historicalPrice)
    && (!currentTyped.length || requestsPrice || previous.price_request_status === 'pending' && answersPropertyReference)
    && (input.semantics.primary_intent === 'select_property' || answersPropertyReference || requestsPrice)
  const objective = !inScope ? input.scope.uncertain ? 'clarify_scope' : text(input.scope.kind)
    : reservationObjective || (explicitPrice || inheritedPrice ? 'ask_price'
      : currentTyped.length && input.semantics.primary_intent === 'ask_price' ? 'answer_previous' : text(input.semantics.primary_intent) || 'other')
  const requiredFacts = inScope && (objective === 'ask_price' || requestsPrice) ? ['price'] : []
  const preserveDuringProfile = inScope && previous.price_request_status !== 'answered' && input.profilePending && !requiredFacts.length
    && ['other', 'answer_previous'].includes(objective)
    && !requests.some(request => ['visit', 'financing'].includes(text(request.domain)))
  const interpretationSource = reservationObjective && inScope ? 'current_reservation' : inheritedPrice ? 'clarification_of_price_request'
    : confidentIntent ? 'extractor' : explicitPrice ? 'lexical_fallback' : 'current_turn'
  const decisions = [...rows(object(input.semantics.interpretation).decisions)]
  if (reservation.request_deferred === true) decisions.push({ code: 'reservation_prerequisite_unresolved',
    source: 'current_turn', original_kind: 'request', canonical_kind: 'information', evidence: reservation.evidence })
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
    interaction_goal: input.semantics.interaction_goal || null,
    current_message: input.current,
    price_request_status: requiredFacts.length || preserveDuringProfile && previous.continuation_goal === 'ask_price'
      ? 'pending' : previous.price_request_status === 'answered' ? 'answered' : 'not_requested',
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

/** Legacy content inspection is disabled; the writer/reviewer own wording. */
export function turnIntentIssues(_reply: string, _contract: unknown, _verifiedPrice: unknown): string[] { void _reply; void _contract; void _verifiedPrice;  return [] }

/** Called only after provider acceptance. A delivered clarification or recovery
 * never closes the unanswered price request; independent content validation
 * and literal coverage of the price fragment are both required. */
export function rememberTurnIntentAfterReply(contract: unknown, audit: unknown, delivery: { accepted: boolean; recovery: boolean }): Row {
  const intent = object(contract), review = object(audit), validation = object(review.final_validation)
  if (intent.price_request_status !== 'pending' || !delivery.accepted || delivery.recovery
    || !['checked', 'review_observed', 'review_disabled'].includes(text(review.status))
    || validation.passed !== true || object(review.recovery).pending === true) return intent
  const priceRequests = rows(intent.requests).filter(request => request.domain === 'property'
    && (Array.isArray(request.topics) ? normalizedRequestTopics(request.topics)?.includes('purchase_price')
      : asksUnitPrice(text(request.request), true)))
  const fragments = priceRequests.map(request => text(request.evidence).trim()).filter(Boolean)
  const referenceOnly = !fragments.length
  if (!fragments.length && Array.isArray(intent.required_facts) && intent.required_facts.includes('price'))
    fragments.push(text(intent.current_message))
  const coverage = rows(review.requests)
  const covered = fragments.length > 0 && fragments.every(fragment => {
    const matches = coverage.filter(row => normalizedLiteral(row.fragment) && normalizedLiteral(row.fragment).includes(normalizedLiteral(fragment)))
    const priceBound = (row: Row) => row.fact_key === 'price' || row.intent === 'ask_price'
      || !referenceOnly && !text(row.fact_key)
    return matches.some(row => row.status === 'answered' && priceBound(row))
      && !matches.some(row => ['unanswered', 'clarification', 'missing_fact', 'outside_scope'].includes(text(row.status)))
  })
  return covered ? { ...intent, price_request_status: 'answered',
    continuation_goal: intent.continuation_goal === 'ask_price' ? null : intent.continuation_goal } : intent
}
