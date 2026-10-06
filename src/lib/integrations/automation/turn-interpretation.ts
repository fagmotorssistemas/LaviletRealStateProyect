import { EXTRACTION_REQUEST_RULES } from './extraction-request-rules'
import { reconcilePassivePropertyMemory } from './turn-interpretation-input'
import { createHash } from 'node:crypto'
import { object, text, type Row } from './data'
import { normalizeEvents, VISIT_INTENT_EXTRACTION_RULES, VISIT_PREFERENCE_EXTRACTION_RULES } from './conversation-rules'
import { normalizeTurnSemantics, TURN_SEMANTIC_EXTRACTION_RULES, TURN_SEMANTICS_SCHEMA } from './turn-semantics'
import { isGreetingOnly, normalized } from './sdr-rules'
import { TURN_RULES } from './turn-routing'
import { LEAD_PROFILE_EXTRACTION_RULES, normalizeLeadProfile } from './lead-profile'
import { promptSections } from './prompt-sections'
import { CATALOG_REQUEST_SCHEMA, CATALOG_REQUEST_RULES, catalogRequestStatus, normalizeCatalogRequest } from './catalog-request'
import { FINANCING_IDENTITY_SCHEMA, FINANCING_IDENTITY_RULES } from './financing-identity'
import { FINANCING_AMOUNTS_SCHEMA, FINANCING_AMOUNTS_RULES, financingAmounts } from './financing-amounts'
import { compactFinancingExtraction, FINANCING_EXTRACTION_RULES } from './financing-prompt'
import { FINANCING_QUOTE_SCHEMA, FINANCING_QUOTE_EXTRACTION_RULES } from './financing-quote'
import { PENDING_REQUEST_RULES } from './pending-inbound'
import { MATERIAL_REQUEST_SCHEMA, MATERIAL_REQUEST_RULES } from './project-material'
import { FINANCING_PARTNER_CHOICE_SCHEMA, FINANCING_PARTNER_CHOICE_RULES } from './financing'
import { reconcileHistoricalInterpretation, rememberInterpretationFacts } from './interpretation-memory'
import { interpretationInput, interpretationSourceIssues, normalizeInactiveInterpretation, mergeInterpretationRepair, reconcileFinancingReference, TurnInterpretationError, CURRENT_TURN_INTERPRETATION_RULE } from './turn-interpretation-input'

export const CONVERSATION_CONTRACT_VERSION = 'lavilet-dialogue-v3'

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
  financing_partner_choice: FINANCING_PARTNER_CHOICE_SCHEMA,
  material_request: MATERIAL_REQUEST_SCHEMA,
  full_name: nullableString,
  financing_identity: FINANCING_IDENTITY_SCHEMA,
  financing_amounts: FINANCING_AMOUNTS_SCHEMA,
  financing_quote: FINANCING_QUOTE_SCHEMA,
  residence_city: nullableString,
  residence_country: nullableString,
  declared_location: nullableObject({ city: nullableString, country: nullableString,
    kind: { type: 'string', enum: ['origin', 'temporary', 'former', 'future', 'unspecified'] }, evidence: { type: 'string' } }),
  residence_response: nullableObject({ status: { type: 'string', enum: ['declined'] }, evidence: { type: 'string' } }),
  residence_confirmation: nullableObject({ decision: { type: 'string', enum: ['confirm', 'deny'] }, evidence: { type: 'string' }, confidence }),
  profile_evidence: closedObject({ full_name: nullableString, residence_city: nullableString, residence_country: nullableString }),
  applicant_type: { type: ['string', 'null'], enum: ['empleado', 'independiente', null] },
  national_id: nullableString,
  employment_stability_months: nullableNumber,
  job_title: nullableString,
  monthly_income: nullableNumber,
  ruc: nullableString,
  visit_preference: nullableObject({ evidence: { type: 'string' }, date_text: nullableString, time_text: nullableString,
    location_type: { type: ['string', 'null'], enum: ['office', 'site', 'work_area', 'model', 'completed_unit', null] }, confidence }),
  visit_intent: nullableObject({ kind: { type: 'string', enum: ['request_visit', 'accept_visit_preference', 'visit_information', 'decline_visit', 'visit_status', 'none'] },
    purpose: { type: 'string', enum: ['coordination', 'preference', 'accept_alternative', 'availability_information', 'access_information', 'decline', 'cancel', 'status', 'none'] },
    target: { type: 'string', enum: ['project', 'other', 'unspecified'] },
    destination: { type: ['string', 'null'], enum: ['office', 'site', 'work_area', 'model', 'completed_unit', 'building', null] }, evidence: { type: 'string' }, confidence }),
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
  withActionMessage?: (message: string) => TurnInterpretation
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
  const advisorRequest = Array.isArray(raw.requests) && raw.requests.map(object).some(request =>
    request.domain === 'advisor' && request.confidence === 'high' && evidenceMatches(text(request.evidence), current))
  return { requested_advisor: !advisorDeclined && (supported('requested_advisor') && (advisorRequest || !Array.isArray(raw.requests)) || advisorRequested), opt_out: optOut,
    tracking_consent: !optOut && (supported('consent_granted') || explicitConsent) }
}

/** Called for every authorized turn, before a response route or operational decision is selected. */
export async function interpretConversationTurn(input: Row, dependencies: Dependencies): Promise<TurnInterpretation> {
  const current = text(input.mensaje_actual)
  const pending = (Array.isArray(input.consultas_pendientes) ? input.consultas_pendientes : []).map(object)
  const readable = current.replace(/\[Archivo no interpretado[^\]]*\]|\[Sticker recibido\]/g, '').trim()
  const method = !readable ? 'unreadable_input' : isGreetingOnly(readable) && !pending.length ? 'literal_greeting' : 'model'
  let raw: Row = {}, promptRevision: string | null = null
  const historicalFields = new Set<string>()
  const reconcile = (value: Row) => {
    const amounts = financingAmounts({}, value.financing_amounts, readable)
    const semantics = object(value.turn_semantics), budget = object(semantics.budget)
    if (!amounts.total_budget && ['loan', ...(budget.status === 'initial_capital' ? [] : ['down_payment'])]
      .some(role => object(amounts[role]).evidence === budget.evidence && object(amounts[role]).amount === budget.amount)) value = { ...value,
      turn_semantics: { ...semantics, budget: { status: 'not_discussed', amount: null, evidence: '', confidence: 'low' } } }
    const result = reconcileHistoricalInterpretation(reconcilePassivePropertyMemory(reconcileFinancingReference(value, input, readable), input), readable, object(input.resumen))
    result.fields.forEach(field => historicalFields.add(field))
    return normalizeInactiveInterpretation(result.raw)
  }
  let recoveryIssues: string[] = []
  if (method === 'model') {
    // Interpretation is shared by both retrieval routes. The feature switch
    // controls retrieval/context size, never the meaning of a requirement.
    const extractionSchema = closedObject({ ...object(TURN_EXTRACTION_SCHEMA.properties), catalog_request: CATALOG_REQUEST_SCHEMA })
    const prompt = await dependencies.activePrompt('extractor_eventos')
    const requestRules = `Contrato ${CONVERSATION_CONTRACT_VERSION}.\n${EXTRACTION_REQUEST_RULES}`
    const currentInstructions = compactFinancingExtraction(input) ? promptSections([
      ['Función y configuración del extractor', prompt], ['Interpretación del turno y recopilación financiera', FINANCING_EXTRACTION_RULES],
      ['Orientación sobre entrada y cuotas', FINANCING_QUOTE_EXTRACTION_RULES],
      ['Solicitud de material', MATERIAL_REQUEST_RULES],
      ['Preferencia de entidad', FINANCING_PARTNER_CHOICE_RULES],
    ]) : promptSections([
      ['Función y configuración del extractor', prompt],
      ['Fuente del turno y separación del historial', CURRENT_TURN_INTERPRETATION_RULE],
      ['Solicitudes, continuidad y autorizaciones', requestRules],
      ['Consultas pendientes sin respuesta', PENDING_REQUEST_RULES],
      ['Solicitud de material', MATERIAL_REQUEST_RULES],
      ['Preferencia de entidad', FINANCING_PARTNER_CHOICE_RULES],
      ['Interpretación del perfil', LEAD_PROFILE_EXTRACTION_RULES],
      ['Identidad y cantidades financieras', FINANCING_IDENTITY_RULES + '\n' + FINANCING_AMOUNTS_RULES],
      ['Orientación sobre entrada y cuotas', FINANCING_QUOTE_EXTRACTION_RULES],
      ['Intención, presupuesto y preferencias de inmuebles', TURN_SEMANTIC_EXTRACTION_RULES],
      ['Consulta estructurada del catálogo', CATALOG_REQUEST_RULES],
      ['Visitas y respuestas a propuestas pendientes', TURN_RULES + '\n' + VISIT_PREFERENCE_EXTRACTION_RULES + '\n' + VISIT_INTENT_EXTRACTION_RULES],
      ['Formato de salida', 'El esquema JSON enviado con esta llamada es la única definición de campos y valores permitidos. Complete sus campos; use null solo donde el esquema lo permite y el dato sea desconocido. No añada un formato alternativo ni texto fuera del JSON.'],
    ])
    promptRevision = createHash('sha256').update(currentInstructions).digest('hex').slice(0, 16)
    dependencies.onPromptRevision?.(promptRevision)
    const modelInput = interpretationInput(input, readable)
    raw = reconcile(await dependencies.aiJson(currentInstructions, modelInput, extractionSchema))
    recoveryIssues = interpretationSourceIssues(raw, readable, pending)
    if (recoveryIssues.length) {
      const repaired = await dependencies.aiJson(currentInstructions, { ...modelInput, recuperacion_interpretacion: {
        issues: recoveryIssues, instruction: 'Revise los campos señalados usando mensaje_actual. missing_current_evidence significa que falta una cita para un dato afirmado; non_current_evidence significa que la cita no pertenece al mensaje actual; invalid_budget_amount significa que falta una cantidad válida. Un bloque sin datos ni acción no necesita evidencia. Conserve la información válida del turno y devuelva el esquema completo. El historial solo resuelve referencias, no aporta declaraciones nuevas.' },
        mensaje_actual: readable }, extractionSchema)
      raw = reconcile(mergeInterpretationRepair(raw, repaired, recoveryIssues))
      const remaining = interpretationSourceIssues(raw, readable, pending)
      if (remaining.length) throw new TurnInterpretationError(remaining)
    }
  }
  const withDiagnostics = (result: TurnInterpretation): TurnInterpretation => {
    result.diagnostic.interpretation_recovery = { attempted: recoveryIssues.length > 0, issues: recoveryIssues, status: recoveryIssues.length ? 'recovered' : 'not_needed' }
    result.diagnostic.historical_reconciliation = { status: historicalFields.size ? 'confirmed_facts_preserved' : 'not_needed', fields: [...historicalFields] }
    const rebind = result.withActionMessage
    if (rebind) result.withActionMessage = message => withDiagnostics(rebind(message))
    return result
  }
  return withDiagnostics(normalizeInterpretation(input, raw, readable, method, promptRevision))
}

/** Reuse the same extraction after scope arbitration. No second model call and
 * no promotion of outside fragments into operational evidence. */
function normalizeInterpretation(input: Row, raw: Row, readable: string, method: TurnInterpretation['method'], promptRevision: string | null): TurnInterpretation {
  const actionMessage = Object.hasOwn(input, 'mensaje_accion') ? text(input.mensaje_accion) : readable
  const lastQuestion = text(input.ultima_pregunta) || text(object(object(input.resumen)._last_operational_step).reply)
  const extracted = normalizeEvents(raw, actionMessage, /(?:n[uú]mero|d[ií]gitos?).*(?:c[eé]dula)|c[eé]dula.*(?:n[uú]mero|d[ií]gitos?)/i.test(lastQuestion))
  const actions = evidencedActions(raw, actionMessage)
  actions.opt_out = evidencedActions(raw, readable).opt_out
  if (actions.opt_out) actions.tracking_consent = false
  Object.assign(extracted, actions)
  extracted.financing_quote = raw.financing_quote
  if (Object.hasOwn(raw, 'material_request')) extracted.material_request = raw.material_request
  if (Object.hasOwn(raw, 'financing_partner_choice')) extracted.financing_partner_choice = raw.financing_partner_choice
  const leadProfile = normalizeLeadProfile(raw, actionMessage, input)
  Object.assign(extracted, { residence_city: leadProfile.residence_city, residence_country: leadProfile.residence_country,
    lead_profile: leadProfile })
  // An unreadable reaction or a greeting must never inherit operational events from history.
  if (method !== 'model') extracted.events = []
  const semantics = normalizeTurnSemantics(raw, actionMessage, input.pregunta_pendiente)
  semantics.financing_amounts = Object.entries(financingAmounts({}, raw.financing_amounts, actionMessage))
    .map(([role, value]) => ({ role, ...object(value) }))
  const catalogRequest = normalizeCatalogRequest(raw.catalog_request, actionMessage)
  semantics.catalog_request = catalogRequest
  semantics.catalog_request_status = catalogRequestStatus(raw.catalog_request, catalogRequest)
  extracted.household = semantics.household
  if (Object.hasOwn(object(raw.turn_semantics), 'housing_quantities')) {
    const quantities = Array.isArray(semantics.housing_quantities) ? semantics.housing_quantities.map(object) : []
    // A prose qualification must not reintroduce a rejected people/evaluation
    // count as a durable bedroom preference through a parallel memory field.
    if (!quantities.some(quantity => quantity.dimension === 'bedrooms' && quantity.role === 'requirement')
      || Array.isArray(semantics.normalization_issues) && semantics.normalization_issues.includes('bedroom_filter_without_bedroom_requirement')) {
      extracted.qualification = { ...object(extracted.qualification), dormitorios_texto: null }
    }
  }
  // The model may omit the scoring event while explicitly identifying the
  // request. Typed, current intent can add interest; the event never authorizes
  // the operational action in the opposite direction.
  if (['request', 'information'].includes(text(object(semantics.reservation).kind))) {
    extracted.events = [...new Set([...(Array.isArray(extracted.events) ? extracted.events : []), 'asked_reservation'])]
  }
  const pending = (Array.isArray(input.consultas_pendientes) ? input.consultas_pendientes : []).map(object)
  const pendingSource = (request: Row) => ['property', 'financing'].includes(text(request.domain))
    ? pending.find(message => evidenceMatches(text(request.evidence), text(message.content))) : undefined
  const requests = (Array.isArray(raw.requests) ? raw.requests : []).map(object)
    .filter(request => text(request.request).trim() && (evidenceMatches(text(request.evidence), readable) || pendingSource(request)))
    .slice(0, 12).map(request => ({ request: text(request.request).slice(0, 500),
      domain: requestDomains.includes(text(request.domain).trim().toLowerCase() as typeof requestDomains[number]) ? text(request.domain).trim().toLowerCase() : 'other',
      evidence: text(request.evidence), confidence: ['high', 'medium', 'low'].includes(text(request.confidence)) ? request.confidence : 'low',
      ...(!evidenceMatches(text(request.evidence), readable) ? { source_message_id: pendingSource(request)?.message_id, source: 'pending' } : {}) }))
  const property = object(semantics.property)
  return { extracted, semantics, requests, method, promptRevision,
    withActionMessage: message => normalizeInterpretation({ ...input, mensaje_accion: message }, raw, readable, method, promptRevision),
    diagnostic: {
      contract_version: CONVERSATION_CONTRACT_VERSION, method,
      primary_intent: semantics.primary_intent, confidence: semantics.confidence,
      interpretation: semantics.interpretation,
      housing_quantities: semantics.housing_quantities,
      household: semantics.household,
      reservation: semantics.reservation,
      property_group: property.group || null, property_category: property.category || null,
      operation: property.operation || null, filters: object(property.filters),
      ...(semantics.catalog_request ? { catalog_request: semantics.catalog_request } : {}),
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
export function rememberInterpretedTurn(previous: Row, current: string, extracted: Row, semantics: Row = object(extracted.turn_semantics)): Row {
  const facts = { ...object(previous.datos_confirmados) }
  if (extracted.preferred_category) facts.categoria = extracted.preferred_category
  if (extracted.purchase_purpose) facts.proposito = extracted.purchase_purpose
  if (object(extracted.household).confidence === 'high') facts.household = extracted.household
  return { ...previous, solicitud_actual: current.slice(0, 1200), datos_confirmados: facts,
    _interpretation_memory: rememberInterpretationFacts(previous, current, extracted, semantics),
    _turn_contract: CONVERSATION_CONTRACT_VERSION }
}
