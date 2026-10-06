import { object, text, type Row } from './data'
import { FINANCING_PROCESS_RULES, ASSISTANCE_CONTINUATION_RULES } from './financing-guidance'
import { isCategoryOverview } from './catalog-dialogue'
import { BROCHURE_URL } from './project-material'
import { confirmedLeadProfile } from './lead-profile'
import { declinesUnitTour, unitTourPreviouslySent } from './unit-model'
import { turnContinuation, TURN_CONTINUATION_RULES } from './turn-continuation'
import { PROJECT_DELIVERY_RULES } from '@/lib/inmobiliaria/projectDelivery'

/** Application delivery limit, independent of the preferred conversational length. */
export const MAX_REPLY_CHARACTERS = 3000
const urls = (value: string) => value.match(/https?:\/\/[^\s<>]+/g)?.map(url => url.replace(/[),.;!?]+$/, '')) || []
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(object) : []
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

function sourceUrls(value: unknown): string[] {
  if (typeof value === 'string') return urls(value)
  if (Array.isArray(value)) return value.flatMap(sourceUrls)
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).filter(([key]) => !/^(?:history|historial|summary|resumen|mensaje_actual|current|current_message|request|requests|evidence|source_message_text)$/i.test(key))
    .flatMap(([, entry]) => sourceUrls(entry))
}

function verifiedUrls(verified: Row = {}): string[] {
  // The context also carries extractor output, lead data and history. Those
  // help interpret the request, but cannot authorize a destination supplied by it.
  const authoritativeSources = ['brochure_url', 'visit_location_url', 'ubicacion', 'authorized_links',
    'catalogo', 'catalog_results', 'alternative_results', 'proyecto', 'project', 'politica_visitas',
    'politica_financiera', 'politica_comercial', 'estado_proyecto', 'instalaciones', 'lugares_cercanos',
    'contexto_sector', 'modelo_3d']
  return authoritativeSources.flatMap(key => sourceUrls(verified[key]))
}

/** Material authority comes from configured sources, never from a draft/fallback. */
export function replyLinkContract(_baseReply: string, audit: Row = {}, context: { current?: string; verified?: Row } = {}) {
  const explicit = object(audit.link_contract), profile = object(audit.profile_introduction)
  const intent = object(audit.resolved_turn_intent || context.verified?.contrato_turno)
  const requests = rows(intent.requests).filter(request => request.confidence === 'high')
  const requested = normalized([context.current || '', ...requests.map(request => text(request.request))].join('\n'))
  const tour = object(audit.unit_model)
  const property = object(context.verified?.property_context)
  const selectedTour = !!text(tour.unit_id) && (tour.delivery_required === true
    || strings(audit.selected_unit_ids).includes(text(tour.unit_id))
    || object(property.query).operation === 'select' && strings(property.selected_ids).includes(text(tour.unit_id)))
  const tourSent = unitTourPreviouslySent(tour, context.verified?.historial,
    object(context.verified?.estado_conversacion).unit_models_sent)
  const tourDeclined = declinesUnitTour(context.current || '')
  const showroom = object(audit.showroom_continuation)
  const required = strings(explicit.required_links)
  if (profile.brochure_required === true && text(profile.brochure_url)) required.push(text(profile.brochure_url))
  const asksToReceive = /\b(?:envie(?:me|nos)?|envi[ae]r|manda(?:me|nos)?|mande(?:me|nos)?|comparta(?:me|nos)?|compartir|muestra(?:me|nos)?|muestre(?:me|nos)?|mostrar|pas[ae](?:me|nos)?|quiero ver|quisiera ver|puedo ver|ver|explorar)\b[^.!?\n]{0,70}\b/
  if (text(tour.url) && !tourDeclined && (selectedTour && !tourSent || showroom.reason === 'requested_visualization'
    || new RegExp(asksToReceive.source + '(?:recorrido|showroom|tour|360|modelo virtual)\\b').test(requested)
      && !/\bno\s+(?:me\s+)?(?:quiero|necesito|interesa|envie|mande|comparta).{0,45}(?:recorrido|showroom|tour|360|modelo)/.test(requested))) required.push(text(tour.url))
  if (audit.source === 'brochure' || new RegExp(asksToReceive.source + '(?:brochure|folleto|brochur|pdf)\\b').test(requested)
    && !/\bno\s+(?:me\s+)?(?:quiero|necesito|interesa|envie|mande|comparta).{0,45}(?:brochure|folleto|brochur|pdf)/.test(requested)) {
    required.push(text(profile.brochure_url) || text(context.verified?.brochure_url) || BROCHURE_URL)
  }
  const allowed = [BROCHURE_URL, ...verifiedUrls(context.verified), ...strings(explicit.allowed_links),
    ...urls(text(profile.brochure_url)), ...urls(text(tour.url))]
  const brochureLinks = [BROCHURE_URL, text(profile.brochure_url), text(context.verified?.brochure_url)].filter(Boolean)
  const shared = profile.brochure_previously_sent === true || object(context.verified?.estado_conversacion).brochure_sent === true
  const resend = required.some(url => brochureLinks.includes(url))
  const tourOmitted = tourDeclined || tourSent && !required.includes(text(tour.url))
  return { allowed_links: [...new Set(allowed.filter(url => (!shared || resend || !brochureLinks.includes(url))
    && (!tourOmitted || url !== text(tour.url))))], required_links: [...new Set(required)] }
}

export function replyLinkIssues(reply: string, contract: ReturnType<typeof replyLinkContract>): string[] {
  const present = urls(reply)
  return [
    ...(present.some(url => !contract.allowed_links.includes(url)) ? ['unauthorized_link'] : []),
    ...(contract.required_links.some(url => !present.includes(url)) ? ['required_link_omitted'] : []),
  ]
}

/** Complete a scheduled brochure delivery from configured material, without another model call. */
export function includeRequiredBrochure(reply: string, audit: Row = {}, context: { current?: string; verified?: Row } = {}) {
  const contract = replyLinkContract('', audit, context)
  const brochure = text(object(audit.profile_introduction).brochure_url) || text(context.verified?.brochure_url) || BROCHURE_URL
  if (!reply.trim() || !contract.required_links.includes(brochure) || !contract.allowed_links.includes(brochure)
    || urls(reply).includes(brochure) || !/^https?:\/\/\S+$/.test(brochure)) return reply
  const completed = `${reply.trim()}\n\nBrochure del proyecto: ${brochure}`
  // Never truncate the answer, substitute another link, or exceed the delivery limit.
  return completed.length <= MAX_REPLY_CHARACTERS ? completed : reply
}

/** A reservation request/handoff does not reserve inventory or confirm payment. */
export function reservationOperationalIssues(reply: string, audit: Row = {}): string[] {
  const receipt = object(audit.reservation)
  if (!Object.keys(receipt).length && audit.source !== 'reservation_handoff') return []
  const sentences = normalized(reply).split(/(?<=[.!?])\s+|\n+/)
    .filter(sentence => !/\bno\s+(?:se\s+)?(?:ha\s+|hemos\s+)?(?:confirmad|reservad|separad|asignad)|\bno\s+(?:esta|queda|quedo)\s+(?:reservad|separad|confirmad)|\b(?:no|aun no|todavia no) (?:puedo|podemos) confirmar/.test(sentence))
  const value = sentences.join(' '), issues: string[] = []
  const confirmsStock = /\b(?:esta|queda|quedo|ha quedado|hemos|he|ya)\s+(?:ya\s+)?(?:reservad[oa]|separad[oa])\b|\b(?:reserva|separacion)\s+(?:esta\s+|ha quedado\s+)?confirmada\b|\b(?:reservamos|separamos)\s+(?:su|el|la)\s+(?:unidad|departamento|penthouse|suite|local)\b/.test(value)
  if (confirmsStock && receipt.request_status !== 'confirmed') issues.push('reservation_not_confirmed')
  const claimsAssigned = /\basesor[a]?\s+(?:ya\s+)?asignad[oa]\b|\b(?:he|hemos|ya)\s+(?:le\s+)?asignado\b|\b(?:le|se le)\s+asigno\b/.test(value)
  if (claimsAssigned && !(receipt.handoff_verified === true && ['assigned', 'acknowledged'].includes(text(receipt.status)) && receipt.advisor_assigned === true)) issues.push('advisor_assignment_not_verified')
  // Handoff meaning and its matching receipt are checked by the semantic reviewer.
  return issues
}

export const commercialContinuationSources = new Set([
  'property_unit_selected', 'property_budget_deferred', 'property_budget_confirmed',
  'property_floor_comparison', 'property_floor_options', 'property_living_options',
  'unit_alternative', 'unit_alternative_journey', 'accepted_unit_alternative',
  'accepted_price_option', 'budget_options',
])

const lockedSources = new Set([
  'visit_intake', 'visit_status', 'visit_option_choice', 'visit_acceptance_clarification',
  'financing_selection_required', 'team_attendance', 'reservation_handoff',
])

export const COMMERCIAL_CONTINUATION_RULES = `El objetivo comercial es atender la necesidad actual y ayudar a encontrar una opción viable y un próximo paso pertinente. La selección del cliente se conserva mientras no solicite cambiarla. Ofrecer comparar alternativas NO cambia esa selección ni autoriza a afirmar que el cliente eligió otra unidad. Ante una limitación económica, siga el siguiente paso autorizado para explorar alternativas o financiamiento, sin volver a elegir planta o unidad resueltas. No repita datos ya solicitados y respondidos. Afirmar que otra opción cuesta menos exige precios comparables verificados. Preserve condiciones de precios referenciales y no prometa aprobación ni condiciones financieras sin respaldo. Cuando el plan exige una decisión pendiente, responder la consulta debe ir seguido de esa pregunta. Solo puede terminar sin pregunta cuando ninguna obligación del turno la exige, por ejemplo un cierre, una negativa o una espera del equipo.`

/** Locks decisions and facts, not their conversational wording. */
export function responsePlan(baseReply: string, audit: Row, context: { current?: string; verified?: Row } = {}) {
  const source = text(audit.source)
  const intent = object(audit.resolved_turn_intent || context.verified?.contrato_turno)
  const explicit = object(audit.response_contract)
  const pending = object(audit.pending_question)
  const continuation = turnContinuation(audit, context.verified)
  const uncovered = Array.isArray(audit.uncovered_requests) ? audit.uncovered_requests : []
  const locked = audit.coverage_complete !== false && !uncovered.length
    && lockedSources.has(source)
  return {
    source,
    locked,
    current_request: { message: context.current || text(intent.current_message), objective: text(intent.objective),
      requests: rows(intent.requests), subject: object(intent.subject), requested_action: text(intent.requested_action) || null },
    required_facts: strings(intent.required_facts),
    protected_facts: [...rows(object(audit.catalog_results).units), ...rows(object(audit.alternative_results).units),
      ...(audit.verified_catalog === true ? [] : rows(context.verified?.catalogo))],
    covered_requests: Array.isArray(audit.covered_requests) ? audit.covered_requests : [],
    ...replyLinkContract(baseReply, audit, context),
    required_numbers: strings(explicit.required_numbers),
    continuation,
    next_question: text(object(audit.profile_introduction).question || object(audit.financing_collection).next_question
      || continuation.suggested_question || (continuation.action === 'leave_open' ? '' : pending.question
        || object(audit.progressive_selection).question || object(audit.post_tour_continuation).question)) || null,
    operational_state: { source, action: text(audit.action) || null, reservation: object(audit.reservation),
      registration_verified: audit.registration_verified === true, request_id: text(audit.request_id) || null,
      preference: object(audit.preference), pending_question: pending },
  }
}

export const FINAL_WRITER_RULES = `Actúe como redactor final de todas las rutas conversacionales de La Vilet, no solo de la presentación del proyecto.
${TURN_CONTINUATION_RULES}
${PROJECT_DELIVERY_RULES}
estado_comercial es el estado del intercambio, compartido con el revisor. Atienda primero la consulta actual. Si requiere_captura=true, dé una explicación inicial breve con datos básicos pertinentes y solicite únicamente datos_a_pedir, explicando proposito_captura: con brochure_y_guia_personalizada conserve el propósito de compartir el brochure y orientar; con guia_personalizada explique la orientación sin prometer nuevamente el brochure ni condicionar su entrega a esos datos. No adelante preferencias secundarias en lugar de esos datos. Respete la restricción de tipos de inmueble si presentacion_sin_tipos=true. Si requiere_captura=false y los datos ya están confirmados, continúe sin volver a pedirlos. Un cambio de tema o una disculpa no borra la identidad declarada. brochure.accion distingue ofrecer para después, compartir ahora y material ya compartido; no confunda el envío planificado con un envío anterior. Con already_shared omita el enlace y la oferta de reenviarlo; solo vuelva a compartirlo si el lead lo solicita y el contrato indica share_now. El siguiente objetivo se conserva, con libertad de expresión; no amplíe una solicitud general con todas las amenidades y cifras disponibles por costumbre.
Una decisión operativa protegida conserva hechos, consentimiento y estado de trámites; no exige repetir literalmente su pregunta. Puede formular las preguntas pertinentes, con propósito explícito, que mantengan el próximo paso autorizado. Prefiera una pregunta breve; su número es una recomendación editorial y no una condición de aprobación. Nunca convierta una consulta de disponibilidad de inmuebles en una cita. Atienda la solicitud actual completa.
${COMMERCIAL_CONTINUATION_RULES}
${FINANCING_PROCESS_RULES}
${ASSISTANCE_CONTINUATION_RULES}
Redacte desde solicitud_actual, los hechos disponibles y el estado operativo. La respuesta base es un respaldo interno, no una fuente de hechos ni una estructura a imitar, incluso en rutas operativas. Puede organizar, resumir y elegir el detalle útil para la necesidad actual sin copiar una lista o una pregunta de la base. No cambie acciones operativas ni invente selecciones del cliente. Una aceptación continúa la propuesta pendiente; una comparación explica diferencias; una consulta concreta recibe primero su respuesta.
Puede ofrecer orientación contextual razonable: si una familia de seis personas pregunta por comodidad, puede explicar que conviene revisar cómo distribuirían los dormitorios y compartir sus preferencias, usando los dormitorios y superficies verificados como referencia. Compartir dormitorio es una posibilidad general, no una característica del proyecto ni una garantía de capacidad. Distinga claramente sugerencias de hechos; no prometa que una unidad es apta para seis, ni invente ocupación máxima, número de camas, posibilidad de remodelar o dormitorios adicionales. No reduzca la conversación a repetir una ficha cuando puede explicar cómo evaluar las opciones.
No narre su procesamiento interno ni las operaciones que realiza para preparar la respuesta: evite «descarto los penthouses», «me concentro en los departamentos», «he interpretado su intención» o «aplico el filtro». Exprese directamente la información útil para el cliente; por ejemplo, «Los departamentos de 3 dormitorios comparten estas características…». Puede reconocer brevemente su preferencia sin describir el trabajo interno. Esto no impide informar una acción real solicitada por el cliente cuando su resultado esté confirmado en el contexto operativo; nunca la invente.
Responda datos_requeridos con los hechos verificados y conserve las condiciones operativas y enlaces obligatorios. No es obligatorio enumerar todas las cifras, atributos, unidades o frases de una respuesta anterior. cifras_obligatorias solo contiene obligaciones explícitas del contrato operativo, nunca números extraídos de una plantilla. Si menciona una cifra del inmueble o su precio, conserve exactamente el valor de la evidencia verificada, incluidos sus decimales: 142,09 m² puede expresarse como 142.09 m² o en palabras equivalentes, pero nunca como 142 m², ni siquiera diciendo «aproximadamente». Puede omitir una cifra que no sea necesaria; no la redondee, trunque ni calcule otra sin evidencia. Cuando continuacion_del_turno.required=true, atender la consulta no sustituye la pregunta necesaria para continuar.
Si apertura_decidida.policy=first_information_request, abra con una disposición amable a compartir información, por ejemplo «Con mucho gusto le comparto información». En otros turnos apertura_decidida es orientación de tono: puede cambiarla u omitirla. Prefiera una cortesía breve pertinente, sin repetir aperturas recientes. No agregue una fórmula en todos los turnos.
El contrato indica si este turno necesita un saludo inicial. Respete esa necesidad sin copiar literalmente una fórmula. Si decisiones_protegidas=true, conserve los datos y el estado operativo, con libertad para explicar su significado y formular el siguiente paso autorizado. pregunta_siguiente propone una formulación: puede cambiar sus palabras, pero no omitir la finalidad cuando continuacion_del_turno.required=true. Responda primero la solicitud actual.
Nunca invente datos para embellecer una explicación.`

export const CATALOG_WRITER_RULES = FINAL_WRITER_RULES.replace(FINANCING_PROCESS_RULES, '').replace(ASSISTANCE_CONTINUATION_RULES, '')

/** A single state contract for writer and reviewer, independent of base wording. */
export function commercialStageContract(audit: Row, verified: Row = {}, requiredLinks: string[] = []) {
  const introduction = object(audit.profile_introduction), conversation = object(verified.estado_conversacion)
  const profile = confirmedLeadProfile(verified.perfil_lead || introduction.profile_state)
  const nameKnown = profile.name_status === 'confirmed'
  const residenceKnown = profile.residence_status === 'confirmed'
    && Boolean(text(profile.residence_city) || text(profile.residence_country))
  const purpose = text(introduction.question_purpose)
  const collect = ['collect_profile', 'collect_name', 'collect_residence', 'confirm_residence'].includes(purpose)
  const missing = [...(!nameKnown ? ['full_name'] : []), ...(!residenceKnown ? ['current_residence'] : [])]
  const brochureUrl = text(introduction.brochure_url) || text(verified.brochure_url) || BROCHURE_URL
  const share = introduction.brochure_required === true || audit.source === 'brochure' || requiredLinks.includes(brochureUrl)
  const sharedBefore = introduction.brochure_previously_sent === true || conversation.brochure_sent === true
  const brochureAction = share ? 'share_now' : sharedBefore ? 'already_shared'
    : introduction.brochure_deferred === true ? 'offer_after_profile' : 'available_if_relevant'
  return { version: 'commercial-stage-v1',
    etapa: collect ? purpose === 'confirm_residence' ? 'confirm_profile' : 'collect_profile'
      : nameKnown && residenceKnown ? 'continue_with_known_profile' : 'answer_current_request',
    consulta_actual_primero: true, requiere_captura: collect,
    datos_confirmados: { nombre: nameKnown ? profile.full_name : null,
      residencia_actual: residenceKnown ? { city: profile.residence_city || null, country: profile.residence_country || null } : null },
    datos_pendientes: missing, datos_a_pedir: collect ? missing : [],
    residencia_por_confirmar: purpose === 'confirm_residence' ? object(introduction.candidate || profile.residence_candidate) : null,
    proposito_captura: collect ? brochureAction === 'offer_after_profile' ? 'brochure_y_guia_personalizada' : 'guia_personalizada' : null,
    presentacion_sin_tipos: introduction.generic_introduction === true && introduction.brochure_deferred === true,
    brochure: { compartido_previamente: sharedBefore,
      accion: brochureAction,
      url: sharedBefore && !share ? null : brochureUrl },
    siguiente_objetivo: collect ? purpose : text(object(audit.pending_question).act)
      || text(object(audit.resolved_turn_intent || verified.contrato_turno).objective) || 'answer_current_request',
  }
}

export function finalWriterContract(baseReply: string, audit: Row = {}, context: { current?: string; verified?: Row } = {}) {
  const plan = responsePlan(baseReply, audit, context)
  return {
    version: 'final-writer-v3', ruta: plan.source || 'commercial',
    decisiones_protegidas: plan.locked,
    objetivo: 'Atender la solicitud actual con información verificada y el estado operativo real; elegir una explicación y continuación pertinentes al contexto.',
    solicitud_actual: plan.current_request,
    estado_comercial: commercialStageContract(audit, context.verified, plan.required_links),
    datos_requeridos: plan.required_facts,
    base_role: 'internal_fallback_only',
    hechos_protegidos: plan.protected_facts,
    hechos_disponibles: plan.protected_facts,
    price_evidence: audit.price_evidence || null,
    cifras_obligatorias: plan.required_numbers, enlaces_obligatorios: plan.required_links,
    enlaces_permitidos: plan.allowed_links,
    pregunta_siguiente: plan.next_question,
    continuacion_del_turno: plan.continuation,
    pregunta_pendiente: object(audit.pending_question),
    presentacion: { ...(isCategoryOverview(audit) ? object(audit.alternative_presentation)
      : { kind: text(object(audit.catalog_query).operation) || 'commercial' }), policy: 'suggestion_not_required_wording' },
    accion: text(audit.action) || null,
    resultado_operativo: object(audit.reservation),
    estado_operativo: plan.operational_state,
    limites_editoriales: { longitud_sugerida: 1200, preguntas_sugeridas: 1, rechazo_por_estilo: false, limite_entrega: MAX_REPLY_CHARACTERS },
    saludo: { responsable: 'sistema', texto: text(audit.writer_greeting) || null },
  }
}
