import { object,text,type Row } from './data'
import { acceptedExtractorConfidence } from './extractor-confidence'
import { interactionMode } from './interaction-mode'
import { turnCommunicationKind } from './turn-communication'

export type CommercialEngagementTurn = {
  semantics?: unknown; intent?: unknown; scope?: unknown; pendingQuestion?: unknown
}
export type CommercialEngagementState = {
  passive: boolean; interested: boolean
  property_continuation_allowed?: boolean
  property_continuation?: Row
  interaction_mode?: Row
}
export const COMMERCIAL_ENGAGEMENT_VERSION = 'commercial-engagement-v3'
const propertyQuestions = ['property_category', 'property_floor', 'property_bedrooms', 'property_area', 'property_requirements', 'unit_choice']
const propertyOperations = new Set(['search', 'rank', 'compare', 'select', 'details'])
const propertyObjectives = new Set(['select_property', 'ask_price', 'project_information'])
const propertyCategories = new Set(['suite', 'departamento', 'penthouse', 'local'])
const currentEvidence = (current: string, value: unknown) => {
  const evidence = text(value).trim()
  return evidence.length <= 1500 && evidence && current.includes(evidence) ? evidence : ''
}

/** Permission to resolve a current property request is narrower than permission
 * to make another sales offer. No customer/writer vocabulary grants permission. */
export function requestedPropertyContinuation(current: string, input: CommercialEngagementTurn = {}): Row {
  const semantics = object(input.semantics), intent = object(input.intent)
  const scope = object(input.scope || intent.scope), property = object(semantics.property)
  const answer = object(semantics.answer_to_previous), pending = object(input.pendingQuestion || intent.pending_question)
  const objective = text(intent.objective || semantics.primary_intent)
  const deny = (reason: string) => ({ version: 'requested-property-continuation-v1', allowed: false,
    property_interest_renewed: false, reason, evidence: '', allowed_question_ids: [] })
  const communication = turnCommunicationKind(semantics)
  if (communication && communication !== 'substantive') return deny('no_substantive_current_turn')
  if (scope.uncertain === true || !['property', 'mixed', 'neutral'].includes(text(scope.kind))) return deny('property_scope_not_verified')
  const mode = object(semantics.interaction_goal)
  if (mode.mode === 'information_only' && acceptedExtractorConfidence(mode.confidence) && currentEvidence(current, mode.mode_evidence))
    return deny('current_information_only_mode')
  const literal = (value: unknown) => currentEvidence(current, value)
  const requests = (Array.isArray(intent.requests) ? intent.requests : []).map(object)
  const request = requests.find(row => row.domain === 'property' && acceptedExtractorConfidence(row.confidence)
    && row.source !== 'pending' && !row.source_message_id && literal(row.evidence))
  const evidence = acceptedExtractorConfidence(property.confidence) && propertyOperations.has(text(property.operation)) ? literal(property.evidence) : ''
  const filters = object(property.filters)
  const criteria = propertyCategories.has(text(property.category))
    || Array.isArray(property.unit_numbers) && property.unit_numbers.length > 0
    || ['bedrooms', 'floor_number', 'min_area_m2', 'max_area_m2', 'bedrooms_upper'].some(key => typeof filters[key] === 'number' && Number.isFinite(filters[key]) && Number(filters[key]) >= 0)
    || Array.isArray(filters.bedrooms_any) && filters.bedrooms_any.some(value => typeof value === 'number' && Number.isInteger(value) && value > 0)
  const propertyPending = propertyQuestions.includes(text(pending.id))
    && ['choose_category', 'choose_floor', 'choose_unit', 'explore_alternatives', 'confirm_bedrooms', 'confirm_priority', 'other'].includes(text(pending.act))
  const answerEvidence = acceptedExtractorConfidence(answer.confidence) && answer.question_id === pending.id ? literal(answer.evidence) : ''
  const sameNegative = propertyPending && answer.kind === 'negative' && answerEvidence
    && (!evidence || evidence === answerEvidence)
  if (sameNegative && !request) return deny('current_property_choice_declined')
  const explicitRequest = propertyObjectives.has(objective) && (request || evidence)
    && (scope.kind !== 'neutral' || request || criteria)
  const propertyAnswer = propertyPending && answerEvidence && ['affirmative', 'uncertain', 'value'].includes(text(answer.kind))
    && scope.kind !== 'neutral'
  const useChoice = ['property_category', 'property_purpose'].includes(text(pending.id))
    && ['choose_category', 'other'].includes(text(pending.act)) && answer.kind === 'value' && !!answerEvidence
    && ['other', 'answer_previous', 'select_property'].includes(objective)
    && acceptedExtractorConfidence(semantics.confidence) && acceptedExtractorConfidence(property.confidence)
    && ['residential', 'commercial'].includes(text(property.group)) && !!literal(property.evidence)
    && ['none', 'search'].includes(text(property.operation)) && scope.kind !== 'neutral'
  if (!explicitRequest && !propertyAnswer && !useChoice) return deny('no_current_property_request_or_verified_answer')
  const renewal = useChoice || explicitRequest && objective === 'select_property' && acceptedExtractorConfidence(semantics.confidence)
    && acceptedExtractorConfidence(property.confidence) && ['search', 'rank', 'select'].includes(text(property.operation)) && !!evidence && criteria
  return { version: 'requested-property-continuation-v1', allowed: true, property_interest_renewed: !!renewal,
    reason: useChoice ? 'current_property_use_choice' : renewal ? 'current_concrete_property_search' : propertyAnswer ? 'current_answer_to_property_question' : 'current_property_information_request',
    objective, evidence: useChoice ? literal(property.evidence) : evidence || text(request?.evidence) || answerEvidence,
    allowed_question_ids: [...propertyQuestions] }
}

export function explicitPropertyInterest(value: string, turn: CommercialEngagementTurn = {}) {
  return requestedPropertyContinuation(value, turn).property_interest_renewed === true
}

/** Durable semantic memory replaces rescanning old messages. A greeting,
 * acknowledgement or old writer invitation cannot revive qualification. */
export function commercialEngagement(current: string, history: unknown, previous: unknown = {}, turn?: CommercialEngagementTurn): CommercialEngagementState {
  void history
  const saved = object(previous)
  let passive = saved.passive_sales === true, interested = saved.property_interest === true
  if (!turn) return { passive, interested }
  const scope = object(turn.scope || object(turn.intent).scope)
  const mode = interactionMode(saved.interaction_mode, turn.semantics)
  if (scope.kind === 'out_of_scope') { passive = true; interested = false }
  const goal = object(object(turn.semantics).interaction_goal)
  if (mode.mode === 'information_only') passive = true
  const continuation = mode.mode === 'information_only'
    ? { allowed: false, property_interest_renewed: false, reason: 'information_only_mode', allowed_question_ids: [] }
    : requestedPropertyContinuation(current, turn)
  const explicitGuidedSearch = goal.mode === 'guided_search' && acceptedExtractorConfidence(goal.confidence)
    && !!currentEvidence(current, goal.mode_evidence)
  if (continuation.property_interest_renewed === true || explicitGuidedSearch) { passive = false; interested = true }
  return { passive, interested, interaction_mode: mode, property_continuation_allowed: continuation.allowed === true, property_continuation: continuation }
}

export function passiveSalesRules(state: ReturnType<typeof commercialEngagement>) {
  return state.passive ? 'MODO INFORMATIVO: la memoria limita las ofertas no solicitadas; no atribuya al lead un rechazo que no este documentado. Conteste todas las preguntas con datos verificados. No agregue capturas, financiamiento, visita ni reserva por rutina. Una consulta informativa no revoca esta pausa. Atienda una gestion expresamente solicitada conservando sus permisos y requisitos propios.'
    + (state.property_continuation_allowed === true ? ' La solicitud actual permite una aclaracion pertinente para resolverla; no concede consentimiento para otro tramite ni para capturar datos personales o presupuesto.'
      : ' No agregue preguntas de calificacion ni otra invitacion comercial no solicitada.') : ''
}

/** Kept as a compatibility API: the writer owns its entire message. */
export function passiveSalesCopy(reply: string, current: string, state: ReturnType<typeof commercialEngagement>) {
  void current
  void state
  return reply
}
