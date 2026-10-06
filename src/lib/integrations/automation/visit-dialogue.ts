import { object, text, type Row } from './data'
import { readinessInvitation, readinessPlacePhrase, type ProjectReadiness, type VisitPlace } from '@/lib/inmobiliaria/projectReadiness'
import type { BusinessScopeDecision } from './business-scope'

const places = ['office', 'site', 'work_area', 'model', 'completed_unit']
const rows = (value: unknown) => Array.isArray(value) ? value.map(object) : []
const place = (value: unknown): VisitPlace | null => places.includes(text(value)) ? text(value) as VisitPlace : null
const literal = (quote: unknown, current: string) => !!text(quote).trim() && current.normalize('NFKC').toLowerCase().includes(text(quote).trim().normalize('NFKC').toLowerCase())
export const VISIT_DIALOGUE_VERSION = 'visit-dialogue-v1'
export const VISIT_DIALOGUE_PLAN_VERSION = 'visit-dialogue-plan-v1'

/** The requested destination and an offered alternative are different decisions. */
export function visitDialogueTurn(input: { previous?: unknown; intent?: unknown; preference?: unknown; readiness: ProjectReadiness;
  intake?: unknown; proposals?: unknown; current: string; sourceMessageId?: string; sourceAt?: string; pendingQuestion?: unknown }) {
  const previous = object(input.previous), intent = object(input.intent), preference = object(input.preference)
  const readiness = input.readiness, intake = object(input.intake)
  const valid = intent.confidence === 'high' && literal(intent.evidence, input.current) && intent.target !== 'other'
  const rawPurpose = valid ? text(intent.purpose) : ''
  const purpose = rawPurpose || (valid && intent.kind === 'request_visit' ? 'coordination'
    : valid && intent.kind === 'accept_visit_preference' ? 'preference' : valid && intent.kind === 'visit_status' ? 'status' : 'other')
  const currentKind = ['coordination', 'preference', 'accept_alternative', 'availability_information', 'access_information', 'decline', 'cancel', 'status'].includes(purpose) ? purpose : 'other'
  const currentDestination = valid ? text(intent.destination || preference.location_type) : ''
  const signature = JSON.stringify([readiness.stage, readiness.verifiedOn, readiness.enabledPlaces, readiness.primaryPlace, readiness.officeAtProjectSite === true, readiness.conditions])
  let state: Row = previous.version === VISIT_DIALOGUE_VERSION ? { ...previous } : { version: VISIT_DIALOGUE_VERSION,
    requested_destination: null, offered_destination: null, effective_destination: place(intake.preferred_location_type),
    alternative_accepted: false, status: intake.status === 'collecting' ? 'collecting' : 'none', missing_fields: [] }
  const knownProposal = rows(input.proposals).find(p => ['awaiting_advisor', 'awaiting_client', 'confirmed'].includes(text(p.status)))
  if (knownProposal) state = { ...state, status: knownProposal.status, request_id: knownProposal.request_id || knownProposal.id,
    effective_destination: place(knownProposal.preferred_location_type) || state.effective_destination }
  const pending = object(input.pendingQuestion)
  const offered = place(state.offered_destination)
  const explicitAcceptance = currentKind === 'accept_alternative' && offered
    && (!currentDestination || currentDestination === offered) && state.status === 'offered'
    && (pending.id === 'visit_destination' || previous.version === VISIT_DIALOGUE_VERSION)
  if (currentKind === 'decline' || currentKind === 'cancel') state = { ...state, status: currentKind === 'cancel' ? 'cancellation_requested' : 'declined',
    offered_destination: null, effective_destination: null, alternative_accepted: false, pending_preference: null, missing_fields: [] }
  const preferenceGiven = valid && preference.confidence === 'high' && literal(preference.evidence, input.current)
    && (preference.date_text || preference.time_text)
  if (preferenceGiven && ['coordination', 'preference'].includes(currentKind)) state.pending_preference = { ...preference,
    source_message_id: input.sourceMessageId || null, source_at: input.sourceAt || null }
  if (currentDestination && ['coordination', 'preference', 'access_information'].includes(currentKind)) state.requested_destination = currentDestination
  const requested = text(state.requested_destination)
  const requestedPlace = requested === 'building' ? readiness.enabledPlaces.includes('completed_unit') ? 'completed_unit' : null : place(requested)
  const blocked = !!requested && (!requestedPlace || !readiness.enabledPlaces.includes(requestedPlace))
  const currentBlocked = !!currentDestination && (!place(currentDestination) || !readiness.enabledPlaces.includes(place(currentDestination)!))
    && !(currentDestination === 'building' && readiness.enabledPlaces.includes('completed_unit'))
  if (currentBlocked && ['coordination', 'preference'].includes(currentKind)) state.effective_destination = null
  if (explicitAcceptance) state = { ...state, effective_destination: offered, alternative_accepted: true, status: 'collecting', missing_fields: [] }
  else if (['coordination', 'preference'].includes(currentKind) && currentDestination && !currentBlocked && requestedPlace) state = {
    ...state, effective_destination: requestedPlace, offered_destination: null, alternative_accepted: false, status: 'collecting' }
  const acceptsPreviouslyRejectedPlace = !!state.effective_destination && readiness.enabledPlaces.includes(state.effective_destination as VisitPlace)
  const needsAlternative = !acceptsPreviouslyRejectedPlace && blocked && ['coordination', 'preference', 'access_information', 'availability_information'].includes(currentKind)
  if (needsAlternative) state = { ...state, status: 'offered', offered_destination: readiness.primaryPlace === 'none' ? null : readiness.primaryPlace,
    effective_destination: null, alternative_accepted: false, missing_fields: ['destination_acceptance'] }
  if (currentKind === 'coordination' && !requested && !state.effective_destination) {
    // A direct request with no rejected destination may use the sole authorized place;
    // choosing among several still requires the customer's choice.
    state.effective_destination = readiness.enabledPlaces.length === 1 ? readiness.enabledPlaces[0] : null
    state.status = 'collecting'
  }
  const readinessChanged = previous.readiness_signature !== signature
  const explainRestriction = blocked && (currentBlocked || currentKind === 'access_information' || needsAlternative && state.explained_readiness_signature !== signature)
  const operational = ['coordination', 'preference', 'accept_alternative'].includes(currentKind)
    && !!place(state.effective_destination) && readiness.enabledPlaces.includes(state.effective_destination as VisitPlace)
    && state.status !== 'declined'
  if (operational) state.missing_fields = [!object(state.pending_preference).date_text && !intake.requested_date && 'date',
    !object(state.pending_preference).time_text && !intake.has_time && 'time'].filter(Boolean)
  state.readiness_signature = signature
  let question = '', questionId = ''
  if (['coordination', 'preference', 'availability_information', 'access_information'].includes(currentKind) && state.status === 'offered' && state.offered_destination) {
    question = `¿Le gustaría coordinar una cita ${readinessPlacePhrase(readiness, state.offered_destination as VisitPlace, true)}?`
    questionId = 'visit_destination'
  } else if (['coordination', 'preference'].includes(currentKind) && !state.effective_destination && readiness.enabledPlaces.length > 1) {
    question = readinessInvitation(readiness); questionId = 'visit_destination'; state.missing_fields = ['destination']
  }
  const plan: Row = { version: VISIT_DIALOGUE_PLAN_VERSION, current_kind: currentKind, state,
    operation_allowed: operational, requested_destination: state.requested_destination,
    effective_destination: state.effective_destination, offered_destination: state.offered_destination,
    alternative_accepted: state.alternative_accepted, explain_restriction: explainRestriction,
    readiness_changed: readinessChanged, question_id: questionId || null, question: question || null,
    information_only: ['availability_information', 'access_information'].includes(currentKind),
    instruction: currentKind === 'other' ? 'Responda la consulta actual. La visita pendiente queda conservada, pero no repita restricciones ni ofrezca inmuebles o trámites por esa coordinación.'
      : currentKind === 'availability_information' ? 'Responda con los horarios de atención verificados, diferenciándolos de cupos libres. No cree una solicitud ni tome esta consulta como aceptación del lugar alternativo. Conserve la decisión pendiente indicada.'
        : explainRestriction ? 'Explique la limitación física verificada, independientemente de la etapa comercial, y ofrezca únicamente el lugar autorizado indicado. No cambie el lugar elegido ni registre una cita antes de aceptar la alternativa.'
          : 'Atienda la gestión actual sin repetir una restricción ya explicada. Conserve las preferencias declaradas; una solicitud recibida no es una cita confirmada.' }
  return plan
}

/** A semantic project reference can repair uncertainty, never a verified foreign business. */
export function reconcileVisitDialogueScope(scope: BusinessScopeDecision, current: string, intentInput: unknown, requestsInput: unknown): BusinessScopeDecision {
  const intent = object(intentInput)
  const grounded = rows(requestsInput).some(r => r.domain === 'visit' && r.confidence === 'high' && literal(r.evidence, current))
  if (!scope.uncertain && scope.kind !== 'neutral' || !grounded || intent.confidence !== 'high' || intent.target !== 'project'
    || intent.kind === 'none' || !literal(intent.evidence, current)) return scope
  return { kind: 'property', property_message: current, reply: '', uncertain: false, confidence: 'high', reason: 'grounded_project_visit_reference' }
}

export function visitDialoguePendingQuestion(planInput: unknown): Row {
  const plan = object(planInput)
  return plan.version === VISIT_DIALOGUE_PLAN_VERSION && plan.question_id && plan.question
    ? { id: plan.question_id, act: 'visit', question: plan.question, destination: plan.offered_destination } : {}
}

/** Original evidence remains attributed to its original message, never to a later yes. */
export function visitDialogueIntakeSnapshot(planInput: unknown, intentInput: unknown, preferenceInput: unknown, currentSourceId: string): Row {
  const plan = object(planInput), intent = object(intentInput), current = object(preferenceInput), state = object(plan.state)
  const retained = object(state.pending_preference)
  const interpreted = Object.keys(current).length ? current : plan.current_kind === 'accept_alternative' && plan.operation_allowed === true
    ? { evidence: intent.evidence, confidence: 'high', canonical_text: null, date_text: null, time_text: null, location_type: plan.effective_destination } : null
  const restore = plan.current_kind === 'accept_alternative' && plan.alternative_accepted === true
    && retained.source_message_id && retained.source_message_id !== currentSourceId && retained.confidence === 'high'
  return { ...(interpreted ? { _interpreted_visit: interpreted } : {}),
    ...(restore ? { _visit_dialogue_consent: { current_intent: intent, source_preference: retained } } : {}) }
}

export function visitDialogueBaseReply(planInput: unknown, readiness: ProjectReadiness) {
  const plan = object(planInput)
  const limitation = plan.explain_restriction === true ? readiness.stage === 'not_started'
    ? 'La obra todavía no ha iniciado, por lo que no hay una edificación ni unidades habilitadas para recorrer.'
    : 'El lugar que solicita no está habilitado actualmente para visitas.' : ''
  return [limitation, text(plan.question)].filter(Boolean).join(' ')
}

export function rememberVisitDialogue(previousInput: unknown, planInput: unknown, result: unknown, delivered: boolean): Row {
  const previous = object(previousInput), plan = object(planInput), audit = object(result)
  if (!delivered || plan.version !== VISIT_DIALOGUE_PLAN_VERSION) return previous
  const state = { ...object(plan.state) }
  if (plan.explain_restriction === true) state.explained_readiness_signature = state.readiness_signature
  if (audit.registration_verified === true) { state.status = 'awaiting_advisor'; state.request_id = audit.request_id; state.missing_fields = []; state.pending_preference = null }
  else if (audit.action === 'confirmed') { state.status = 'confirmed'; state.missing_fields = []; state.pending_preference = null }
  return state
}

export const VISIT_DIALOGUE_RULES = 'visit_dialogue_plan es el contrato compartido de esta visita. requested_destination es el lugar pedido, offered_destination sólo una alternativa y effective_destination el lugar realmente elegido o aceptado. No convierta preguntar días/horarios, rechazar un lugar o hablar de otro tema en aceptar la oficina ni en crear/confirmar citas. Con explain_restriction=false no repita la negativa histórica; si pregunta expresamente por el acceso o cambia el estado físico puede explicarla de nuevo. Con current_kind=other atienda la consulta sin arrastrar negativas ni ofertas de inmuebles y conserve la visita pendiente. Con information_only=true informe horarios verificados, no cupos libres ni una solicitud registrada. Incluya la pregunta concreta del plan cuando exista, conectándola con la respuesta; no sustituya la aceptación del lugar por datos personales, presupuesto o una elección de inmueble. La oficina en el sitio del proyecto sigue siendo oficina: no concede acceso a la obra o unidades. La etapa comercial no acredita avance físico. La revisión debe comprobar estas mismas decisiones y la respuesta a la solicitud actual, no sólo que la política descrita sea cierta.'
