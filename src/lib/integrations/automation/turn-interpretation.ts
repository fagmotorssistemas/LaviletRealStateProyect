import { createHash } from 'node:crypto'
import { object, text, type Row } from './data'
import { normalizeEvents, VISIT_INTENT_EXTRACTION_RULES, VISIT_PREFERENCE_EXTRACTION_RULES } from './conversation-rules'
import { normalizeTurnSemantics, TURN_SEMANTIC_EXTRACTION_RULES, TURN_SEMANTICS_SCHEMA } from './turn-semantics'
import { isGreetingOnly, normalized } from './sdr-rules'
import { TURN_RULES } from './turn-routing'

export const CONVERSATION_CONTRACT_VERSION = 'lavilet-dialogue-v2'

const nullableString = { type: ['string', 'null'] }
const nullableNumber = { type: ['number', 'null'] }
const boolean = { type: 'boolean' }
const closedObject = (properties: Row): Row => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
const nullableObject = (properties: Row): Row => ({ anyOf: [closedObject(properties), { type: 'null' }] })
const confidence = { type: 'string', enum: ['high', 'medium', 'low'] }
const requestDomains = ['property', 'visit', 'financing', 'advisor', 'tracking', 'courtesy', 'other'] as const

/** One versioned extraction contract. Unknown values stay null; actions still require server validation. */
export const TURN_EXTRACTION_SCHEMA = closedObject({
  events: { type: 'array', items: { type: 'string', enum: ['declared_unit_type', 'declared_purchase_purpose', 'asked_location_features', 'asked_delivery_date', 'asked_price', 'asked_financing', 'requested_visit', 'asked_reservation', 'nutrition_response'] } },
  preferred_category: { type: ['string', 'null'], enum: ['suite', 'departamento', 'penthouse', 'local', null] },
  purchase_purpose: { type: ['string', 'null'], enum: ['vivir', 'invertir', 'segunda_vivienda', 'negocio', null] },
  declaration_evidence: closedObject({ preferred_category: nullableString, purchase_purpose: nullableString }),
  action_evidence: closedObject({ requested_advisor: nullableString, opt_out: nullableString, consent_granted: nullableString }),
  qualification: closedObject(Object.fromEntries(['actividad_comercial', 'area_buscada', 'prioridad', 'plazo_compra', 'presupuesto_texto', 'dormitorios_texto'].map(key => [key, nullableString]))),
  unit_id: nullableString,
  preferred_visit_time_text: nullableString,
  visit_needs_help: boolean,
  requested_advisor: boolean,
  opt_out: boolean,
  consent_granted: boolean,
  financing_consent: { type: ['boolean', 'null'] },
  financing_partner: nullableString,
  full_name: nullableString,
  applicant_type: { type: ['string', 'null'], enum: ['empleado', 'independiente', null] },
  national_id: nullableString,
  employment_stability_months: nullableNumber,
  job_title: nullableString,
  monthly_income: nullableNumber,
  ruc: nullableString,
  visit_preference: nullableObject({ evidence: { type: 'string' }, date_text: nullableString, time_text: nullableString,
    location_type: { type: ['string', 'null'], enum: ['office', 'site', 'work_area', 'model', 'completed_unit', null] }, confidence }),
  visit_intent: nullableObject({ kind: { type: 'string', enum: ['request_visit', 'accept_visit_preference', 'visit_status', 'none'] }, evidence: { type: 'string' }, confidence }),
  requests: { type: 'array', items: closedObject({ request: { type: 'string' }, domain: { type: 'string', enum: [...requestDomains] }, evidence: { type: 'string' }, confidence }) },
  turn_semantics: TURN_SEMANTICS_SCHEMA,
})

type Dependencies = {
  activePrompt: (name: string) => Promise<string>
  aiJson: (instructions: string, input: unknown, schema?: Row) => Promise<Row>
  onPromptRevision?: (revision: string) => void
}

export type TurnInterpretation = {
  extracted: Row
  semantics: Row
  requests: Row[]
  method: 'model' | 'literal_greeting' | 'unreadable_input'
  promptRevision: string | null
  diagnostic: Row
}

const evidenceMatches = (evidence: string, current: string) => evidence.length > 0 && evidence.length <= 500
  && current.normalize('NFKC').toLowerCase().includes(evidence.normalize('NFKC').toLowerCase())

/** Model flags require current evidence; legacy outputs only use explicit requests. */
function evidencedActions(raw: Row, current: string) {
  const evidence = object(raw.action_evidence), message = normalized(current)
  const supported = (key: string) => raw[key] === true && evidenceMatches(text(evidence[key]), current)
  const advisorDeclined = /\bno (?:quiero|deseo|necesito|prefiero)\b[^.!?]{0,35}\b(?:asesor|persona|humano|llamada)\b/.test(message)
  const advisorRequested = /\b(?:quiero|quisiera|necesito|deseo|prefiero|puedo|podria|puede)\b[^.!?]{0,70}\b(?:asesor|asesora|persona|humano|humana|llamada|llame|llamen)\b/.test(message)
    || /\b(?:paseme|comuniqueme|comunicame|deriveme|transfierame)\b[^.!?]{0,45}\b(?:asesor|persona|humano)\b/.test(message)
    || /^(?:por favor )?(?:llameme|llamame|que me llamen|quiero que me llamen)\b/.test(message)
  const explicitOptOut = /\bno (?:me )?(?:envien|mande|manden|escriban|contacten)|\bdejen de (?:escribirme|contactarme)|\bno (?:quiero|deseo) recibir[^.!?]{0,50}(?:mensaj|novedad|seguimiento)|\b(?:elimine|borre) (?:mi )?(?:numero|contacto)\b/.test(message)
  const explicitConsent = /\b(?:acepto|autorizo|quiero|deseo)\b[^.!?]{0,25}\brecibir\b[^.!?]{0,35}\b(?:novedades|seguimiento|mensajes)\b/.test(message)
  const optOut = supported('opt_out') || explicitOptOut
  return { requested_advisor: !advisorDeclined && (supported('requested_advisor') || advisorRequested), opt_out: optOut,
    tracking_consent: !optOut && (supported('consent_granted') || explicitConsent) }
}

/** Called for every authorized turn, before a response route or operational decision is selected. */
export async function interpretConversationTurn(input: Row, dependencies: Dependencies): Promise<TurnInterpretation> {
  const current = text(input.mensaje_actual)
  const readable = current.replace(/\[Archivo no interpretado[^\]]*\]|\[Sticker recibido\]/g, '').trim()
  const method = !readable ? 'unreadable_input' : isGreetingOnly(readable) ? 'literal_greeting' : 'model'
  let raw: Row = {}, promptRevision: string | null = null
  if (method === 'model') {
    const prompt = await dependencies.activePrompt('extractor_eventos')
    const instructions = prompt + '\n' + TURN_RULES + '\n' + VISIT_PREFERENCE_EXTRACTION_RULES + '\n'
      + VISIT_INTENT_EXTRACTION_RULES + '\n' + TURN_SEMANTIC_EXTRACTION_RULES + `
Contrato ${CONVERSATION_CONTRACT_VERSION}. Devuelva todos los campos del esquema; null significa desconocido.
Enumere en requests TODAS las solicitudes actuales, incluidas dudas adicionales, correcciones, peticiones de asesor y no recibir más mensajes. Cada evidence debe ser literal del mensaje actual. No rellene solicitudes del historial.
Separe las solicitudes independientes y asigne domain: property para catálogo, precios, características y datos del proyecto; visit para coordinar, aceptar, cambiar, cancelar o consultar una visita inmobiliaria; financing para consulta o revisión financiera; advisor para atención humana explícita; tracking para alta/baja de mensajes; courtesy para agradecimientos, despedidas y cortesía sin consulta nueva; other para temas ajenos o sin dominio resoluble. «Sí, confirmo la cita; además, ¿admiten mascotas?» contiene una solicitud visit y otra property. «Sí, confirmo la cita, muchas gracias» contiene una aceptación visit y cortesía courtesy, sin nueva consulta comercial. No absorba consultas adicionales dentro de visit ni clasifique una cita ajena al proyecto como visita inmobiliaria. El dominio describe la solicitud, nunca acredita una acción realizada.
mensaje_accion contiene solo la parte inmobiliaria autorizada por el clasificador de alcance. Las declaraciones, visitas, financiamiento y solicitudes de asesor requieren evidencia en mensaje_accion. Una baja de mensajes (opt_out) es global y puede proceder de mensaje_actual completo. No derive al equipo inmobiliario una solicitud de asesor de otro negocio.
Para requested_advisor, opt_out y consent_granted copie en action_evidence el fragmento literal ACTUAL que autoriza esa acción, o null. Una pregunta de precio, un brochure, aceptar detalles y un agradecimiento no solicitan asesor ni conceden seguimiento. El historial no autoriza una acción nueva.
La pregunta pendiente puede contener target_ids y candidate_ids: la aceptación responde al acto y al referente de esa pregunta; no acepta otra acción ni una reserva.
Una pregunta nueva sobre dormitorios o tamaño NO es una respuesta negativa al presupuesto por comenzar con "no". "Vivienda" indica el grupo residencial, no elige departamentos frente a suites ni declara un presupuesto.
El historial puede identificar una referencia implícita; diferencie esa referencia de un código expresado literalmente. Consultar el máximo o las opciones de una planta no significa elegir ni reservar una unidad.
Use la última pregunta REAL del bot. Pedir ayuda para un horario activa requested_visit y visit_needs_help; no requested_advisor por ese solo motivo. Una fecha parcial responde a una coordinación durable. Extraiga financing_partner incluso si no está entre las entidades disponibles. No transforme información comercial en consentimiento.
Un archivo no interpretado no aporta evidencia. Use el texto legible que lo acompaña; no recupere intenciones viejas para llenar ese vacío.`
    promptRevision = createHash('sha256').update(instructions).digest('hex').slice(0, 16)
    dependencies.onPromptRevision?.(promptRevision)
    raw = await dependencies.aiJson(instructions, { ...input, mensaje_actual: readable }, TURN_EXTRACTION_SCHEMA)
  }
  const actionMessage = Object.hasOwn(input, 'mensaje_accion') ? text(input.mensaje_accion) : readable
  const extracted = normalizeEvents(raw, actionMessage)
  const actions = evidencedActions(raw, actionMessage)
  actions.opt_out = evidencedActions(raw, readable).opt_out
  if (actions.opt_out) actions.tracking_consent = false
  Object.assign(extracted, actions)
  // An unreadable reaction or a greeting must never inherit operational events from history.
  if (method !== 'model') extracted.events = []
  const semantics = normalizeTurnSemantics(raw, actionMessage, input.pregunta_pendiente)
  const requests = (Array.isArray(raw.requests) ? raw.requests : []).map(object)
    .filter(request => text(request.request).trim() && evidenceMatches(text(request.evidence), readable))
    .slice(0, 12).map(request => ({ request: text(request.request).slice(0, 500),
      domain: requestDomains.includes(text(request.domain).trim().toLowerCase() as typeof requestDomains[number]) ? text(request.domain).trim().toLowerCase() : 'other',
      evidence: text(request.evidence), confidence: ['high', 'medium', 'low'].includes(text(request.confidence)) ? request.confidence : 'low' }))
  const property = object(semantics.property)
  return { extracted, semantics, requests, method, promptRevision,
    diagnostic: {
      contract_version: CONVERSATION_CONTRACT_VERSION, method,
      primary_intent: semantics.primary_intent, confidence: semantics.confidence,
      property_group: property.group || null, property_category: property.category || null,
      operation: property.operation || null, filters: object(property.filters),
      reference_kind: property.reference_kind || null, selector: property.selector || null,
      unit_numbers: property.unit_numbers || [], query_scope: property.query_scope || null,
      request_count: requests.length,
      normalization_issues: semantics.normalization_issues || [],
      // No free-form financial/identity fields enter execution telemetry.
      discarded_request_count: Math.max(0, (Array.isArray(raw.requests) ? raw.requests.length : 0) - requests.length),
    },
  }
}

/** Structured continuity replaces an additional free-form summary inference on every turn. */
export function rememberInterpretedTurn(previous: Row, current: string, extracted: Row): Row {
  const facts = { ...object(previous.datos_confirmados) }
  if (extracted.preferred_category) facts.categoria = extracted.preferred_category
  if (extracted.purchase_purpose) facts.proposito = extracted.purchase_purpose
  return { ...previous, solicitud_actual: current.slice(0, 1200), datos_confirmados: facts,
    _turn_contract: CONVERSATION_CONTRACT_VERSION }
}
