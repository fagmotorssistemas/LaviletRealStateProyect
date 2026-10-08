import { PROPERTY_CATEGORIES } from './property-category-contract'
import { object, text, type Row } from './data'
import { normalized } from './sdr-rules'
import { financingDocument } from './financing-identity'
import { EXTRACTED_CONVERSATION_EVENTS } from './event-contract'
const events = new Set<string>(EXTRACTED_CONVERSATION_EVENTS)

export const VISIT_PREFERENCE_EXTRACTION_RULES = `
Cuando el mensaje contenga una preferencia de fecha u hora para una visita, devuelva además:
"visit_preference":{"evidence":"copia literal del fragmento del cliente","date_text":"fecha corregida o null","time_text":"hora corregida o null","location_type":"office|site|work_area|model|completed_unit|null","confidence":"high|medium|low"}.
date_text debe conservar el sentido y usar solo una de estas formas: hoy, mañana, pasado mañana, un día de lunes a domingo con referencia opcional a esta/próxima semana, AAAA-MM-DD, DD/MM/AAAA o DD de mes.
time_text debe usar una hora inequívoca como "a las 10 am", "a las 14:30", "por la mañana" o "por la tarde". Corrija faltas ortográficas evidentes, pero no cambie el día, la hora ni AM/PM.
evidence debe ser una copia literal presente en mensaje_cliente. Use confidence=high solo cuando exista una única interpretación clara. Ante alternativas, negaciones, aproximaciones, contradicciones o duda, use medium/low. Si no hay preferencia de visita, devuelva visit_preference:null.
location_type representa respectivamente oficina, terreno del proyecto, área autorizada de obra, departamento modelo o unidad terminada. No lo complete si el cliente no menciona un lugar.
No convierta hoy/mañana ni un día de la semana en una fecha absoluta; el calendario la calculará con la fecha real del mensaje.`

export const VISIT_INTENT_EXTRACTION_RULES = `
Devuelva además "visit_intent" para interpretar semánticamente SOLO la intención de visita del mensaje actual:
{"kind":"request_visit|accept_visit_preference|visit_information|decline_visit|visit_status|none","purpose":"coordination|preference|accept_alternative|availability_information|access_information|decline|cancel|status|none","target":"project|other|unspecified","destination":"office|site|work_area|model|completed_unit|building|null","evidence":"copia literal del fragmento del cliente","confidence":"high|medium|low"}.
request_visit: el cliente pide agendar, coordinar o realizar una visita inmobiliaria (purpose=coordination), o aporta una fecha/hora para la coordinación vigente (purpose=preference), aunque tenga errores ortográficos o palabras separadas incorrectamente. Preguntar días, horarios o cupos es visit_information con availability_information: NO solicita crear una cita ni acepta un lugar alternativo.
accept_visit_preference: acepta inequívocamente una fecha/hora pendiente (preference) o el lugar alternativo ofrecido (accept_alternative). Una respuesta breve solo acepta la alternativa o propuesta concreta demostrada por dialogo_visita, pregunta_pendiente o coordinacion_visita; no acepta simultáneamente fechas, lugares ni opciones no elegidas.
visit_information/access_information: pregunta qué puede visitar, por qué no está habilitado un lugar o cómo es la atención. decline_visit distingue decline (rechaza la visita o la alternativa) de cancel (pide cancelar una solicitud real). visit_status/status pregunta si una solicitud ya quedó registrada o confirmada. none/none: cualquier otra intención, incluidas consultas de seguridad, precios o financiamiento que no pidan visitas.
target indica a qué negocio pertenece la cita según mensaje e historial: project cuando se refiere a este proyecto, other para otro servicio y unspecified si falta referente. destination conserva el lugar pedido o elegido en el mensaje actual: building para edificación sin un área específica; no lo cambie por office porque sólo la oficina esté habilitada. Si no menciona ni acepta un lugar, use null. Una consulta sobre horarios después de una oficina ofrecida no acepta esa oficina. Rechazar la edificación tampoco acepta la oficina.
No confunda una fecha futura como "miércoles que viene" con una pregunta sobre si una persona va a venir. No convierta una cita médica, vuelo, hotel u otro servicio ajeno en una visita al proyecto.
Use confidence=high solo cuando el fragmento literal permite una única interpretación. evidence debe ser una copia literal presente en mensaje_actual. No use el historial como evidencia de una intención nueva.`

const plain = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
const weekday = '(?:lunes|martes|miercoles|jueves|viernes|sabado|domingo)'
const month = '(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)'
const datePattern = new RegExp(`^(?:hoy|manana|pasado manana|mismo dia|(?:el )?${weekday}(?: de (?:esta semana|la (?:proxima|siguiente) semana|la semana (?:que viene|entrante)))?|(?:el )?[0-9]{4}-[0-9]{2}-[0-9]{2}|(?:el )?[0-9]{1,2}/[0-9]{1,2}(?:/[0-9]{4})?|(?:el )?[0-9]{1,2} de ${month}(?: de [0-9]{4})?)$`)
const timePattern = /^(?:misma hora|mismo horario|(?:a las? )?(?:[01]?[0-9]|2[0-3])(?::[0-5][0-9])?\s*(?:am|pm|horas?)?|(?:por|en|de) la (?:manana|tarde|noche))$/

export function normalizedVisitPreference(raw: unknown, message: string): Row | null {
  const preference = object(raw)
  const evidence = text(preference.evidence).trim()
  if (preference.confidence !== 'high' || !evidence || evidence.length > 240) return null
  const normalizedEvidence = normalized(evidence)
  const normalizedMessage = normalized(message)
  if (!normalizedEvidence || !normalizedMessage.includes(normalizedEvidence)) return null
  // A canonical value must never silently select one of several options or turn a rejection into a request.
  if (/\b(?:o|entre|quizas|tal vez|aproximadamente|alrededor)\b/.test(normalizedMessage)
    || /\b(?:no puedo|no quiero|cancelar|cancelo|cancelacion)\b/.test(normalizedEvidence)) return null
  const dateText = plain(text(preference.date_text))
  const timeText = plain(text(preference.time_text))
  const locationType = ['office', 'site', 'work_area', 'model', 'completed_unit'].includes(text(preference.location_type)) ? text(preference.location_type) : null
  if ((dateText && !datePattern.test(dateText)) || (timeText && !timePattern.test(timeText)) || (!dateText && !timeText && !locationType)) return null
  const canonicalText = [dateText, timeText].filter(Boolean).join(' ')
  if (canonicalText.length > 160) return null
  return { evidence, date_text: dateText || null, time_text: timeText || null, location_type: locationType,
    canonical_text: canonicalText || null, confidence: 'high' }
}

export function normalizedVisitIntent(raw: unknown, message: string): Row | null {
  const intent = object(raw)
  const kind = text(intent.kind)
  const evidence = text(intent.evidence).trim()
  if (!['request_visit', 'accept_visit_preference', 'visit_information', 'decline_visit', 'visit_status', 'none'].includes(kind)
    || intent.confidence !== 'high' || !evidence || evidence.length > 240) return null
  const normalizedEvidence = normalized(evidence)
  const normalizedMessage = normalized(message)
  if (!normalizedEvidence || !normalizedMessage.includes(normalizedEvidence)) return null
  if (kind === 'request_visit' && /\b(?:no|tampoco|ni)\s+(?:quiero|quisiera|deseo|puedo|podemos|me interesa|me gustaria)\b/.test(normalizedEvidence)) return null
  const purposes = ['coordination', 'preference', 'accept_alternative', 'availability_information', 'access_information', 'decline', 'cancel', 'status', 'none']
  const purpose = purposes.includes(text(intent.purpose)) ? text(intent.purpose)
    : kind === 'request_visit' ? 'coordination' : kind === 'accept_visit_preference' ? 'preference' : kind === 'visit_status' ? 'status' : 'none'
  const compatiblePurposes: Record<string, string[]> = { request_visit: ['coordination'], accept_visit_preference: ['preference', 'accept_alternative'],
    visit_information: ['availability_information', 'access_information'], decline_visit: ['decline', 'cancel'], visit_status: ['status'], none: ['none'] }
  if (!compatiblePurposes[kind].includes(purpose)) return null
  const target = ['project', 'other', 'unspecified'].includes(text(intent.target)) ? text(intent.target) : 'unspecified'
  const destination = ['office', 'site', 'work_area', 'model', 'completed_unit', 'building'].includes(text(intent.destination)) ? text(intent.destination) : null
  return { kind, purpose, target, destination, evidence, confidence: 'high' }
}

export function normalizeEvents(raw: unknown, message: string, awaitingDocument = false): Row {
  const data = object(raw)
  const nullableText = (key: string) => text(data[key]).trim() || null
  const positive = (key: string) => typeof data[key] === 'number' && Number.isFinite(data[key]) && Number(data[key]) >= 0 ? data[key] : null
  const chosenEvents = [...new Set(['first_response', ...(Array.isArray(data.events) ? data.events.filter(e => typeof e === 'string' && events.has(e)) : [])])]
  const document = financingDocument(object(data.financing_identity).document || data.national_id || data.ruc
    || (awaitingDocument && /^[\d\s.-]+$/.test(message.trim()) ? message.trim() : ''), message)
  const evidence = object(data.declaration_evidence)
  const supported = (key: string) => {
    const quote = normalized(text(evidence[key]))
    return quote.length > 0 && quote.length <= 180 && normalized(message).includes(quote)
  }
  const category = supported('preferred_category') && (PROPERTY_CATEGORIES as readonly string[]).includes(text(data.preferred_category)) ? data.preferred_category : null
  const purpose = supported('purchase_purpose') && ['vivir', 'invertir', 'segunda_vivienda', 'negocio'].includes(text(data.purchase_purpose)) ? data.purchase_purpose : null
  return {
    events: chosenEvents.filter(e => (e !== 'declared_unit_type' || category) && (e !== 'declared_purchase_purpose' || purpose)),
    preferred_category: category,
    qualification: object(data.qualification),
    purchase_purpose: purpose,
    unit_id: /^[a-f0-9-]{36}$/i.test(text(data.unit_id)) ? data.unit_id : null,
    preferred_visit_time_text: nullableText('preferred_visit_time_text'),
    visit_preference: normalizedVisitPreference(data.visit_preference, message),
    visit_intent: normalizedVisitIntent(data.visit_intent, message),
    visit_needs_help: data.visit_needs_help === true,
    tracking_consent: data.consent_granted === true || data.tracking_consent === true,
    opt_out: data.opt_out === true,
    requested_advisor: data.requested_advisor === true,
    financing_consent: typeof data.financing_consent === 'boolean' ? data.financing_consent : null,
    financing_partner: nullableText('financing_partner'), full_name: nullableText('full_name'),
    applicant_type: ['empleado', 'independiente'].includes(text(data.applicant_type)) ? data.applicant_type : null,
    national_id: document.national_id,
    ruc: null,
    financing_identity: object(data.financing_identity),
    financing_amounts: data.financing_amounts,
    document_validation: document,
    employment_stability_months: Number.isInteger(positive('employment_stability_months')) ? positive('employment_stability_months') : null,
    job_title: nullableText('job_title'), monthly_income: positive('monthly_income'),
  }
}

export function validateIntent(raw: Row, proposal: Row | null, sourceAt: string, registeredAt: string) {
  let intent = text(raw.intent)
  if (!['accept', 'counterproposal', 'reject', 'cancel', 'question', 'unclear', 'opt_out'].includes(intent)) throw new Error('INVALID_VISIT_INTENT')
  if (!proposal && !['question', 'opt_out'].includes(intent)) intent = 'unclear'
  if (intent === 'accept' && (proposal?.status !== 'awaiting_client' || !proposal.advisor_accepted_at
    || !(Date.parse(sourceAt) > Date.parse(text(proposal.propuesta_enviada_at)))
    || !(Date.parse(registeredAt) > Date.parse(text(proposal.propuesta_enviada_at))))) intent = 'unclear'
  return intent
}
