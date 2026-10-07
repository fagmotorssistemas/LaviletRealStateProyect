import { object, text, type Row } from './data'
import { normalized } from './sdr-rules'
import { isPropertyScopeRedirect } from './sales-subject'
import { replyQuestionText } from './reply-question'

const property = /inmueble|departamento|suite|vivienda|local|proyecto|propiedad|la vilet|lavilet|bien(?:es)?(?:\s+inmueble)?|unidad/
/** Referencia a un inmueble concreto (no saludo genérico). */
const identifiedProperty =
  /(?:este|esta|ese|esa)\s+(?:bien|inmueble|departamento|suite|propiedad|unidad|local)|la\s+suite|el\s+departamento|\bunidad\s*\d|\b\d{2,4}\b.*(?:piso|suite|depto|departamento)/

export type CommercialEngagementTurn = {
  semantics?: unknown; intent?: unknown; scope?: unknown; pendingQuestion?: unknown
}
export type CommercialEngagementState = {
  passive: boolean; interested: boolean
  property_continuation_allowed?: boolean
  property_continuation?: Row
}
export const COMMERCIAL_ENGAGEMENT_VERSION = 'commercial-engagement-v2'
const propertyQuestions = ['property_category', 'property_floor', 'property_bedrooms', 'property_area', 'property_requirements', 'unit_choice']
const propertyOperations = new Set(['search', 'rank', 'compare', 'select', 'details'])
const propertyObjectives = new Set(['select_property', 'ask_price', 'project_information'])
const propertyCategories = new Set(['suite', 'departamento', 'penthouse', 'local'])
const salesRefusalPattern = /no (?:no )?(?:estoy interesad[oa]|me interesa)(?:\b|$)|no (?:quiero|deseo) (?:comprar|adquirir)|solo (?:por )?curiosidad|(?:numero|chat) equivocado|me equivoque de (?:numero|chat)/
const salesRefusal = (m: string) => salesRefusalPattern.test(m)
const currentEvidence = (current: string, value: unknown) => {
  const evidence = text(value).trim(), fragment = normalized(evidence)
  return evidence.length <= 1500 && fragment && normalized(current).includes(fragment) ? evidence : ''
}

/** A refusal of one workflow does not reject an independently requested home.
 * Current literal evidence must separate both acts; a search label alone cannot
 * waive a global refusal or manufacture consent to the declined workflow. */
function currentSalesRefusal(current: string, input: CommercialEngagementTurn): boolean {
  const value = normalized(current)
  if (!salesRefusal(value)) return false
  const semantics = object(input.semantics), intent = object(input.intent), property = object(semantics.property)
  const requests = (Array.isArray(intent.requests) ? intent.requests : []).map(object)
  const request = requests.find(row => row.domain === 'property' && row.confidence === 'high'
    && row.source !== 'pending' && !row.source_message_id && currentEvidence(current, row.evidence)
    && !salesRefusal(normalized(text(row.evidence))))
  const propertyEvidence = property.confidence === 'high' && propertyOperations.has(text(property.operation))
    ? currentEvidence(current, property.evidence) : ''
  const independentEvidence = text(request?.evidence)
    || propertyEvidence && !salesRefusal(normalized(propertyEvidence)) && propertyEvidence
  const answer = object(semantics.answer_to_previous), pending = object(input.pendingQuestion || intent.pending_question)
  const operationalAnswer = ['financing_invitation', 'financing_partner', 'financing_data',
    'visit_invitation', 'visit_destination', 'visit_date_time', 'reservation_invitation'].includes(text(pending.id))
    && !!replyQuestionText(text(pending.question)) && answer.kind === 'negative' && answer.confidence === 'high'
    && answer.question_id === pending.id ? normalized(currentEvidence(current, answer.evidence)) : ''
  if (!independentEvidence) {
    // A grounded answer declining the pending workflow keeps the previous
    // property engagement. It creates neither renewed interest nor another CTA.
    if (!operationalAnswer || /compra|adquirir|invertir|curiosidad|equivocad|proyecto|vivienda|propiedad|inmueble/.test(operationalAnswer)) return true
    return salesRefusal(value.replace(operationalAnswer, ' '))
  }
  const remainder = value.replace(normalized(independentEvidence), ' ')
  const refusalMatches = [...remainder.matchAll(new RegExp(salesRefusalPattern.source, 'g'))]
  const refusalClauses = refusalMatches.map((match, index) => remainder.slice(match.index, refusalMatches[index + 1]?.index).trim())
  if (!refusalClauses.length) return true
  return refusalClauses.some(clause => {
    // Keep rejection of buying, curiosity and a wrong number global even if an
    // unrelated pending workflow is also interpreted as declined.
    if (/compra|adquirir|invertir|curiosidad|equivocad/.test(clause)) return true
    const qualified = /no (?:no )?(?:estoy interesad[oa]|me interesa)\s+(?:(?:en|el|la|un|una|los|las|ese|esa)\s+){0,3}(?:financ\w*|credito\w*|hipotec\w*|visita\w*|cita\w*|reserv\w*|separacion)\b/.test(clause)
    return !qualified && (!operationalAnswer || normalized(clause) !== operationalAnswer)
  })
}

/** Permission to resolve a current property request is narrower than permission
 * to make another sales offer. It never grants financing, reservation or a visit. */
export function requestedPropertyContinuation(current: string, input: CommercialEngagementTurn = {}): Row {
  const semantics = object(input.semantics), intent = object(input.intent)
  const scope = object(input.scope || intent.scope), property = object(semantics.property)
  const answer = object(semantics.answer_to_previous), pending = object(input.pendingQuestion || intent.pending_question)
  const objective = text(intent.objective || semantics.primary_intent)
  const deny = (reason: string) => ({ version: 'requested-property-continuation-v1', allowed: false,
    property_interest_renewed: false, reason, evidence: '', allowed_question_ids: [] })
  if (scope.uncertain === true || !['property', 'mixed', 'neutral'].includes(text(scope.kind))) return deny('property_scope_not_verified')
  if (currentSalesRefusal(current, input)) return deny('current_sales_refusal')
  const literal = (value: unknown) => currentEvidence(current, value)
  const requests = (Array.isArray(intent.requests) ? intent.requests : []).map(object)
  const request = requests.find(row => row.domain === 'property' && row.confidence === 'high'
    && row.source !== 'pending' && !row.source_message_id && literal(row.evidence))
  const evidence = property.confidence === 'high' && propertyOperations.has(text(property.operation)) ? literal(property.evidence) : ''
  const filters = object(property.filters)
  const criteria = propertyCategories.has(text(property.category))
    || Array.isArray(property.unit_numbers) && property.unit_numbers.length > 0
    || ['bedrooms', 'floor_number', 'min_area_m2', 'max_area_m2', 'bedrooms_upper'].some(key => typeof filters[key] === 'number' && Number.isFinite(filters[key]) && Number(filters[key]) >= 0)
    || Array.isArray(filters.bedrooms_any) && filters.bedrooms_any.some(value => typeof value === 'number' && Number.isInteger(value) && value > 0)
  const propertyPending = propertyQuestions.includes(text(pending.id)) && !!replyQuestionText(text(pending.question))
  const answerEvidence = answer.confidence === 'high' && answer.question_id === pending.id ? literal(answer.evidence) : ''
  const sameNegative = propertyPending && answer.kind === 'negative' && answerEvidence
    && (!evidence || normalized(evidence) === normalized(answerEvidence))
  if (sameNegative && !request) return deny('current_property_choice_declined')
  const explicitRequest = propertyObjectives.has(objective) && (request || evidence)
    && (scope.kind !== 'neutral' || request || criteria)
  const propertyAnswer = propertyPending && answerEvidence && ['affirmative', 'uncertain', 'value'].includes(text(answer.kind))
    && scope.kind !== 'neutral'
  if (!explicitRequest && !propertyAnswer) return deny('no_current_property_request_or_verified_answer')
  const renewal = explicitRequest && objective === 'select_property' && semantics.confidence === 'high'
    && property.confidence === 'high' && ['search', 'rank', 'select'].includes(text(property.operation)) && !!evidence && criteria
  return { version: 'requested-property-continuation-v1', allowed: true, property_interest_renewed: !!renewal,
    reason: renewal ? 'current_concrete_property_search' : propertyAnswer ? 'current_answer_to_property_question' : 'current_property_information_request',
    objective, evidence: evidence || text(request?.evidence) || answerEvidence,
    allowed_question_ids: [...propertyQuestions] }
}

/** A factual question can show interest without revoking an earlier sales refusal. */
function renewedPropertyInterest(m: string) {
  return /(?:quiero|quisiera|busco|deseo|me interesa|estoy interesad[oa] en) (?:comprar|adquirir|invertir)/.test(m)
    && (property.test(m) || !/taxi|comida|cafe|capuchino|vehiculo|carro|vuelo|moto/.test(m))
    || /(?:ahora si|si) (?:me interesa|estoy interesad[oa])/.test(m) && property.test(m)
    || /(?:quiero|quisiera|deseo|me gustaria).*(?:visitar|agendar una visita|revisar (?:mi |el )?financiamiento|iniciar (?:la |una )?evaluacion)/.test(m)
    || /(?:busco|quiero|quisiera|me interesa|necesito).*(?:departamento|suite|vivienda|local)/.test(m)
      && /\b[123] (?:dormitorios|habitaciones|cuartos)|para (?:vivir|invertir|mi negocio)|presupuesto|\$|\b\d{3}\b/.test(m)
}

export function explicitPropertyInterest(value: string) {
  const m = normalized(value)
  if (/no (?:estoy interesad|me interesa|quiero comprar|quiero adquirir)|solo (?:por )?curiosidad/.test(m)) return false
  // Consulta concreta de disponibilidad / precio / visita sobre propiedad identificada.
  if (
    identifiedProperty.test(m) &&
    /(?:disponib|sigue\s+libre|todavia\s+est[aá]|precio|cu[aá]nto\s+(?:cuesta|cuesta|vale)|valor|visita|agendar|conocer\s+el\s+(?:depto|departamento|suite)|mas\s+informacion\s+sobre\s+(?:este|esta|el|la))/.test(
      m,
    )
  ) {
    return true
  }
  // Disponibilidad explícita aunque el eco del anuncio no repita tipología.
  if (
    /(?:todavia|aun)\s+est[aá]\s+disponib|est[aá]\s+disponib(?:le)?(?:\s+todavia)?|sigue\s+disponib/.test(m) &&
    !/taxi|comida|cafe|capuchino|vehiculo|carro|vuelo|moto/.test(m)
  ) {
    return true
  }
  return renewedPropertyInterest(m)
}

/** Scope comprehension is not buying interest. Remember an explicit stop until real renewed interest. */
export function commercialEngagement(current: string, history: unknown, previous: unknown = {}, turn?: CommercialEngagementTurn): CommercialEngagementState {
  const saved = object(previous)
  let passive = saved.passive_sales === true, interested = saved.property_interest === true
  const rows = (Array.isArray(history) ? history : []).map(object)
  // Versioned memory already reconciled the earlier turns semantically. Do not
  // reinterpret a scoped refusal in that history through the legacy text scan.
  const messages = [...(turn && saved.engagement_version === COMMERCIAL_ENGAGEMENT_VERSION ? [] : rows),
    { role: 'cliente', content: current }]
  for (const [index, row] of messages.entries()) {
    const content = text(row.content), m = normalized(content)
    if (row.role === 'cliente') {
      if (salesRefusal(m) && (!turn || index !== messages.length - 1 || currentSalesRefusal(content, turn))) { passive = true; interested = false }
      else if (explicitPropertyInterest(content) && (!passive || renewedPropertyInterest(m))) { passive = false; interested = true }
    } else if (['bot', 'asesor'].includes(text(row.role)) && isPropertyScopeRedirect(content)
      && !/no (?:vendemos|ofrecemos).{0,20}(?:casas|credito directo)/.test(m)) { passive = true; interested = false }
  }
  if (!turn) return { passive, interested }
  const scope = object(turn.scope || object(turn.intent).scope)
  if (scope.kind === 'out_of_scope') { passive = true; interested = false }
  const continuation = requestedPropertyContinuation(current, turn)
  if (continuation.property_interest_renewed === true) { passive = false; interested = true }
  return { passive, interested, property_continuation_allowed: continuation.allowed === true, property_continuation: continuation }
}

export function passiveSalesRules(state: ReturnType<typeof commercialEngagement>) {
  return state.passive ? 'MODO INFORMATIVO: la memoria limita las ofertas no solicitadas; no atribuya al lead un rechazo que no esté documentado. Conteste todas las preguntas con datos verificados. No añada financiamiento, visita, reserva, brochure, datos personales ni presupuesto no solicitado. Una pregunta de precio o «comprendo» no revoca el rechazo. Si pide explícitamente financiamiento, visita o asesor, atienda esa petición sin añadir otra oferta.'
    + (state.property_continuation_allowed === true ? ' La solicitud actual de inmuebles sí permite una pregunta pertinente para resolverla: categoría, planta, dormitorios, área, revisión de una alternativa o elección entre opciones efectivamente presentadas. Conserve el alcance de property_continuation; esa aclaración no concede consentimiento para otro trámite ni para capturar datos personales o presupuesto.'
      : ' No agregue preguntas de calificación ni otra invitación comercial no solicitada.') : ''
}

/** Detect unrequested offers without altering the draft or deleting any requested facts. */
export function passiveSalesCopy(reply: string, current: string, state: ReturnType<typeof commercialEngagement>) {
  if (!state.passive) return reply
  const requested = normalized(current)
  const clauses = reply.split(/(?<=[.!?])\s+|\n+/)
  const kept = clauses.filter(clause => {
    const m = normalized(clause)
    if (/\?/.test(clause) && /presupuesto|para vivir|para invertir/.test(m)) return false
    if (/\?/.test(clause) && /interesa|busca|dormitorio/.test(m) && state.property_continuation_allowed !== true) return false
    const offer = /podemos|puedo|si (?:le interesa|desea|quiere|esta interesado)|le gustaria|le interesa|desea (?:que|conocer|revisar|coordinar)|le invito|tambien|para el financiamiento trabajamos|le comparto|contamos con|tenemos opciones de financ|visitenos/.test(m)
    if (!offer) return true
    if (/financ|credito|pichincha|\bjep\b/.test(m) && !/financ|credito|pichincha|\bjep\b|no se si.*alcanz|no me alcanza/.test(requested)) return false
    if (/visita|oficina|cita/.test(m) && !/visita|oficina|cita/.test(requested)) return false
    if (/brochure|folleto|distribucion|muestre una opcion|opcion de ese rango/.test(m) && !/brochure|folleto|distribucion|muestre|opciones/.test(requested)) return false
    return true
  })
  return kept.length === clauses.length ? reply : kept.map(c => c.trim()).filter(Boolean).join(' ')
}
