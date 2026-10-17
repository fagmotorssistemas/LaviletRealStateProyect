import { createHash } from 'node:crypto'
import { ACTION_AUTHORITY_RULES,ACTION_AUTHORITY_SCHEMA,actionAuthorized,actionDeclined,currentContactDecision,normalizedActionAuthority } from './action-authority'
import { budgetQuestionBasis } from './budget-question-context'
import { CATALOG_REQUEST_RULES,CATALOG_REQUEST_SCHEMA,catalogRequestStatus,normalizeCatalogRequest } from './catalog-request'
import { CONVERSATION_LANGUAGE_RULES,CONVERSATION_LANGUAGE_SCHEMA,conversationLanguage } from './conversation-language'
import { normalizeEvents,VISIT_INTENT_EXTRACTION_RULES,VISIT_PREFERENCE_EXTRACTION_RULES } from './conversation-rules'
import { CURRENT_EVIDENCE_FRAGMENTS_RULES,currentMessageFragments,EVIDENCE_SOURCES_SCHEMA,reconcileInformationalEvidence } from './current-evidence-fragments'
import { object,text,type Row } from './data'
import { DISCOUNT_REQUEST_EXTRACTION_RULES } from './discount-request'
import { EXTRACTED_CONVERSATION_EVENTS } from './event-contract'
import { EXTRACTION_REQUEST_RULES } from './extraction-request-rules'
import { acceptedExtractorConfidence } from './extractor-confidence'
import { FINANCING_PARTNER_CHOICE_RULES,FINANCING_PARTNER_CHOICE_SCHEMA } from './financing'
import { FINANCING_AMOUNTS_RULES,FINANCING_AMOUNTS_SCHEMA,financingAmounts,financingAmountStatements,reconcileMonetaryInterpretation } from './financing-amounts'
import { resolveFinancingEntryReference } from './financing-entry'
import { FINANCING_IDENTITY_RULES,FINANCING_IDENTITY_SCHEMA } from './financing-identity'
import { compactFinancingExtraction,FINANCING_EXTRACTION_RULES } from './financing-prompt'
import { FINANCING_QUOTE_EXTRACTION_RULES,FINANCING_QUOTE_SCHEMA } from './financing-quote'
import { isolateHistoricalBudget,reconcileConfirmedBudgetEcho } from './historical-budget-isolation'
import { interpretationConsistencyIssues, propertyAnswerConsistencyIssues } from './interpretation-consistency'
import { interactionGoalIssues, INTERACTION_GOAL_RULES } from './interaction-mode'
import { CONTEXTUAL_OBJECTION_EXTRACTION_RULES } from './project-objections'
import { reconcileHistoricalInterpretation,rememberInterpretationFacts } from './interpretation-memory'
import { partiallyRecoverInterpretation } from './interpretation-partial-recovery'
import { LEAD_NURTURE_EXTRACTION_RULES } from './lead-nurture-state'
import { currentProfileNameResponse,LEAD_PROFILE_EXTRACTION_RULES,needsProfileNameRecovery,normalizeLeadProfile,PROFILE_NAME_RECOVERY_RULES,requiresProfileNameAssessment } from './lead-profile'
import { confirmedMonetaryReferences } from './monetary-reference'
import { PENDING_REQUEST_RULES } from './pending-inbound'
import { MATERIAL_REQUEST_RULES,MATERIAL_REQUEST_SCHEMA } from './project-material'
import { promptSections } from './prompt-sections'
import { PROPERTY_CATEGORIES } from './property-category-contract'
import { RECOMMENDATION_REQUEST_RULES,RECOMMENDATION_REQUEST_SCHEMA,recommendationRequest } from './property-recommendation-request'
import { COMMON_AREA_REQUEST_RULES,FINANCING_REQUEST_TOPICS_RULES,normalizedRequestTopics,REQUEST_TOPICS_RULES,REQUEST_TOPICS_SCHEMA } from './request-topics'
import { SELECTION_PREFERENCES_RULES,VIEWS_PREFERENCE_RULES } from './selection-preferences'
import { COMMUNICATION_INTERPRETATION_RULES,communicationSchema,normalizedTurnCommunication } from './turn-communication'
import { BLOCK_RECOVERY_RULES,CURRENT_TURN_INTERPRETATION_RULE,EXTRACTION_CONSISTENCY_RULES,interpretationInput,interpretationRepairBlocks,interpretationRepairContext,interpretationSourceIssues,isolateHistoricalPropertyFromBudget,mergeInterpretationRepair,normalizeInactiveInterpretation,QUANTITY_RECOVERY_RULES,reconcileEchoedBudgetQuestion,reconcileFinancingReference,reconcilePassivePropertyMemory,reconcileQuotedQuantityReferences,TurnInterpretationError } from './turn-interpretation-input'
import { TURN_RULES } from './turn-routing'
import { normalizedTurnRouting,TURN_ROUTING_RULES,TURN_ROUTING_SCHEMA } from './turn-routing-contract'
import { normalizedPendingQuestion,normalizeTurnSemantics,pendingQuestionFromReply,TURN_SEMANTIC_EXTRACTION_RULES,TURN_SEMANTICS_SCHEMA } from './turn-semantics'
import { normalizedVisitPreference,VISIT_PREFERENCE_SCHEMA,visitPreferenceSchemaForSources } from './visit-preference-contract'

export const CONVERSATION_CONTRACT_VERSION = 'lavilet-dialogue-v4'

const nullableString = { type: ['string', 'null'] }
const nullableNumber = { type: ['number', 'null'] }
const boolean = { type: 'boolean' }
const closedObject = (properties: Row): Row => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false })
const nullableObject = (properties: Row): Row => ({ anyOf: [closedObject(properties), { type: 'null' }] })
const confidence = { type: 'string', enum: ['high', 'medium', 'low'] }
const requestDomains = ['property', 'visit', 'financing', 'advisor', 'tracking', 'courtesy', 'other'] as const
const nameResponseProperties = { status: { type: 'string', enum: ['declared', 'not_declared', 'declined', 'uncertain'] },
  evidence: { type: 'string' }, confidence }

/** One versioned extraction contract. Unknown values stay null; actions still require server validation. */
export const TURN_EXTRACTION_SCHEMA = closedObject({
  routing: TURN_ROUTING_SCHEMA,
  communication: communicationSchema,
  action_authority: ACTION_AUTHORITY_SCHEMA,
  evidence_sources: EVIDENCE_SOURCES_SCHEMA,
  conversation_language: CONVERSATION_LANGUAGE_SCHEMA,
  recommendation_request: RECOMMENDATION_REQUEST_SCHEMA,
  events: { type: 'array', items: { type: 'string', enum: [...EXTRACTED_CONVERSATION_EVENTS] } },
  preferred_category: { type: ['string', 'null'], enum: [...PROPERTY_CATEGORIES, null] },
  purchase_purpose: { type: ['string', 'null'], enum: ['vivir', 'invertir', 'segunda_vivienda', 'negocio', null] },
  declaration_evidence: closedObject({ preferred_category: nullableString, purchase_purpose: nullableString }),
  qualification: closedObject(Object.fromEntries(['actividad_comercial', 'area_buscada', 'prioridad', 'plazo_compra', 'presupuesto_texto', 'dormitorios_texto'].map(key => [key, nullableString]))),
  unit_id: nullableString,
  preferred_visit_time_text: nullableString,
  visit_needs_help: boolean,
  financing_partner: nullableString,
  financing_partner_choice: FINANCING_PARTNER_CHOICE_SCHEMA,
  material_request: MATERIAL_REQUEST_SCHEMA,
  full_name: nullableString,
  name_response: nullableObject(nameResponseProperties),
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
  visit_preference: VISIT_PREFERENCE_SCHEMA,
  visit_preferences: { type: 'array', maxItems: 12, items: VISIT_PREFERENCE_SCHEMA },
  visit_intent: nullableObject({ kind: { type: 'string', enum: ['request_visit', 'accept_visit_preference', 'visit_information', 'decline_visit', 'visit_status', 'none'] },
    purpose: { type: 'string', enum: ['coordination', 'preference', 'accept_alternative', 'availability_information', 'access_information', 'decline', 'cancel', 'status', 'none'] },
    target: { type: 'string', enum: ['project', 'other', 'unspecified'] },
    destination: { type: ['string', 'null'], enum: ['office', 'site', 'work_area', 'model', 'completed_unit', 'building', null] }, evidence: { type: 'string' }, confidence }),
  requests: { type: 'array', items: closedObject({ request: { type: 'string' }, domain: { type: 'string', enum: [...requestDomains] }, topics: REQUEST_TOPICS_SCHEMA, evidence: { type: 'string' }, confidence }) },
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

/** Called for every authorized turn, before a response route or operational decision is selected. */
export async function interpretConversationTurn(input: Row, dependencies: Dependencies): Promise<TurnInterpretation> {
  const current = text(input.mensaje_actual)
  const monetaryReferences = confirmedMonetaryReferences(input)
  const pending = (Array.isArray(input.consultas_pendientes) ? input.consultas_pendientes : []).map(object)
  const readable = current.replace(/\[Archivo no interpretado[^\]]*\]|\[Sticker recibido\]/g, '').trim()
  const method = !readable ? 'unreadable_input' : 'model'
  let raw: Row = {}, promptRevision: string | null = null
  const historicalFields = new Set<string>()
  const reconcile = (value: Row, budgetEchoAllowed = false) => {
    value = reconcileInformationalEvidence(value, readable)
    const entrySemantics = object(value.turn_semantics), entryBudget = object(entrySemantics.budget), entryAnswer = object(entrySemantics.answer_to_previous)
    // The delivered question and typed answer identify the subject. Preserve
    // this response for entry memory without replacing a known total budget.
    if (object(input.pregunta_pendiente).id === 'financing_down_payment'
      && entryAnswer.question_id === 'financing_down_payment' && acceptedExtractorConfidence(entryAnswer.confidence)
      && ['no_defined_budget', 'declines_to_disclose', 'amount_pending'].includes(text(entryBudget.status))
      && !['total_budget'].includes(text(entryBudget.subject)) && entryBudget.evidence === entryAnswer.evidence) {
      value = { ...value, turn_semantics: { ...entrySemantics, budget: { ...entryBudget, subject: 'down_payment' } } }
    }
    value = resolveFinancingEntryReference(value, readable, normalizedPendingQuestion(input.pregunta_pendiente))
    value = reconcileMonetaryInterpretation(value, readable)
    // A recovery owns genuinely unresolved financial meaning. It cannot erase
    // the original current declaration by returning a new historical echo.
    const budgetEcho = budgetEchoAllowed ? reconcileConfirmedBudgetEcho(value, input, readable) : { raw: value, fields: [] }
    budgetEcho.fields.forEach(field => historicalFields.add(field))
    const result = reconcileHistoricalInterpretation(reconcilePassivePropertyMemory(reconcileFinancingReference(budgetEcho.raw, input, readable), input), readable, object(input.resumen))
    result.fields.forEach(field => historicalFields.add(field))
    const references = reconcileQuotedQuantityReferences(result.raw, input, readable)
    references.fields.forEach(field => historicalFields.add(field))
    const budgetQuestion = reconcileEchoedBudgetQuestion(references.raw, input, readable)
    budgetQuestion.fields.forEach(field => historicalFields.add(field))
    return normalizeInactiveInterpretation(budgetQuestion.raw)
  }
  let recoveryIssues: string[] = []
  let profileNameRecovery: Row = { attempted: false, status: 'not_needed' }
  let isolatedProperty = false
  let isolatedBudget = false
  let clarificationFields: string[] = []
  const visitPreferenceInvalid = (value: Row) => {
    const primary = object(value.visit_preference), batch = Array.isArray(value.visit_preferences) ? value.visit_preferences : []
    const candidates = [primary, ...batch.map(object)].filter(item => ['specified', 'ambiguous', 'declined'].includes(text(item.decision))
      || item.location_type != null || !['', 'none'].includes(text(object(item.date).kind)) || !['', 'none'].includes(text(object(item.time).kind)))
    const context = { sourceMessageId: text(input.source_message_id), sourceAt: text(input.source_at),
      currentMessages: input.current_messages, history: input.historial || input.historial_reciente, pendingQuestion: normalizedPendingQuestion(input.pregunta_pendiente),
      answer: object(value.turn_semantics).answer_to_previous, collecting: object(input.coordinacion_visita).status === 'collecting' }
    return batch.length > 12 || candidates.some(preference => !normalizedVisitPreference(preference, readable, context))
  }
  const inconsistentSocialTurn = (value: Row) => {
    const communication = normalizedTurnCommunication(value.communication, readable)
    if (!['greeting_only', 'courtesy_only', 'reaction_only'].includes(communication.kind)) return false
    const authority = normalizedActionAuthority(value.action_authority, readable)
    const profile = object(value.profile_evidence), identity = object(value.financing_identity)
    const property = object(object(value.turn_semantics).property), contact = currentContactDecision(authority)
    return (['advisor', 'visit', 'financing', 'reservation'] as const).some(domain => actionAuthorized(authority, domain))
      || contact.opt_out === true || contact.tracking_consent === true
      || property.operation !== 'none' && acceptedExtractorConfidence(property.confidence) && evidenceMatches(text(property.evidence), readable)
      || ['selected', 'conditional', 'rejected'].includes(text(object(object(value.turn_semantics).unit_choice).kind))
        && acceptedExtractorConfidence(object(object(value.turn_semantics).unit_choice).confidence)
        && evidenceMatches(text(object(object(value.turn_semantics).unit_choice).evidence), readable)
      || ['request', 'accept', 'decline', 'inquiry', 'defer'].includes(text(object(value.material_request).kind))
        && acceptedExtractorConfidence(object(value.material_request).confidence) && evidenceMatches(text(object(value.material_request).evidence), readable)
      || ['full_name', 'residence_city', 'residence_country'].some(key => value[key] != null && evidenceMatches(text(profile[key]), readable))
      || ['given_names', 'surnames', 'document'].some(key => identity[key] != null && evidenceMatches(text(identity.evidence), readable))
      || (Array.isArray(value.financing_amounts) ? value.financing_amounts : []).map(object).some(amount =>
        typeof amount.amount === 'number' && evidenceMatches(text(amount.evidence), readable))
      || (Array.isArray(value.requests) ? value.requests : []).map(object).some(request => request.domain !== 'courtesy'
      && acceptedExtractorConfidence(request.confidence) && evidenceMatches(text(request.evidence), readable))
  }
  const missingOperationMeaning = (value: Row) => {
    const visit = object(value.visit_intent), reservation = object(object(value.turn_semantics).reservation)
    const authority = object(value.action_authority)
    return (visit.kind === 'request_visit' && acceptedExtractorConfidence(visit.confidence) && evidenceMatches(text(visit.evidence), readable)
      && object(authority.visit).decision === 'none')
      || (reservation.kind === 'request' && acceptedExtractorConfidence(reservation.confidence) && evidenceMatches(text(reservation.evidence), readable)
        && object(authority.reservation).decision === 'none')
  }
  const validationIssues = (value: Row) => [...new Set([
    ...(!Object.hasOwn(value, 'communication') || !Object.hasOwn(value, 'routing') || object(value.action_authority).version !== 'action-authority-v1' ? ['invalid_turn_contract'] : []),
    ...(inconsistentSocialTurn(value) || missingOperationMeaning(value) ? ['invalid_turn_contract'] : []),
    ...(visitPreferenceInvalid(value) ? ['invalid_visit_preference'] : []),
    ...interactionGoalIssues(value, readable),
    ...propertyAnswerConsistencyIssues(value, readable, normalizedPendingQuestion(input.pregunta_pendiente)),
    ...interpretationSourceIssues(value, readable, pending, normalizedPendingQuestion(input.pregunta_pendiente), monetaryReferences), ...interpretationConsistencyIssues(value, readable),
  ])]
  if (method === 'model') {
    // Interpretation is shared by both retrieval routes. The feature switch
    // controls retrieval/context size, never the meaning of a requirement.
    const nameAssessmentRequired = requiresProfileNameAssessment(input)
    const extractionSchema = closedObject({ ...object(TURN_EXTRACTION_SCHEMA.properties),
      visit_preference: visitPreferenceSchemaForSources(input),
      visit_preferences: { type: 'array', maxItems: 12, items: visitPreferenceSchemaForSources(input) },
      ...(nameAssessmentRequired ? { name_response: closedObject(nameResponseProperties) } : {}),
      catalog_request: CATALOG_REQUEST_SCHEMA })
    const prompt = await dependencies.activePrompt('extractor_eventos')
    const requestRules = `Contrato ${CONVERSATION_CONTRACT_VERSION}.\n${EXTRACTION_REQUEST_RULES}`
    const commonInterpretation = TURN_ROUTING_RULES + '\n' + COMMUNICATION_INTERPRETATION_RULES + '\n' + ACTION_AUTHORITY_RULES + '\n' + VISIT_PREFERENCE_EXTRACTION_RULES
      + '\n' + CONTEXTUAL_OBJECTION_EXTRACTION_RULES
    const currentInstructions = (compactFinancingExtraction(input) ? promptSections([
      ['Función y configuración del extractor', prompt], ['Interpretación del turno y recopilación financiera', FINANCING_EXTRACTION_RULES],
      ['Orientación sobre entrada y cuotas', FINANCING_QUOTE_EXTRACTION_RULES],
      ['Prioridades inmobiliarias durante una consulta financiera', SELECTION_PREFERENCES_RULES + '\n' + VIEWS_PREFERENCE_RULES],
      ['Solicitud de material', MATERIAL_REQUEST_RULES],
      ['Idioma, recomendaciones y fuentes actuales', CONVERSATION_LANGUAGE_RULES + '\n' + RECOMMENDATION_REQUEST_RULES + '\n' + CURRENT_EVIDENCE_FRAGMENTS_RULES],
      ['Consultas y negociación de descuentos', DISCOUNT_REQUEST_EXTRACTION_RULES],
      ['Preferencia de entidad', FINANCING_PARTNER_CHOICE_RULES],
      ['Nutrición y compra aplazada', LEAD_NURTURE_EXTRACTION_RULES],
      ['Orientación e información solicitada', INTERACTION_GOAL_RULES],
      ['Temas actuales por solicitud', REQUEST_TOPICS_RULES + '\n' + FINANCING_REQUEST_TOPICS_RULES + '\n' + COMMON_AREA_REQUEST_RULES],
      ['Comprobación de coherencia entre bloques', EXTRACTION_CONSISTENCY_RULES],
      ['Interpretación del perfil pendiente', nameAssessmentRequired && LEAD_PROFILE_EXTRACTION_RULES],
    ]) : promptSections([
      ['Función y configuración del extractor', prompt],
      ['Idioma, recomendaciones y fuentes actuales', CONVERSATION_LANGUAGE_RULES + '\n' + RECOMMENDATION_REQUEST_RULES + '\n' + CURRENT_EVIDENCE_FRAGMENTS_RULES],
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
      ['Visitas y respuestas a propuestas pendientes', TURN_RULES + '\n' + VISIT_INTENT_EXTRACTION_RULES],
      ['Temas actuales por solicitud', REQUEST_TOPICS_RULES + '\n' + FINANCING_REQUEST_TOPICS_RULES + '\n' + COMMON_AREA_REQUEST_RULES],
      ['Comprobación de coherencia entre bloques', EXTRACTION_CONSISTENCY_RULES],
      ['Formato de salida', 'El esquema JSON enviado con esta llamada es la única definición de campos y valores permitidos. Complete sus campos; use null solo donde el esquema lo permite y el dato sea desconocido. No añada un formato alternativo ni texto fuera del JSON.'],
    ])
    ) + '\n' + commonInterpretation
    promptRevision = createHash('sha256').update(currentInstructions).digest('hex').slice(0, 16)
    dependencies.onPromptRevision?.(promptRevision)
    const modelInput = interpretationInput(input, readable)
    raw = reconcile(await dependencies.aiJson(currentInstructions, modelInput, extractionSchema), true)
    recoveryIssues = validationIssues(raw)
    const budget = object(object(raw.turn_semantics).budget)
    // Question context can request a semantic recheck, but never supplies the
    // amount or changes the model's monetary role without that focused check.
    // Generic amount questions deliberately preserve a genuine ambiguity.
    const previousQuestion = text(input.ultima_pregunta) || text(object(object(input.resumen)._last_operational_step).reply)
    const kindWasAsked = normalizedPendingQuestion(input.pregunta_pendiente).id === 'budget_kind'
      || pendingQuestionFromReply(previousQuestion).id === 'budget_kind'
    const roleWasAsked = budgetQuestionBasis(normalizedPendingQuestion(input.pregunta_pendiente))
      || budgetQuestionBasis(pendingQuestionFromReply(previousQuestion))
    if (budget.status === 'amount' && acceptedExtractorConfidence(budget.confidence) && evidenceMatches(text(budget.evidence), readable)
      && (kindWasAsked || roleWasAsked)) recoveryIssues.push('unresolved_budget_role')
    if (recoveryIssues.length) {
      const blocks = interpretationRepairBlocks(recoveryIssues)
      const quantityOnly = blocks.quantity && !blocks.property && !blocks.budget && !blocks.requests && !blocks.profile && blocks.semanticFields.length === 1
      const rootProperties = object(extractionSchema.properties), semanticProperties = object(TURN_SEMANTICS_SCHEMA.properties)
      const repairProperties: Row = Object.fromEntries(blocks.rootFields.map(field => [field, rootProperties[field]]))
      repairProperties.recovery_outcome = { type: 'string', enum: ['repaired', 'clarification', 'unrecoverable'],
        description: 'repaired si resolvió los bloques; clarification si solo una preferencia inmobiliaria sigue ambigua y puede aclararse sin acciones; unrecoverable si no hay interpretación segura.' }
      if (blocks.property || blocks.requests || blocks.semanticFields.includes('primary_intent')) repairProperties.evidence_sources = EVIDENCE_SOURCES_SCHEMA
      if (blocks.budget) {
        repairProperties.qualification = closedObject({ presupuesto_texto: nullableString })
        repairProperties.budget_turn_use = closedObject({ kind: { type: 'string', enum: ['current_update', 'context_only', 'none', 'uncertain'] },
          evidence: { type: 'string' }, confidence })
      }
      if (blocks.property) {
        repairProperties.declaration_evidence = closedObject({ preferred_category: nullableString })
        repairProperties.property_turn_use = closedObject({ kind: { type: 'string', enum: ['current_request', 'context_only', 'none', 'uncertain'] },
          evidence: { type: 'string' }, confidence })
      }
      if (blocks.profile) repairProperties.profile_evidence = closedObject({ residence_city: nullableString, residence_country: nullableString })
      if (blocks.semanticFields.length) repairProperties.turn_semantics = closedObject(Object.fromEntries(
        blocks.semanticFields.map(field => [field, semanticProperties[field]])))
      const repairSchema = blocks.fullTurn ? extractionSchema : closedObject(repairProperties)
      const repairInput = interpretationRepairContext({ mensaje_actual: readable,
        ...(blocks.visit ? { source_message_id: modelInput.source_message_id, source_at: modelInput.source_at,
          current_messages: modelInput.current_messages, historial: modelInput.historial, coordinacion_visita: modelInput.coordinacion_visita } : {}),
        pregunta_pendiente: input.pregunta_pendiente,
        ultima_pregunta: previousQuestion,
        hechos_confirmados: modelInput.hechos_confirmados,
        referencias_monetarias_confirmadas: monetaryReferences,
        perfil_inicial: modelInput.perfil_inicial,
        resumen: modelInput.resumen,
        contexto_propiedades: modelInput.contexto_propiedades,
        reservation_context: modelInput.reservation_context,
        unidades_identificadas: modelInput.unidades_identificadas,
        recuperacion_interpretacion: { issues: recoveryIssues,
          fields: [...blocks.semanticFields, ...blocks.rootFields], preserve_other_fields: true,
          instruction: 'Corrija únicamente los bloques del esquema. Las referencias conocidas no son declaraciones actuales; no copie citas del historial. Conserve las demás interpretaciones y permisos.' } }) as Row
      repairInput.mensajes_actuales = currentMessageFragments(readable)
      if (blocks.propertyAnswer) repairInput.historial = modelInput.historial
      if (blocks.visit) {
        // Source recovery needs original message text and IDs. The generic
        // historical-evidence sanitizer deliberately strips these fields.
        repairInput.current_messages = modelInput.current_messages
        repairInput.historial = modelInput.historial
        repairInput.visit_preference_proposed = raw.visit_preference
        repairInput.visit_preferences_proposed = raw.visit_preferences
      }
      repairInput.interpretacion_propuesta = interpretationRepairContext({ property: object(object(raw.turn_semantics).property),
        primary_intent: object(raw.turn_semantics).primary_intent,
        requests: raw.requests, catalog_request: raw.catalog_request,
        instruction: 'Esta propuesta no está validada. Si el único problema es la cita, conserve la elección y reconstruya su evidencia con los IDs actuales consecutivos. Si hay negación, condición o corrección posterior, resuelva el significado completo; si es ambiguo, no seleccione. No sustituya una elección clara por una comparación solo para reparar la cita.' })
      const repairInstructions = blocks.fullTurn ? currentInstructions : quantityOnly ? QUANTITY_RECOVERY_RULES
        : BLOCK_RECOVERY_RULES + '\n' + CURRENT_EVIDENCE_FRAGMENTS_RULES + (blocks.budget ? '\n' + FINANCING_AMOUNTS_RULES + '\n' + EXTRACTION_CONSISTENCY_RULES : '')
          + (blocks.profile ? '\n' + LEAD_PROFILE_EXTRACTION_RULES : '')
          + (blocks.visit ? '\n' + VISIT_PREFERENCE_EXTRACTION_RULES : '')
          + (blocks.semanticFields.includes('interaction_goal') ? '\n' + INTERACTION_GOAL_RULES : '')
          + (blocks.property ? '\n' + CURRENT_TURN_INTERPRETATION_RULE + '\n' + TURN_SEMANTIC_EXTRACTION_RULES + '\n' + CATALOG_REQUEST_RULES + '\n' + REQUEST_TOPICS_RULES : '')
      const repaired = await dependencies.aiJson(repairInstructions,
        blocks.fullTurn ? { ...modelInput, recuperacion_interpretacion: repairInput.recuperacion_interpretacion }
          : quantityOnly ? { mensaje_actual: readable, pregunta_pendiente: input.pregunta_pendiente,
          recuperacion_interpretacion: { issues: recoveryIssues, fields: ['housing_quantities'], preserve_other_fields: true } } : repairInput,
        repairSchema)
      const previous = raw
      raw = reconcile(mergeInterpretationRepair(raw, repaired, recoveryIssues))
      let remaining = validationIssues(raw)
      if (!remaining.length && repaired.recovery_outcome === 'clarification' && blocks.property)
        clarificationFields = ['property']
      if (blocks.budget && !blocks.fullTurn && remaining.length) {
        const isolated = isolateHistoricalBudget(previous, raw, repaired, input, readable, remaining,
          blocks.semanticFields.includes('primary_intent'))
        if (isolated) {
          const candidate = reconcile(isolated)
          const candidateIssues = validationIssues(candidate)
          if (!candidateIssues.length) {
            raw = candidate
            remaining = candidateIssues
            isolatedBudget = true
          }
        }
      }
      if (blocks.property && !blocks.budget && !blocks.fullTurn && remaining.length) {
        const knownBudgetQuestion = text(normalizedPendingQuestion(input.pregunta_pendiente).id).startsWith('budget_')
          || text(pendingQuestionFromReply(previousQuestion).id).startsWith('budget_')
        const isolated = isolateHistoricalPropertyFromBudget(previous, raw, repaired, readable, knownBudgetQuestion, remaining, monetaryReferences)
        if (isolated) {
          raw = reconcile(isolated)
          remaining = validationIssues(raw)
          isolatedProperty = !remaining.length
        }
      }
      if (remaining.length) {
        const partial = partiallyRecoverInterpretation(raw, readable, remaining)
        if (!partial || validationIssues(partial).length) throw new TurnInterpretationError(remaining)
        clarificationFields = [...new Set(remaining.map(issue => text(issue.split(':')[1]).split('.')[0]))]
        raw = partial
      }
    }
    if (needsProfileNameRecovery(raw, readable, input)) {
      // Only an omitted identity field is checked. Previously accepted profile,
      // catalogue, money and permission blocks remain the same objects.
      const before = object(normalizeLeadProfile(raw, readable, input).field_status).full_name
      const repaired = await dependencies.aiJson(PROFILE_NAME_RECOVERY_RULES, {
        mensaje_actual: readable,
        pregunta_pendiente: { id: object(input.pregunta_pendiente).id,
          question: object(input.pregunta_pendiente).question },
        recuperacion_perfil: { fields: ['full_name'], preserve_other_fields: true,
          reason: 'missing_name_in_current_profile_answer' },
      }, closedObject({ full_name: nullableString,
        profile_evidence: closedObject({ full_name: nullableString }),
        name_response: closedObject(nameResponseProperties) }))
      const response = currentProfileNameResponse(repaired, readable)
      const candidate = normalizeLeadProfile(repaired, readable, input)
      const accepted = response?.status === 'declared' && !!candidate.full_name
      profileNameRecovery = { attempted: true, status: accepted ? 'recovered'
        : response && response.status !== 'declared' ? response.status : 'invalid_result',
        initial_field_status: before,
        preserved_fields: ['residence', 'property', 'budget', 'requests', 'permissions'] }
      if (accepted) raw = { ...raw, full_name: candidate.full_name,
        profile_evidence: { ...object(raw.profile_evidence), full_name: object(candidate.evidence).full_name },
        name_response: response }
      else if (response) raw = { ...raw, name_response: response }
    }
  }
  const withDiagnostics = (result: TurnInterpretation): TurnInterpretation => {
    if (clarificationFields.length) result.semantics.interpretation_clarification = {
      fields: clarificationFields, current_message: readable,
      instruction: 'Se conservaron los datos válidos, pero una cita no permitió confirmar esta novedad. Responda las demás consultas verificadas y aclare únicamente ese punto con naturalidad. No afirme una nueva elección, no borre decisiones anteriores ni derive por rutina.' }
    result.diagnostic.interpretation_recovery = { attempted: recoveryIssues.length > 0, issues: recoveryIssues, status: recoveryIssues.length ? 'recovered' : 'not_needed',
      ...(isolatedProperty ? { contract: 'budget-property-isolation-v1', isolated_fields: ['property', 'catalog_request', 'preferred_category', 'unit_id'],
        preserved_fields: ['budget', 'financing_amounts'], reason: 'current_budget_answer_with_context_only_property' } : {}),
      ...(isolatedBudget ? { contract: 'historical-budget-isolation-v1', isolated_fields: ['budget', 'financing_amounts', 'qualification.presupuesto_texto'],
        preserved_fields: ['property', 'requests', 'profile', 'permissions'], reason: 'current_request_with_context_only_budget' } : {}) }
    result.diagnostic.historical_reconciliation = { status: historicalFields.size ? 'confirmed_facts_preserved' : 'not_needed', fields: [...historicalFields] }
    result.diagnostic.profile_name_recovery = profileNameRecovery
    if (clarificationFields.length) result.diagnostic.interpretation_recovery = { ...object(result.diagnostic.interpretation_recovery),
      status: 'partial', clarification_fields: clarificationFields, preserved_valid_fields: true }
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
  raw = resolveFinancingEntryReference(raw, actionMessage, normalizedPendingQuestion(input.pregunta_pendiente))
  const pending = normalizedPendingQuestion(input.pregunta_pendiente)
  const visitContext = { sourceMessageId: text(input.source_message_id), sourceAt: text(input.source_at),
    history: input.historial || input.historial_reciente, currentMessages: input.current_messages, pendingQuestion: pending, answer: object(raw.turn_semantics).answer_to_previous,
    collecting: object(input.coordinacion_visita).status === 'collecting' }
  const extracted = normalizeEvents(raw, actionMessage, pending.id === 'financing_data', pending, visitContext)
  const preferences = (Array.isArray(raw.visit_preferences) ? raw.visit_preferences : []).flatMap(preference => {
    const normalized = normalizedVisitPreference(preference, actionMessage, visitContext)
    return normalized ? [normalized] : []
  })
  extracted.visit_preferences = preferences
  if (!extracted.visit_preference && preferences.length) extracted.visit_preference = preferences[preferences.length - 1]
  const authority = normalizedActionAuthority(raw.action_authority, actionMessage)
  const communication = normalizedTurnCommunication(raw.communication, readable)
  const semantics = normalizeTurnSemantics(raw, actionMessage, pending, confirmedMonetaryReferences(input))
  const contact = currentContactDecision(normalizedActionAuthority(raw.action_authority, readable))
  Object.assign(extracted, contact, { requested_advisor: actionAuthorized(authority, 'advisor'), action_authority: authority,
    financing_consent: actionAuthorized(authority, 'financing') ? true
      : actionDeclined(authority, 'financing') ? false : null,
    financing_quote: raw.financing_quote, financing_partner_choice: raw.financing_partner_choice,
    material_request: raw.material_request, communication })
  extracted.routing = normalizedTurnRouting(raw.routing, actionMessage)
  semantics.routing = extracted.routing
  semantics.version = CONVERSATION_CONTRACT_VERSION
  semantics.communication = communication
  semantics.action_authority = authority
  if (!actionAuthorized(authority, 'reservation') && object(semantics.reservation).kind === 'request')
    semantics.reservation = { kind: 'none', unit_numbers: [], confidence: 'low' }
  const visit = object(extracted.visit_intent), visitAnswer = object(semantics.answer_to_previous)
  const answersVisit = text(pending.id).startsWith('visit_') && visitAnswer.question_id === pending.id
    && ['affirmative', 'value'].includes(text(visitAnswer.kind)) && acceptedExtractorConfidence(visitAnswer.confidence)
  if (['request_visit', 'accept_visit_preference'].includes(text(visit.kind))
    && (!actionAuthorized(authority, 'visit') || visit.kind === 'accept_visit_preference' && !answersVisit)) extracted.visit_intent = null
  semantics.visit_preferences = preferences
  semantics.visit_intent = extracted.visit_intent
  const currentVisit = actionAuthorized(authority, 'visit') && !!extracted.visit_intent
  if (!currentVisit && semantics.primary_intent === 'request_visit') semantics.primary_intent = 'other'
  if (!currentVisit) extracted.events = (Array.isArray(extracted.events) ? extracted.events : []).filter(event => event !== 'requested_visit')
  if (method !== 'model' || communication.kind !== 'substantive') extracted.events = []
  const pendingInputs = (Array.isArray(input.consultas_pendientes) ? input.consultas_pendientes : []).map(object)
  const sourceOf = (request: Row) => ['property', 'financing'].includes(text(request.domain))
    ? pendingInputs.find(message => evidenceMatches(text(request.evidence), text(message.content))) : undefined
  const rawRequests = (Array.isArray(raw.requests) ? raw.requests : []).map(object)
  const requests = rawRequests.filter(request => text(request.request).trim()
    && (evidenceMatches(text(request.evidence), readable) || sourceOf(request))).slice(0, 12).map(request => ({
      request: text(request.request).slice(0, 500), domain: requestDomains.includes(text(request.domain).trim().toLowerCase() as typeof requestDomains[number])
        ? text(request.domain).trim().toLowerCase() : 'other',
      topics: normalizedRequestTopics(request.topics) || [], evidence: request.evidence,
      confidence: acceptedExtractorConfidence(request.confidence) ? request.confidence : 'low',
      ...(!evidenceMatches(text(request.evidence), readable) ? { source_message_id: sourceOf(request)?.message_id, source: 'pending' } : {}) }))
  const leadProfile = normalizeLeadProfile(raw, actionMessage, input)
  Object.assign(extracted, { residence_city: leadProfile.residence_city, residence_country: leadProfile.residence_country, lead_profile: leadProfile })
  extracted.conversation_language = conversationLanguage(object(input.resumen)._conversation_language, raw.conversation_language, readable)
  semantics.recommendation_request = recommendationRequest(raw.recommendation_request, readable)
  const catalog = normalizeCatalogRequest(raw.catalog_request, actionMessage)
  semantics.catalog_request = catalog
  semantics.catalog_request_status = catalogRequestStatus(raw.catalog_request, catalog)
  semantics.financing_amounts = financingAmountStatements(raw.financing_amounts, actionMessage)
  extracted.household = semantics.household
  semantics.requests = requests
  if (Object.hasOwn(object(raw.turn_semantics), 'housing_quantities')
    && !(Array.isArray(semantics.housing_quantities) && semantics.housing_quantities.map(object)
      .some(quantity => quantity.dimension === 'bedrooms' && quantity.role === 'requirement')))
    extracted.qualification = { ...object(extracted.qualification), dormitorios_texto: null }
  const property = object(semantics.property)
  return { extracted, semantics, requests, method, promptRevision,
    withActionMessage: message => normalizeInterpretation({ ...input, mensaje_accion: message }, raw, readable, method, promptRevision),
    diagnostic: { contract_version: CONVERSATION_CONTRACT_VERSION, method,
      communication: { kind: communication.kind, confidence: communication.confidence, greeting_present: communication.greeting_present },
      authority_status: authority.status,
      confidence_policy: 'high_or_medium_with_current_evidence',
      primary_intent: semantics.primary_intent, confidence: semantics.confidence, interpretation: semantics.interpretation,
      housing_quantities: semantics.housing_quantities, household: semantics.household, reservation: semantics.reservation,
      property_group: property.group || null, property_category: property.category || null, operation: property.operation || null,
      filters: object(property.filters), catalog_request: catalog, reference_kind: property.reference_kind || null,
      selector: property.selector || null, unit_numbers: property.unit_numbers || [], query_scope: property.query_scope || null,
      request_count: requests.length, discarded_request_count: rawRequests.length - requests.length,
      normalization_issues: semantics.normalization_issues || [],
      profile_fields: Object.entries(object(leadProfile.field_status)).map(([field, status]) => ({ field, ...object(status) })) }
  }
}

/** Structured continuity replaces an additional free-form summary inference on every turn. */
export function rememberInterpretedTurn(previous: Row, current: string, extracted: Row, semantics: Row = object(extracted.turn_semantics)): Row {
  const facts = { ...object(previous.datos_confirmados) }
  if (extracted.preferred_category) facts.categoria = extracted.preferred_category
  if (extracted.purchase_purpose) facts.proposito = extracted.purchase_purpose
  if (acceptedExtractorConfidence(object(extracted.household).confidence)) facts.household = extracted.household
  const amounts = semantics.financing_amounts || extracted.financing_amounts
  const statements = Array.isArray(amounts) ? amounts.map(object) : []
  const entryAnswer = object(semantics.answer_to_previous).question_id === 'financing_down_payment'
    || object(previous._pending_question).id === 'financing_down_payment'
  const totalUpdated = statements.some(statement => statement.role === 'total_budget' || statement.replaces_role === 'total_budget')
  // Answering the separate entry question must not overwrite the commercial
  // budget or turn an undefined entry into an undefined purchase budget.
  const separateEntry = entryAnswer && !totalUpdated
  const memorySemantics = separateEntry ? { ...semantics, budget: { status: 'not_discussed' } } : semantics
  const memoryExtracted = separateEntry ? { ...extracted, qualification: { ...object(extracted.qualification), presupuesto_texto: null } } : extracted
  return { ...previous, solicitud_actual: current.slice(0, 1200), datos_confirmados: facts,
    _conversation_language: conversationLanguage(previous._conversation_language, extracted.conversation_language, current),
    _financing_amounts: financingAmounts(object(previous._financing_amounts), amounts, current),
    _interpretation_memory: rememberInterpretationFacts(previous, current, memoryExtracted, memorySemantics),
    _turn_contract: CONVERSATION_CONTRACT_VERSION }
}
