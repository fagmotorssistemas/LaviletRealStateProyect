import { object, text, type Row } from './data'
import { isCategoryOverview } from './catalog-dialogue'

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

/** A template URL is allowed evidence, not an obligation to repeat that material. */
export function replyLinkContract(baseReply: string, audit: Row = {}, context: { current?: string; verified?: Row } = {}) {
  const explicit = object(audit.link_contract), profile = object(audit.profile_introduction)
  const intent = object(audit.resolved_turn_intent || context.verified?.contrato_turno)
  const requests = rows(intent.requests).filter(request => request.confidence === 'high')
  const requested = normalized([context.current || '', ...requests.map(request => text(request.request))].join('\n'))
  const tour = object(audit.unit_model)
  const showroom = object(audit.showroom_continuation)
  const required = strings(explicit.required_links)
  if (profile.brochure_required === true && text(profile.brochure_url)) required.push(text(profile.brochure_url))
  const asksToReceive = /\b(?:envie(?:me|nos)?|envi[ae]r|manda(?:me|nos)?|mande(?:me|nos)?|comparta(?:me|nos)?|compartir|muestra(?:me|nos)?|muestre(?:me|nos)?|mostrar|pas[ae](?:me|nos)?|quiero ver|quisiera ver|puedo ver|ver|explorar)\b[^.!?\n]{0,70}\b/
  if (text(tour.url) && (showroom.reason === 'requested_visualization'
    || new RegExp(asksToReceive.source + '(?:recorrido|showroom|tour|360|modelo virtual)\\b').test(requested)
      && !/\bno\s+(?:me\s+)?(?:quiero|necesito|interesa|envie|mande|comparta).{0,45}(?:recorrido|showroom|tour|360|modelo)/.test(requested))) required.push(text(tour.url))
  if (audit.source === 'brochure' || new RegExp(asksToReceive.source + '(?:brochure|folleto|brochur|pdf)\\b').test(requested)
    && !/\bno\s+(?:me\s+)?(?:quiero|necesito|interesa|envie|mande|comparta).{0,45}(?:brochure|folleto|brochur|pdf)/.test(requested)) {
    required.push(...urls(baseReply).filter(url => /brochure|folleto|\.pdf(?:[?#]|$)/i.test(url)))
  }
  const allowed = [...urls(baseReply), ...verifiedUrls(context.verified), ...strings(explicit.allowed_links),
    ...urls(text(profile.brochure_url)), ...urls(text(tour.url))]
  return { allowed_links: [...new Set(allowed)], required_links: [...new Set(required)] }
}

export function replyLinkIssues(reply: string, contract: ReturnType<typeof replyLinkContract>): string[] {
  const present = urls(reply)
  return [
    ...(present.some(url => !contract.allowed_links.includes(url)) ? ['unauthorized_link'] : []),
    ...(contract.required_links.some(url => !present.includes(url)) ? ['required_link_omitted'] : []),
  ]
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
  const claimsHandoff = /\b(?:he|hemos|ya)\s+(?:le\s+)?(?:derivado|pasado|enviado|registrado|solicitado|comunicado)\b|\b(?:solicitud|consulta)\s+(?:ha quedado|esta|quedo)\s+(?:registrada|enviada|derivada|en cola)\b/.test(value)
  if (claimsHandoff && receipt.handoff_verified !== true) issues.push('reservation_handoff_not_verified')
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
  'financing_selection_required', 'financing_question', 'team_attendance', 'reservation_handoff',
])

export const COMMERCIAL_CONTINUATION_RULES = `El objetivo comercial es atender la necesidad actual y ayudar a encontrar una opción viable y un próximo paso pertinente. La selección del cliente se conserva mientras no solicite cambiarla. Ofrecer comparar alternativas NO cambia esa selección ni autoriza a afirmar que el cliente eligió otra unidad. Ante una limitación económica puede ofrecer alternativas verificadas o explorar financiamiento y preguntar qué camino prefiere; no está obligado a pedir presupuesto ni a volver a elegir planta o unidad. No repita datos ya solicitados y respondidos. Afirmar que otra opción cuesta menos exige precios comparables verificados. Preserve condiciones de precios referenciales y no prometa aprobación ni condiciones financieras sin respaldo. Una consulta atendida o un cierre del cliente puede terminar sin pregunta; evalúe una continuación útil sin presionar ni preguntar por costumbre.`

/** Locks decisions and facts, not their conversational wording. */
export function responsePlan(baseReply: string, audit: Row, context: { current?: string; verified?: Row } = {}) {
  const source = text(audit.source)
  const uncovered = Array.isArray(audit.uncovered_requests) ? audit.uncovered_requests : []
  const locked = audit.coverage_complete !== false && !uncovered.length
    && (lockedSources.has(source) || source === 'unit_price' && audit.verified_price_only === true && audit.price_grounded !== true)
  return {
    source,
    locked,
    protected_facts: [...(Array.isArray(object(audit.catalog_results).units) ? object(audit.catalog_results).units as unknown[] : []),
      ...(Array.isArray(object(audit.alternative_results).units) ? object(audit.alternative_results).units as unknown[] : [])],
    covered_requests: Array.isArray(audit.covered_requests) ? audit.covered_requests : [],
    ...replyLinkContract(baseReply, audit, context),
    required_numbers: [...baseReply.matchAll(/\b\d[\d.,]*\b/g)].map(match => match[0]),
    next_question: text(baseReply.match(/[^?¿\n]*\?\s*$/)?.[0]).trim() || null,
  }
}

export const FINAL_WRITER_RULES = `Actúe como redactor final de todas las rutas conversacionales de La Vilet, no solo de la presentación del proyecto.
Una decisión operativa protegida conserva hechos, consentimiento y estado de trámites; no exige repetir literalmente su pregunta. Puede formular las preguntas pertinentes, con propósito explícito, que mantengan el próximo paso autorizado. Prefiera una pregunta breve; su número es una recomendación editorial y no una condición de aprobación. Nunca convierta una consulta de disponibilidad de inmuebles en una cita. La revisión debe comprobar el propósito y la cobertura de la solicitud actual, además de los datos; una respuesta base también puede omitir la consulta.
${COMMERCIAL_CONTINUATION_RULES}
Use contrato_redaccion y evidencia_turno para responder al cliente con naturalidad. No cambie acciones operativas ni invente selecciones del cliente. Si decisiones_protegidas=false, la base es una orientación: puede reorganizar, resumir y elegir una pregunta útil según la necesidad actual, sin repetir preguntas resueltas. Para una familia aún sin requisitos conocidos, oriente con categorías verificadas y pregunte un dato útil como dormitorios, sin inventar ocupación máxima ni asumir tamaño familiar. Una aceptación continúa la propuesta pendiente; una comparación explica diferencias; una consulta concreta recibe primero su respuesta. No convierta un resumen en una lista de fichas.
No narre su procesamiento interno ni las operaciones que realiza para preparar la respuesta: evite «descarto los penthouses», «me concentro en los departamentos», «he interpretado su intención» o «aplico el filtro». Exprese directamente la información útil para el cliente; por ejemplo, «Los departamentos de 3 dormitorios comparten estas características…». Puede reconocer brevemente su preferencia sin describir el trabajo interno. Esto no impide informar una acción real solicitada por el cliente cuando su resultado esté confirmado en el contexto operativo; nunca la invente.
Conserve los hechos necesarios para responder la consulta, condiciones y enlaces obligatorios. Las cifras_obligatorias del contrato deben conservarse; otras cifras de opciones secundarias pueden omitirse cuando no sean pertinentes, sin alterar los valores que sí mencione. No añada brochure, saludo, invitación ni pregunta por costumbre: respete el contrato y el modo comercial del contexto.
Si recibe apertura_decidida, úsela como orientación de tono: puede cambiarla u omitirla. Prefiera una cortesía breve pertinente, sin repetir aperturas recientes. No agregue una fórmula en todos los turnos.
El contrato indica si este turno necesita un saludo inicial. Respete esa necesidad sin copiar literalmente una fórmula. Si decisiones_protegidas=true, conserve los datos y el estado operativo, con libertad para explicar su significado y formular el siguiente paso autorizado. pregunta_siguiente es una propuesta; su redacción puede cambiar y la solicitud actual prevalece sobre una continuación anterior.
Puede mejorar una base correcta pero poco natural. Si ya es clara y pertinente, consérvela. Nunca invente datos para embellecerla.`

export function finalWriterContract(baseReply: string, audit: Row = {}, context: { current?: string; verified?: Row } = {}) {
  const plan = responsePlan(baseReply, audit, context)
  return {
    version: 'final-writer-v2', ruta: plan.source || 'commercial',
    decisiones_protegidas: plan.locked,
    objetivo: plan.locked ? 'Responder conservando la decisión operativa protegida y su próximo paso.'
      : 'Responder todas las solicitudes actuales con la evidencia del turno y una continuación pertinente al contexto. La base no impone su estructura ni su pregunta.',
    hechos_protegidos: plan.protected_facts,
    price_evidence: audit.price_evidence || null,
    cifras_obligatorias: audit.semantic_review_enabled === true && !plan.locked ? [] : plan.required_numbers, enlaces_obligatorios: plan.required_links,
    enlaces_permitidos: plan.allowed_links,
    pregunta_siguiente: plan.next_question,
    pregunta_pendiente: object(audit.pending_question),
    presentacion: isCategoryOverview(audit) ? object(audit.alternative_presentation)
      : { kind: text(object(audit.catalog_query).operation) || 'commercial' },
    accion: text(audit.action) || null,
    resultado_operativo: object(audit.reservation),
    limites_editoriales: { longitud_sugerida: 1200, preguntas_sugeridas: 1, rechazo_por_estilo: false, limite_entrega: MAX_REPLY_CHARACTERS },
    saludo: { responsable: 'sistema', texto: text(audit.writer_greeting) || null },
  }
}
