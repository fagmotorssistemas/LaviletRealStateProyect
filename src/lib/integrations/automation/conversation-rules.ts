import { object,text,type Row } from './data'
import { EXTRACTED_CONVERSATION_EVENTS } from './event-contract'
import { acceptedExtractorConfidence } from './extractor-confidence'
import { financingDocument } from './financing-identity'
import { PROPERTY_CATEGORIES } from './property-category-contract'
import { isAssetOnlyPurposeEvidence,isGeneralProjectOverviewWithoutPurchaseScope,isPassiveProfilePurposeEvidence,isPassivePurchaseEvidence } from './purchase-evidence'

import type { VisitPreferenceContext } from './visit-preference-contract'
import { normalizedVisitPreference } from './visit-preference-contract'
import { actionAuthorized, actionDeclined, currentContactDecision, normalizedActionAuthority } from './action-authority'
const events = new Set<string>(EXTRACTED_CONVERSATION_EVENTS)

export { normalizedVisitPreference,VISIT_PREFERENCE_EXTRACTION_RULES,VISIT_PREFERENCE_SCHEMA } from './visit-preference-contract'

export const VISIT_INTENT_EXTRACTION_RULES = `
Devuelva además "visit_intent" para interpretar semánticamente SOLO la intención de visita del mensaje actual:
{"kind":"request_visit|accept_visit_preference|visit_information|decline_visit|visit_status|none","purpose":"coordination|preference|accept_alternative|availability_information|access_information|decline|cancel|status|none","target":"project|other|unspecified","destination":"office|site|work_area|model|completed_unit|building|null","evidence":"copia literal del fragmento del cliente","confidence":"high|medium|low"}.
request_visit: el cliente pide agendar, coordinar o realizar una visita inmobiliaria (purpose=coordination), o aporta una fecha/hora para la coordinación vigente (purpose=preference), aunque tenga errores ortográficos o palabras separadas incorrectamente. Preguntar días, horarios o cupos es visit_information con availability_information: NO solicita crear una cita ni acepta un lugar alternativo.
accept_visit_preference: acepta inequívocamente una fecha/hora pendiente (preference) o el lugar alternativo ofrecido (accept_alternative). Una respuesta breve solo acepta la alternativa o propuesta concreta demostrada por dialogo_visita, pregunta_pendiente o coordinacion_visita; no acepta simultáneamente fechas, lugares ni opciones no elegidas.
visit_information/access_information: pregunta qué puede visitar, por qué no está habilitado un lugar o cómo es la atención. decline_visit distingue decline (rechaza la visita o la alternativa) de cancel (pide cancelar una solicitud real). visit_status/status pregunta si una solicitud ya quedó registrada o confirmada. none/none: cualquier otra intención, incluidas consultas de seguridad, precios o financiamiento que no pidan visitas.
target indica a qué negocio pertenece la cita según mensaje e historial: project cuando se refiere a este proyecto, other para otro servicio y unspecified si falta referente. destination conserva el lugar pedido o elegido en el mensaje actual: building para edificación sin un área específica; no lo cambie por office porque sólo la oficina esté habilitada. Si no menciona ni acepta un lugar, use null. Una consulta sobre horarios después de una oficina ofrecida no acepta esa oficina. Rechazar la edificación tampoco acepta la oficina.
No confunda una fecha futura como "miércoles que viene" con una pregunta sobre si una persona va a venir. No convierta una cita médica, vuelo, hotel u otro servicio ajeno en una visita al proyecto.
Use confidence=high solo cuando el fragmento literal permite una única interpretación. evidence debe ser una copia literal presente en mensaje_actual. No use el historial como evidencia de una intención nueva.`

export function normalizedVisitIntent(raw: unknown, message: string): Row | null {
  const intent = object(raw)
  const kind = text(intent.kind)
  const evidence = text(intent.evidence).trim()
  if (!['request_visit', 'accept_visit_preference', 'visit_information', 'decline_visit', 'visit_status', 'none'].includes(kind)
    || !acceptedExtractorConfidence(intent.confidence) || !evidence || evidence.length > 240) return null
  const normalizedEvidence = evidence.normalize('NFKC').toLowerCase()
  const normalizedMessage = message.normalize('NFKC').toLowerCase()
  if (!normalizedEvidence || !normalizedMessage.includes(normalizedEvidence)) return null
  const purposes = ['coordination', 'preference', 'accept_alternative', 'availability_information', 'access_information', 'decline', 'cancel', 'status', 'none']
  const purpose = purposes.includes(text(intent.purpose)) ? text(intent.purpose)
    : kind === 'request_visit' ? 'coordination' : kind === 'accept_visit_preference' ? 'preference' : kind === 'visit_status' ? 'status' : 'none'
  const compatiblePurposes: Record<string, string[]> = { request_visit: ['coordination', 'preference'], accept_visit_preference: ['preference', 'accept_alternative'],
    visit_information: ['availability_information', 'access_information'], decline_visit: ['decline', 'cancel'], visit_status: ['status'], none: ['none'] }
  if (!compatiblePurposes[kind].includes(purpose)) return null
  const target = ['project', 'other', 'unspecified'].includes(text(intent.target)) ? text(intent.target) : 'unspecified'
  const destination = ['office', 'site', 'work_area', 'model', 'completed_unit', 'building'].includes(text(intent.destination)) ? text(intent.destination) : null
  return { kind, purpose, target, destination, evidence, confidence: intent.confidence }
}

export function normalizeEvents(raw: unknown, message: string, _awaitingDocument = false, pendingQuestion?: unknown, visitContext?: VisitPreferenceContext): Row { void _awaitingDocument;
  const data = object(raw)
  const authority = normalizedActionAuthority(data.action_authority, message)
  const contact = currentContactDecision(authority)
  const nullableText = (key: string) => text(data[key]).trim() || null
  const positive = (key: string) => typeof data[key] === 'number' && Number.isFinite(data[key]) && Number(data[key]) >= 0 ? data[key] : null
  const chosenEvents = [...new Set(['first_response', ...(Array.isArray(data.events) ? data.events.filter(e => typeof e === 'string' && events.has(e)) : [])])]
  const document = financingDocument(object(data.financing_identity).document || data.national_id || data.ruc, message)
  const evidence = object(data.declaration_evidence)
  const supported = (key: string) => {
    const quote = text(evidence[key]).normalize('NFKC').toLowerCase()
    return quote.length > 0 && quote.length <= 500 && message.normalize('NFKC').toLowerCase().includes(quote)
  }
  const overviewOnly = isGeneralProjectOverviewWithoutPurchaseScope(data, message)
  const passiveSource = (quote: unknown) => isPassivePurchaseEvidence(quote, { communication: data.communication })
    || isPassiveProfilePurposeEvidence(data, pendingQuestion, quote) || overviewOnly
  const category = supported('preferred_category') && !passiveSource(evidence.preferred_category)
    && (PROPERTY_CATEGORIES as readonly string[]).includes(text(data.preferred_category)) ? data.preferred_category : null
  const purpose = supported('purchase_purpose') && !passiveSource(evidence.purchase_purpose)
    && !isAssetOnlyPurposeEvidence(data, pendingQuestion, evidence.purchase_purpose)
    && ['vivir', 'invertir', 'segunda_vivienda', 'negocio'].includes(text(data.purchase_purpose)) ? data.purchase_purpose : null
  return {
    events: chosenEvents.filter(e => (e !== 'declared_unit_type' || category) && (e !== 'declared_purchase_purpose' || purpose)),
    preferred_category: category,
    qualification: object(data.qualification),
    purchase_purpose: purpose,
    unit_id: /^[a-f0-9-]{36}$/i.test(text(data.unit_id)) ? data.unit_id : null,
    preferred_visit_time_text: nullableText('preferred_visit_time_text'),
    visit_preference: normalizedVisitPreference(data.visit_preference, message, visitContext),
    visit_intent: normalizedVisitIntent(data.visit_intent, message),
    visit_needs_help: data.visit_needs_help === true,
    ...contact,
    action_authority: authority,
    requested_advisor: actionAuthorized(authority, 'advisor'),
    financing_consent: actionAuthorized(authority, 'financing') ? true : actionDeclined(authority, 'financing') ? false : null,
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
