import { DIALOGUE_WRITING_RULES } from './dialogue-writing-rules'
import { informationOnly, INFORMATION_ONLY_WRITER_RULES } from './interaction-mode'
import { CONVERSATION_WRITING_STYLE_RULES } from './conversation-style'
import { VISUAL_MATERIAL_WRITER_RULES } from './visual-materials'
import { withProjectObjectionContext, PROJECT_OBJECTION_WRITER_RULES } from './project-objections'
import { REFERENTIAL_PRICE_NOTICE_RULES, priceNoticeForConversation } from './price-conditions'

import { WRITER_OBJECTIVE_RULES, writerObjectiveContext } from './writer-objectives'
import { responseReviewEnabled, responseReviewObservationOnly, responseReviewControl, writerTransportReply, unreviewedWriterReply, InvalidWriterTransportError } from './response-review-policy'

import { scopeTurnCatalog } from './turn-context-scope'
import { withProjectIntroductionForTurn } from './project-introduction-context'
import { responseContentScope, projectContentForWriter, RESPONSE_CONTENT_SCOPE_RULES, RESPONSE_CONTENT_SCOPE_WRITER_RULE } from './response-content-scope'
import { CONTEXTUAL_NEEDS_WRITER_RULES, needsSupplementaryFeatures } from './needs-guidance'
import { contextualReasoningEvidence } from './contextual-reasoning'
import { semanticCatalogContext, SEMANTIC_OPENING_RULE } from './semantic-catalog-context'
import { taskVerifiedContext, taskModelEvidence, addTaskQueryEvidence, TASK_CONTEXT_RULES } from './task-context'
import { locationDisclosurePolicy, projectLocationForPrompt } from './location-policy'
import { FINANCING_COLLECTION_WRITER_RULES } from './financing-prompt'
import { catalogCostBaseline } from './catalog-cost-baseline'
import { withPromptCostComparison } from './prompt-cost-comparison'
import { turnBudgetAssessment, budgetContinuationInstruction, budgetForCommercialPlan } from './turn-budget'
import { commercialJourneyPlan, COMMERCIAL_JOURNEY_RULES } from './commercial-journey'

import { recordBudgetDecision } from './ai-execution-trace'

import { COMPARISON_EVIDENCE_RULES } from './comparison-evidence'

import { reviewObligations } from './focused-review'
import { requestReferences, coverageReferenceSchema, resolveRequestReference } from './question-references'

import { finalWriterContract, FINAL_WRITER_RULES, CATALOG_WRITER_RULES, commercialContinuationSources, MAX_REPLY_CHARACTERS, replyLinkContract } from './response-plan'
import { LEAD_INTRODUCTION_RULES } from './lead-introduction'
import { confirmedLeadProfile } from './lead-profile'

import { BUSINESS_POLICY_RULES } from '@/lib/inmobiliaria/businessPolicies'
import { promptSections } from './prompt-sections'
import { ACTION_INVITATION_RULE } from './direct-conversation-rule'
import { FINANCING_COLLECTION_RULE } from './financing-continuation'
import { financingCollectionActive } from './financing-guidance'
import { UNIT_ALTERNATIVE_RULES } from './unit-alternatives'

import { continuationMetadata, continuationQuestionProperties, CONTINUATION_QUESTION_RULE } from './continuation-question'
import { PROGRESSIVE_OPTIONS_RULES } from './progressive-options'
import { TURN_INTENT_RULES } from './turn-intent'
import { isCategoryOverview, budgetRecommendationBase } from './catalog-dialogue'
import { budgetRecommendationPresentation } from './budget-presentation'

import { turnEvidence, verifiedClaimSources } from './turn-evidence'
import { compactTurnPromptContext, optimizedCatalogPrompt, TURN_CONTEXT_REFERENCE_RULES, CATALOG_SUMMARY_RULES } from './turn-prompt-context'
import { BUSINESS_SCOPE_WRITING_RULES } from './scope-response'

import { COMMERCIAL_ACCURACY_RULES, NUMERIC_RELATION_WRITING_RULES } from './commercial-accuracy'
import { readinessRules, type ProjectReadiness } from '@/lib/inmobiliaria/projectReadiness'
import { isVisitCopy, VISIT_COPY_RULES, VISIT_NATURAL_RULES } from './visit-copy'
import 'server-only'
import { aiJson } from './ai'
import { object, text, type Row } from './data'

import { BROCHURE_DESCRIPTION } from './project-material'
import { categoryPriceComparison } from './category-price-comparison'
import { commercialMemory, experienceContext, RESIDENTIAL_CONTINUITY_RULES, turnWritingRules } from './commercial-experience'
import { commercialEngagement, passiveSalesRules } from './commercial-engagement'
import { projectPublicName, PROJECT_NAME_WRITING_RULES } from './conversation-tone'
import { coverageFactKeys } from './coverage-evidence'

import { unitPriceQuote, priceEvidence } from './price-reply'
import { decidedOpening } from './response-openings'

import { businessRiskContext } from './business-risk-review'
import { availableAssistance, ASSISTANCE_RULES } from './business-facts'

import { reviewWriterContent } from './writer-content-review'
export type TurnCompletenessInput={
  current: string
  history?: unknown
  baseReply: string
  /** Only current catalogue/policies and successful operational results, never AI summaries as facts. */
  verified: Row
  /** Observability only; never included in an agent prompt. */
  costBaseline?: Row
  audit?: Row
  preserveOperationalQuestion?: boolean
  /** @deprecated Prose callbacks are intentionally never executed. */
  validateReply?: (reply: string) => string[]
  normalizeReply?: (reply: string) => string
}
export type TurnCompletenessResult={
  reply: string
  changed: boolean
  needsAdvisor: boolean
  unresolved: string[]
  audit: Row
}

type CoverageState='answered'|'unanswered'|'clarification'|'outside_scope'|'missing_fact'
const states: CoverageState[]=['answered', 'unanswered', 'clarification', 'outside_scope', 'missing_fact']
const requestTypes=['specific_fact', 'general_information', 'action', 'clarification', 'courtesy', 'outside_scope']
const COVERAGE_RULES=DIALOGUE_WRITING_RULES
const purposes=['none', 'clarify_request', 'collect_lead_profile', 'choose_property', 'choose_financing_partner', 'collect_financing_required', 'coordinate_visit', 'offer_advisor', 'offer_verified_material', 'permission_to_continue']
const field={ type: 'string' }
const questionRoles=['none', 'necessary_clarification', 'required_collection', 'optional_continuation']
const questionSchema: Row={
  type: 'object', additionalProperties: false,
  properties: {
    text: { type: 'string', description: 'Texto completo de la pregunta realmente escrita; vacio si no hay pregunta. El sistema usa estos metadatos sin analizar reply.' }, ...continuationQuestionProperties, purpose: { type: 'string', enum: purposes },
    role: { type: 'string', enum: questionRoles },
    missing_datum: { type: 'string', description: 'Dato necesario para responder o cumplir una captura obligatoria. Puede estar vacío en una invitación opcional.' },
    next_decision: { type: 'string', description: 'Descripción orientativa del siguiente paso, no autorización de una acción. Puede quedar vacía si no está determinado.' }
  },
  // Strict output requires every declared property, including future shared metadata.
  required: ['text', 'purpose', 'role', 'missing_datum', 'next_decision', ...Object.keys(continuationQuestionProperties)]
}
const coverageSchema: Row={
  type: 'object', additionalProperties: false,
  properties: {
    reply: { type: 'string', description: 'Respuesta destinada al cliente. No incluya la auditoría interna.' },
    requests: {
      type: 'array', items: {
        type: 'object', additionalProperties: false, properties: {
          fragment: { type: 'string', description: 'Fragmento literal de mensaje_actual del cliente. Nunca copie preguntas del bot, de respuesta_base o de reply.' }, intent: field, request_type: { type: 'string', enum: requestTypes },
          status: { type: 'string', enum: states, description: 'Cobertura en reply final propuesto.' }, evidence: field,
          fact_key: { type: ['string', 'null'], enum: [...coverageFactKeys, null], description: 'Dato solicitado. catalog_comparison para comparar opciones; policy para condiciones no descritas por las fichas; null para acciones/cortesía.' },
        }, required: ['fragment', 'intent', 'request_type', 'status', 'evidence', 'fact_key']
      }
    },
    question: questionSchema,
  }, required: ['reply', 'requests', 'question'],
}
const receiptProperties={
  presented_unit_ids: { type: 'array', items: { type: 'string' } },
  project_presented: { type: 'boolean' }, financing_mentioned: { type: 'boolean' }, visit_invited: { type: 'boolean' }, unit_options_offered: { type: 'boolean' }, unit_model_shared: { type: 'boolean' }, mentioned_benefits: { type: 'array', items: { type: 'string' } },
  brochure_shared: { type: 'boolean' }, price_notice_included: { type: 'boolean' }, brand_introduced: { type: 'boolean' },
  offered_action: { type: 'string', enum: ['none', 'information', 'internal_advisor', 'financing_review', 'ambiguous'] },
}
object(coverageSchema.properties).writer_receipts={
  type: 'object', additionalProperties: false, properties: receiptProperties, required: Object.keys(receiptProperties),
  description: 'Describe unicamente lo que efectivamente comunico en reply. No autoriza operaciones. presented_unit_ids son IDs de unidades realmente presentadas, no mencionadas solo como pregunta.'
}
  ; (coverageSchema.required as string[]).push('writer_receipts')
const urls=(value: string): string[] => value.match(/https?:\/\/[^\s<>]+/g)?.map(v => v.replace(/[),.;!?]+$/, ''))||[]
const numbers=(value: string): string[] => value.replace(/https?:\/\/[^\s<>]+/g, '').match(/\b\d+(?:[.,:/-]\d+)*\b/g)||[]

function verifiedText(value: unknown): string {
  if(typeof value==='string'||typeof value==='number') return String(value)
  if(Array.isArray(value)) return value.map(verifiedText).join('\n')
  if(!value||typeof value!=='object') return ''
  return Object.entries(value).filter(([key]) => !/^(?:id|.*_id|.*_at|historial|history|resumen|summary|mensaje_actual|current)$/i.test(key))
    .map(([, entry]) => verifiedText(entry)).join('\n')
}

function approvedIntroductionNumbers(verified: Row): string[] {
  const introduction=object(verified.presentacion_general_proyecto)
  return introduction.available===true&&introduction.content_kind==='approved_business_summary'
    ? numbers(text(introduction.summary)):[]
}

function queryConstraintNumbers(audit: Row={}): string[] {
  return audit.verified_catalog===true? Object.values(object(object(audit.catalog_query).filters))
    .flatMap(value => Array.isArray(value)? value:[value]).filter(value => typeof value==='number'&&Number.isFinite(value)).map(String):[]
}

/** Compatibility exports: only transport can be checked by code. */
export function turnCompletenessIssues(_input: TurnCompletenessInput, reply: string): string[] {
  return !reply.trim()? ['empty_reply']:reply.length>MAX_REPLY_CHARACTERS? ['transport_length']:[]
}
export const mandatoryReplyIssues=turnCompletenessIssues
export function turnEditorialObservations(...unused: unknown[]): string[] { void unused; return [] }
export function protectedSentences(value: string): string[] { return [value] }
export function safeRentalCreditBase(base: string, ...unused: unknown[]) { void unused; return { reply: base, removed: false, unresolved: [] as string[] } }

function writerMetadata(candidate: Row, evidence: Row[]) {
  const raw=object(candidate.question), semantic=continuationMetadata(raw)
  const question=typeof raw.text==='string'&&semantic.continuation_id&&semantic.continuation_id!=='none'
    ? { ...raw, ...semantic }:{}
  const receipt=object(candidate.writer_receipts), allowed=new Set(evidence.map(row => text(row.id)))
  const presented=Array.isArray(receipt.presented_unit_ids)? receipt.presented_unit_ids.filter((id): id is string => typeof id==='string'&&allowed.has(id)):[]
  return { question, receipts: { ...receipt, presented_unit_ids: presented } }
}

/** The writer owns its prose. Only the AI reviewer may judge its meaning. */
export async function completeTurnReply(input: TurnCompletenessInput, generate: typeof aiJson=aiJson): Promise<TurnCompletenessResult> {
  input={
    ...input, verified: withProjectObjectionContext({
      ...input.verified,
      politica_comercial: priceNoticeForConversation(input.verified, input.history),
      category_price_comparison: categoryPriceComparison(input.verified, input.current)
    }, input.current)
  }
  const observationOnly=responseReviewObservationOnly()
  const normalRuleSets=new Map<string, { actual: string; normal: string }>()
  // Diagnostic failure must never interrupt delivery or change model inputs.
  let normalContext: ReturnType<typeof catalogCostBaseline>|null=null
  if(input.costBaseline) {
    try { normalContext=catalogCostBaseline(input.costBaseline, input.audit||{}, input.current, input.history) } catch { /* estimate unavailable */ }
  }
  if(normalContext) {
    const actualGenerate=generate
    generate=(...args) => {
      let baseline: Row|null=null
      try { baseline=normalContext!(args[6]||'data', object(args[1])) } catch { /* estimate unavailable */ }
      return baseline? withPromptCostComparison(baseline, () => actualGenerate(...args),
        normalRuleSets.get(args[6]||'data')):actualGenerate(...args)
    }
  }
  const turnIntent=object(input.audit?.resolved_turn_intent||input.verified.contrato_turno)
  const profile=confirmedLeadProfile(input.verified.perfil_lead||object(input.audit?.profile_introduction).profile_state)
  input={
    ...input, audit: { ...input.audit, resolved_turn_intent: turnIntent }, verified: {
      ...input.verified,
      perfil_lead: profile, lead: {
        ...object(input.verified.lead), name: profile.full_name||null,
        name_confirmed: profile.name_status==='confirmed', name_source: object(profile.sources).full_name||null
      }, contrato_turno: turnIntent
    }
  }
  input={ ...input, verified: withProjectIntroductionForTurn(input.verified) }
  // The same selected source backs the draft, writer contract and reviewer.
  // A summary loaded for final completion cannot remain in conflict with the
  // earlier basic opening audit.
  const initialPresentation=object(input.verified.presentacion_general_proyecto)
  const openingProfile=object(input.audit?.profile_introduction)
  if((openingProfile.generic_introduction===true||object(openingProfile.presentation).required===true)
    &&initialPresentation.available===true) {
    input={
      ...input, audit: {
        ...input.audit, profile_introduction: {
          ...openingProfile,
          presentation: {
            required: true, approved_summary: text(initialPresentation.summary)||null,
            source: text(initialPresentation.source)||null, content_kind: 'approved_business_summary'
          }
        }
      }
    }
  }
  const engagement=commercialEngagement(input.current, input.history, input.verified._sales_memory, {
    semantics: input.verified.semantica_turno, intent: turnIntent,
    scope: turnIntent.scope, pendingQuestion: turnIntent.pending_question,
  })
  const publicName=projectPublicName(input.verified.proyecto, input.verified.politicas)
  input={
    ...input, verified: {
      ...input.verified, commercial_engagement: engagement,
      ...(publicName? { proyecto: { ...object(input.verified.proyecto), name: publicName, public_name: publicName } }:{})
    }
  }
  const locationPolicy=locationDisclosurePolicy({ current: input.current, verified: input.verified, audit: input.audit })
  input={
    ...input, verified: projectLocationForPrompt({
      ...input.verified,
      ...(input.audit?.visit_dialogue_plan? { visit_dialogue_plan: input.audit.visit_dialogue_plan }:{})
    }, locationPolicy),
    audit: { ...input.audit, location_disclosure: locationPolicy }
  }
  input={ ...input, verified: semanticCatalogContext(input.verified, input.audit||{}, input.current) }
  input={ ...input, verified: scopeTurnCatalog(input.verified, input.audit||{}) }
  // Decisions use the canonical snapshot. A task projection may omit the
  // catalogue for a financial explanation; that is never evidence of absence.
  let budgetAssessment=turnBudgetAssessment(input.verified, input.audit||{})
  if(budgetAssessment) input={ ...input, verified: { ...input.verified, presupuesto_del_turno: budgetAssessment } }
  if(input.verified.recorrido_comercial) {
    const journey=commercialJourneyPlan(input.verified, input.audit||{})
    if(budgetAssessment) budgetAssessment=budgetForCommercialPlan(budgetAssessment, journey)
    input={ ...input, verified: { ...input.verified, siguiente_paso_comercial: journey }, audit: { ...input.audit, commercial_journey: journey } }
    if (journey.action === 'current_operation' && object(journey.reservation_context).active === true) {
      // The same persisted operation backs planning, the writer and review.
      // It records an earlier request, never a new action or confirmation.
      const reservation = object(journey.reservation_context)
      input.audit = { ...input.audit, reservation: { ...reservation, existing_request: true,
        request_registered: true, inventory_reserved: false, handoff_verified: false }, pending_question: {} }
      input.preserveOperationalQuestion = false
      delete input.audit.progressive_selection
      delete input.audit.post_tour_continuation
    }
    if(budgetAssessment) input.verified.presupuesto_del_turno=budgetAssessment
    if(journey.question_id||['leave_open', 'information_only', 'answer_current_question', 'answer_project_categories', 'visual_information'].includes(text(journey.action))) {
      input.preserveOperationalQuestion=false
      delete input.audit!.progressive_selection
      delete input.audit!.post_tour_continuation
    }
  }
  const recommendationBase=budgetRecommendationBase(input.verified, input.audit||{})
  if(recommendationBase) input={
    ...input, baseReply: recommendationBase,
    audit: { ...input.audit, budget_recommendation_presentation: budgetRecommendationPresentation(input.verified) }
  }
  const contentScope=responseContentScope(input.current, input.verified, input.audit||{})
  const scopedLocationPolicy={
    ...object(input.verified.location_disclosure),
    general_location_allowed: object(object(contentScope.topics).general_location).allowed===true,
    ...(object(object(contentScope.topics).general_location).allowed===true? {}:{ general_location: {} })
  }
  input={
    ...input, verified: { ...input.verified, alcance_contenido_turno: contentScope, location_disclosure: scopedLocationPolicy },
    audit: { ...input.audit, response_content_scope: contentScope, location_disclosure: scopedLocationPolicy }
  }
  if(budgetAssessment) recordBudgetDecision(budgetAssessment)
  const canonicalVerified=input.verified
  // Compact only after deciding the next step and the scope of its facts.
  if(input.audit?.business_risk_review_enabled===true||object(input.verified.catalog_search).embeddingsEnabled===true)
    input={ ...input, verified: taskVerifiedContext(input.verified, input.audit||{}, input.current) }
  const catalogEvidence=turnEvidence(input.verified, input.audit)
  input={ ...input, verified: { ...input.verified, catalogo: catalogEvidence.units } }
  const originalBase=input.baseReply
  const adaptiveContinuation=commercialContinuationSources.has(text(input.audit?.source))
  if(adaptiveContinuation) input={ ...input, preserveOperationalQuestion: false }
  // Re-read the current turn's catalogue snapshot before protecting a specialist
  // price answer. A remembered category is not an authority for this turn.
  const verifiedQuote=input.audit?.source==='unit_price'&&input.audit?.verified_price_only===true
    ? unitPriceQuote(input.verified, input.current, {}):null
  const groundedPrice=verifiedQuote?.quoted===true&&!!verifiedQuote.units?.length
  const evidence=groundedPrice? priceEvidence(verifiedQuote!, input.verified):null
  if(groundedPrice) input={
    ...input, baseReply: input.audit?.profile_introduction? originalBase:[verifiedQuote!.reply, ...urls(originalBase).filter(url => !verifiedQuote!.reply.includes(url))].join(' '), preserveOperationalQuestion: false,
    verified: { ...input.verified, respuesta_precio_verificada: verifiedQuote!.reply },
    audit: { ...input.audit, price_evidence: evidence, price_grounded: true }
  }
  const sharedEvidence=addTaskQueryEvidence(turnEvidence(canonicalVerified, input.audit, groundedPrice? verifiedQuote!.units:[]), canonicalVerified)
  const modelEvidence=taskModelEvidence(sharedEvidence, input.verified)
  if(input.verified.prompt_context_selection) input={
    ...input, verified: {
      ...input.verified,
      prompt_context_selection: {
        ...object(input.verified.prompt_context_selection), included_unit_count: modelEvidence.units.length,
        available_unit_count: sharedEvidence.units.length, included_group_count: modelEvidence.groups.length
      }
    }
  }
  // The fresh comparison pool has already joined the canonical evidence. Do
  // not send a second, unscoped copy as if it were another authority.
  input={ ...input, verified: { ...input.verified } }
  delete input.verified.catalogo_verificacion
  const surfaceCalculation=['interior', 'combined', 'compare'].includes(text(object(object(input.verified.semantica_turno).catalog_request).surface_basis))
  const reasoningEvidence=contextualReasoningEvidence(input.current, {
    ...input.verified,
    politica_comercial: {
      ...object(input.verified.politica_comercial), precios_autorizados: surfaceCalculation
        &&object(object(contentScope.topics).purchase_prices).allowed===true&&object(input.verified.politica_comercial).precios_autorizados===true
    },
    catalogo: needsSupplementaryFeatures(input.verified)||surfaceCalculation? modelEvidence.units:[]
  })
  input.verified.razonamiento_contextual=reasoningEvidence
  // References must point into the evidence actually supplied to the models,
  // never reintroduce unscoped catalogue entries after task projection.
  const claimSources=verifiedClaimSources(input.verified, input.audit||{}, modelEvidence, input.current)
  const introduction=object(input.audit?.profile_introduction)
  const informationOpeningRequired=introduction.generic_introduction===true
    &&introduction.reason==='first_substantive_project_contact'&&introduction.stage==='request'
  const initialPresentationAudit=object(introduction.presentation).required===true
    &&text(object(introduction.presentation).approved_summary).trim()
    ? { initial_presentation: { source: 'writer', policy: 'approved_summary_facts_with_free_wording' } }:{}
  const opening={
    ...decidedOpening(input.baseReply, input.history),
    policy: informationOpeningRequired? 'first_information_request':'editorial_suggestion', applied: false
  }
  const writerContract=finalWriterContract(input.baseReply, input.audit, input)
  // Successful drafts belong to the writer. Corrections go back to that model;
  // delivery never appends a greeting, question, commercial notice or material.
  const serverContinuationCompletion=null
  const turnObligations=reviewObligations(input.audit||{}, input.verified, writerContract)
  if(input.audit?.source==='virtual_showroom'&&!object(input.audit.unit_model).unit_id
    &&!(Array.isArray(object(input.verified.property_context).selected_ids)&&(object(input.verified.property_context).selected_ids as unknown[]).length))
    turnObligations.push({
      id: 'general_visualization_reference',
      instruction: 'El recorrido compartido es general y el cliente todavía no eligió una unidad. Preséntelo como recorrido de las opciones o departamentos del proyecto, sin afirmar que muestra el departamento elegido ni tratar un singular coloquial del cliente como selección. El material visual no cambia dormitorios, tipo ni pregunta pendiente: retome el siguiente paso comercial autorizado.'
    })
  const writerRequestRefs=requestReferences(input.current,
    (Array.isArray(turnIntent.requests)? turnIntent.requests:[]).map(raw => ({ fragment: text(object(raw).evidence)||text(object(raw).request) })))
  const activeWriterSchema=coverageReferenceSchema(coverageSchema, writerRequestRefs)
  const linkContract=replyLinkContract(input.baseReply, input.audit, input)
  const selected=Array.isArray(object(input.verified.property_context).selected_ids)? object(input.verified.property_context).selected_ids as string[]:[]
  const continuationAudit=() => ({
    objective: 'Atender la necesidad actual sin cambiar decisiones del cliente.',
    current_request: input.current, selected_units: selected, policy: 'writer_metadata'
  })
  if(!input.current.trim()) throw new InvalidWriterTransportError('EMPTY_CUSTOMER_TURN')
  const history=(Array.isArray(input.history)? input.history:[]).map(object).slice(-8)
    .map(row => ({ role: text(row.role), content: text(row.content).slice(0, 1800) }))
  const memory=commercialMemory(input.verified.memoria_comercial, input.history, input.current)
  const writerVerifiedContext=experienceContext({ ...input.verified, historial: input.history }, input.current, memory)
  delete writerVerifiedContext.razonamiento_contextual
  const context={
    response_content_scope: contentScope, razonamiento_contextual: reasoningEvidence, contrato_turno: turnIntent, property_context: object(input.verified.property_context), objetivo_comercial: continuationAudit().objective, evidencia_turno: modelEvidence, evidencia_afirmaciones: claimSources, apertura_decidida: opening, contrato_redaccion: writerContract, mensaje_actual: input.current, historial_reciente: history,
    contexto_verificado: writerVerifiedContext, estado_operativo: input.audit||{}, preserveOperationalQuestion: input.preserveOperationalQuestion===true,
    referencias_solicitud: writerRequestRefs, obligaciones_del_turno: turnObligations,
    capacidades_disponibles: availableAssistance(input.verified),
    material_protegido: {
      brochure_description: BROCHURE_DESCRIPTION,
      cifras_obligatorias: writerContract.cifras_obligatorias, cifras_permitidas: [...new Set([...numbers(verifiedText(input.verified)), ...approvedIntroductionNumbers(input.verified), ...numbers(input.current), ...queryConstraintNumbers(input.audit)])],
      enlaces_obligatorios: linkContract.required_links, enlaces_permitidos: linkContract.allowed_links
    }
  }
  const optimizedPrompt=optimizedCatalogPrompt(context)
  // A known budget or accepted financing while choosing a property does not
  // need the entire collection procedure in both prompts. The shared journey
  // obligation supplies the current offer/selection step and its safeguards.
  const financialTask=financingCollectionActive(input.audit||{})
    ||/^financing/.test(text(input.audit?.source))
    ||object(input.verified.siguiente_paso_comercial).action==='continue_financing'
    ||(Array.isArray(turnIntent.requests)&&turnIntent.requests.some(r => object(r).domain==='financing'))
  const visitRules=COMMERCIAL_ACCURACY_RULES+'\n'+TURN_CONTEXT_REFERENCE_RULES+'\n'+COMPARISON_EVIDENCE_RULES
    +(object(input.audit?.catalog_retrieval).optimized===true? '\n'+CATALOG_SUMMARY_RULES:'')
    +(input.verified.limite_alcance? '\n'+BUSINESS_SCOPE_WRITING_RULES:'')
    +(isVisitCopy(input.audit??{})? VISIT_COPY_RULES+VISIT_NATURAL_RULES:'')+(input.verified.estado_proyecto? '\n'+readinessRules(input.verified.estado_proyecto as ProjectReadiness):'')
  let writingRules=input.audit?.verified_catalog===true
    ? '\nLa evidencia del turno proviene de una consulta ejecutada sobre el catálogo. Puede agrupar opciones equivalentes para explicar diferencias con claridad. Preserve relaciones entre unidades, categorías y medidas; no repita una ficha por unidad si basta explicar grupos y plantas. Mantenga el referente conversacional y el estado operativo. Atienda las solicitudes actuales; no convierta máximos en selección ni mezcle otros dormitorios en los rangos. catalog_comparison y catalog_coverage contienen resultados de la consulta, no obligan a enumerar dimensiones que el cliente no necesita. Use cifras verificadas y agregaciones calculadas en evidencia_turno.groups.'
    :turnWritingRules(input.current, memory)
  if(input.audit?.semantic_review_enabled===true&&!context.contrato_redaccion.decisiones_protegidas) writingRules+='\nLas cifras de opciones secundarias no son obligatorias si no responden a la consulta actual. Redacte frases naturales y priorice la respuesta solicitada. No infiera mayor precio por superficie ni exclusividad. Preserve enlaces requeridos, acciones confirmadas y datos necesarios; no invente el resultado de una consulta ausente.'
  if(isCategoryOverview(input.audit||{})) writingRules+='\nPuede orientar con categorías y diferencias verificadas sin enumerar fichas ni superficies por obligación. Elija una continuación útil a la consulta actual, sin reabrir preferencias resueltas.'
  if(groundedPrice) writingRules+='\nEl precio se volvió a consultar para la categoría/unidades del mensaje actual. price_evidence contiene las relaciones verificadas unidad-precio. Use la cotización verificada del turno, no los precios antiguos del historial. Conserve moneda y condiciones comerciales vigentes. '+REFERENTIAL_PRICE_NOTICE_RULES
    +(input.verified.siguiente_paso_comercial? ' Conserve el siguiente paso vigente indicado en siguiente_paso_comercial; una cotización no lo sustituye por una invitación a detalles.'
      :input.audit?.progressive_selection? ' Mantenga el propósito de la pregunta indicado en progressive_selection cuando no haya un recorrido vigente que lo sustituya; puede reformularla.'
        :' Las invitaciones adicionales son opcionales; la pregunta del siguiente paso vigente sigue siendo obligatoria si continuacion_del_turno.required=true. No afirme que una cita ya está agendada.')
  if(input.audit?.profile_introduction) writingRules+='\n'+LEAD_INTRODUCTION_RULES
  if(input.verified.material_visual) writingRules+='\n'+VISUAL_MATERIAL_WRITER_RULES
  if(input.verified.prompt_context_selection) writingRules+='\n'+(object(input.verified.prompt_context_selection).version==='task-context-v1'? TASK_CONTEXT_RULES:SEMANTIC_OPENING_RULE)
  if(budgetAssessment) writingRules+='\nPRESUPUESTO: contexto_verificado.presupuesto_del_turno contiene la evaluación común por unidades y categorías. claim_contract limita cada afirmación al conjunto que describe; solo permite afirmar universalidad comprobada por código. '+(budgetAssessment.mention_required===true
    ? 'Responda la relación necesaria con el presupuesto junto con las características solicitadas; si faltan precios, explique el límite de esa comparación. '
    :'Use esa evaluación para orientar internamente; no repita dinero ni una comparación que el mensaje actual no requiere. ')
    +'El presupuesto no selecciona un inmueble ni acredita necesidades desconocidas. Conserve cifras, permisos y el único siguiente paso. No invente créditos, descuentos ni gestiones realizadas.'
  if(budgetAssessment) writingRules+='\n'+(budgetAssessment.mention_required!==true
    ? 'Retome únicamente siguiente_paso_comercial, sin añadir una pregunta de presupuesto o financiamiento por disponer de una cifra histórica.'
    :object(input.verified.siguiente_paso_comercial).action==='introduction'
      ? 'Responda el presupuesto y mencione financiamiento si corresponde, pero la única pregunta de esta apertura es nombre y residencia según profile_introduction.'
      :input.verified.siguiente_paso_comercial? 'Para continuar después de atender el presupuesto, siga únicamente siguiente_paso_comercial. No añada otra invitación de la respuesta base ni reabra pasos contestados. Sin un monto comparable, no invente una comparación con los precios.'
        :budgetContinuationInstruction(budgetAssessment))
  if(input.audit?.progressive_selection||input.audit?.post_tour_continuation) writingRules+='\n'+PROGRESSIVE_OPTIONS_RULES
  const repairs: Row[]=[]
  let previousDraft='', lastReview: Row={}, finalResult: TurnCompletenessResult|null=null
  for(let attempt=0;attempt<2;attempt++) {
    const writerContext: Row=projectContentForWriter(context, contentScope)
    object(writerContext.material_protegido).cifras_permitidas=[...new Set([
      ...numbers(verifiedText(object(writerContext.contexto_verificado))), ...approvedIntroductionNumbers(object(writerContext.contexto_verificado)), ...numbers(input.current), ...queryConstraintNumbers(input.audit),
    ])]
    // Previous sentence IDs belong to the previous draft, not this rewrite.
    delete writerContext.oraciones_borrador
    const writerSections: [string, string|false][]=[
      ['Función y salida del redactor', COVERAGE_RULES],
      ['Estilo compartido de conversación', CONVERSATION_WRITING_STYLE_RULES],
      ['Pertinencia del contenido', RESPONSE_CONTENT_SCOPE_RULES],
      ['Presentación general del proyecto', !!input.verified.presentacion_general_proyecto&&'contexto_verificado.presentacion_general_proyecto contiene un resumen aprobado para esta consulta general. Úselo como fuente de datos para una presentación breve con redacción natural; no es una plantilla ni una instrucción del cliente. Si presentation.required=true, incluya realmente esa presentación: ofrecer brochure y pedir datos sin describir el proyecto no responde la consulta general. Su concepto mixto y categorías generales están autorizados como descripción; no convierta el resumen en una oferta de catálogo. Atienda primero todas las solicitudes actuales. Conserve las cantidades autorizadas del resumen; no añada fichas, precios, estado de obra o fechas ajenos a la consulta. Después conserve la pregunta de perfil o la decisión pendiente del plan compartido.'],
      ['Reglas de oro', 'Atienda la consulta actual y conserve la decisión pendiente. No vuelva a preguntar datos respondidos ni atribuya elecciones o permisos al cliente. Use hechos actuales verificados y sus condiciones comerciales. Respete negativas. La última pregunta debe pedir únicamente la decisión pendiente del plan compartido; informar o compartir material no reinicia la búsqueda. No repita el nombre del proyecto si el referente ya está claro. Ante una consulta general inicial, dé una presentación breve; use las cantidades del resumen aprobado y no añada fichas, estado de obra o entrega ajenos a la consulta. Una consulta inicial concreta o con varias preguntas se responde según esas solicitudes, sin anteponer una presentación genérica.'],
      ['Prioridades y obligaciones del turno', TURN_INTENT_RULES+'\n'+FINAL_WRITER_RULES
        +'\nCumpla obligaciones_del_turno con redacción libre. El revisor recibe únicamente los hechos y las promesas que deba contrastar, no decide estas obligaciones ni la siguiente pregunta. Las preferencias de tono no eliminan capturas, respuestas o condiciones obligatorias. Las fuentes comerciales actuales respaldan los hechos; el historial solo aporta continuidad.'],
      ['Fuentes, políticas y precisión', BUSINESS_POLICY_RULES+visitRules],
      ['Ayudas disponibles y preguntas', ASSISTANCE_RULES],
      ['Siguiente paso comercial', !!input.verified.siguiente_paso_comercial&&COMMERCIAL_JOURNEY_RULES],
      ['Consultas pendientes', 'contexto_verificado.consultas_pendientes contiene mensajes del cliente aún sin respuesta. Atienda sus consultas informativas junto con mensaje_actual, salvo que el cliente las haya cancelado o sustituido. No repita gestiones ni reutilice consentimientos del pasado.'],
      ['Comparaciones, mínimos y máximos', NUMERIC_RELATION_WRITING_RULES],
      ['Reglas aplicables a esta respuesta', writingRules+'\n'+(informationOnly(input.verified)? INFORMATION_ONLY_WRITER_RULES:'')+'\n'+passiveSalesRules(engagement)+'\n'+PROJECT_NAME_WRITING_RULES+ACTION_INVITATION_RULE],
      ['Continuidad residencial', RESIDENTIAL_CONTINUITY_RULES],
      ['Alternativas de inmuebles', !!(input.audit?.alternative_results||input.audit?.alternative_presentation
        ||/alternative/.test(text(input.audit?.source)))&&UNIT_ALTERNATIVE_RULES],
      ['Recopilación financiera', financingCollectionActive(input.audit||{})&&FINANCING_COLLECTION_RULE],
      ['Resultados vacíos de catálogo', 'Si una búsqueda completa no tiene resultados, explique esa ausencia dentro de sus filtros. No invente una unidad para justificarla ni sustituya la respuesta por totales generales del proyecto que el cliente no pidió. Los grupos complete_query representan esa búsqueda; catalog_inventory describe el inventario actual publicado y disponible, y requirement_alternatives una propuesta distinta. No mezcle sus cantidades ni sus características. Si bedrooms_required=true, respete ese requisito: no insista en unidades con menos dormitorios que el cliente acaba de descartar. No afirme máximos ni alternativas que no estén respaldados por evidencia_turno.groups o alternative_results. Explique una alternativa pertinente como cambio de requisitos, conservando la pregunta de aceptación cuando corresponda; no la trate como elegida ni avance a presupuesto, planta o financiamiento antes de la aceptación. No ofrezca propiedades fuera del catálogo autorizado.'],
    ]
    const instructions=optimizedPrompt&&input.audit?.financing_collection
      &&object(input.verified.prompt_context_selection).task==='financing'
      ? promptSections([['Redacción de recopilación financiera', FINANCING_COLLECTION_WRITER_RULES+'\n'+CONVERSATION_WRITING_STYLE_RULES+'\n'+CONTINUATION_QUESTION_RULE+'\n'+CONTEXTUAL_NEEDS_WRITER_RULES+'\n'+RESPONSE_CONTENT_SCOPE_WRITER_RULE]])
      :promptSections(optimizedPrompt? writerSections.map(([title, rules]): [string, string|false] => {
        if(title==='Prioridades y obligaciones del turno') return [title, (financialTask? FINAL_WRITER_RULES:CATALOG_WRITER_RULES+'\n'+CONTINUATION_QUESTION_RULE)
          +'\ncontrato_turno y obligaciones_del_turno determinan la necesidad actual. El historial solo resuelve continuidad; no cambia la búsqueda ni autoriza acciones. Cumpla los datos pendientes y enlaces requeridos.']
        if(title==='Continuidad residencial'&&object(input.audit?.catalog_query).group!=='residential') return [title, false]
        if(title==='Consultas pendientes'&&(!Array.isArray(input.verified.consultas_pendientes)||!input.verified.consultas_pendientes.length)) return [title, false]
        if(title==='Resultados vacíos de catálogo'&&sharedEvidence.units.length) return [title, false]
        return [title, rules]
      }):writerSections)
    normalRuleSets.set('writing', { actual: instructions, normal: promptSections(writerSections) })

    const candidate=await generate(instructions+'\n'+WRITER_OBJECTIVE_RULES
      +(input.verified.objeciones_proyecto? '\n'+PROJECT_OBJECTION_WRITER_RULES:''),
      compactTurnPromptContext(writerObjectiveContext({
        ...writerContext, ...(attempt? {
          reparacion: {
            instruccion: 'Corrija las afirmaciones señaladas por la IA revisora con las fuentes autorizadas. Redacte la respuesta completa conservando la consulta, decisiones y acompañamiento pertinente. Ninguna comprobación de palabras o cifras del servidor decide la redacción. No invente una gestión realizada.',
            borrador: previousDraft, hallazgos_revisor: lastReview.findings,
          }
        }:{})
      })), activeWriterSchema, undefined, undefined, undefined, 'writing')
    const reply=writerTransportReply(candidate.reply)
    const metadata=writerMetadata(candidate, sharedEvidence.units)
    // Resolve the writer-selected request ID against this turn's canonical
    // customer fragments. This is an identity mapping, not a reading of reply.
    const requests=(Array.isArray(candidate.requests)? candidate.requests:[]).map(raw => {
      const row=object(raw)
      return { ...row, request_id: row.fragment, fragment: resolveRequestReference(row.fragment, writerRequestRefs) }
    })
    const baseAudit: Row={
      review_control: responseReviewControl(), prose_authority: 'writer_and_ai_reviewer',
      server_semantic_validation: false, question: metadata.question, writer_receipts: metadata.receipts,
      requests, commercial_journey: input.verified.siguiente_paso_comercial, response_content_scope: contentScope,
      writer_contract: writerContract, ...initialPresentationAudit, resolved_turn_intent: turnIntent,
      business_policy_sources: input.verified.politicas_negocio||[], price_evidence: evidence,
      opening_decision: opening, server_continuation_completion: serverContinuationCompletion,
      follow_up: { usable: true, source: 'writer_metadata' }, editorial_observations: [], text_transformations: [],
      final_validation: { passed: true, policy: 'transport_only', issues: [], validated_text: reply },
      transport_validation: { passed: true, policy: 'nonempty_and_length' }, repair_attempts: [...repairs],
      operational_action_verified: object(input.audit?.reservation).handoff_verified===true||object(input.audit?.handoff_result).verified===true,
    }
    if(!responseReviewEnabled()) {
      const unreviewed=unreviewedWriterReply(reply)
      return { reply, changed: reply!==originalBase.trim(), needsAdvisor: false, unresolved: [], audit: { ...unreviewed.audit, ...baseAudit } }
    }
    let review: Awaited<ReturnType<typeof reviewWriterContent>>
    try {
      review=await reviewWriterContent(reply, businessRiskContext({
        current: input.current, reply,
        obligations: turnObligations, units: modelEvidence.units, groups: modelEvidence.groups,
        projectFacts: sharedEvidence.project_facts, claimSources, verified: input.verified, audit: input.audit||{},
        allowedLinks: linkContract.allowed_links
      }), generate)
    } catch(error) {
      if(!observationOnly) throw error
      review={
        approved: false, findings: [], audit: {
          status: 'unavailable', authority: 'ai_reviewer',
          error_code: error instanceof Error? error.message:'REVIEW_UNAVAILABLE'
        }
      }
    }
    const semanticReview={ ...review.audit, acceptance: { content_approved: review.approved, follow_up_usable: true } }
    if(observationOnly||review.approved) return {
      reply, changed: reply!==originalBase.trim(), needsAdvisor: false, unresolved: [], audit: {
        ...baseAudit, status: observationOnly? 'review_observed':'checked', independent_review: true,
        semantic_review: semanticReview, review_enforcement: { blocking: !observationOnly, mode: observationOnly? 'observation_only':'ai_reviewer' },
        ...(observationOnly? { observation: { status: review.audit.status, enforcement: false } }:{}),
        recovery: { pending: false },
      }
    }
    lastReview={ ...review.audit, findings: review.findings }
    previousDraft=reply
    repairs.push({ target: 'commercial_draft', status: review.audit.status, authority: 'ai_reviewer', issues: review.findings, rejected_review: lastReview })
    finalResult={
      reply, changed: reply!==originalBase.trim(), needsAdvisor: false, unresolved: [], audit: {
        ...baseAudit, status: 'rejected_review', independent_review: true, semantic_review: semanticReview,
        repair_attempts: [...repairs], recovery: { pending: true, base_used: false, reason: 'ai_review_not_approved' },
        fallback_validation: { passed: false, policy: 'ai_reviewer', issues: ['response_requires_validation'] },
      }
    }
  }
  return finalResult!
}
