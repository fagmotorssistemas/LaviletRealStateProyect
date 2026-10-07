import { EXTRACTION_REQUEST_RULES } from './extraction-request-rules'
import { reconcilePassivePropertyMemory } from './turn-interpretation-input'
import { createHash } from 'node:crypto'
import { object, text, type Row } from './data'
import { normalizeEvents, VISIT_INTENT_EXTRACTION_RULES, VISIT_PREFERENCE_EXTRACTION_RULES } from './conversation-rules'
import { normalizeTurnSemantics, normalizedPendingQuestion, TURN_SEMANTIC_EXTRACTION_RULES, TURN_SEMANTICS_SCHEMA } from './turn-semantics'
import { isGreetingOnly, normalized } from './sdr-rules'
import { TURN_RULES, explicitlyRequestsVisit, visitRequestPermissionVeto } from './turn-routing'
import { replyQuestions } from './reply-question'
import { isBareAffirmative } from './conversation-next-step'
import { asksUnitPrice } from './price-reply'
import { LEAD_PROFILE_EXTRACTION_RULES, normalizeLeadProfile } from './lead-profile'
import { promptSections } from './prompt-sections'
import { CATALOG_REQUEST_SCHEMA, CATALOG_REQUEST_RULES, catalogRequestStatus, normalizeCatalogRequest } from './catalog-request'
import { FINANCING_IDENTITY_SCHEMA, FINANCING_IDENTITY_RULES } from './financing-identity'
import { FINANCING_AMOUNTS_SCHEMA, FINANCING_AMOUNTS_RULES, financingAmounts } from './financing-amounts'
import { compactFinancingExtraction, FINANCING_EXTRACTION_RULES } from './financing-prompt'
import { FINANCING_QUOTE_SCHEMA, FINANCING_QUOTE_EXTRACTION_RULES } from './financing-quote'
import { PENDING_REQUEST_RULES } from './pending-inbound'
import { MATERIAL_REQUEST_SCHEMA, MATERIAL_REQUEST_RULES } from './project-material'
import { FINANCING_PARTNER_CHOICE_SCHEMA, FINANCING_PARTNER_CHOICE_RULES, financingInputs, financingPartnerAnswer } from './financing'
import { reconcileHistoricalInterpretation, rememberInterpretationFacts } from './interpretation-memory'
import { interpretationInput, interpretationSourceIssues, normalizeInactiveInterpretation, mergeInterpretationRepair, reconcileFinancingReference, reconcileQuotedQuantityReferences, reconcileEchoedBudgetQuestion, TurnInterpretationError, CURRENT_TURN_INTERPRETATION_RULE, QUANTITY_RECOVERY_RULES, EXTRACTION_CONSISTENCY_RULES } from './turn-interpretation-input'

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

/** A declined process is not an unsubscribe. The refusal must govern the
 * communication/contact itself, including its literal current paraphrases. */
function contactRefusalPredicates() {
  return [
    /\b(?:no|nunca|jamas|tampoco|ni) (?:me |nos )?(?:(?:vuelvan?|sigan?) (?:a )?)?(?:escrib\w*|contact\w*|envie\w*|envi\w*|mande\w*|molest\w*)\b/g,
    /\b(?:dejen?|paren?|cesen?|deberian dejar|debe dejar) de (?:escrib\w*|contact\w*|envi\w*|mand\w*|molest\w*)\b/g,
    /\b(?:ya )?no (?:quiero|deseo|necesito|autorizo|acepto|quisiera) (?:mas |ningun[oa]?s? |seguir )?(?:(?:recibir|recibiendo|reciba|recibamos|tener) (?:mas |ningun[oa]?s? |sus |esos |estas )?)?(?:mensajes?|novedades|seguimiento|comunicaciones|publicidad|notificaciones)\b/g,
    /\b(?:no|nunca|tampoco) (?:quiero|deseo|autorizo|acepto|quisiera) que (?:me|nos) (?:(?:sigan?|vuelvan?) (?:a )?)?(?:escrib\w*|contact\w*|envie\w*|mande\w*)\b/g,
    /\b(?:elimine\w*|borre\w*|quite\w*|retire\w*) (?:mi |nuestro |el )?(?:numero|contacto)(?:\b|$)/g,
    /\b(?:quiero|deseo|necesito|solicito) (?:darme|que me den|que me de|la) (?:de )?baja\b/g,
    /\b(?:deme|denme|darme|dar de) (?:de )?baja\b/g,
  ]
}

function maskReportedActionStatements(current: string): string {
  const quoted = /«[^»]*»|“[^”]*”|"[^"]*"|(?<!\p{L})'[^']*'(?!\p{L})/gu
  return current.replace(quoted, (quote: string, index: number) => {
    const value = normalized(quote.slice(1, -1))
    const actionStatement = contactRefusalPredicates().some(pattern => pattern.test(value))
      || /\b(?:quiero|quisiera|deseo|necesito|prefiero|solicito|pido|acepto|autorizo|me interesa|me gustaria)\b[^.!?]{0,90}\b(?:asesor[ae]?s?|persona|humano|humana|llamada|llamen|novedades|seguimiento|mensajes|informado|informada|visita|cita|agend\w*|visitar|financiamiento|credito|revision)\b/.test(value)
      || /^(?:por favor )?(?:llameme|llamame|comuniqueme|paseme|manteng\w*|informeme|aviseme|agenden|coordinemos)\b/.test(value)
    if (!actionStatement || current.trim() === quote) return quote
    const before = normalized(current.slice(0, index)).trim()
    const after = normalized(current.slice(index + quote.length)).trim()
    const enclosingPrefix = before.split(/[.!?;\n]+/).at(-1) || ''
    const attributed = /\b(?:dijo|decia|dice|dijeron|dicen|escribio|escribieron|escribe|escriben|puso|ponia|respondio|comento|comentaron|mensaje|texto|frase|ejemplo)\b/.test(enclosingPrefix)
    // Emphasizing one's own request is different from reporting a command.
    if (!attributed && (/\b(?:quiero|quisiera|deseo|necesito|prefiero|solicito|pido|digo|confirmo|repito)(?: decir| pedir)?\s*:?\s*$/.test(before)
      || /(?:^|[.!?;])\s*por favor\s*:?\s*$/.test(before)
      || /^\s*[,;:]?\s*es lo que (?:quiero|pido|solicito)\b/.test(after))) return quote
    return quote.replace(/[^\r\n]/g, ' ')
  })
}

function restrictedContactScope(suffix: string): boolean {
  const rest = suffix.trim().replace(/^(?:mas|ya|nunca)\s+/, '')
    .replace(/^(?:(?:mas|ningun[oa]?s?|sus|esos|estas) )?(?:mensajes?|novedades|seguimiento|comunicaciones|publicidad|notificaciones|informacion)\s+/, '')
  // A specific topic, purpose or channel is a contact preference. It cannot
  // silently disable all communication. A sender qualifier is still global.
  if (/^(?:sobre|acerca de|respecto a|en relacion (?:a|con)|relacionad[oa]s? con|para)\s+\S/.test(rest)) return true
  if (/^de(?:l)?\s+\S/.test(rest)
    && !/^de (?:ustedes|vosotros|su empresa|esta empresa|ahora en adelante|ningun tipo)\b/.test(rest)) return true
  return /^(?:por|a traves de|via|mediante) (?:el |la |los |las )?(?:telefono|llamadas?|correo|email|whatsapp|sms|redes sociales|mensajes? de texto)\b/.test(rest)
}

function globalContactRefusal(current: string): boolean {
  const ownMessage = maskReportedActionStatements(current)
  return ownMessage.split(/[.!?;\n]+|\bpero\b|\badem[aá]s\b|\bsin embargo\b/iu).some(clause => {
    const value = normalized(clause)
    return contactRefusalPredicates().some(pattern => [...value.matchAll(pattern)]
      .some(match => !restrictedContactScope(value.slice((match.index ?? 0) + match[0].length))))
  })
}

function refusalOnlyStatement(clause: string): boolean {
  const value = normalized(clause)
  const declined = /\b(?:no|nunca|jamas|tampoco|ni) (?:quiero|quisiera|deseo|necesito|prefiero|acepto|autorizo)\b/.test(value)
    || contactRefusalPredicates().some(pattern => pattern.test(value))
    || /^(?:no|no gracias|por ahora no|ahora no|todavia no)[.! ]*$/.test(value)
  if (!declined || /[¿?]/.test(clause)) return false
  const positivePredicates = [...value.matchAll(/\b(?:quiero|quisiera|deseo|necesito|prefiero|me interesa|me gustaria)\s+(?:saber|conocer|consultar|confirmar|revisar|iniciar|continuar|recibir informacion|informacion|detalles|hablar|visitar|agendar)\b/g)]
  return !positivePredicates.some(match => !/\b(?:no|nunca|jamas|tampoco|ni)(?:\s+\w+){0,2}\s*$/.test(value.slice(0, match.index)))
}

function currentOperationalRequestIssue(request: Row, current: string): string | null {
  if (!['visit', 'financing', 'advisor', 'tracking'].includes(text(request.domain))
    || !evidenceMatches(text(request.evidence), current)) return null
  const ownMessage = maskReportedActionStatements(current)
  if (!evidenceMatches(text(request.evidence), ownMessage)) return 'reported_operational_request_is_not_current_permission'
  const source = evidenceMatches(text(request.request), ownMessage) ? text(request.request) : text(request.evidence)
  // A genuine unsubscribe is an actual global contact action, distinct from
  // declining another process. Retain its record while opt-out keeps priority.
  if (request.domain === 'tracking' && globalContactRefusal(ownMessage) && globalContactRefusal(source)) return null
  const quote = normalized(source)
  const enclosingClauses = ownMessage.split(/[.!?;\n]+|\bpero\b|\badem[aá]s\b|,\s*(?=(?:solo|solamente|unicamente)\b)/iu)
    .filter(clause => { const value = normalized(clause); return value && (value.includes(quote) || quote.includes(value)) })
  return enclosingClauses.length > 0 && enclosingClauses.every(refusalOnlyStatement)
    ? 'scoped_decline_is_not_a_positive_operational_request' : null
}

/** Model flags require current evidence; legacy outputs only use explicit requests. */
function evidencedActions(raw: Row, source: string, previousQuestion = '') {
  const current = maskReportedActionStatements(source)
  const evidence = object(raw.action_evidence), message = normalized(current)
  const supported = (key: string) => raw[key] === true && evidenceMatches(text(evidence[key]), current)
  const advisorDeclined = /\bno (?:quiero|deseo|necesito|prefiero)\b[^.!?]{0,35}\b(?:asesor|persona|humano|llamada)\b/.test(message)
  const advisorRequested = /\b(?:quiero|quisiera|necesito|deseo|prefiero|puedo|podria|puede)\b[^.!?]{0,70}\b(?:asesor|asesora|persona|humano|humana|llamada|llame|llamen)\b/.test(message)
    || /\b(?:paseme|comuniqueme|comunicame|deriveme|transfierame)\b[^.!?]{0,45}\b(?:asesor|persona|humano)\b/.test(message)
    || /^(?:por favor )?(?:llameme|llamame|que me llamen|quiero que me llamen)\b/.test(message)
  const explicitOptOut = globalContactRefusal(current)
  const trackingTopic = /\b(?:novedades|seguimiento|mensajes|actualizaciones|(?:mantener\w*|manteng\w*) (?:informad[oa]s?|al tanto))\b/
  const permission = /\b(?:acept(?:a|o)|autoriz(?:a|o)|quier(?:e|o)|quisiera|dese(?:a|o)|permite|puedo|podemos|(?:le|te|me|nos) gustaria|(?:le|me|nos) interesa)\b/
  const imperativeTracking = /^(?:por favor )?(?:manteng\w*|informeme|informenme|aviseme|avisenme)\b/
  const refusedOrConditional = /\b(?:no|nunca|jamas|tampoco|ni)\b[^.!?]{0,35}\b(?:acepto|autorizo|quiero|quisiera|deseo|gustaria|interesa|recibir|manteng\w*)|\b(?:solo si|solamente si|siempre que|a condicion|cuando)\b/
  const explicitConsent = current.split(/[.!?;\n]+|\bpero\b/iu).some(clause => {
    const value = normalized(clause)
    return trackingTopic.test(value) && (permission.test(value) || imperativeTracking.test(value)) && !refusedOrConditional.test(value)
      && /\b(?:recibir|reciba|envien|envie|manden|mande|contact|escrib|mantener|manteng)\w*\b/.test(value)
  })
  const questions = replyQuestions(previousQuestion)
  const actualTrackingInvitation = questions.length === 1 && trackingTopic.test(normalized(questions[0]))
    && permission.test(normalized(questions[0]))
  const acknowledgement = current.replace(/^[\s,]*(?:bueno|entonces)[\s,]+/i, '')
  const shortAcceptance = isBareAffirmative(acknowledgement) || /^(?:acepto|autorizo)(?:,? (?:por favor|gracias))?[.! ]*$/.test(message)
  const currentAnswer = object(object(raw.turn_semantics).answer_to_previous)
  const semanticAcceptance = currentAnswer.kind === 'affirmative' && currentAnswer.confidence === 'high'
    && evidenceMatches(text(currentAnswer.evidence), current)
  const concurrentDecision = (Array.isArray(raw.requests) ? raw.requests : []).map(object).some(request =>
    !['tracking', 'courtesy'].includes(text(request.domain)) && request.confidence === 'high'
    && evidenceMatches(text(request.evidence), current))
  const trackingAnswer = supported('consent_granted') && actualTrackingInvitation && !refusedOrConditional.test(message)
    && (shortAcceptance || semanticAcceptance && !concurrentDecision)
  const optOut = explicitOptOut
  const advisorRequest = Array.isArray(raw.requests) && raw.requests.map(object).some(request =>
    request.domain === 'advisor' && request.confidence === 'high' && evidenceMatches(text(request.evidence), current))
  return { requested_advisor: !advisorDeclined && (supported('requested_advisor') && (advisorRequest || !Array.isArray(raw.requests)) || advisorRequested), opt_out: optOut,
    tracking_consent: !optOut && (trackingAnswer || explicitConsent) }
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
    const references = reconcileQuotedQuantityReferences(result.raw, input, readable)
    references.fields.forEach(field => historicalFields.add(field))
    const budgetQuestion = reconcileEchoedBudgetQuestion(references.raw, input, readable)
    budgetQuestion.fields.forEach(field => historicalFields.add(field))
    return normalizeInactiveInterpretation(budgetQuestion.raw)
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
      ['Comprobación de coherencia entre bloques', EXTRACTION_CONSISTENCY_RULES],
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
      ['Comprobación de coherencia entre bloques', EXTRACTION_CONSISTENCY_RULES],
      ['Formato de salida', 'El esquema JSON enviado con esta llamada es la única definición de campos y valores permitidos. Complete sus campos; use null solo donde el esquema lo permite y el dato sea desconocido. No añada un formato alternativo ni texto fuera del JSON.'],
    ])
    promptRevision = createHash('sha256').update(currentInstructions).digest('hex').slice(0, 16)
    dependencies.onPromptRevision?.(promptRevision)
    const modelInput = interpretationInput(input, readable)
    raw = reconcile(await dependencies.aiJson(currentInstructions, modelInput, extractionSchema))
    recoveryIssues = interpretationSourceIssues(raw, readable, pending)
    if (recoveryIssues.length) {
      const quantityOnly = recoveryIssues.every(issue => /^(?:missing|non)_current_evidence:quantity\.\d+$/.test(issue))
      const quantitySchema = closedObject({ turn_semantics: closedObject({
        housing_quantities: object(TURN_SEMANTICS_SCHEMA.properties).housing_quantities,
      }) })
      const repairInput: Row = { ...modelInput, recuperacion_interpretacion: {
        issues: recoveryIssues, instruction: 'Revise los campos señalados usando mensaje_actual. missing_current_evidence significa que falta una cita para un dato afirmado; non_current_evidence significa que la cita no pertenece al mensaje actual; invalid_budget_amount significa que falta una cantidad válida. Un bloque sin datos ni acción no necesita evidencia. Conserve la información válida del turno y devuelva el esquema completo. El historial solo resuelve referencias, no aporta declaraciones nuevas.' },
        mensaje_actual: readable }
      const repaired = await dependencies.aiJson(quantityOnly ? QUANTITY_RECOVERY_RULES : currentInstructions,
        quantityOnly ? { mensaje_actual: readable, pregunta_pendiente: input.pregunta_pendiente,
          recuperacion_interpretacion: { issues: recoveryIssues, fields: ['housing_quantities'], preserve_other_fields: true } } : repairInput,
        quantityOnly ? quantitySchema : extractionSchema)
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
  const actions = evidencedActions(raw, actionMessage, lastQuestion || text(object(input.pregunta_pendiente).question))
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
  const actualPendingQuestion = normalizedPendingQuestion(input.pregunta_pendiente)
  const partnerChoice = object(extracted.financing_partner_choice)
  if (actualPendingQuestion.id === 'financing_partner' && partnerChoice.kind === 'select'
    && partnerChoice.confidence === 'high' && evidenceMatches(text(partnerChoice.evidence), actionMessage)) {
    const financingContext = object(input.financiamiento)
    const partnerInput = financingInputs({ ...extracted, turn_semantics: semantics }, actionMessage, lastQuestion,
      { partners: Array.isArray(financingContext.partners) ? financingContext.partners.map(text) : [], current: object(financingContext.current) })
    const partnerAnswer = { question_id: 'financing_partner', kind: 'value', evidence: partnerChoice.evidence, confidence: 'high' }
    // The lender consumer validates the current entity and rejects an ordinary
    // terms/requirements question. Supplying that answer never grants consent.
    if (financingPartnerAnswer({ ...extracted, turn_semantics: { ...semantics, answer_to_previous: partnerAnswer } }, partnerInput)
      && !/\b(?:no se|no he decidido|tal vez|quizas|si elijo|si escojo)\b/.test(normalized(text(partnerChoice.evidence)))) {
      if (object(semantics.answer_to_previous).kind !== 'value' || object(semantics.answer_to_previous).question_id !== 'financing_partner') {
        semantics.answer_to_previous = partnerAnswer
        semantics.normalization_issues = [...(Array.isArray(semantics.normalization_issues) ? semantics.normalization_issues : []),
          'current_lender_choice_restores_pending_answer']
      }
    }
  }
  const answer = object(semantics.answer_to_previous), visit = object(extracted.visit_intent)
  if (visit.kind === 'request_visit' && visit.purpose === 'coordination'
    && visitRequestPermissionVeto(actionMessage, text(visit.evidence))) {
    extracted.visit_intent = null
    semantics.normalization_issues = [...(Array.isArray(semantics.normalization_issues) ? semantics.normalization_issues : []),
      'visit_request_is_refused_or_conditional']
  }
  const visitAnswer = text(actualPendingQuestion.id).startsWith('visit_')
    && answer.question_id === actualPendingQuestion.id && answer.confidence === 'high'
    && ['affirmative', 'value'].includes(text(answer.kind)) && evidenceMatches(text(answer.evidence), actionMessage)
  const physicalVisitRequest = actionMessage.split(/[.!?;\n]+|\bpero\b|\badem[aá]s\b/iu).some(clause => {
    const value = normalized(clause)
    const information = /\b(?:quiero|quisiera|deseo|necesito) (?:saber|consultar|confirmar|revisar|informacion|detalles|recibir informacion)\b/.test(value)
      || /\b(?:que dias|que horarios|cuales dias|cuales horarios|que incluye|como funciona|como es)\b/.test(value)
    const physicalAttention = /\b(?:presencial|en persona|(?:atencion|atiend\w*|atend\w*|recib\w*)[^.!?]{0,25}\b(?:en|a) (?:la |su )?oficina)\b/.test(value)
    const actualRequest = /\b(?:quiero|quisiera|deseo|necesito|prefiero|me gustaria|me interesa|puedo|podemos|pueden|podria|podrian|podriamos)\b/.test(value)
      || /[¿?]/.test(clause) && /\b(?:me|nos) (?:reciben|recibiran|atienden|atenderan)\b/.test(value)
    const reported = /[«“"']/u.test(clause) && /\b(?:dijo|dice|escribio|escribe|mensaje|texto|frase)\b/.test(value)
    return physicalAttention && actualRequest && !information && !reported && !visitRequestPermissionVeto(actionMessage, clause.trim())
  })
  if (object(extracted.visit_intent).kind === 'request_visit' && object(extracted.visit_intent).purpose === 'coordination'
    && !explicitlyRequestsVisit(actionMessage) && !physicalVisitRequest && !visitAnswer) {
    extracted.visit_intent = null
    semantics.normalization_issues = [...(Array.isArray(semantics.normalization_issues) ? semantics.normalization_issues : []),
      'visit_coordination_without_current_visit_permission']
  }
  const sameEvidence = (left: unknown, right: unknown) => text(left).trim().normalize('NFKC').toLowerCase()
    === text(right).trim().normalize('NFKC').toLowerCase()
  const rawRequests = (Array.isArray(raw.requests) ? raw.requests : []).map(object)
  const reservation = object(semantics.reservation)
  const reservationRequest = reservation.kind === 'request' && reservation.confidence === 'high'
    && evidenceMatches(text(reservation.evidence), actionMessage)
  const sharesReservationClause = (evidence: unknown) => {
    const quote = normalized(text(evidence)), reservationQuote = normalized(text(reservation.evidence))
    return Boolean(quote && reservationQuote && (quote.includes(reservationQuote) || reservationQuote.includes(quote)))
  }
  const explicitDomain = (domain: string, evidence: unknown) => domain === 'visit'
    ? explicitlyRequestsVisit(text(evidence))
    : /\b(?:asesor|asesora|humano|humana|llamada|llame|llamen)\b/.test(normalized(text(evidence)))
      && evidencedActions({ ...raw, action_evidence: { ...object(raw.action_evidence), requested_advisor: evidence } }, text(evidence)).requested_advisor
  const independentDomain = (domain: string) => rawRequests.some(request => request.domain === domain
    && request.confidence === 'high' && evidenceMatches(text(request.evidence), actionMessage)
    && (!sharesReservationClause(request.evidence) || explicitDomain(domain, request.evidence)))
  const reservationCollision = (request: Row) => reservationRequest && ['advisor', 'visit'].includes(text(request.domain))
    && sharesReservationClause(request.evidence) && !explicitDomain(text(request.domain), request.evidence)
  // A reservation has its own handoff workflow. Reusing its clause as a visit
  // or human-contact request does not supply separate permission for either;
  // separately evidenced requests in a compound turn remain valid.
  if (reservationRequest && !independentDomain('visit') && ['request_visit', 'accept_visit_preference'].includes(text(visit.kind))
    && sharesReservationClause(visit.evidence) && !explicitDomain('visit', visit.evidence)) {
    extracted.visit_intent = null
    extracted.events = (Array.isArray(extracted.events) ? extracted.events : []).filter(event => event !== 'requested_visit')
    semantics.normalization_issues = [...(Array.isArray(semantics.normalization_issues) ? semantics.normalization_issues : []),
      'reservation_clause_reused_for_visit']
  }
  if (reservationRequest && !independentDomain('advisor') && extracted.requested_advisor === true
    && (sharesReservationClause(object(raw.action_evidence).requested_advisor)
      && !explicitDomain('advisor', object(raw.action_evidence).requested_advisor)
      || rawRequests.some(request => request.domain === 'advisor' && reservationCollision(request)))) {
    extracted.requested_advisor = false
    semantics.normalization_issues = [...(Array.isArray(semantics.normalization_issues) ? semantics.normalization_issues : []),
      'reservation_clause_reused_for_advisor']
  }
  const independentVisit = (Array.isArray(raw.requests) ? raw.requests : []).map(object).some(request =>
    request.domain === 'visit' && request.confidence === 'high' && evidenceMatches(text(request.evidence), actionMessage)
      && !sameEvidence(request.evidence, answer.evidence))
  // An acceptance answers a particular offer. The same clause cannot be reused
  // to accept a visit when the actual pending question asks about another
  // object; a separately evidenced visit request remains independent.
  if (visit.kind === 'accept_visit_preference' && answer.confidence === 'high' && answer.question_id
    && !text(answer.question_id).startsWith('visit_') && sameEvidence(visit.evidence, answer.evidence) && !independentVisit) {
    extracted.visit_intent = null
    semantics.normalization_issues = [...(Array.isArray(semantics.normalization_issues) ? semantics.normalization_issues : []),
      'visit_acceptance_belongs_to_other_question']
  }
  const visitIntent = object(extracted.visit_intent)
  const evidencedVisitRequest = rawRequests.some(request => request.domain === 'visit' && request.confidence === 'high'
    && evidenceMatches(text(request.evidence), actionMessage) && !reservationCollision(request)
    && explicitlyRequestsVisit(text(request.evidence)) && !visitRequestPermissionVeto(actionMessage, text(request.evidence)))
  const currentVisit = ['request_visit', 'accept_visit_preference'].includes(text(visitIntent.kind))
    || explicitlyRequestsVisit(actionMessage) || evidencedVisitRequest
  if (!currentVisit) {
    extracted.events = (Array.isArray(extracted.events) ? extracted.events : []).filter(event => event !== 'requested_visit')
    if (semantics.primary_intent === 'request_visit') {
      semantics.primary_intent = reservationRequest ? 'request_reservation' : 'other'
      semantics.interpretation = { ...object(semantics.interpretation), canonical_primary_intent: semantics.primary_intent }
      semantics.normalization_issues = [...(Array.isArray(semantics.normalization_issues) ? semantics.normalization_issues : []),
        'visit_event_without_current_request']
    }
  }
  // A place where the lead currently lives describes their profile; it is not
  // the intended use of the purchase. Generic requests for information cannot
  // fill that missing decision either. Only reject those demonstrably passive
  // sources, rather than requiring every valid purpose to use a fixed phrase.
  const purposeQuote = normalized(text(object(raw.declaration_evidence).purchase_purpose))
  const passivePurposeSource = (quote: string) => /^(?:(?:solo|solamente|unicamente|por ahora) )?(?:(?:quiero|quisiera|deseo|necesito|busco|me interesa) (?:tener |recibir |conocer |obtener |mas )?)?(?:informacion|detalles)(?: (?:del|sobre el|sobre la|sobre|de|del proyecto) [a-z0-9 ]+)?[.!?]*$/.test(quote)
    || /^(?:(?:yo|actualmente|ahora|por ahora) )?(?:vivo|vivimos|resido|residimos|radico|radicamos|estoy viviendo|estamos viviendo) en [^.!?;,]+[.!?]*$/.test(quote)
      && !/\b(?:para|busco|quiero|quisiera|deseo|necesito|comprar|compra|mud|invertir|inversion|negocio|vivienda)\b/.test(quote)
  if (extracted.purchase_purpose && passivePurposeSource(purposeQuote)) {
    extracted.purchase_purpose = null
    extracted.events = (Array.isArray(extracted.events) ? extracted.events : []).filter(event => event !== 'declared_purchase_purpose')
    semantics.normalization_issues = [...(Array.isArray(semantics.normalization_issues) ? semantics.normalization_issues : []),
      'purchase_purpose_from_passive_source']
  }
  const propertySource = object(semantics.property)
  if (propertySource.operation === 'none' && !propertySource.category && !propertySource.selector
    && passivePurposeSource(normalized(text(propertySource.evidence)))
    && !Object.values(object(propertySource.filters)).some(value => value !== null && value !== undefined && (!Array.isArray(value) || value.length))) {
    semantics.property = { ...propertySource, group: null }
  }
  semantics.financing_amounts = Object.entries(financingAmounts({}, raw.financing_amounts, actionMessage))
    .map(([role, value]) => ({ role, ...object(value) }))
  let catalogRequest = normalizeCatalogRequest(raw.catalog_request, actionMessage)
  const currentProperty = object(semantics.property), propertyFilters = object(currentProperty.filters)
  // Selecting a requirement narrows the catalogue. It does not select the
  // sole unit that happens to match it. Explicit codes and relative unit
  // selectors retain their separate meaning.
  if (currentProperty.operation === 'select' && propertyFilters.floor_number !== null
    && propertyFilters.floor_number !== undefined && currentProperty.confidence === 'high'
    && evidenceMatches(text(object(currentProperty.filter_evidence).floor_number), actionMessage)
    && !(Array.isArray(currentProperty.unit_numbers) && currentProperty.unit_numbers.length) && !currentProperty.selector) {
    semantics.property = { ...currentProperty, operation: 'search', reference_kind: 'none', query_scope: 'catalog' }
    if (catalogRequest?.purpose === 'select') catalogRequest = { ...catalogRequest, purpose: 'search' }
    semantics.normalization_issues = [...(Array.isArray(semantics.normalization_issues) ? semantics.normalization_issues : []),
      'floor_preference_is_not_unit_selection']
  }
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
  const rejectedCurrentOperationalRequests = rawRequests.map(request => ({ request, reason: currentOperationalRequestIssue(request, readable) }))
    .filter(item => item.reason !== null)
  const requests = rawRequests.filter(request => !reservationCollision(request))
    .filter(request => !currentOperationalRequestIssue(request, readable))
    .filter(request => !(request.domain === 'visit' && !currentVisit && sameEvidence(request.evidence, answer.evidence)))
    .filter(request => text(request.request).trim() && (evidenceMatches(text(request.evidence), readable) || pendingSource(request)))
    .slice(0, 12).map(request => ({ request: text(request.request).slice(0, 500),
      domain: requestDomains.includes(text(request.domain).trim().toLowerCase() as typeof requestDomains[number]) ? text(request.domain).trim().toLowerCase() : 'other',
      evidence: text(request.evidence), confidence: ['high', 'medium', 'low'].includes(text(request.confidence)) ? request.confidence : 'low',
      ...(!evidenceMatches(text(request.evidence), readable) ? { source_message_id: pendingSource(request)?.message_id, source: 'pending' } : {}) }))
  if (extracted.financing_consent === true) {
    // Apply the same permission contract as the operational consumer. Naming a
    // lender or asking about its terms is not a new financial authorization.
    // This changes only the current-turn claim, never a saved prior consent.
    const financing = object(input.financiamiento)
    const permission = financingInputs({ ...extracted, turn_semantics: { ...semantics,
      requests: requests.filter(request => evidenceMatches(text(request.evidence), actionMessage)) } }, actionMessage,
    lastQuestion || text(object(input.pregunta_pendiente).question),
    { partners: Array.isArray(financing.partners) ? financing.partners.map(text) : [], current: object(financing.current) },
    object(object(input.resumen)._last_operational_step))
    if (permission.consent !== true) {
      extracted.financing_consent = null
      semantics.normalization_issues = [...(Array.isArray(semantics.normalization_issues) ? semantics.normalization_issues : []),
        'financing_consent_without_current_authorization']
    }
  }
  const currentPositivePropertyRequest = requests.find(request => request.domain === 'property' && request.confidence === 'high'
    && evidenceMatches(text(request.evidence), readable)
    && !refusalOnlyStatement(evidenceMatches(text(request.request), readable) ? text(request.request) : text(request.evidence)))
  const noPositiveOperationalRequest = !requests.some(request => ['visit', 'financing', 'advisor', 'tracking'].includes(text(request.domain))
    && request.confidence === 'high' && evidenceMatches(text(request.evidence), readable))
  const discardedOperationalScope = rejectedCurrentOperationalRequests.length > 0
    || ['ask_financing', 'request_visit'].includes(text(semantics.primary_intent)) && refusalOnlyStatement(text(semantics.primary_evidence))
  if (discardedOperationalScope) {
    const previousDecisions = object(semantics.interpretation).decisions
    semantics.interpretation = { ...object(semantics.interpretation), decisions: [
      ...(Array.isArray(previousDecisions) ? previousDecisions : []),
      ...[...new Set(rejectedCurrentOperationalRequests.map(item => item.reason))].map(code => ({ code })),
    ] }
    if (noPositiveOperationalRequest && !extracted.requested_advisor && !extracted.opt_out && extracted.financing_consent !== true
      && !currentVisit && object(semantics.reservation).kind === 'none') {
      const positivePropertyEvidence = currentPositivePropertyRequest
        ? evidenceMatches(text(currentPositivePropertyRequest.request), readable) ? text(currentPositivePropertyRequest.request)
          : text(currentPositivePropertyRequest.evidence) : ''
      const currentPriceQuery = positivePropertyEvidence && asksUnitPrice(positivePropertyEvidence, true)
        && catalogRequest?.metric === 'published_commercial_price'
      const canonicalIntent = currentPositivePropertyRequest ? currentPriceQuery ? 'ask_price' : 'project_information' : 'other'
      if (['other', 'ask_financing', 'request_visit', 'project_information'].includes(text(semantics.primary_intent))) {
        semantics.primary_intent = canonicalIntent
        semantics.primary_evidence = positivePropertyEvidence || null
        semantics.confidence = currentPositivePropertyRequest ? 'high' : 'low'
        const decisions = object(semantics.interpretation).decisions
        semantics.interpretation = { ...object(semantics.interpretation), canonical_primary_intent: canonicalIntent,
          decisions: [...(Array.isArray(decisions) ? decisions : []), { code: 'current_positive_request_recovers_discarded_operational_scope' }] }
      }
      extracted.events = (Array.isArray(extracted.events) ? extracted.events : []).filter(event => event !== 'asked_financing'
        && (event !== 'asked_reservation' || requests.some(request => request.domain === 'property'
          && !refusalOnlyStatement(text(request.evidence)) && /\b(?:reserv\w*|separ\w*)\b/.test(normalized(text(request.evidence))))))
    }
  }
  let property = object(semantics.property)
  const rawInterpretationDecisions = object(semantics.interpretation).decisions
  const interpretationDecisions = Array.isArray(rawInterpretationDecisions)
    ? rawInterpretationDecisions.map(object) : []
  const rejectedActionIntent = interpretationDecisions.some(decision => decision.code === 'reservation_intent_without_current_action_evidence')
    || Array.isArray(semantics.normalization_issues) && semantics.normalization_issues.includes('visit_event_without_current_request')
  const currentPropertyRequest = requests.find(request => request.domain === 'property' && request.confidence === 'high'
    && evidenceMatches(text(request.evidence), actionMessage))
  const hasCurrentAction = extracted.requested_advisor || extracted.opt_out || extracted.financing_consent === true || currentVisit
    || object(semantics.reservation).kind !== 'none'
    || requests.some(request => ['visit', 'financing', 'advisor', 'tracking'].includes(text(request.domain))
      && request.confidence === 'high' && evidenceMatches(text(request.evidence), actionMessage))
  const propertyContext = object(input.contexto_propiedades)
  const hasContextIds = (key: string) => { const ids = propertyContext[key]; return Array.isArray(ids) && ids.length > 0 }
  const hasKnownOptions = ['offered_ids', 'comparison_ids', 'selected_ids'].some(hasContextIds)
  const currentCatalogRequirements = object(semantics.catalog_request).requirements
  const currentQuantities = (Array.isArray(semantics.housing_quantities) ? semantics.housing_quantities : []).map(object)
  const evaluatedQuantity = currentQuantities.find(quantity => quantity.dimension === 'bedrooms' && quantity.role === 'evaluation'
    && quantity.confidence === 'high' && evidenceMatches(text(quantity.evidence), actionMessage))
  const noCurrentFilters = !Object.values(object(property.filters)).some(value => value !== null && value !== undefined
    && (!Array.isArray(value) || value.length > 0))
  const currentPeopleContext = currentQuantities.find(quantity => quantity.dimension === 'people'
    && ['context', 'evaluation'].includes(text(quantity.role)) && quantity.confidence === 'high'
    && evidenceMatches(text(quantity.evidence), actionMessage))
  const currentOnlyPropertyRequests = requests.filter(request => request.domain === 'property' && request.confidence === 'high'
    && evidenceMatches(text(request.evidence), actionMessage))
  const knownReferenceInCurrentRequest = currentOnlyPropertyRequests.length === 1
    && /\b(?:(?:es(?:t)?[ao]s?|aquell[ao]s?|amb[ao]s?) (?:opciones?|alternativas?|unidades?|departamentos?|apartamentos?|penthouses?|suites?|viviendas?|inmuebles?)|(?:en|entre|de) (?:ellas|ellos|ambas|ambos))\b/.test(normalized(text(currentOnlyPropertyRequests[0].evidence)))
  const knownGroup = text(object(propertyContext.query).group)
  // The people count describes the household, not another bedroom filter. A
  // current request explicitly referring to the already offered options can
  // still ask about their distribution without repeating a bedroom count.
  if (property.operation === 'none' && currentPeopleContext && knownReferenceInCurrentRequest && hasKnownOptions
    && noCurrentFilters && !hasCurrentAction && !extracted.tracking_consent && !property.category && !property.selector
    && !(Array.isArray(property.unit_numbers) && property.unit_numbers.length)
    && !(Array.isArray(property.excluded_categories) && property.excluded_categories.length)
    && !(knownGroup && property.group && property.group !== knownGroup)
    && !currentQuantities.some(quantity => quantity.role === 'requirement')
    && !(Array.isArray(currentCatalogRequirements) && currentCatalogRequirements.length)
    && !['search', 'select', 'rank'].includes(text(object(semantics.catalog_request).purpose))
    && ['other', 'project_information', 'ask_price'].includes(text(semantics.primary_intent))
    && object(semantics.budget).status === 'not_discussed') {
    const propertyRequestEvidence = currentOnlyPropertyRequests[0].evidence
    property = { ...property, group: property.group || knownGroup || null, operation: 'details', reference_kind: 'followup',
      query_scope: hasContextIds('comparison_ids') ? 'comparison' : hasContextIds('offered_ids') ? 'offered' : 'selected',
      evidence: propertyRequestEvidence, confidence: 'high' }
    semantics.property = property
    semantics.normalization_issues = [...(Array.isArray(semantics.normalization_issues) ? semantics.normalization_issues : []),
      'current_household_reference_restores_known_property_information']
    const priorDecisions = object(semantics.interpretation).decisions
    if (semantics.primary_intent !== 'ask_price' && !asksUnitPrice(actionMessage, true)) {
      semantics.primary_intent = 'project_information'
      semantics.primary_evidence = propertyRequestEvidence
      semantics.confidence = 'high'
    }
    semantics.interpretation = { ...object(semantics.interpretation), canonical_primary_intent: semantics.primary_intent,
      decisions: [...(Array.isArray(priorDecisions) ? priorDecisions : []),
        { code: 'current_household_reference_restores_known_property_information', source: 'current_property_request_and_people_context',
          query_scope: property.query_scope }] }
  }
  if (semantics.primary_intent === 'other' && rejectedActionIntent && property.operation === 'none'
    && currentPropertyRequest && evaluatedQuantity && hasKnownOptions && noCurrentFilters && !hasCurrentAction
    && !currentQuantities.some(quantity => quantity.role === 'requirement')
    && !(Array.isArray(currentCatalogRequirements) && currentCatalogRequirements.length)
    && !['search', 'select', 'rank'].includes(text(object(semantics.catalog_request).purpose))) {
    property = { ...property, group: text(object(propertyContext.query).group) || property.group || 'residential',
      operation: 'details', reference_kind: 'followup', query_scope: hasContextIds('comparison_ids') ? 'comparison'
        : hasContextIds('offered_ids') ? 'offered' : 'selected', evidence: currentPropertyRequest.evidence, confidence: 'high' }
    semantics.property = property
    semantics.normalization_issues = [...(Array.isArray(semantics.normalization_issues) ? semantics.normalization_issues : []),
      'current_evaluation_restores_known_property_reference']
  }
  if (semantics.primary_intent === 'other' && rejectedActionIntent && object(semantics.reservation).kind === 'none'
    && property.confidence === 'high' && ['details', 'compare'].includes(text(property.operation))
    && evidenceMatches(text(property.evidence), actionMessage)
    && requests.some(request => request.domain === 'property' && request.confidence === 'high' && evidenceMatches(text(request.evidence), actionMessage))
    && !requests.some(request => ['visit', 'financing', 'advisor', 'tracking'].includes(text(request.domain))
      && request.confidence === 'high' && evidenceMatches(text(request.evidence), actionMessage))
    && !extracted.requested_advisor && !extracted.opt_out && extracted.financing_consent !== true && !currentVisit
    && !(answer.kind === 'affirmative' && /^(?:si|claro|de acuerdo|esta bien|perfecto)(?:,? por favor)?[.! ]*$/.test(normalized(actionMessage)))) {
    semantics.primary_intent = 'project_information'
    semantics.primary_evidence = property.evidence
    semantics.confidence = 'high'
    semantics.interpretation = { ...object(semantics.interpretation), canonical_primary_intent: 'project_information',
      decisions: [...interpretationDecisions, { code: 'current_property_information_recovers_unsupported_action_intent' }] }
  }
  // Exclusive evaluation of known options is informational even when an
  // unrelated high-level label disagrees. Quantity meaning and current source
  // are required together; an actual price question keeps its own objective.
  const currentPropertyRequests = requests.filter(request => request.domain === 'property' && request.confidence === 'high'
    && evidenceMatches(text(request.evidence), actionMessage))
  const exclusiveCurrentEvaluation = evaluatedQuantity && hasKnownOptions && noCurrentFilters && !hasCurrentAction
    && !extracted.tracking_consent && currentPropertyRequests.length === 1
    && property.confidence === 'high' && ['details', 'compare'].includes(text(property.operation))
    && evidenceMatches(text(property.evidence), actionMessage)
    && !currentQuantities.some(quantity => quantity.role === 'requirement')
    && !(Array.isArray(currentCatalogRequirements) && currentCatalogRequirements.length)
    && !['search', 'select', 'rank'].includes(text(object(semantics.catalog_request).purpose))
    && object(semantics.catalog_request).metric !== 'published_commercial_price'
    && !asksUnitPrice(actionMessage, true)
  if (exclusiveCurrentEvaluation) {
    const previousEvaluationDecisions = object(semantics.interpretation).decisions
    if (semantics.primary_intent !== 'project_information') {
      semantics.primary_intent = 'project_information'
      semantics.primary_evidence = property.evidence
      semantics.confidence = 'high'
      semantics.interpretation = { ...object(semantics.interpretation), canonical_primary_intent: 'project_information',
        decisions: [...(Array.isArray(previousEvaluationDecisions) ? previousEvaluationDecisions : []),
          { code: 'current_evaluation_recovers_exclusive_informational_scope' }] }
    }
    extracted.events = (Array.isArray(extracted.events) ? extracted.events : []).filter(event => event !== 'asked_price')
  }
  const budgetAnswer = object(semantics.budget), pendingQuestionId = text(object(input.pregunta_pendiente).id)
  const sameBudgetClause = (evidence: unknown) => {
    const quote = normalized(text(evidence)), budgetQuote = normalized(text(budgetAnswer.evidence))
    return Boolean(quote && budgetQuote && (quote.includes(budgetQuote) || budgetQuote.includes(quote)))
  }
  const exclusiveBudgetAnswer = ['budget_amount', 'budget_kind'].includes(pendingQuestionId)
    && budgetAnswer.confidence === 'high' && budgetAnswer.status !== 'not_discussed'
    && evidenceMatches(text(budgetAnswer.evidence), actionMessage) && property.operation === 'none'
    && !extracted.requested_advisor && !extracted.opt_out && extracted.financing_consent !== true && !currentVisit
    && object(semantics.reservation).kind === 'none'
    && !requests.some(request => request.confidence === 'high' && evidenceMatches(text(request.evidence), actionMessage)
      && !['courtesy', 'tracking'].includes(text(request.domain)) && !sameBudgetClause(request.evidence))
  if (exclusiveBudgetAnswer && semantics.primary_intent !== 'discuss_budget') {
    const currentInterpretationDecisions = object(semantics.interpretation).decisions
    semantics.primary_intent = 'discuss_budget'
    semantics.primary_evidence = budgetAnswer.evidence
    semantics.confidence = 'high'
    semantics.interpretation = { ...object(semantics.interpretation), canonical_primary_intent: 'discuss_budget',
      decisions: [...(Array.isArray(currentInterpretationDecisions) ? currentInterpretationDecisions : []),
        { code: 'current_budget_answer_recovers_exclusive_scope' }] }
    extracted.events = (Array.isArray(extracted.events) ? extracted.events : []).filter(event => event !== 'asked_price')
  }
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
