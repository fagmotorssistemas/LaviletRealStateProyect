import { currentTopicReply } from './current-topic'
import { withHandoffNotice } from './handoff-copy'
import { requiresContentReview, unverifiedReply } from './delivery-integrity'
import { withConversationTone, conversationToneAudit } from './tone-settings'
import { readinessInvitation, readinessPlaceClarification, type ProjectReadiness } from '@/lib/inmobiliaria/projectReadiness'
import 'server-only'
import { activePrompt, aiJson, mediaText } from './ai'
import { OpenAIRequestError } from './openai-request'
import { unansweredInbound } from './pending-inbound'
import { confirmedInterpretationMemory } from './interpretation-memory'
import { assertLive, automationSettings } from './config'
import { normalizedVisitPreference, validateIntent, VISIT_PREFERENCE_EXTRACTION_RULES } from './conversation-rules'
import { autoConfig, db, object, one, permitted, rpc, scope, text, type Row } from './data'
import { botStopped, getKommoContact, getKommoLead, launchSalesbot, setKommoField } from './kommo'
import { inboundFromRow, type Inbound } from './webhook'
import { preserveCtwaForContact } from './ctwa-lead-store'
import { applyWhatsappAdsConsentFromClientMessage, evaluateWaLeadSubmittedForCurrentTurn } from '@/lib/meta/waLeadSubmittedTurn'
import { resolveRecentUnitOfferText } from '@/lib/meta/waLeadSubmittedOfferContext'
import { isUnitOfferContext } from '@/lib/meta/waLeadSubmittedEligibility'
import type { Guard } from './visits'
import { isGreetingOnly, qualifiedFacts, sdrState } from './sdr-rules'
import { commercialContext, commercialReply, publishedUnitCatalog } from './sdr'
import { appendUnitModel, unitModelDelivery } from './unit-model'
import { showroomRequest, asksConstructionStatus } from './virtual-showroom'
import { visitRoutePermission } from './route-consistency'
import { isProfileOnlyTurn, leadIntroductionTurn, leadProfilePendingQuestion, rememberLeadIntroduction } from './lead-introduction'
import { confirmedLeadName, confirmedLeadProfile, mergeLeadProfile } from './lead-profile'
import { progressivePendingQuestion } from './progressive-options'
import { tourContinuation } from './tour-continuation'
import { resolveTurnIntent } from './turn-intent'
import { isOnlyUnitVisualRequest, isUnitVisualRequest } from './unit-visual-request'
import { greetingForTurn, isCourtesyOnly, minimalGreeting, naturalConversationReply } from './conversation-style'

import { financingContext, financingInputs, financingReply, financingQuestionReply, isFinancingTurn, avoidFinancingRepeat, priceFinancingReply } from './financing'
import { intakeReply, isVisitDetail, needsVisitHelp, visitTurnIntent, visitBusinessHoursReply, visitHoursWereOffered } from './visit-intake'
import { asksVisitStatus, asksTeamAttendance, teamAttendanceReply, declinedFollowup, explicitlyRequestsVisit, hasUnrelatedAppointmentTarget, isConversationRepair, TURN_RULES, visitStatusReply } from './turn-routing'
import { commercialMemory, isProjectInformationRequest, rememberCommercialReply, projectInformationChoiceReply, projectInformationReply, projectOverviewReply } from './commercial-experience'
import { resolveCatalogReference } from './catalog-reference'
import { propertyContext, resolvePropertyTurn, rememberPropertyReply } from './property-context'
import { preferredPropertyCategory } from './property-selection'
import { fabricatedActionRequest, mediaClarificationReply } from './clarification'
import { acceptsUnitOptions, acceptsVisitInvitation, ambiguousVisitAcceptance, rememberSalesReply } from './sales-policy'
import { mediaFailureReply, unreadMediaMarker } from './media-format'
import { variedReplyOpening, applyDecidedOpening } from './response-openings'
import { acceptedPriceOption, asksUnitPrice, unitPriceQuote } from './price-reply'
import { scheduleNutrition24h } from './nutrition'
import { scheduleNutritionWeekOne } from './nutrition-week-one'
import { scheduleNutritionLater } from './nutrition-later'
import { nutritionContinuation } from './nutrition-week-one-rules'
import { brochureReply, BROCHURE_URL, launchVisitReply, vehicleScopeReply, wantsBrochure } from './project-material'
import { salesSubject } from './sales-subject'
import { classifyBusinessScope, reconcileConversationScope, type BusinessScopeDecision } from './business-scope'
import { inboundFreshness } from './inbound-freshness'
import { financingFieldAnswer } from './financing-continuation'
import { locationAnswer, locationRequestKind, withVisitLocation } from './visit-location'
import { completeTurnAnswer, turnAnswerFacts } from './turn-answer'
import { selectedVisitOption } from './visit-choice'
import { visitParserReady } from './visit-parser-health'
import { visitOptionsList } from '@/lib/inmobiliaria/visitProposalOptions'
import { asksForHouse, houseProductReply } from './product-fit'
import { declinesAllVisitAlternatives } from './visit-escalation'
import { completeTurnReply } from './turn-completeness'
import { scopeFallbackReply, scopeWritingContract, scopePolicyContext } from './scope-response'
import { catalogQuery, filterCatalog, validateCatalogReply } from './catalog-dialogue'
import { advisorOwnsConversation } from './human-attention'
import { traceForEvents, traceText, type AutomationExecutionTrace } from './execution-trace'
import { financingPrerequisiteReply } from './property-selection'
import { answersPendingQuestion, normalizedPendingQuestion, pendingQuestionFromReply } from './turn-semantics'
import { followUpUsable, pendingFollowUpNeedsInterpretation } from './review-disposition'
import { MAX_REPLY_CHARACTERS, responsePlan } from './response-plan'
import { evaluateInterestDecision, reservationRequest, verifiedReservationReceipt } from './reservation-action'
import { commercialTurnTopics } from './multi-topic-turn'
import { CONVERSATION_CONTRACT_VERSION, interpretConversationTurn, rememberInterpretedTurn } from './turn-interpretation'
import { decisionRecord, catalogSnapshot, type DecisionRecord } from './decision-record'
import { withAIExecutionTrace } from './ai-execution-trace'
import { PreReplySendError } from './delivery-phase'
import { requireReviewedResponse } from './response-review-recovery'
import { assessMissingFacts, catalogCoversFragment } from './coverage-evidence'

export const visitIntentPrompt = `Clasifique la respuesta a una propuesta de visita usando el historial cronológico.
Devuelva JSON {"intent":"accept|counterproposal|reject|cancel|question|unclear|opt_out","visit_preference":null}.
accept: aceptación inequívoca y sin condiciones de la propuesta enviada y vigente, status=awaiting_client.
Un sí/ok solo acepta si responde directamente a esa propuesta o a una aclaración explícita de confirmación.
Si hay otra pregunta posterior, dudas, condiciones, cambio de horario o una pregunta adicional, no acepte.
counterproposal: pide otro día/hora. reject: rechaza ese horario. cancel: pide cancelar la visita completa.
question: pregunta sobre visita u otro tema. unclear: ambiguo, varias citas o falta evidencia.
opt_out: pide no recibir mensajes. Con propuesta null no asigne accept/cancel/reject/counterproposal.
Un saludo, una consulta comercial o cambiar de tema son question, aunque exista una cita pendiente. unclear se limita a respuestas ambiguas SOBRE la cita. Con status=awaiting_advisor, dar el horario solicitado es counterproposal, no accept. No confunda una solicitud de llamada con una visita.
Evalúe el turno completo, no solo su última frase. Si primero dice cancelar y después aclara que prefiere otro día, es counterproposal. «No puedo a esa hora, mejor a las 3» es counterproposal y conserva el día de la propuesta. «No puedo asistir» sin alternativa es cancel; «no puedo a esa hora» es reject. Un agradecimiento sin consulta ni decisión pendiente es question. Use los mensajes previos del cliente para entender respuestas parciales como «a las 4» después de «hoy».
No invente intervalos ni acciones ejecutadas.
${VISIT_PREFERENCE_EXTRACTION_RULES}`

async function register(events: Inbound[], guard: Guard) {
  const latest = events[events.length - 1]
  const kommo = await getKommoLead(latest.kommoId)
  const contacts = object(kommo._embedded).contacts
  if (!Array.isArray(contacts) || !contacts.map(object).some(c => c.id === latest.contactId)) throw new Error('CONTACT_NOT_LINKED_TO_LEAD')
  const contact = await getKommoContact(latest.contactId)
  const fields = (Array.isArray(contact.custom_fields_values) ? contact.custom_fields_values : []).map(object)
  const phoneField = fields.find(f => f.field_code === 'PHONE')
  const phone = text(object(Array.isArray(phoneField?.values) ? phoneField.values[0] : null).value)
  if (!phone.replace(/\D/g, '')) throw new Error('CONTACT_PHONE_MISSING')
  let registration: Row = {}, hasNew = false, mediaFailed = false
  const mediaErrors: string[] = []
  const normalized: Inbound[] = []
  for (const event of events) {
    await guard()
    let content = event.text
    if (event.media) {
      try { content = await mediaText(event) } catch (error) {
        if (error instanceof OpenAIRequestError) throw error
        mediaFailed = true
        mediaErrors.push(error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'MEDIA_PROCESSING_FAILED')
        content = [event.text, unreadMediaMarker(event.media)].filter(Boolean).join('\n')
      }
    }
    const result = object(await rpc('register_inbound_message', {
      p_tenant_id: scope.tenant_id, p_project_id: scope.project_id, p_phone: phone,
      p_name: text(contact.name) || event.name || 'Sin nombre', p_source: event.origin, p_channel: 'whatsapp',
      // No inventar campaña ads/orgánico. p_campaign sigue null; ctwa_clid va a lv_whatsapp_ctwa_attribution.
      p_campaign: null, p_contact_id: String(event.contactId), p_kommo_id: event.kommoId,
      p_external_message_id: event.externalId, p_content: content, p_tracking_consent: false,
    }))
    if (!text(result.lead_id) || !text(result.conversation_id)) throw new Error('INBOUND_RPC_CONTRACT_MISMATCH')
    registration = result
    // First-touch ctwa_clid si Kommo lo trajo; mensajes sin clid no borran captura previa.
    await preserveCtwaForContact({
      leadId: text(result.lead_id),
      occurredAt: event.sentAt,
      adReferral: event.adReferral,
      contactId: event.contactId,
      kommoId: event.kommoId,
      externalMessageId: event.externalId,
      ctwa: event.ctwa,
    })
    if (result.is_duplicate === true) continue
    hasNew = true
    const conversation = await one('conversations', text(result.conversation_id))
    if (conversation.lead_id !== result.lead_id) throw new Error('CONVERSATION_SCOPE_MISMATCH')
    // Guardar la hora de origen evita abrir una ventana de WhatsApp al reprocesar un webhook antiguo.
    const { error } = await db().from('messages').update({ sent_at: event.sentAt, media_type: event.media?.type ?? null,
      media_url: event.media?.url ?? null }).eq('conversation_id', result.conversation_id).eq('external_message_id', event.externalId).eq('role', 'cliente')
    if (error) throw new Error('INBOUND_TIMESTAMP_FAILED')
    normalized.push({ ...event, text: content })
  }
  return { registration, hasNew, mediaFailed, mediaErrors, normalized, stopped: botStopped(kommo) }
}

export async function processConversation(rows: Row[], guard: Guard, inferenceDeadlineAt?: number) {
  const trace = traceForEvents(rows)
  const delivery = { replyWriteAttempted: false }
  let superseded = false
  const inferenceGuard = async () => {
    await guard()
    const latest = rows.map(row => inboundFromRow(row.payload)).sort((a, b) => a.sentAt.localeCompare(b.sentAt)).at(-1)
    if (!latest) return
    const { count, error } = await db().from('lv_integration_events').select('id', { count: 'exact', head: true })
      .match(scope).eq('contact_key', `${latest.kommoId}:${latest.contactId}`).eq('status', 'pending')
      .gt('payload->>sentAt', latest.sentAt)
    if (error) throw new Error('NEW_INPUT_CHECK_FAILED')
    if (count) { superseded = true; throw new Error('NEW_INPUT_PENDING') }
  }
  try {
    const result = await withAIExecutionTrace(trace, () => withConversationTone(() => processConversationWithTone(rows, guard, trace, delivery)), inferenceGuard, inferenceDeadlineAt)
    trace.add('execution_exit', 'Resultado de la ejecución', 'output', 'conversation.ts',
      ['accepted', 'confirmed'].includes(text(result.action)) ? 'succeeded' : 'skipped', {},
      { action: result.action, reason: object(result).reason || result.action })
    return result
  } catch (error) {
    trace.failOpenSteps(error)
    if (superseded && !delivery.replyWriteAttempted) return { action: 'superseded_or_paused', reason: 'NEW_INPUT_PENDING' }
    throw delivery.replyWriteAttempted ? error : new PreReplySendError(error)
  } finally {
    await trace.flush()
  }
}
async function processConversationWithTone(rows: Row[], guard: Guard, trace: AutomationExecutionTrace, delivery: { replyWriteAttempted: boolean }) {
  assertLive()
  const events = rows.map(row => inboundFromRow(row.payload)).sort((a, b) => a.sentAt.localeCompare(b.sentAt) || a.externalId.localeCompare(b.externalId))
  const last = events[events.length - 1]
  if (!last || events.some(e => e.kommoId !== last.kommoId || e.contactId !== last.contactId)) throw new Error('MIXED_CONVERSATION_BATCH')
  const inboundStep = trace.start('message_received', 'Mensaje recibido', 'input', 'webhook.ts · conversation.ts', {
    message: traceText(events.map(event => event.text).join('\n')),
    messages_in_batch: events.length,
    has_media: events.some(event => Boolean(event.media)),
  })
  if (Date.now() - Date.parse(last.sentAt) >= 24 * 3_600_000) {
    trace.finish(inboundStep, 'paused', { reason: 'REPLY_WINDOW_EXPIRED' })
    return { action: 'expired' }
  }
  const initialConfig = await autoConfig()
  if (initialConfig.enabled !== true || initialConfig.dry_run !== false) {
    trace.finish(inboundStep, 'paused', { reason: 'AUTOMATION_DISABLED' })
    return { action: 'disabled' }
  }
  const settings = automationSettings()
  // Persistencia (mensaje + CTWA) va antes del gate test_only para no perder
  // trazabilidad. Registrar nunca autoriza una respuesta del bot.
  const inbound = await register(events, guard)
  const registeredLeadId = text(inbound.registration.lead_id)
  trace.setContext({ leadId: registeredLeadId, conversationId: inbound.registration.conversation_id })
  const target = settings.testLeadId || (initialConfig.test_only === true ? text(initialConfig.test_lead_id) : null)
  if (target && registeredLeadId !== target) {
    // test_only is the authoritative server-side lock. Mirror that decision in
    // both stores so every non-test lead displays the bot as stopped. A failed
    // mirror write never opens the bot; a later inbound message retries it.
    let localStopSynced = false
    let kommoStopSynced = false
    let localStopError: string | null = null
    let kommoStopError: string | null = null
    try {
      const localStop = await db().from('leads').update({ bot_enabled: false })
        .match(scope).eq('id', registeredLeadId)
      if (localStop.error) localStopError = 'LOCAL_STOP_SYNC_FAILED'
      else localStopSynced = true
    } catch {
      localStopError = 'LOCAL_STOP_SYNC_FAILED'
    }
    try {
      await guard()
      const remoteLead = await getKommoLead(last.kommoId)
      if (!botStopped(remoteLead)) await setKommoField(last.kommoId, 451530, 'true')
      kommoStopSynced = true
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      kommoStopError = /^[A-Z0-9_]+$/.test(message) ? message : 'KOMMO_STOP_SYNC_FAILED'
    }
    // LeadSubmitted BM: fuera del bot de prueba, sin responder.
    try {
      if (inbound.hasNew && registeredLeadId) {
        const outsideLead = await one('leads', registeredLeadId)
        const msg = (inbound.normalized.map(e => e.text).join('\n') || last.text || '').slice(0, 30_000)
        const recentOfferText = await resolveRecentUnitOfferText({
          admin: db(),
          conversationId: text(inbound.registration.conversation_id),
        })
        await evaluateWaLeadSubmittedForCurrentTurn({
          admin: db(),
          rpc,
          lead: { ...outsideLead, id: registeredLeadId },
          contactId: last.contactId,
          currentMessage: msg,
          sourceMessageSentAt: last.sentAt,
          recentOfferText,
          tenantId: scope.tenant_id,
          projectId: scope.project_id,
        })
      }
    } catch {
      /* soft-fail */
    }
    trace.finish(inboundStep, 'skipped', {
      reason: 'OUTSIDE_TEST_LEAD', bot_paused: true,
      message_persisted: true,
      local_stop_synced: localStopSynced,
      kommo_stop_synced: kommoStopSynced,
      ...(localStopError ? { local_stop_error: localStopError } : {}),
      ...(kommoStopError ? { kommo_stop_error: kommoStopError } : {}),
    })
    return {
      action: 'outside_test_lead', bot_paused: true, message_persisted: true,
      is_duplicate: inbound.hasNew !== true,
      local_stop_synced: localStopSynced,
      kommo_stop_synced: kommoStopSynced,
      ...(localStopError ? { local_stop_error: localStopError } : {}),
      ...(kommoStopError ? { kommo_stop_error: kommoStopError } : {}),
    }
  }
  if (!inbound.hasNew) {
    trace.finish(inboundStep, 'skipped', { reason: 'DUPLICATE' })
    return { action: 'duplicate' }
  }
  const activeLast = inbound.normalized[inbound.normalized.length - 1]
  const receivedAt = text(rows.find(row => object(row.payload).externalId === activeLast.externalId)?.received_at) || activeLast.sentAt
  const freshness = inboundFreshness(activeLast.sentAt, receivedAt)
  if (freshness.delayed) {
    const newer = await db().from('lv_integration_events').select('id', { count: 'exact', head: true }).match(scope)
      .eq('kind', 'inbound').eq('contact_key', `${last.kommoId}:${last.contactId}`).gt('payload->>sentAt', activeLast.sentAt)
      .abortSignal(AbortSignal.timeout(10_000))
    if (newer.error) throw new Error('NEW_INPUT_CHECK_FAILED')
    if (newer.count) {
      trace.finish(inboundStep, 'skipped', { reason: 'SUPERSEDED_DELAYED_INBOUND', webhook_delay_minutes: freshness.lagMinutes,
        message_persisted: true, newer_messages: newer.count })
      return { action: 'cancelled', reason: 'SUPERSEDED_DELAYED_INBOUND', webhook_delay_minutes: freshness.lagMinutes,
        requires_review: true, delivery_status: 'not_sent' }
    }
  }
  let lead = await one('leads', text(inbound.registration.lead_id))
  trace.finish(inboundStep, 'succeeded', { lead_identified: true, conversation_identified: true, media_read_failed: inbound.mediaFailed,
    webhook_delay_minutes: freshness.lagMinutes, delayed_webhook: freshness.delayed })
  const permissionStep = trace.start('response_permission', 'Permiso para responder', 'control', 'conversation.ts · kommo.ts', {
    manual_stop: lead.bot_enabled !== true || inbound.stopped,
    opt_out: Boolean(lead.tracking_opt_out_at),
  })
  const turnMessage = inbound.normalized.map(e => e.text).join('\n').slice(0, 30_000)
  if (!permitted(initialConfig, lead, settings.testLeadId) || lead.bot_enabled !== true
    || lead.tracking_opt_out_at || inbound.stopped) {
    const reason = lead.tracking_opt_out_at ? 'OPT_OUT' : lead.bot_enabled !== true || inbound.stopped ? 'MANUAL_STOP' : 'NOT_PERMITTED'
    trace.finish(permissionStep, 'paused', { reason })
    // Cliente fuera del bot / pausado: elegible a LeadSubmitted sin respuesta automática.
    try {
      const recentOfferText = await resolveRecentUnitOfferText({
        admin: db(),
        conversationId: text(inbound.registration.conversation_id),
      })
      await evaluateWaLeadSubmittedForCurrentTurn({
        admin: db(),
        rpc,
        lead: { ...lead, id: String(lead.id) },
        contactId: last.contactId,
        currentMessage: turnMessage,
        sourceMessageSentAt: last.sentAt,
        recentOfferText,
        tenantId: scope.tenant_id,
        projectId: scope.project_id,
      })
    } catch {
      /* soft-fail */
    }
    return { action: 'bot_paused' }
  }
  let current = inbound.normalized.map(e => e.text).join('\n').slice(0, 30_000)
  const meaningfulText = current.replace(/\[Archivo no interpretado[^\]]*\]|\[Sticker recibido\]/g, '').trim()
  const processingStarted = Date.now()
  const conversationBefore = await one('conversations', text(inbound.registration.conversation_id))
  const recentOutbound = await db().from('messages').select('role,sent_at,content')
    .eq('conversation_id', conversationBefore.id).in('role', ['bot', 'asesor'])
    .lt('sent_at', activeLast.sentAt).order('sent_at', { ascending: false }).limit(12)
  if (recentOutbound.error) throw new Error('HUMAN_ACTIVITY_CHECK_FAILED')
  if (advisorOwnsConversation(recentOutbound.data || [], activeLast.sentAt)) {
    trace.finish(permissionStep, 'paused', { reason: 'ADVISOR_OWNS_CONVERSATION' })
    // Asesor atiende: igual se evalúa LeadSubmitted (oferta puede ser del asesor).
    try {
      const recentOfferText = await resolveRecentUnitOfferText({
        admin: db(),
        conversationId: text(conversationBefore.id),
        preferredText:
          (recentOutbound.data || [])
            .map((row: { content?: string }) => text(row.content))
            .find((c: string) => isUnitOfferContext(c)) || null,
      })
      await evaluateWaLeadSubmittedForCurrentTurn({
        admin: db(),
        rpc,
        lead: { ...lead, id: String(lead.id) },
        contactId: last.contactId,
        currentMessage: turnMessage,
        sourceMessageSentAt: activeLast.sentAt,
        recentOfferText,
        tenantId: scope.tenant_id,
        projectId: scope.project_id,
      })
    } catch {
      /* soft-fail */
    }
    return { action: 'human_attention' }
  }
  trace.finish(permissionStep, 'succeeded', { reason: 'BOT_CAN_RESPOND' })
  const contextStep = trace.start('commercial_context', 'Cargar contexto comercial', 'context', 'context-read.ts · lv_app_conversation_context', {
    lead_id: text(lead.id),
  })
  const context = object(await rpc('lv_app_conversation_context', { p_lead: lead.id, p_message: activeLast.externalId }))
  const pendingRead = await db().from('messages').select('id,external_message_id,role,content,sent_at,model_used,answered_ids:tool_calls->answered_message_ids,provider_status:tool_calls->>provider_status,recovery_source:tool_calls->>source,recovery_pending:tool_calls->turn_completeness->recovery->>pending')
    .eq('conversation_id', conversationBefore.id).lte('sent_at', activeLast.sentAt)
    .order('sent_at', { ascending: false }).order('id', { ascending: false }).limit(80)
  if (pendingRead.error) throw new Error('PENDING_INPUT_READ_FAILED')
  const pendingInputs = unansweredInbound((pendingRead.data || []).reverse().map(message => ({ ...message,
    tool_calls: { ...(Array.isArray(message.answered_ids) ? { answered_message_ids: message.answered_ids } : {}),
      provider_status: message.provider_status, source: message.recovery_source,
      turn_completeness: { recovery: { pending: message.recovery_pending === 'true' } } },
  })), inbound.normalized.map(event => event.externalId))
  context.consultas_pendientes = pendingInputs
  trace.finish(contextStep, 'succeeded', {
    history_messages: Array.isArray(context.historial) ? context.historial.length : 0,
    has_project_context: Boolean(context.proyecto),
    has_visit_context: Boolean(context.cita || context.propuesta_visita),
    pending_message_ids: pendingInputs.map(message => message.message_id),
  })
  const continuation = !inbound.mediaFailed ? nutritionContinuation(current, context.historial) : null
  if (continuation) current = continuation.message
  const originalTurn = current
  let reply = '', finalNotice = false, handoffNotice = '', pendingCommercialHandoff = ''
  let appliedVisitAction: Row | null = null
  let interestDecision: Row | null = null
  let summary: Row = {}, audit: Row = {}, greetingTemplate = false
  let turnCatalog: Row[] = [], propertyTurn: Row = {}, currentSemantics: Row = {}
  let greeting = !inbound.mediaFailed && !pendingInputs.length && isGreetingOnly(current)
  const storedSummary = object(conversationBefore.summary)
  const previousSummary: Row = { ...storedSummary, _lead_profile: confirmedLeadProfile(storedSummary._lead_profile) }
  let businessScope: BusinessScopeDecision = { kind: 'neutral', property_message: current, reply: '', uncertain: false }
  const financeContinuation = !inbound.mediaFailed && meaningfulText && !greeting && !isCourtesyOnly(current)
    && financingFieldAnswer(current, context.historial, {explicit_consent:true})
    ? financingFieldAnswer(current, context.historial, (await financingContext(lead)).current) : null
  const scopeStep = trace.start('scope_classification', 'Interpretar alcance del mensaje', 'ai', 'business-scope.ts', {
    message: traceText(current),
    financing_continuation: Boolean(financeContinuation),
  })
  if (!inbound.mediaFailed && meaningfulText && !greeting && !isCourtesyOnly(current)) {
    businessScope = financeContinuation || isProjectInformationRequest(current) ? {kind:'property',property_message:current,reply:'',uncertain:false}
      : await classifyBusinessScope(current, context.historial, previousSummary._brand_introduced === true, object(previousSummary._turn_intent).scope, previousSummary._pending_question)
    if (businessScope.kind === 'out_of_scope') {
      reply = scopeFallbackReply(businessScope, previousSummary._brand_introduced === true)
      audit = { source: 'business_out_of_scope', business_scope: businessScope.kind }
    } else if (businessScope.uncertain) {
      reply = scopeFallbackReply(businessScope, previousSummary._brand_introduced === true)
      audit = { source: 'scope_clarification', business_scope: 'uncertain' }
    } else if (businessScope.kind === 'mixed') current = businessScope.property_message
  }
  trace.finish(scopeStep, 'succeeded', {
    scope: businessScope.kind,
    reason: businessScope.reason || null,
    outside_evidence: businessScope.outside_evidence || null,
    uncertain: businessScope.uncertain,
    confidence: businessScope.confidence || null,
    greeting,
    courtesy: isCourtesyOnly(current),
  })
  const modelOnly = isOnlyUnitVisualRequest(current) && !explicitlyRequestsVisit(current)
  async function transferToAdvisor(reason: string, cause: Pick<DecisionRecord, 'rule_id' | 'origin' | 'caused_by_step' | 'facts'>) {
    const decision = decisionRecord({ ...cause, reason, outcome: 'requested',
      setting: { kind: 'code', label: 'Condición de derivación al asesor', source: 'conversation.ts · turn-completeness.ts' } })
    const handoffStep = trace.start('advisor_handoff', 'Derivar al asesor', 'action', 'conversation.ts · handoff_lead', {
      reason: traceText(reason, 300), decision,
    })
    await guard()
    const handoffReason = `${reason}. Consulta pendiente: ${current.slice(0, 650)}`
    await rpc('handoff_lead', { p_lead_id: lead.id, p_reason: handoffReason })
    // Compatibilidad hasta aplicar la migración: el traspaso crea una tarea,
    // pero no concede permiso para detener la IA.
    const reactivated = await db().from('leads').update({ bot_enabled: true }).match(scope)
      .eq('id', lead.id).eq('handoff_reason', handoffReason).is('tracking_opt_out_at', null)
    if (reactivated.error) throw new Error('HANDOFF_BOT_STATE_FAILED')
    lead = await one('leads', text(lead.id))
    if (!['queued', 'assigned', 'acknowledged'].includes(text(lead.handoff_status))) throw new Error('HANDOFF_NOT_RECORDED')
    handoffNotice = lead.handoff_status === 'queued'
      ? 'He dejado su consulta en la bandeja del equipo para que un asesor le ayude con ese detalle.'
      : 'He pasado su consulta a un asesor de nuestro equipo para que le ayude con ese detalle.'
    trace.finish(handoffStep, 'succeeded', {
      handoff_status: text(lead.handoff_status),
      assigned_advisor: Boolean(lead.assigned_to),
      bot_remains_enabled: lead.bot_enabled === true,
      decision: { ...decision, outcome: text(lead.handoff_status) },
    })
    return handoffNotice
  }
  async function collectVisit(args: Row) {
    const visitStep = trace.start('visit_coordination', 'Coordinar visita', 'action', 'visit-intake.ts · lv_collect_visit_intake', {
      has_interpreted_preference: Boolean(object(args.p_snapshot)._interpreted_visit),
      needs_help: args.p_needs_help === true,
      rescheduling: Boolean(args.p_previous_request),
    })
    const info=await commercialContext(lead, context.historial, summary._lead_profile || previousSummary._lead_profile)
    if(info.estado_proyecto && object(info.estado_proyecto).primaryPlace==='none') {
      trace.finish(visitStep, 'paused', { action: 'visits_disabled', reason: 'NO_AUTHORIZED_PLACE' })
      return {action:'visits_disabled',message:'Por el momento no hay visitas presenciales habilitadas. Podemos resolver sus dudas por aquí.'}
    }
    if (!await visitParserReady()) {
      // Preserve the request in the actual advisor queue; do not ask for the
      // same date again or manufacture a booking using the old SQL parser.
      const message = await transferToAdvisor('revisar la solicitud de visita y el horario indicado; coordinación automática en actualización', { rule_id: 'visit.parser_unavailable', origin: 'operational', caused_by_step: visitStep })
      trace.finish(visitStep, 'paused', { action: 'advisor_handoff', reason: 'VISIT_PARSER_NOT_READY' })
      return { action: 'advisor_handoff', message }
    }
    try {
      const result = object(await rpc('lv_collect_visit_intake', args))
      if (result.action === 'submitted') {
        if (!text(result.request_id)) throw new Error('VISIT_REQUEST_RECEIPT_MISSING')
        const receipt = await db().from('appointment_reschedule_requests')
          .select('id,status,assigned_advisor_id').match(scope).eq('lead_id', lead.id)
          .eq('id', text(result.request_id)).maybeSingle()
        const saved = object(receipt.data)
        if (receipt.error || saved.id !== result.request_id || !['awaiting_advisor', 'awaiting_client', 'confirmed'].includes(text(saved.status))) throw new Error('VISIT_REQUEST_NOT_VERIFIED')
        trace.finish(visitStep, 'succeeded', {
          action: 'submitted', status: text(saved.status), request_registered: true,
          assigned_advisor: Boolean(saved.assigned_advisor_id),
        })
        return { ...result, registration_verified: true, assigned_advisor_id: saved.assigned_advisor_id || null }
      }
      if (!['collecting', 'stale', 'closed_day', 'past', 'outside_hours'].includes(text(result.action))) throw new Error('VISIT_INTAKE_INVALID_RESULT')
      trace.finish(visitStep, text(result.action) === 'collecting' ? 'succeeded' : 'paused', {
        action: text(result.action), has_slot: Boolean(result.slot),
      })
      return result
    } catch (error) {
      // Do not replay a write of unknown outcome. Store a real handoff for the
      // team to check the existing request before creating another one.
      const message = await transferToAdvisor('verificar el registro de la solicitud de visita y el horario indicado antes de crear otra solicitud; no se pudo comprobar la coordinación automática', { rule_id: 'visit.registration_unverified', origin: 'operational', caused_by_step: visitStep })
      trace.finish(visitStep, 'failed', { action: 'advisor_handoff', registration_verified: false }, error)
      return { action: 'advisor_handoff', message, registration_verified: false }
    }
  }
  const memory = commercialMemory(previousSummary._commercial_memory, context.historial, current)
  const state = sdrState(lead, context.historial)
  const repair = isConversationRepair(current) && !!state.ultima_respuesta
  if (repair) greeting = false
  const turnGreeting = greetingForTurn(current, context.historial, lead.last_bot_message_at, activeLast.sentAt)
  const proposals = (Array.isArray(context.propuestas) ? context.propuestas : []).map(object)
  const { data: visitDraft, error: draftError } = await db().from('lv_visit_intakes').select('status,needs_help,preferred_period').eq('conversation_id', inbound.registration.conversation_id).maybeSingle()
  if (draftError) throw new Error('VISIT_INTAKE_CONTEXT_FAILED')
  // Common interpretation precedes every conversational response route.
  await guard()
  const minimalTurn = !meaningfulText || greeting
  trace.setVersions({ contractVersion: CONVERSATION_CONTRACT_VERSION, model: process.env.OPENAI_MODEL })
  const toolsContextStep = trace.start('decision_context', 'Cargar catálogo y contexto financiero', 'context', 'sdr.ts · financing.ts', { required: !minimalTurn })
  const finance = minimalTurn ? { partners: [], current: {} } : await financingContext(lead)
  turnCatalog = minimalTurn ? [] : await publishedUnitCatalog()
  trace.finish(toolsContextStep, minimalTurn ? 'skipped' : 'succeeded', { catalog_units: turnCatalog.length, financing_partners: finance.partners.length })
  const initialReference = resolveCatalogReference(turnCatalog, current, previousSummary._unit_reference, context.historial)
  const previousPropertyContext = minimalTurn ? object(previousSummary._property_context) : propertyContext(turnCatalog, previousSummary._property_context, context.historial)
  const semanticStep = trace.start('semantic_extraction', 'Interpretar intención y datos', 'ai', 'ai.ts · conversation-rules.ts · turn-semantics.ts', {
    message: traceText(current), has_previous_summary: Object.keys(previousSummary).length > 0,
    catalog_matches: initialReference.matches.length,
  })
  const lastResponse = text(state.ultima_respuesta)
  const rememberedQuestion = normalizedPendingQuestion(previousSummary._pending_question || previousPropertyContext.pending_question, minimalTurn ? undefined : turnCatalog)
  const pendingQuestion = pendingFollowUpNeedsInterpretation(previousSummary, lastResponse) ? {}
    : text(rememberedQuestion.question) && (lastResponse.includes(text(rememberedQuestion.question)) || previousSummary._interpretation_pending === true)
    ? rememberedQuestion
    : pendingQuestionFromReply(lastResponse)
  let interpretation = await interpretConversationTurn({
    consultas_pendientes: pendingInputs,
    resumen: previousSummary, historial: context.historial,
    perfil_inicial: { ...object(previousSummary._lead_profile), awaiting: object(previousSummary._lead_introduction).status === 'pending',
      missing: ['full_name', 'residence_city', 'residence_country'].filter(key => !text(object(previousSummary._lead_profile)[key])) },
    historial_reciente: Array.isArray(context.historial) ? context.historial.slice(-8) : [],
    tema_actual: salesSubject(current, context.historial), alcance_negocio: businessScope.kind,
    alcance_negocio_incierto: businessScope.uncertain,
    ultima_pregunta: state.ultima_respuesta, pregunta_pendiente: pendingQuestion,
    contexto_propiedades: previousPropertyContext, catalogo_unidades: turnCatalog,
    propuestas: proposals, coordinacion_visita: visitDraft, financiamiento: finance,
    unidades_identificadas: initialReference.matches, mensaje_actual: originalTurn,
    mensaje_accion: businessScope.kind === 'out_of_scope' || businessScope.uncertain && businessScope.outside_evidence && businessScope.confidence !== 'low' ? '' : current,
  }, { aiJson, activePrompt, onPromptRevision: revision => trace.setVersions({ promptVersions: { extractor_eventos: revision } }) })
  if (object(interpretation.diagnostic.interpretation_recovery).attempted === true) trace.add(
    'interpretation_recovery', 'Recuperar interpretación del mensaje actual', 'decision', 'turn-interpretation.ts', 'succeeded', {},
    object(interpretation.diagnostic.interpretation_recovery))
  const classifiedScope = businessScope.kind
  const classifiedUncertain = businessScope.uncertain
  const reconciledScope = await reconcileConversationScope(businessScope, current, interpretation.requests, context.historial, pendingQuestion)
  if (reconciledScope !== businessScope) {
    businessScope = reconciledScope
    if (businessScope.kind === 'property' || businessScope.kind === 'mixed') {
      reply = ''
      audit = {}
      if (businessScope.kind === 'mixed') current = businessScope.property_message
      interpretation = interpretation.withActionMessage?.(current) || interpretation
    } else {
      reply = scopeFallbackReply(businessScope, previousSummary._brand_introduced === true)
      audit = { source: businessScope.uncertain ? 'scope_clarification' : 'business_out_of_scope', business_scope: businessScope.kind }
    }
    trace.add('scope_reconciliation', 'Conciliar alcance e intención', 'decision', 'business-scope.ts', 'succeeded',
      { classifier_scope: classifiedScope, classifier_uncertain: classifiedUncertain },
      { scope: businessScope.kind, reason: businessScope.reason, grounded_requests: interpretation.requests.filter(request => request.domain === 'property' && request.confidence === 'high').length })
  }
  const { extracted, semantics: turnSemantics } = interpretation
  const turnIntent = resolveTurnIntent({ current, history: context.historial, semantics: turnSemantics, requests: interpretation.requests,
    scope: businessScope, previous: previousSummary._turn_intent, pendingQuestion,
    profilePending: object(previousSummary._lead_introduction).status === 'pending' })
  if (object(turnIntent.scope).kind === 'property' && businessScope.kind === 'neutral') businessScope = { kind: 'property', property_message: current, reply: '', uncertain: false }
  if (['ask_price', 'request_reservation', 'ask_reservation'].includes(turnIntent.objective)) turnSemantics.primary_intent = turnIntent.objective
  trace.add('turn_intent', 'Resolver objetivo compartido del turno', 'decision', 'turn-intent.ts', 'succeeded',
    { classifier_scope: classifiedScope, extractor_intent: interpretation.diagnostic.primary_intent }, turnIntent)
  turnSemantics.requests = interpretation.requests
  trace.setVersions({ contractVersion: CONVERSATION_CONTRACT_VERSION, model: process.env.OPENAI_MODEL,
    promptVersions: interpretation.promptRevision ? { extractor_eventos: interpretation.promptRevision } : {} })
  const categoryPreference = preferredPropertyCategory(current, turnSemantics)
  // Legacy extraction cannot overwrite the new, evidenced interpretation with a mentioned rejection.
  extracted.preferred_category = categoryPreference
  if (categoryPreference && object(turnSemantics.property).confidence !== 'high') {
    turnSemantics.property = { ...object(turnSemantics.property), category: categoryPreference, confidence: 'high', evidence: current.slice(0, 240) }
  }
  const catalogStep = trace.start('catalog_resolution', 'Resolver consulta y referencias del catálogo', 'decision', 'property-context.ts', {
    operation: object(turnSemantics.property).operation, filters: object(object(turnSemantics.property).filters),
    previous_query: object(previousPropertyContext.query), pending_question: pendingQuestion,
  })
  const reference = resolvePropertyTurn(turnCatalog, current, previousSummary, context.historial, turnSemantics)
  propertyTurn = reference
  currentSemantics = turnSemantics
  const unresolvedPropertyScope = businessScope.uncertain || businessScope.kind === 'out_of_scope'
  summary = { ...rememberInterpretedTurn(previousSummary, originalTurn, unresolvedPropertyScope
    ? { ...extracted, preferred_category: null, purchase_purpose: null } : extracted, unresolvedPropertyScope ? {} : turnSemantics),
    _turn_intent: turnIntent,
    _unit_reference: minimalTurn || unresolvedPropertyScope ? previousSummary._unit_reference || {} : reference.memory,
    _property_context: minimalTurn || unresolvedPropertyScope ? previousPropertyContext : reference.context }
  const declaredProfile = object(extracted.lead_profile)
  summary._lead_profile = mergeLeadProfile(previousSummary._lead_profile, declaredProfile,
    { message_id: activeLast.externalId, declared_at: activeLast.sentAt })
  trace.add('lead_profile_resolution', 'Interpretar los datos del lead', 'decision', 'lead-profile.ts', 'succeeded', {},
    { profile: summary._lead_profile, decisions: object(summary._lead_profile).diagnostics })
  extracted.turn_semantics = turnSemantics
  if(financeContinuation) Object.assign(extracted,financeContinuation)
  const financeInput = financingInputs(extracted, current, text(state.ultima_respuesta), finance, object(previousSummary._last_operational_step))
  extracted.financing_consent = financeInput.consent
  extracted.financing_partner = financeInput.partner
  const collectingVisit = visitDraft?.status === 'collecting'
  const semanticVisit = object(extracted.visit_intent)
  const visitPermission = visitRoutePermission(interpretation.requests, turnSemantics, semanticVisit)
  trace.add('route_consistency', 'Comprobar ruta frente a la solicitud actual', 'decision', 'route-consistency.ts', 'succeeded', {}, visitPermission)
  const semanticVisitRequest = semanticVisit.kind === 'request_visit' && !hasUnrelatedAppointmentTarget(current)
  // A semantic acceptance is actionable only while a durable visit draft is
  // already collecting details. This prevents a bare "sí" from starting a
  // visit while financing, pricing or another feature is active.
  const semanticVisitAcceptance = (semanticVisit.kind === 'accept_visit_preference' && collectingVisit)
    || answersPendingQuestion(turnSemantics, 'visit_invitation', 'affirmative')
  const explicitVisitRequest = explicitlyRequestsVisit(current)
  const invitationAccepted = acceptsVisitInvitation(current, text(state.ultima_respuesta))
  const visitSignal = explicitVisitRequest || semanticVisitRequest || semanticVisitAcceptance || invitationAccepted
  const canRequestVisit = visitPermission.allowed && !modelOnly && !asksVisitStatus(current, text(state.ultima_respuesta)) && (!repair || isVisitDetail(current))
    && (!isCourtesyOnly(current) || semanticVisitAcceptance || invitationAccepted)
    && (visitSignal || collectingVisit)
  if (canRequestVisit && visitSignal) extracted.events = [...new Set([...(extracted.events as string[]), 'requested_visit'])]
  if (!canRequestVisit) extracted.events = (extracted.events as string[]).filter(e => e !== 'requested_visit')
  const priceTurn = turnIntent.required_facts.includes('price')
  const reservation = object(turnSemantics.reservation)
  const startingReservation = turnIntent.requested_action === 'reservation_handoff'
  const reservationInformation = turnIntent.objective === 'ask_reservation'
  const reservationSelectedIds = Array.isArray(previousPropertyContext.selected_ids) ? previousPropertyContext.selected_ids : []
  const reservationAction = startingReservation ? reservationRequest(reservation, inbound.normalized, turnCatalog,
    turnCatalog.filter(unit => reservationSelectedIds.includes(unit.id))) : null
  if (reservation.kind === 'declined' || startingReservation && !reservationAction) {
    extracted.events = (extracted.events as string[]).filter(event => event !== 'asked_reservation')
  }
  const answeringIntroduction = object(previousSummary._lead_introduction).status === 'pending'
    && isProfileOnlyTurn(current, { ...extracted, turn_semantics: turnSemantics })
  const financeTurn = financeInput.consent === true || (!answeringIntroduction && !priceTurn && isFinancingTurn(extracted, current, text(state.ultima_respuesta), financeInput))
  if (!financeTurn) extracted.events = (extracted.events as string[]).filter(e => e !== 'asked_financing')
  if (isCourtesyOnly(current) && !visitSignal && !financeTurn && !extracted.requested_advisor) extracted.events = []
  trace.finish(semanticStep, 'succeeded', {
    ...interpretation.diagnostic,
    events: extracted.events,
    preferred_category: text(extracted.preferred_category) || null,
    purchase_purpose: text(extracted.purchase_purpose) || null,
    requested_visit: (extracted.events as string[]).includes('requested_visit'),
    requested_advisor: extracted.requested_advisor === true,
    opt_out: extracted.opt_out === true,
    financing_partner: text(extracted.financing_partner) || null,
    financing_turn: financeTurn,
    visit_intent: text(semanticVisit.kind) || null,
    primary_intent: text(turnSemantics.primary_intent),
    answers_question: text(object(turnSemantics.answer_to_previous).question_id) || null,
    answer_kind: text(object(turnSemantics.answer_to_previous).kind) || null,
    budget_status: text(object(turnSemantics.budget).status) || null,
    property_category: text(object(turnSemantics.property).category) || null,
    property_excluded_categories: object(turnSemantics.property).excluded_categories,
    reference_reason: reference.reason, reference_unit_ids: reference.matches.map(unit => unit.id),
    reference_needs_clarification: reference.needsClarification,
  })
  trace.finish(catalogStep, 'succeeded', {
    reference_reason: reference.reason, needs_clarification: reference.needsClarification,
    candidate_unit_ids: reference.matches.map(unit => unit.id), query: object(object(reference).query),
    filter_resolution: object(reference.context).filter_resolution, reference_resolution: object(reference.context).reference_resolution,
    catalog_snapshot: catalogSnapshot(reference.matches),
    decision: decisionRecord({ rule_id: 'property.resolve_query', origin: 'memory', caused_by_step: semanticStep,
      reason: text(reference.reason), before: { query: object(previousPropertyContext.query) }, after: { query: object(object(reference).query) },
      facts: { candidate_count: reference.matches.length, needs_clarification: reference.needsClarification },
      outcome: reference.needsClarification ? 'clarification_required' : 'query_resolved',
      setting: { kind: 'code', label: 'Continuidad y filtros de búsqueda', source: 'property-context.ts' } }),
  })

  // Consent withdrawal is a turn-wide decision, including brochure or mixed requests.
  if (extracted.opt_out) {
    await guard()
    await rpc('set_tracking_preference', { p_lead_id: lead.id, p_consent: false, p_reason: 'solicitó no recibir más mensajes' })
    reply = 'Hemos registrado su solicitud de no recibir más mensajes.'
    finalNotice = true
    audit = { source: 'opt_out' }
  }
  if (!reply && !inbound.mediaFailed && !['property', 'mixed'].includes(businessScope.kind)
    && !extracted.requested_advisor) {
    reply = vehicleScopeReply(current, context.historial)
    if (reply) audit = { source: 'vehicle_out_of_scope' }
  }
  if (!reply && !inbound.mediaFailed && asksForHouse(current) && !extracted.requested_advisor
    && financeInput.consent !== true && !(extracted.events as string[]).includes('requested_visit')) {
    reply = houseProductReply(current, text(state.ultima_respuesta))
    if (/financ|cr[eé]dito|hipoteca/i.test(current)) reply += ' ' + priceFinancingReply(current, finance)
    audit = { source: 'product_clarification' }
  }
  // Facts and explicit consent apply to the interpreted turn, regardless of response route.
  if (!finalNotice && interpretation.method === 'model' && businessScope.kind !== 'out_of_scope'
    && audit.source !== 'vehicle_out_of_scope' && !businessScope.uncertain) {
    await guard()
    if (extracted.tracking_consent) await rpc('set_tracking_preference', { p_lead_id: lead.id, p_consent: true, p_reason: 'aceptó recibir novedades' })
    // Consentimiento ads/Meta: explícito (evidencia) y distinto de tracking_consent.
    try {
      lead = {
        ...lead,
        ...(await applyWhatsappAdsConsentFromClientMessage({
          rpc,
          leadId: String(lead.id),
          currentMessage: current,
          lead,
        })),
      }
    } catch {
      /* soft-fail */
    }
    if (!inbound.mediaFailed && current.trim()) {
      const scoreDecision = await evaluateInterestDecision(rpc, { p_lead_id: lead.id, p_events: extracted.events, p_source_message_id: activeLast.externalId })
      interestDecision = scoreDecision
      trace.add('interest_evaluation', 'Registrar interés y decisión comercial', 'decision', 'lv_evaluate_message_interest_v2', 'succeeded',
        { events: extracted.events }, { ...scoreDecision, action_executed: false })
    }
    // Do not persist UUIDs invented by extraction or arbitrarily pick among equal-sized units.
    const unitId = !reference.needsClarification && (reference.explicit || isUnitVisualRequest(current)) && reference.matches.length === 1 ? reference.matches[0].id : null
    if (unitId) extracted.preferred_category = reference.matches[0].category
    const previousCategory = lead.preferred_category
    const declarations = object(await rpc('save_lead_declarations', { p_lead_id: lead.id, p_preferred_category: extracted.preferred_category,
      p_purchase_purpose: extracted.purchase_purpose, p_unit_id: unitId }))
    lead = { ...lead, ...declarations }
    const facts = qualifiedFacts(object(extracted.qualification), current)
    const categoryChanged = previousCategory && lead.preferred_category !== previousCategory
    if (categoryChanged && !unitId && reference.reason === 'category_change') { reference.matches = []; summary._unit_reference = {} }
    if (Object.keys(facts).length || categoryChanged) {
      const previousFacts = object(object(lead.behavior_signals).sdr)
      // A switch from housing to commercial property starts a different search.
      const signals = { ...object(lead.behavior_signals), sdr: { ...(categoryChanged ? {} : previousFacts), ...facts } }
      const crossUse = categoryChanged && (previousCategory === 'local' || lead.preferred_category === 'local')
      const resetSearch = crossUse ? { preferred_bedrooms: null, ...(!extracted.purchase_purpose && lead.purchase_purpose !== 'invertir' ? { purchase_purpose: null } : {}) } : {}
      const { error } = await db().from('leads').update({ behavior_signals: signals, ...resetSearch }).match(scope).eq('id', lead.id)
      if (error) throw new Error('QUALIFICATION_SAVE_FAILED')
      lead = { ...lead, ...resetSearch, behavior_signals: signals }
    }
    // LeadSubmitted BM: interés del turno actual; fuera/dentro del bot. Soft-fail.
    try {
      await evaluateWaLeadSubmittedForCurrentTurn({
        admin: db(),
        rpc,
        lead: { ...lead, id: String(lead.id) },
        contactId: last.contactId,
        currentMessage: current,
        sourceMessageSentAt: activeLast.sentAt,
        scoreEvents: extracted.events as string[],
        recentOfferText: await resolveRecentUnitOfferText({
          admin: db(),
          conversationId: text(inbound.registration.conversation_id),
          preferredText: text(state.ultima_respuesta) || null,
        }),
        tenantId: scope.tenant_id,
        projectId: scope.project_id,
      })
    } catch {
      /* soft-fail: nunca corta la atención */
    }
  }
  const operationalTurn = extracted.requested_advisor === true || financeTurn || startingReservation || reservationInformation
    || (extracted.events as string[]).includes('requested_visit')
  const catalogTurn = Boolean(object(turnSemantics.property).group)
    || !['', 'none'].includes(text(object(turnSemantics.property).operation))

  async function afterAppliedVisit(result: Row, proposal: Row): Promise<Row | null> {
    const remaining = interpretation.requests.filter(request => !['visit', 'tracking', 'courtesy'].includes(text(request.domain)))
    const updated = { ...summary, _pending_question: {},
      _property_context: { ...object(summary._property_context), pending_question: {}, focused_ids: [] },
      _last_operational_step: { kind: 'visit_confirmed', request_id: proposal.request_id || proposal.id },
      _pending_requests: remaining }
    const stateStep = trace.start('state_persisted', 'Guardar el resultado de la visita', 'action', 'conversation.ts', {})
    const saved = await db().from('conversations').update({ summary: JSON.stringify(updated) }).match(scope).eq('id', text(inbound.registration.conversation_id))
    trace.finish(stateStep, saved.error ? 'failed' : 'succeeded', { memory_saved: !saved.error, remaining_requests: remaining.length }, saved.error ? 'MEMORY_SAVE_FAILED' : undefined)
    summary = updated
    // The verified RPC owns the confirmation outbox. Do not send that confirmation twice.
    if (!remaining.length || result.action === 'duplicate') return { ...result, memory_saved: !saved.error }
    appliedVisitAction = result
    current = remaining.map(request => text(request.evidence)).join('\n')
    if (extracted.requested_advisor && remaining.some(request => request.domain === 'advisor')) {
      reply = await transferToAdvisor('pidió hablar con un asesor después de confirmar su visita', { rule_id: 'advisor.explicit_request', origin: 'client', caused_by_step: semanticStep })
      audit = { source: 'advisor_handoff', completed_visit_action: result, coverage_complete: false }
      return null
    }
    // Reuse the financial action handler below; the already applied visit is excluded there.
    if (financeTurn && remaining.some(request => request.domain === 'financing')) return null
    const residualSemantics = { ...turnSemantics, primary_intent: 'other' }
    const residualReference = resolvePropertyTurn(turnCatalog, current, summary, context.historial, residualSemantics)
    propertyTurn = residualReference
    currentSemantics = residualSemantics
    const info = { ...await commercialContext(lead, context.historial, summary._lead_profile || previousSummary._lead_profile), alcance_negocio: businessScope.kind,
      final_review_follows: true,
      historial: context.historial, financiamiento: finance, referencia_unidad: residualReference,
      property_context: residualReference.context, semantica_turno: residualSemantics,
      resultado_visita: { action: 'confirmed', request_id: proposal.request_id || proposal.id } }
    const generated = await commercialReply(info, current, summary, guard)
    reply = generated.reply
    audit = { ...generated.audit, completed_visit_action: result, coverage_complete: false }
    if (audit.requires_advisor === true) {
      pendingCommercialHandoff = text(audit.handoff_reason) || 'resolver las consultas adicionales a la confirmación de visita'
      reply = completeTurnAnswer('', turnAnswerFacts(info, current, summary)).reply || 'Ese detalle necesita verificación del equipo.'
    }
    if (!reply.trim()) throw new Error('EMPTY_VISIT_FOLLOWUP_REPLY')
    return null
  }

  // A current reservation instruction owns the action; selecting a unit does not replace it.
  if (!finalNotice && !inbound.mediaFailed && !businessScope.uncertain && businessScope.kind !== 'out_of_scope'
    && (startingReservation || reservationInformation)) {
    if (startingReservation) {
      const request = reservationAction
      if (!request) {
        reply = '¿Desea que iniciemos la solicitud de reserva con un asesor?'
        audit = { source: 'reservation_clarification', action: 'clarification_required',
          reservation: { ...reservation, handoff_verified: false }, reason: 'reservation_request_evidence_unresolved' }
      } else {
        const step = trace.start('advisor_handoff', 'Solicitar reserva y asignar asesor', 'action', 'lv_request_reservation_handoff',
          { requested_action: 'reservation_handoff', ...request })
        await guard()
        const receipt = object(await rpc('lv_request_reservation_handoff', { p_lead_id: lead.id,
          p_source_message_id: request.source_message_id, p_unit_ids: request.unit_ids, p_evidence: request.evidence,
          p_evidence_message_ids: request.evidence_message_ids }))
        lead = await one('leads', text(lead.id))
        if (!verifiedReservationReceipt(receipt, lead, request)) throw new Error('RESERVATION_HANDOFF_NOT_VERIFIED')
        const assigned = ['assigned', 'acknowledged'].includes(text(receipt.handoff_status))
        const subject = request.unit_numbers.length ? ` de la unidad ${request.unit_numbers.join(', ')}` : ''
        handoffNotice = assigned
          ? `He registrado su solicitud de reserva${subject} y un asesor tiene asignada su atención para continuar con el proceso.`
          : `He registrado su solicitud de reserva${subject} en la bandeja del equipo, pendiente de asignar un asesor para continuar con el proceso.`
        reply = handoffNotice
        audit = { source: 'reservation_handoff', action: assigned ? 'advisor_assigned' : 'advisor_queued',
          reservation: { ...reservation, ...request, ...receipt, status: receipt.handoff_status, advisor_assigned: assigned, handoff_verified: true },
          required_facts: turnIntent.required_facts }
        trace.finish(step, 'succeeded', { ...receipt, requested_action: 'reservation_handoff', handoff_verified: true,
          advisor_assigned: assigned, inventory_reserved: false, bot_remains_enabled: lead.bot_enabled === true })
      }
    } else {
      reply = 'Un asesor puede orientarle sobre los requisitos y los pasos para solicitar una reserva. ¿Le gustaría que le ponga en contacto con el equipo para continuar?'
      audit = { source: 'reservation_information', reservation: { ...reservation, handoff_verified: false }, action: 'information_only' }
    }
  }

  // General information is about the project even when extraction also assigns
  // a property group/search. Keep operational actions ahead of this presentation.
  if (!reply && answeringIntroduction && !operationalTurn && !inbound.mediaFailed && !businessScope.uncertain
    && !['out_of_scope', 'mixed'].includes(businessScope.kind)) {
    const continuation = leadIntroductionTurn({ current, history: context.historial,
      summary: { ...previousSummary, _lead_profile: summary._lead_profile }, extracted, reply: '', audit: { source: 'commercial' }, catalog: turnCatalog })
    if (continuation.applied) {
      reply = continuation.reply
      audit = continuation.audit
      summary._lead_introduction = continuation.state
      trace.add('lead_introduction', 'Presentación y datos del lead', 'decision', 'lead-introduction.ts', 'succeeded', {}, continuation.audit)
    }
  }
  if (!reply && !inbound.mediaFailed && !operationalTurn && (turnIntent.objective === 'project_information'
    || (turnSemantics.confidence !== 'high' && isProjectInformationRequest(current)))) {
    const info = { ...await commercialContext(lead, context.historial, summary._lead_profile || previousSummary._lead_profile), semantica_turno: turnSemantics, property_context: reference.context }
    reply = projectInformationReply(info, current, BROCHURE_URL)
    if (reply) audit = { source: 'project_overview', brochure_sent: true }
  }

  if (!inbound.mediaFailed && !operationalTurn && !catalogTurn) {
    if (!reply && asksTeamAttendance(current)) {
      const appointments = await db().from('appointments').select('id,status,start_time,end_time').match(scope)
        .eq('lead_id', lead.id).in('status', ['aceptado', 'reprogramado']).gt('end_time', activeLast.sentAt)
      if (appointments.error) {
        reply = await transferToAdvisor('verificar a qué cita se refiere el cliente y si espera una visita del equipo', { rule_id: 'visit.team_attendance_unverified', origin: 'operational', caused_by_step: semanticStep })
        audit = { source: 'advisor_handoff' }
      } else {
        reply = teamAttendanceReply(appointments.data || [], proposals)
        audit = { source: 'team_attendance', verified_appointments: appointments.data || [] }
      }
    }
    if (!reply) {
      reply = projectInformationChoiceReply(current, context.historial)
      if (reply) audit = { source: 'project_information_choice' }
    }
    if (!reply && wantsBrochure(current, context.historial)) {
      const info = await commercialContext(lead, context.historial, summary._lead_profile || previousSummary._lead_profile)
      reply = brochureReply(current, context.historial, text(info.modo_comercial),!!info.estado_proyecto)
      if (reply) audit = { source: 'brochure', brochure_sent: true }
    }
    if (!reply && acceptsUnitOptions(current, text(state.ultima_respuesta))) {
      const accepted = acceptedPriceOption(await commercialContext(lead, context.historial, summary._lead_profile || previousSummary._lead_profile), current, previousSummary)
      reply = accepted?.reply || `No tengo los detalles actualizados de esa unidad. Le comparto el brochure para que pueda conocer la propuesta del proyecto:\n\n${BROCHURE_URL}`
      audit = accepted?.audit || { source: 'price_option_unavailable', brochure_sent: true }
    }
    if (!reply) reply = mediaClarificationReply(current)
    if (reply && !audit.source) audit = { source: 'media_clarification' }
    if (!reply && fabricatedActionRequest(current)) { reply = 'Para confirmarle una cita o una reserva, primero debe quedar registrada y aprobada en el sistema. Puedo ayudarle a coordinarla.'; audit = {source:'action_not_recorded'} }
    if (!reply) {reply = declinedFollowup(current, text(state.ultima_respuesta)); if (reply) audit = { source: 'declined_followup' }}
    if (!reply && asksVisitStatus(current, text(state.ultima_respuesta))) {
      reply = visitStatusReply(proposals, visitDraft?.status === 'collecting')
      if (!reply) reply = visitDraft?.status === 'collecting'
        ? 'Todavía estamos definiendo el horario; su cita aún no está confirmada.'
        : proposals.length > 1 ? 'Hay varias solicitudes de visita. ¿A cuál se refiere?'
          : 'No encuentro una solicitud de visita registrada ni una cita confirmada. ¿Qué día y hora le gustaría venir?'
      if (reply) audit = { source: 'visit_status' }
    }
    const locationRequest = locationRequestKind(current)
    const earlyTopics = commercialTurnTopics(current, context.historial, ['property', 'mixed'].includes(businessScope.kind))
    if (!reply && locationRequest && earlyTopics.length === 1 && earlyTopics[0] === 'location') {
      const info = await commercialContext(lead, context.historial, summary._lead_profile || previousSummary._lead_profile)
      reply = locationAnswer(info, locationRequest)
      if (reply) {
        audit = { source: 'location' }
      } else {
        reply = await transferToAdvisor('compartir la ubicación verificada del proyecto', { rule_id: 'project.location_missing', origin: 'policy', caused_by_step: semanticStep })
        audit = { source: 'location_handoff' }
      }
    }
    if (!reply && repair && !/asesor|persona|humano/i.test(current) && !explicitlyRequestsVisit(current) && salesSubject(current).subject !== 'property' && !asksUnitPrice(current)) {
      const finance = await financingContext(lead)
      const selected = text(finance.current.selected_partner_name)
      const visitReply = visitStatusReply(proposals, visitDraft?.status === 'collecting')
      const declined = (Array.isArray(context.historial) ? context.historial : []).map(object).slice(-4)
        .some(m => /dejamos la cita cancelada|hemos cancelado la cita/.test(text(m.content)))
      reply = declined ? 'Disculpe la confusión. Su cita quedó cancelada y no vamos a proponerle otra fecha si no lo desea.'
        : visitReply ? 'Disculpe la confusión. ' + visitReply
          : selected ? `Disculpe la repetición. Ya tengo registrada su elección de ${selected}.${finance.current.explicit_consent === true ? ' Podemos continuar desde los datos que faltan, sin comenzar de nuevo.' : ' La revisión todavía no se ha iniciado; podemos retomarla cuando usted lo indique.'}`
            : ''
      if (reply) audit = { source: 'context_repair' }
    }
  }
  if(!reply && ambiguousVisitAcceptance(current,text(state.ultima_respuesta))) {
    reply='¿Se refiere a coordinar una visita?'
    audit={source:'visit_acceptance_clarification'}
  }
  if (!reply && !inbound.mediaFailed && isCourtesyOnly(current) && !acceptsVisitInvitation(current,text(state.ultima_respuesta)) && !proposals.some(p => p.status === 'awaiting_client')) {
    if (isCourtesyOnly(text(state.ultima_respuesta)) || /^Con mucho gusto, ¡le esperamos!$/i.test(text(state.ultima_respuesta))) {
      trace.add('route_selected', 'Cortesía ya atendida', 'decision', 'conversation-style.ts', 'skipped', {}, { action: 'courtesy_already_acknowledged' })
      return { action: 'courtesy_already_acknowledged' }
    }
    reply = visitDraft?.status !== 'collecting' && proposals.some(p => p.status === 'confirmed') ? 'Con mucho gusto, ¡le esperamos!' : 'Con mucho gusto.'
    audit = { source: 'courtesy' }
  }
  if (!reply && greeting) {
    const welcome = (await activePrompt('saludo_inicial')).trim()
    reply = state.ya_saludamos ? 'Cuénteme, ¿en qué podemos ayudarle?'
      : welcome.length > 0 && welcome.length <= 140 && !/la\s*vilet|proyecto|vivienda|invertir|local comercial|suite|departamento|edificio|puertas del sol|financ|precio|sector/i.test(welcome)
        ? welcome : minimalGreeting(turnGreeting)
    greetingTemplate = true; audit = { source: 'minimal_greeting' }
  }
  if (!meaningfulText) {
    if (current.includes('[Sticker recibido]') && !inbound.mediaFailed) {
      trace.add('route_selected', 'Reacción sin respuesta', 'decision', 'media-format.ts', 'skipped', {}, { action: 'reaction_only' })
      return { action: 'reaction_only' }
    }
    reply = mediaFailureReply(activeLast.media, inbound.mediaErrors)
    audit = { source: 'media_not_understood', media_errors: inbound.mediaErrors }
  }
  if (!reply && businessScope.kind === 'mixed' && (explicitlyRequestsVisit(current) || ((proposals.length || visitDraft?.status === 'collecting') && (isVisitDetail(current) || /cancel|reprogram/i.test(current))))) {
    // The existing SQL appointment parser reads the original message. Let a human
    // resolve mixed bookings so a flight's date cannot become the property's date.
    reply = await transferToAdvisor('coordinación inmobiliaria mezclada con otra gestión; verificar únicamente la visita al proyecto', { rule_id: 'visit.mixed_scope', origin: 'operational', caused_by_step: semanticStep })
    audit = { source: 'mixed_visit_handoff' }
  }
  if (!reply && !greeting && !modelOnly && proposals.length && visitPermission.allowed) {
    await guard()
    const visitIntentStep = trace.start('visit_intent', 'Interpretar respuesta de visita', 'ai', 'conversation.ts · visitIntentPrompt', {
      message: traceText(current), proposals_available: proposals.length,
    })
    const proposal: Row | null = proposals.length === 1 ? { ...proposals[0], source_sent_at: activeLast.sentAt } : null
    const classification = await aiJson(visitIntentPrompt + '\n' + TURN_RULES, { mensaje_cliente: current,
      propuesta: proposal && visitDraft?.status === 'collecting' ? { ...proposal, status: 'awaiting_advisor' } : proposal,
      historial: context.historial })
    const options = Array.isArray(proposal?.proposed_options) ? proposal.proposed_options.map(object) : []
    const visitRequests = interpretation.requests.filter(request => request.domain === 'visit' && request.confidence === 'high')
    const sentences = current.split(/[.!]\s+|\n+/).map(value => value.trim().replace(/[.!]$/, ''))
    const visitClause = visitRequests.length === 1 && sentences.includes(text(visitRequests[0].evidence).replace(/[.!]$/, ''))
      && !/\b(?:no|pero|solo si|siempre que|a condici[oó]n|si (?:me|nos|el|la|es)|quiz[aá]s|tal vez)\b/i.test(current)
      ? text(visitRequests[0].evidence) : ''
    // A complete, unconditional acceptance sentence can coexist with a separate question.
    // A model-proposed substring must never remove a condition or refusal from consent.
    const selected = selectedVisitOption(current, options, activeLast.sentAt)
      ?? (visitClause ? selectedVisitOption(visitClause, options, activeLast.sentAt) : null)
    const interpretedVisit = normalizedVisitPreference(classification.visit_preference, current)
    const override = visitTurnIntent(current)
    // Withdrawal is authorized only by the common, evidenced interpretation.
    const intent = validateIntent(classification.intent === 'opt_out' ? { intent: extracted.opt_out ? 'opt_out' : 'question' } : selected !== null ? { intent: 'accept' }
      : override === 'counterproposal' ? { intent: override } : classification, proposal, activeLast.sentAt, text(context.mensaje_actual_at))
    trace.finish(visitIntentStep, 'succeeded', {
      intent, selected_option: selected, has_preference: Boolean(interpretedVisit), proposal_status: text(proposal?.status),
    })
    if (intent === 'opt_out') {
      await guard(); await rpc('set_tracking_preference', { p_lead_id: lead.id, p_consent: false, p_reason: 'solicitó no recibir más mensajes' })
      reply = 'Hemos registrado su solicitud de no recibir más mensajes.'; finalNotice = true
    } else if (proposal && declinesAllVisitAlternatives(current, proposal, intent)) {
      await guard()
      const result = await collectVisit({ p_lead: lead.id, p_message: activeLast.externalId,
        p_needs_help: true, p_previous_request: proposal.request_id || proposal.id, p_snapshot: proposal })
      reply = text(result.message) || 'Entiendo. Pediré al equipo que revise otras fechas y le enviaremos nuevas opciones por aquí.'
      audit = { source: result.action === 'advisor_handoff' ? 'advisor_handoff' : 'visit_intake', action: result.action,
        preference: result.slot, request_id: result.request_id, registration_verified: result.registration_verified,
        assigned_advisor_id: result.assigned_advisor_id, proposal_rejected: true, bot_paused: false }
    } else if (proposal && intent === 'accept' && options.length > 1) {
      if (selected === null) {
        reply = `¿Cuál de estos horarios le queda mejor?\n\n${visitOptionsList(options.map(o => ({ start_time: text(o.start_time), end_time: text(o.end_time) })))}`
        audit = { source: 'visit_option_choice' }
      } else {
        await guard()
        const result = object(await rpc('lv_client_select_visit_option', { p_request_id: proposal.request_id || proposal.id,
          p_option_index: selected, p_message_id: activeLast.externalId }))
        if (result.status !== 'confirmed') throw new Error('VISIT_OPTION_NOT_CONFIRMED')
        trace.add('visit_result', 'Confirmar cita', 'output', 'lv_client_select_visit_option', 'succeeded', {}, { action: 'confirmed', selected_option: selected })
        const exit = await afterAppliedVisit({ action: 'confirmed', selected_option: selected }, proposal)
        if (exit) return exit
      }
    } else if (proposal && (intent === 'counterproposal' || intent === 'reject' || (intent === 'unclear' && visitDraft?.status === 'collecting'))) {
      await guard()
      const requestedHelp = needsVisitHelp(current)
      const advisorHelp = requestedHelp && (visitHoursWereOffered(text(state.ultima_respuesta))
        || (proposal.proposed_by === 'advisor' && proposal.status === 'awaiting_client'))
      const result = await collectVisit({ p_lead: lead.id, p_message: activeLast.externalId,
        p_needs_help: advisorHelp, p_previous_request: proposal.request_id || proposal.id,
        p_snapshot: interpretedVisit ? { ...proposal, _interpreted_visit: interpretedVisit } : proposal })
      reply = text(result.message) || intakeReply(result, activeLast.sentAt)
      if (result.action === 'collecting' && requestedHelp) {
        const visitInfo = await commercialContext(lead, context.historial, summary._lead_profile || previousSummary._lead_profile)
        reply = visitBusinessHoursReply(visitInfo.horario_atencion, result, activeLast.sentAt) || reply
      }
      audit = { source: result.action === 'advisor_handoff' ? 'advisor_handoff' : 'visit_intake', action: result.action, preference: result.slot, request_id: result.request_id, registration_verified: result.registration_verified, assigned_advisor_id: result.assigned_advisor_id }
    } else if (proposal && intent === 'unclear') {
      reply = proposal.status === 'awaiting_advisor'
        ? 'El equipo todavía está revisando el horario. Le confirmaremos por aquí en cuanto esté listo.'
        : 'Para evitar una confusión, ¿le queda bien el horario de la propuesta que le enviamos?'
    } else if (proposal && intent !== 'question') {
      await guard()
      const applied = object(await rpc('lv_apply_client_visit_intent', { p_tenant: scope.tenant_id, p_project: scope.project_id,
        p_lead: lead.id, p_request: proposal.request_id || proposal.id, p_message: activeLast.externalId, p_intent: intent, p_snapshot: proposal }))
      if (['confirmed', 'duplicate'].includes(text(applied.action))) {
        trace.add('visit_result', 'Aplicar decisión de visita', 'output', 'lv_apply_client_visit_intent',
          text(applied.action) === 'confirmed' ? 'succeeded' : 'skipped', {}, { action: text(applied.action) })
        const exit = await afterAppliedVisit({ action: applied.action }, proposal)
        if (exit) return exit
      }
      else {
        if (!['reply', 'stale', 'conversation'].includes(text(applied.action))) throw new Error('VISIT_INTENT_RPC_CONTRACT_MISMATCH')
        reply = text(applied.mensaje)
      }
      if (intent === 'cancel' && applied.action === 'reply') {
        const { error } = await db().from('lv_visit_intakes').delete().eq('conversation_id', inbound.registration.conversation_id)
        if (error) throw new Error('VISIT_DRAFT_CANCEL_FAILED')
      }
    } else if (!proposal && intent === 'unclear') reply = '¿A qué día y horario de visita se refiere?'
  }
  if (!reply) {
    await guard()
    {
      const financeAnswer = priceTurn || financeInput.consent === true ? '' : financingQuestionReply(current, finance.partners, text(state.ultima_respuesta), extracted)
      let financePrerequisite = ''
      if (financeTurn && !financeAnswer) {
        const selectionInfo = { ...await commercialContext(lead, context.historial, summary._lead_profile || previousSummary._lead_profile), historial: context.historial,
          financiamiento: finance, referencia_unidad: reference }
        financePrerequisite = financingPrerequisiteReply(selectionInfo, current)
      }
      // A question about a product is not an application or consent to collect personal data.
      let fin: Row = {}, financeFailure = ''
      if (financeTurn && !financeAnswer && !financePrerequisite) {
        try { fin = object(await rpc('process_financing_message_v2', { p_lead_id: lead.id,
        p_asked_financing: (extracted.events as string[]).includes('asked_financing') || !!financeInput.partner,
        ...Object.fromEntries(['financing_consent', 'financing_partner', 'full_name', 'applicant_type', 'national_id',
          'employment_stability_months', 'job_title', 'monthly_income', 'ruc'].map(key => ['p_' + key, extracted[key]])),
        p_source_message_id: activeLast.externalId, p_current_message: current })) }
        catch (error) {
          // Do not replay a financial write whose outcome is uncertain. Preserve
          // the client's request for a real advisor instead of silently stopping.
          financeFailure = error instanceof Error && /^RPC_[a-z0-9_]+$/i.test(error.message) ? error.message.toUpperCase() : 'FINANCING_PROCESSING_FAILED'
        }
      }
      const visitRequested = !appliedVisitAction && ((extracted.events as string[]).includes('requested_visit')
        || (canRequestVisit && visitDraft?.status === 'collecting' && !financeTurn
          && (isVisitDetail(current) || needsVisitHelp(current) || visitTurnIntent(current)==='counterproposal')))
      if (financePrerequisite) {
        reply = financePrerequisite
        audit = { source: 'financing_selection_required' }
      } else if (financeFailure) {
        reply = await transferToAdvisor('continuar la revisión de financiamiento' + (financeInput.partner ? ' con ' + financeInput.partner : '') + '; comprobar el avance previo antes de volver a solicitar datos', { rule_id: 'financing.processing_failed', origin: 'operational', caused_by_step: semanticStep, facts: { failure_code: financeFailure } })
        if (financeInput.partner) reply = `Le ayudaremos a revisar la opción con ${financeInput.partner}. ` + reply
        audit = { source: 'financing_handoff', failure_code: financeFailure, selected_partner: financeInput.partner }
      } else if (!visitRequested && (extracted.requested_advisor || fin.ready_for_handoff === true)) {
        reply = await transferToAdvisor(extracted.requested_advisor ? 'pidió hablar con un asesor' : 'información lista para revisión', { rule_id: extracted.requested_advisor ? 'advisor.explicit_request' : 'financing.ready_for_handoff', origin: extracted.requested_advisor ? 'client' : 'operational', caused_by_step: semanticStep })
        audit = { source: 'advisor_handoff' }
      } else if (visitRequested) {
        await guard()
        const visitInfo = await commercialContext(lead, context.historial, summary._lead_profile || previousSummary._lead_profile)
        const quote = priceTurn ? unitPriceQuote({ ...visitInfo, contrato_turno: turnIntent, alcance_negocio: businessScope.kind, financiamiento: finance, referencia_unidad: reference }, current, summary) : null
        if (quote?.needsAdvisor) {
          reply = await transferToAdvisor('confirmar el precio solicitado y ayudar a coordinar la visita', { rule_id: 'price.unverified_for_visit', origin: 'catalog', caused_by_step: catalogStep })
          audit = { source: 'price_and_visit_handoff' }
        } else {
          const result = await collectVisit({ p_lead: lead.id, p_message: activeLast.externalId,
            p_needs_help: false, ...(extracted.visit_preference ? { p_snapshot: { _interpreted_visit: extracted.visit_preference } } : {}) })
          reply = text(result.message) || intakeReply(result, activeLast.sentAt)
          const shouldShowVisitHours = ['closed_day', 'outside_hours'].includes(text(result.action))
            || (result.action === 'collecting' && result.needs_location !== true
              && (explicitVisitRequest || semanticVisitRequest || needsVisitHelp(current)))
          if (shouldShowVisitHours) reply = visitBusinessHoursReply(visitInfo.horario_atencion, result, activeLast.sentAt) || reply
          const overview = projectOverviewReply(visitInfo, current)
          if (overview) reply = overview + ' ' + reply
          if (quote) reply = quote.reply.replace(/\s*¿[^?]+\?\s*$/, '') + ' ' + reply
          audit = { source: result.action === 'advisor_handoff' ? 'advisor_handoff' : 'visit_intake', action: result.action, preference: result.slot, request_id: result.request_id, registration_verified: result.registration_verified, assigned_advisor_id: result.assigned_advisor_id,
            semantic_visit_intent: semanticVisit.kind || null }
        }
        if (wantsBrochure(current, context.historial)) reply += `\n\nLe comparto el brochure del proyecto: ${BROCHURE_URL}`
      } else if (financeAnswer) {
        reply = financeAnswer
        audit = { source: 'financing_question' }
      } else if (fin.active === true) {
        try {
          reply = avoidFinancingRepeat(financingReply(fin, finance.partners, financeInput.unsupported), current, text(state.ultima_respuesta), fin, finance.partners)
          const selectedPartner = text(fin.selected_partner_name) || financeInput.partner
          if (selectedPartner && financeInput.partner && !reply.includes(selectedPartner)) reply = `Continuamos con ${selectedPartner}. ` + reply
          audit = { source: 'financing', state: fin.state || fin.financing_state, selected_partner: selectedPartner }
        } catch (error) {
          if (!(error instanceof Error) || error.message !== 'UNKNOWN_FINANCING_STATE') throw error
          reply = await transferToAdvisor('continuar la revisión de financiamiento y comprobar los datos que faltan' + (financeInput.partner ? ' con ' + financeInput.partner : ''), { rule_id: 'financing.unknown_state', origin: 'operational', caused_by_step: semanticStep })
          audit = { source: 'financing_handoff', failure_code: 'UNKNOWN_FINANCING_STATE', selected_partner: financeInput.partner }
        }
      }
      else {
        const model = reference.needsClarification ? null : unitModelDelivery(reference, current, context.historial, previousSummary._unit_models_sent)
        const info = { ...await commercialContext(lead, context.historial, summary._lead_profile || previousSummary._lead_profile), alcance_negocio: businessScope.kind, propuestas: proposals,
          final_review_follows: true,
          contrato_turno: turnIntent,
          consultas_pendientes: pendingInputs,
          coordinacion_visita: visitDraft, financiamiento: finance, reglas_del_turno: TURN_RULES, memoria_comercial: memory,
          referencia_unidad:reference, property_context: reference.context, semantica_turno: turnSemantics, archivos_no_leidos:inbound.mediaErrors,
          modelo_3d: model ? { unidad: model.unit_number, se_adjunta_en_esta_respuesta: true, modelo_especifico_disponible: model.model_available, texto_de_entrega: model.caption } : null }
        const placeClarification = info.estado_proyecto
          ? readinessPlaceClarification(info.estado_proyecto as ProjectReadiness,current) : ''
        if(placeClarification) {
          reply=placeClarification
          audit={source:'visit_place_clarification'}
        } else {
          const generated = await commercialReply(info, current, summary, guard)
          audit = generated.audit
          if (audit.requires_advisor === true) {
            // A draft rejection is only a proposed handoff. Finish checking the
            // available facts before mutating the lead or pausing the conversation.
            pendingCommercialHandoff = text(audit.handoff_reason) || 'consulta por verificar'
            const partial = completeTurnAnswer('', turnAnswerFacts(info, current, summary)).reply
            reply = partial || 'Ese detalle debe verificarlo nuestro equipo.'
          } else reply = appendUnitModel(generated.reply, model)
          if (model && reply.includes(model.url)) audit = { ...audit, unit_model: model }
        }
      }
    }
  }
  if (appliedVisitAction) audit.completed_visit_action = appliedVisitAction
  if (inbound.mediaErrors.length) audit = {...audit, media_errors: inbound.mediaErrors}
  if (audit.source === 'visit_intake') {
    const info = await commercialContext(lead, context.historial, summary._lead_profile || previousSummary._lead_profile)
    if(info.estado_proyecto && /¿Qué día y a qué hora le gustaría venir\?/.test(reply)) {
      const invitation=readinessInvitation(info.estado_proyecto as ProjectReadiness).replace('¿Le gustaría','Podemos').replace('?','.')
      reply=reply.replace('¿Qué día y a qué hora le gustaría venir?',`${invitation} ¿Qué día y hora le convendrían?`)
    } else if (!info.estado_proyecto && info.modo_comercial === 'lanzamiento') reply = launchVisitReply(reply, object(info.politica_visitas).launchDestination === 'office' ? 'office' : 'site')
  }
  if (['financing', 'financing_question', 'financing_handoff', 'visit_intake', 'visit_status'].includes(text(audit.source))) {
    const info = { ...await commercialContext(lead, context.historial, summary._lead_profile || previousSummary._lead_profile), alcance_negocio: businessScope.kind, financiamiento: await financingContext(lead) }
    const prepared = turnAnswerFacts(info, current, previousSummary)
    const completed = completeTurnAnswer(reply, prepared)
    reply = completed.reply
    // The semantic check below can answer topics outside this small factual
    // checklist. Only an actual information gap should trigger human help.
    audit = { ...audit, answered_topics: prepared.topics.filter(topic => !completed.missing.includes(topic)) }
  }
  // A specialist may protect its action, but must still account for other requests in the turn.
  if (interpretation.requests.length > 1) audit.coverage_complete = false
  // Attach from the resolved state, independently of the commercial route.
  if (audit.verified_catalog === true && !propertyTurn.needsClarification) {
    const delivery = unitModelDelivery({ explicit: propertyTurn.explicit === true, hasUnitMention: propertyTurn.hasUnitMention === true,
      matches: (Array.isArray(propertyTurn.matches) ? propertyTurn.matches : []).map(object) }, current, context.historial, previousSummary._unit_models_sent)
    if (delivery) {
      reply = appendUnitModel(reply, delivery)
      audit.unit_model = delivery
    }
  }
  const visualContinuation = showroomRequest(current, context.historial)
  const showroomEligible = !inbound.mediaFailed && !finalNotice && !handoffNotice
    && !businessScope.uncertain && !['out_of_scope', 'mixed'].includes(businessScope.kind)
    && ['', 'catalog_search', 'catalog_select', 'catalog_reference', 'unit_model_request', 'commercial', 'location', 'project_overview', 'project_information_choice', 'visit_place_clarification'].includes(text(audit.source))
  if (showroomEligible && (visualContinuation || asksConstructionStatus(current))) {
    const info = await commercialContext(lead, context.historial, summary._lead_profile || previousSummary._lead_profile)
    const readiness = object(info.estado_proyecto)
    const noPhysicalUnits = readiness.stage === 'not_started'
      || Array.isArray(readiness.enabledPlaces) && !readiness.enabledPlaces.some(place => ['model', 'completed_unit'].includes(String(place)))
    if (visualContinuation || noPhysicalUnits) {
      const delivery = unitModelDelivery({ explicit: false, allowGeneralTour: true, hasUnitMention: visualContinuation ? propertyTurn.hasUnitMention === true : false, matches: visualContinuation
        ? (Array.isArray(propertyTurn.matches) ? propertyTurn.matches : []).map(object) : [] },
      'Quiero ver el recorrido virtual', context.historial, previousSummary._unit_models_sent)
      if (delivery) {
        // A correction keeps the visualization goal; it is not a fresh request for a catalogue list.
        const onlyVisualization = visualContinuation && interpretation.requests.length <= 1 && !/precio|financ|credito|ubicaci[oó]n|direcci[oó]n|agendar|reservar|dormitorio|habitaci[oó]n|baños?|superficie|metros|incluye|tiene/i.test(current)
        if (onlyVisualization) reply = 'Puede conocer la distribución y los espacios mediante el showroom virtual.'
        reply = appendUnitModel(reply, delivery)
        audit = { ...audit, unit_model: delivery, showroom_continuation: { ...visualContinuation, reason: visualContinuation ? 'requested_visualization' : 'physical_units_unavailable' },
          ...(onlyVisualization ? { source: 'virtual_showroom', coverage_complete: false } : {}) }
      }
    }
  }
  // All commercial paths that delivered one unit's tour use the same next step.
  const deliveredTour = object(audit.unit_model)
  if (text(deliveredTour.unit_number) && text(deliveredTour.url) && reply.includes(text(deliveredTour.url))
    && !finalNotice && !handoffNotice && !/^(?:visit|financing|advisor|price_and_visit)/.test(text(audit.source))) {
    const info = { ...await commercialContext(lead, context.historial, summary._lead_profile || previousSummary._lead_profile), historial: context.historial,
      semantica_turno: turnSemantics, financiamiento: finance, memoria_comercial: memory }
    const unit = (Array.isArray(info.catalogo) ? info.catalogo : []).map(object).find(row => text(row.unit_number) === text(deliveredTour.unit_number)) || {}
    const next = tourContinuation(info, unit, current)
    if (next.reply) {
      if (!reply.trim().endsWith(next.reply)) reply = reply.replace(/\s*¿[^¿?]+\?\s*$/, '').trim() + '\n\n' + next.reply
      audit = { ...audit, post_tour_continuation: next, pending_question: next.pending_question }
      delete audit.progressive_selection
    }
  }
  if (!audit.profile_introduction && !startingReservation) {
    const introduction = leadIntroductionTurn({ current, history: context.historial, summary: { ...previousSummary, _lead_profile: summary._lead_profile },
      extracted, reply, audit, catalog: turnCatalog })
    if (!finalNotice && !handoffNotice && !businessScope.uncertain && !['out_of_scope', 'mixed'].includes(businessScope.kind)) {
      reply = introduction.reply
      audit = { ...audit, ...introduction.audit }
      summary._lead_introduction = introduction.state
      if (introduction.applied) trace.add('lead_introduction', 'Presentación y datos del lead', 'decision', 'lead-introduction.ts', 'succeeded', {}, introduction.audit)
    }
  }
  // Action parsing uses only verified property fragments. Writing/review sees
  // the full mixed message and its boundary together, before any final send.
  const writingCurrent = [...new Set([
    ...interpretation.requests.filter(request => request.source === 'pending').map(request => text(request.evidence)),
    businessScope.kind === 'mixed' ? originalTurn : current,
  ])].join('\n')
  const needsScopeCopy = businessScope.uncertain || ['out_of_scope', 'mixed'].includes(businessScope.kind)
  const scopeOnlyReview = businessScope.uncertain || businessScope.kind === 'out_of_scope'
  const scopeContract = needsScopeCopy ? scopeWritingContract(businessScope, previousSummary._brand_introduced === true) : null
  if (businessScope.kind === 'mixed') reply = scopeFallbackReply(businessScope, true) + '\n\n' + reply
  const plannedResponse = responsePlan(reply, audit)
  let reviewedText = ''
  let reviewFinalContent: ((candidate: string) => ReturnType<typeof completeTurnReply>) | null = null
  const catalogBaseReply = audit.verified_catalog === true ? reply : ''
  const recoveringTurn = () => object(object(audit.turn_completeness).recovery).pending === true
  const recoveryReply = (coverage: Row) => {
    const body = unverifiedReply({ ...audit, turn_completeness: coverage })
    // This is an independently verified receipt, not the rejected commercial
    // base. Its real operation must remain visible even when prose review fails.
    return audit.source === 'visit_intake' && audit.registration_verified === true && audit.action === 'submitted'
      ? intakeReply({ action: 'submitted', slot: audit.preference, registration_verified: true }, activeLast.sentAt) + '\n\n' + body : body
  }
  audit = { ...audit, interest_decision: interestDecision, response_plan: plannedResponse, turn_contract: CONVERSATION_CONTRACT_VERSION, resolved_turn_intent: turnIntent,
    interpretation: interpretation.diagnostic, writer_greeting: turnGreeting }
  const commercialPromptRoute = !text(audit.source) || ['commercial', 'verified_information_gap'].includes(text(audit.source))
  const dialogueStep = trace.add('dialogue_decision', 'Decidir la respuesta y la siguiente pregunta', 'decision', 'conversation.ts · catalog-dialogue.ts', 'succeeded',
    { primary_intent: turnSemantics.primary_intent, operation: object(turnSemantics.property).operation },
    { source: text(audit.source) || 'commercial', action: text(audit.action) || null, catalog_query: audit.catalog_query,
      result_unit_ids: object(audit.catalog_results).unit_ids, pending_question: audit.pending_question,
      coverage_locked: plannedResponse.locked,
      catalog_snapshot: catalogSnapshot(object(audit.catalog_results).units), catalog_comparison: audit.catalog_comparison,
      base_preview: traceText(reply, MAX_REPLY_CHARACTERS),
      decision: decisionRecord({ rule_id: `response.${text(audit.source) || 'commercial'}`, origin: audit.verified_catalog === true ? 'catalog' : commercialPromptRoute ? 'model' : 'policy',
        caused_by_step: audit.verified_catalog === true ? catalogStep : semanticStep,
        reason: audit.verified_catalog === true ? 'La consulta al catálogo determina las opciones y los datos de esta respuesta.' : 'La intención y el estado de la conversación determinan esta ruta de respuesta.',
        facts: { source: text(audit.source) || 'commercial', coverage_locked: plannedResponse.locked }, outcome: 'base_reply_prepared',
        setting: audit.verified_catalog === true
          ? { kind: 'code', label: 'Presentación del catálogo', source: 'catalog-dialogue.ts' }
          : commercialPromptRoute
            ? { kind: 'prompt', label: 'Conversación y orientación comercial', href: '/inmobiliaria/automatizacion/guion#respuestas', source: 'sdr.ts · respuesta_comercial' }
            : { kind: 'code', label: 'Ruta especializada de respuesta', source: `conversation.ts · ruta ${text(audit.source)}` } }) })
  if (!finalNotice && !['minimal_greeting', 'courtesy', 'media_not_understood', 'media_clarification', 'vehicle_out_of_scope', 'commercial_location_budget'].includes(text(audit.source))) {
    await guard()
    const commercialInfo: Row = !scopeOnlyReview || businessScope.uncertain
      ? await commercialContext(lead, context.historial, summary._lead_profile || previousSummary._lead_profile) : {}
    commercialInfo.estado_conversacion = { brochure_sent: object(previousSummary._lead_introduction).brochure_sent === true,
      introduction_status: object(previousSummary._lead_introduction).status || null }
    commercialInfo.hechos_confirmados = confirmedInterpretationMemory(Object.keys(summary).length ? summary : previousSummary)
    commercialInfo.consultas_pendientes = pendingInputs
    const info: Row = scopeOnlyReview
      ? { ...scopePolicyContext({ ...commercialInfo, financiamiento: finance, semantica_turno: currentSemantics,
        property_context: propertyTurn.context, referencia_unidad: propertyTurn,
        solicitudes_interpretadas: interpretation.requests }, businessScope), limite_alcance: scopeContract, contrato_turno: turnIntent }
      : { ...commercialInfo, alcance_negocio: businessScope.kind, financiamiento: await financingContext(lead), propuestas: proposals,
      ...(scopeContract ? { limite_alcance: scopeContract } : {}),
      estado_operativo: audit, coordinacion_visita: visitDraft, referencia_unidad: propertyTurn,
      avisos_operativos_confirmados: handoffNotice ? [handoffNotice] : [],
      property_context: object(propertyTurn.context), semantica_turno: currentSemantics,
      contrato_turno: turnIntent,
      perfil_lead: summary._lead_profile,
      solicitudes_interpretadas: interpretation.requests,
      catalogo_verificacion: commercialInfo.catalogo,
      ...(audit.verified_catalog === true ? {
        catalogo: object(audit.catalog_results).units, catalog_results: audit.catalog_results, catalog_query: audit.catalog_query } : {}) }
    // The map URL is not a suggestion the writer may add opportunistically.
    if (!locationRequestKind(current)) delete (info as Row).ubicacion
    const costBaseline = object(audit.catalog_retrieval).applied === true
      ? { ...info, catalogo: commercialInfo.catalogo } : undefined
    if (object(audit.catalog_retrieval).applied === true) {
      // Both writer and reviewer receive the same fresh partial selection.
      // Do not silently re-expand it through comparison evidence.
      info.catalogo_verificacion = info.catalogo
      info.catalog_context_scope = audit.catalog_context_scope
      info.catalog_retrieval = audit.catalog_retrieval
      info.catalog_read = { complete: false, scope: 'semantic_candidates' }
      const ids = new Set((Array.isArray(info.catalogo) ? info.catalogo : []).map(unit => object(unit).id))
      info.referencia_unidad = { ...object(info.referencia_unidad), matches: (Array.isArray(propertyTurn.matches) ? propertyTurn.matches : []).filter(unit => ids.has(object(unit).id)) }
    }
    const quote = unitPriceQuote(info, current, Object.keys(summary).length ? summary : previousSummary)
    const coverageStep = trace.start('response_coverage', 'Redactar y validar la respuesta final', 'decision', 'turn-completeness.ts', {
      base_preview: traceText(reply, MAX_REPLY_CHARACTERS), source: text(audit.source) || 'commercial',
      catalog_coverage: audit.catalog_coverage,
    })
    const reviewed = await completeTurnReply({ current: writingCurrent, history: context.historial, baseReply: reply,
      costBaseline,
      verified: { ...info, _sales_memory: previousSummary._sales_memory, respuesta_precio_verificada: quote?.reply || null, precios_del_turno: quote?.prices || [] }, audit: { ...audit, semantic_review_enabled: true, business_risk_review_enabled: true },
      preserveOperationalQuestion: plannedResponse.locked || ['financing', 'visit_intake', 'visit_status', 'visit_option_choice', 'unit_alternative', 'unit_alternative_journey', 'project_overview', 'project_information_choice'].includes(text(audit.source)) })
    // Boundary integrity check: normal candidates already passed these checks inside the repair loop.
    const semanticEvidence = reviewed.audit.status === 'checked' ? reviewed.audit.semantic_review : null
    const catalogValidation = validateCatalogReply(reviewed.reply, { ...audit, semantic_review: semanticEvidence })
    if (object(reviewed.audit.fallback_validation).passed === false) {
      // The fallback already failed coverage or factual validation. Presentation
      // obligations cannot restore that rejected base at this boundary.
      reply = recoveryReply(reviewed.audit)
      reviewed.audit = { ...reviewed.audit, retained_verified_reply: false, final_preview: traceText(reply, MAX_REPLY_CHARACTERS) }
    } else if (catalogValidation.valid) {
      reply = reviewed.reply
      audit.semantic_review = semanticEvidence
      if (reviewed.audit.status === 'checked' && reply === reviewed.reply) {
        reviewedText = reply
        reviewFinalContent = candidate => completeTurnReply({ current: writingCurrent, history: context.historial, baseReply: candidate,
          costBaseline,
          verified: { ...info, respuesta_precio_verificada: quote?.reply || null, precios_del_turno: quote?.prices || [], avisos_operativos_confirmados: handoffNotice ? [handoffNotice] : [] },
          audit: { ...audit, semantic_review_enabled: true, business_risk_review_enabled: true },
        })
      }
    }
    else {
      // Reject the rewrite, not the conversation. A valid catalogue quote does
      // not become an information gap because an AI draft changed its prices.
      // Keep genuine missing facts flagged by the review (e.g. an unknown fee).
      const baseCheck = validateCatalogReply(reply, audit)
      const unansweredBase = (Array.isArray(reviewed.audit.requests) ? reviewed.audit.requests : []).map(object)
        .some(request => request.base_status === 'unanswered' && !catalogCoversFragment(text(request.fragment), text(request.fact_key), audit))
      const rejectedBase = reply
      reviewed.audit = { ...reviewed.audit, status: 'rejected_catalog_guard',
        final_validation: { passed: false, boundary_integrity_failure: true, issues: [catalogValidation.reason], details: catalogValidation.details || [] },
        candidate_requests: reviewed.audit.requests, requests: [],
        issues: [catalogValidation.reason || 'unsupported_catalog_rewrite'], retained_verified_reply: false,
        recovery: { version: 'turn-recovery-v1', pending: true, base_used: false, reason: 'boundary_integrity_failure' },
        fallback_validation: { passed: false, issues: [baseCheck.reason, unansweredBase ? 'fallback_unanswered_request' : null, 'response_requires_validation'].filter(Boolean),
          recovery: 'pending_validation', rejected_preview: traceText(rejectedBase, MAX_REPLY_CHARACTERS) } }
      reply = recoveryReply(reviewed.audit)
      reviewed.audit.final_preview = traceText(reply, MAX_REPLY_CHARACTERS)
      const originalGaps = (Array.isArray(reviewed.audit.candidate_requests) ? reviewed.audit.candidate_requests : []).map(object)
        .filter(request => request.status === 'missing_fact' || !request.status && request.base_status === 'missing_fact')
        .map(request => text(request.fragment)).filter(Boolean)
      originalGaps.push(...(Array.isArray(reviewed.audit.missing_fact_fragments) ? reviewed.audit.missing_fact_fragments : [])
        .filter((fragment): fragment is string => typeof fragment === 'string' && current.includes(fragment)))
      reviewed.unresolved = assessMissingFacts(originalGaps, audit).unresolved
      reviewed.needsAdvisor = reviewed.unresolved.length > 0
    }
    // Scope clarification is never a factual property gap or consent to handoff.
    if (scopeOnlyReview) { reviewed.unresolved = []; reviewed.needsAdvisor = false }
    const grounded = assessMissingFacts(reviewed.unresolved, audit, (Array.isArray(reviewed.audit.requests) ? reviewed.audit.requests : []).map(object))
    reviewed.unresolved = grounded.unresolved
    reviewed.needsAdvisor = reviewed.needsAdvisor && grounded.unresolved.length > 0
    reviewed.audit = { ...reviewed.audit, needs_advisor: reviewed.needsAdvisor, unresolved: reviewed.unresolved,
      handoff_assessments: [...(Array.isArray(reviewed.audit.handoff_assessments) ? reviewed.audit.handoff_assessments : []), ...grounded.assessments] }
    const requests = Array.isArray(reviewed.audit.requests) ? reviewed.audit.requests.map(object) : []
    const resolvedFromContext = catalogValidation.valid && !reviewed.needsAdvisor && reviewed.audit.status === 'checked'
      && requests.length > 0 && requests.every(request => ['answered', 'clarification', 'outside_scope'].includes(text(request.status)))
    const needsCommercialHandoff = !!pendingCommercialHandoff && !resolvedFromContext
    trace.finish(coverageStep, 'succeeded', {
      business_policy_sources: reviewed.audit.business_policy_sources,
      business_policy_context: commercialInfo.business_policy_context || { status: 'not_loaded_outside_scope' },
      resolved_turn_intent: turnIntent,
      reservation: audit.reservation,
      interpretation: interpretation.diagnostic,
      editorial_observations: reviewed.audit.editorial_observations,
      link_contract: reviewed.audit.link_contract,
      operational_action_verified: reviewed.audit.operational_action_verified,
      profile_introduction: audit.profile_introduction,
      progressive_selection: audit.progressive_selection, post_tour_continuation: audit.post_tour_continuation,
      commercial_continuation: reviewed.audit.commercial_continuation,
      follow_up: reviewed.audit.follow_up, catalog_context_scope: reviewed.audit.catalog_context_scope,
      ...(reviewed.audit.prompt_context_selection ? { prompt_context_selection: reviewed.audit.prompt_context_selection } : {}),
      catalog_retrieval: audit.catalog_retrieval,
      text_transformations: reviewed.audit.text_transformations,
      status: reviewed.audit.status, requests: reviewed.audit.requests, issues: reviewed.audit.issues,
      price_evidence: reviewed.audit.price_evidence,
      final_validation: reviewed.audit.final_validation,
      fallback_validation: reviewed.audit.fallback_validation,
      recovery: reviewed.audit.recovery,
      repair_attempts: reviewed.audit.repair_attempts,
      repair_budget: reviewed.audit.repair_budget,
      semantic_review: reviewed.audit.semantic_review, opening_decision: reviewed.audit.opening_decision, query_transition: audit.query_transition,
      filter_resolution: audit.filter_resolution, reference_resolution: audit.reference_resolution,
      missing_fact_fragments: reviewed.audit.missing_fact_fragments, handoff_assessments: reviewed.audit.handoff_assessments,
      unresolved: reviewed.unresolved, needs_advisor: reviewed.needsAdvisor || needsCommercialHandoff,
      base_preview: reviewed.audit.base_preview, proposed_preview: reviewed.audit.proposed_preview,
      final_preview: traceText(reply, MAX_REPLY_CHARACTERS),
      decision: decisionRecord({ rule_id: 'coverage.verify_information_gap', origin: 'coverage_review', caused_by_step: dialogueStep,
        reason: reviewed.needsAdvisor ? 'La revisión identificó una consulta concreta sin datos verificados.'
          : needsCommercialHandoff ? 'La consulta pendiente de la ruta comercial no pudo resolverse con el contexto.'
            : grounded.assessments.some(item => item.outcome === 'answered_by_catalog') ? 'El catálogo ya responde la consulta; se descartó una derivación innecesaria.'
              : 'No se identificó un dato faltante que requiera derivación.',
        facts: { unresolved: reviewed.unresolved, pending_commercial_handoff: pendingCommercialHandoff || null, review_status: reviewed.audit.status },
        outcome: reviewed.needsAdvisor || needsCommercialHandoff ? 'handoff_required' : 'no_handoff',
        setting: { kind: 'code', label: 'Revisión de cobertura y datos faltantes', source: 'turn-completeness.ts · coverage-evidence.ts' } }),
    })
    audit = { ...audit, turn_completeness: reviewed.audit, ...(pendingCommercialHandoff ? {
      requires_advisor: needsCommercialHandoff, handoff_review: resolvedFromContext ? 'resolved_from_context' : 'needs_advisor',
      ...(resolvedFromContext ? { handoff_reason: null } : {}),
    } : {}) }
    requireReviewedResponse(reviewed.audit)
    const visitCoordinationHandled = audit.source === 'visit_intake'
      && ['collecting', 'submitted', 'closed_day', 'outside_hours', 'past'].includes(text(audit.action))
      && (!reviewed.unresolved.length || reviewed.unresolved.every(item => /\b(?:visitas?|citas?|fechas?|horas?|horarios?|agenda|agendar|reagendar|propuestas?)\b/i.test(item)))
    if (((reviewed.needsAdvisor && !visitCoordinationHandled) || needsCommercialHandoff) && !finalNotice && !handoffNotice) {
      const reason = reviewed.unresolved.length ? 'resolver consultas concretas pendientes: ' + reviewed.unresolved.join(' | ').slice(0, 650) : pendingCommercialHandoff
      const notice = await transferToAdvisor(reason, { rule_id: 'advisor.verified_information_gap', origin: 'coverage_review', caused_by_step: coverageStep,
        facts: { unresolved: reviewed.unresolved, review_status: reviewed.audit.status, pending_commercial_handoff: pendingCommercialHandoff || null } })
      const beforeHandoff = reply
      reply = withHandoffNotice(reply, notice)
      audit.handoff_text_transformations = [{ stage: 'Derivación por consultas pendientes: aviso añadido conservando la pregunta', before: beforeHandoff, after: reply }]
      audit = { ...audit, additional_questions_handoff: true }
    }
  }
  // A writer may improve the answer, but cannot hide a handoff already performed.
  const actionExplained = object(audit.turn_completeness).operational_action_verified === true
  if (handoffNotice && !reply.includes(handoffNotice) && !actionExplained) {
    const beforeHandoff = reply
    reply = withHandoffNotice(reply, handoffNotice)
    audit.handoff_text_transformations = [{ stage: 'Aviso de derivación realizada: se conserva la pregunta', before: beforeHandoff, after: reply }]
  }
  if (!recoveringTurn() && !['business_out_of_scope', 'vehicle_out_of_scope', 'media_not_understood', 'scope_clarification', 'location_handoff'].includes(text(audit.source)) && locationRequestKind(current)) {
    reply = withVisitLocation(reply, await commercialContext(lead, context.historial, summary._lead_profile || previousSummary._lead_profile), true)
  }
  trace.add('route_selected', 'Seleccionar ruta de respuesta', 'decision', 'conversation.ts · turn-routing.ts', 'succeeded', {
    scope: businessScope.kind,
  }, {
    source: text(audit.source) || 'commercial',
    action: text(audit.action) || null,
    advisor_handoff: Boolean(handoffNotice),
  })
  const validationStep = trace.start('response_validation', 'Validar respuesta', 'decision', 'direct-reply.ts · turn-completeness.ts', {
    source: text(audit.source) || 'commercial',
  })
  const beforeFinalFormatting = reply
  const direct = reviewedText ? reply : currentTopicReply(reply,current)
  if(direct !== reply) audit.direct_reply_guard = true
  const openingDecision = object(audit.turn_completeness).opening_decision
  const withOpening = (body: string) => reviewedText ? body : openingDecision ? applyDecidedOpening(body, text(object(openingDecision).prefix)) : variedReplyOpening(body, context.historial)
  reply = reviewedText ? direct : naturalConversationReply(withOpening(direct), confirmedLeadName(summary._lead_profile || previousSummary._lead_profile), turnGreeting, activeLast.sentAt)
  // The last prose transformation is checked too, before any external send.
  const finalCatalogValidation = validateCatalogReply(reply, audit)
  if (!finalCatalogValidation.valid && catalogBaseReply) {
    const approvedAllowed = !!reviewedText && !recoveringTurn() && validateCatalogReply(reviewedText, audit).valid
    if (!approvedAllowed && !recoveringTurn()) audit.turn_completeness = { ...object(audit.turn_completeness),
      recovery: { version: 'turn-recovery-v1', pending: true, base_used: false, reason: 'final_catalog_guard' },
      fallback_validation: { passed: false, issues: ['response_requires_validation', finalCatalogValidation.reason].filter(Boolean) } }
    reply = approvedAllowed ? reviewedText : naturalConversationReply(withOpening(recoveryReply(object(audit.turn_completeness))), confirmedLeadName(summary._lead_profile || previousSummary._lead_profile), turnGreeting, activeLast.sentAt)
    if (handoffNotice && !reply.includes(handoffNotice)) reply = withHandoffNotice(reply, handoffNotice)
    audit.final_catalog_guard = finalCatalogValidation.reason || 'unsupported_catalog_rewrite'
    if (!approvedAllowed) audit.fallback_recovery = { status: 'invalid_base_not_restored', issue: finalCatalogValidation.reason }
  }
  if (reviewedText && reviewFinalContent && requiresContentReview(reviewedText, reply, handoffNotice)) {
    const step = trace.start('final_content_review', 'Revisar contenido modificado antes del envío', 'decision', 'delivery-integrity.ts', {
      approved_preview: reviewedText, candidate_preview: reply,
    })
    const checked = await reviewFinalContent(reply)
    const beforeReview = reply
    const accepted = checked.audit.status === 'checked' && (!handoffNotice || checked.reply.includes(handoffNotice) || checked.audit.operational_action_verified === true)
    // A failed second review never licenses the altered body or starts another handoff.
    reply = accepted ? checked.reply : withHandoffNotice(reviewedText, handoffNotice)
    audit.delivery_integrity = { changed_content: true, status: accepted ? 'revalidated' : 'restored_approved',
      approved_text: reviewedText, candidate_text: beforeReview, final_text: reply, review: checked.audit }
    trace.finish(step, 'succeeded', audit.delivery_integrity as Row)
  } else if (reviewedText) {
    audit.delivery_integrity = { changed_content: false, status: 'approved_content_preserved', approved_text: reviewedText, final_text: reply,
      confirmed_notice_added: Boolean(handoffNotice && reply.includes(handoffNotice)) }
  }
  requireReviewedResponse(object(audit.turn_completeness))
  const canTrackFollowUp = followUpUsable(audit)
  const profilePending = canTrackFollowUp ? leadProfilePendingQuestion(reply, audit) : {}
  const progressivePending = canTrackFollowUp ? progressivePendingQuestion(reply, audit) : {}
  const declaredPending = normalizedPendingQuestion(audit.pending_question, turnCatalog)
  // A protected catalog question retains its referent; other routes migrate via the legacy classifier.
  const replyPending = text(declaredPending.question) && reply.includes(text(declaredPending.question))
    ? declaredPending : pendingQuestionFromReply(reply)
  audit.pending_question = canTrackFollowUp && reply.includes('?') ? Object.keys(profilePending).length ? normalizedPendingQuestion(profilePending)
    : Object.keys(progressivePending).length ? normalizedPendingQuestion(progressivePending, turnCatalog) : replyPending : {}
  if (recoveringTurn()) { audit.answered_topics = []; audit.coverage_complete = false }
  if (!reply.trim() || reply.length > MAX_REPLY_CHARACTERS) throw new Error('EMPTY_OR_LONG_REPLY')
  trace.finish(validationStep, 'succeeded', {
    delivery_integrity: audit.delivery_integrity || null,
    text_transformations: [...(Array.isArray(audit.handoff_text_transformations) ? audit.handoff_text_transformations : []), ...(beforeFinalFormatting !== reply ? [{ stage: 'Validación y formato final antes de Kommo', before: beforeFinalFormatting, after: reply }] : [])],
    final_preview: traceText(reply, 3000),
    response_length: reply.length,
    response_preview: traceText(reply, 280),
    direct_reply_adjusted: audit.direct_reply_guard === true,
    turn_completeness_checked: Boolean(audit.turn_completeness),
    coverage_status: text(object(audit.turn_completeness).status) || (plannedResponse.locked ? 'protected_operational_reply' : 'deterministic_reply'),
    follow_up_usable: canTrackFollowUp,
    catalog_guard: text(audit.final_catalog_guard) || (audit.verified_catalog === true ? 'passed' : 'not_applicable'),
  })
  const conversationId = text(inbound.registration.conversation_id)
  async function authorized() {
    await guard()
    const currentLead = await one('leads', text(lead.id)), config = await autoConfig()
    if (!permitted(config, currentLead, settings.testLeadId) || Number(currentLead.kommo_id) !== last.kommoId
      || (!finalNotice && (currentLead.bot_enabled !== true || currentLead.tracking_opt_out_at))) return false
    if (Date.now() - Date.parse(activeLast.sentAt) >= 24 * 3_600_000) return false
    const remote = await getKommoLead(last.kommoId)
    if (!finalNotice && botStopped(remote)) return false
    const { count, error } = await db().from('messages').select('id', { count: 'exact', head: true })
      .eq('conversation_id', conversationId).eq('role', 'asesor').gt('sent_at', activeLast.sentAt)
    if (error) throw new Error('HUMAN_ACTIVITY_CHECK_FAILED')
    if (count) return false
    const { count: newer, error: newerError } = await db().from('lv_integration_events').select('id', { count: 'exact', head: true })
      .match(scope).eq('contact_key', `${last.kommoId}:${last.contactId}`).eq('status', 'pending')
    if (newerError) throw new Error('NEW_INPUT_CHECK_FAILED')
    return !newer
  }
  const deliveryStep = trace.start('message_delivery', 'Enviar respuesta', 'output', 'kommo.ts · register_outbound_message', {
    provider: 'kommo_salesbot', response_length: reply.length,
  })
  if (!await authorized()) {
    trace.finish(deliveryStep, 'paused', { action: 'paused_before_reply', reason: 'AUTHORIZATION_CHANGED' })
    return { action: 'paused_before_reply' }
  }
  // Un envío de visita incierto podría reutilizar campos o haber iniciado otra conversación.
  const { count, error } = await db().from('lv_outbox').select('id', { count: 'exact', head: true })
    .match(scope).eq('lead_id', lead.id).in('status', ['claimed', 'uncertain'])
  if (error || count) throw new Error('UNRESOLVED_VISIT_SEND')
  delivery.replyWriteAttempted = true
  await setKommoField(last.kommoId, 457014, reply)
  if (!await authorized()) {
    trace.finish(deliveryStep, 'paused', { action: 'paused_before_salesbot', reason: 'AUTHORIZATION_CHANGED' })
    return { action: 'paused_before_salesbot' }
  }
  await launchSalesbot(last.kommoId, 15578)
  if (continuation) audit.nutrition_continuation = { topic: continuation.topic, source_message_id: continuation.sourceMessageId }
  audit.conversation_tone = conversationToneAudit()
  await rpc('register_outbound_message', { p_conversation_id: conversationId, p_content: reply,
    p_model: greetingTemplate ? 'template:saludo_inicial' : process.env.OPENAI_MODEL, p_tool_calls: { source_message_id: activeLast.externalId,
      answered_message_ids: recoveringTurn() ? [] : [...pendingInputs.map(message => message.message_id), ...inbound.normalized.map(event => event.externalId)],
      provider_status: 'accepted', processing_ms: Date.now() - processingStarted, ...audit } })
  trace.finish(deliveryStep, 'succeeded', {
    action: 'accepted', provider: 'kommo_salesbot', response_registered: true, delivery_confirmed: false,
  })
  const stateStep = trace.start('state_persisted', 'Guardar estado y seguimientos', 'action', 'conversation.ts · nutrition.ts', {
    lead_id: text(lead.id),
  })
  const sentModels = Array.isArray(previousSummary._unit_models_sent) ? previousSummary._unit_models_sent : []
  const sentModel = object(audit.unit_model)
  const sentModelId = text(sentModel.url) && reply.includes(text(sentModel.url)) ? text(sentModel.unit_id) : ''
  const pendingRecovery = recoveringTurn()
  const reviewedOffer = text(object(object(audit.turn_completeness).semantic_review).offered_action)
  const interpretedPropertyContext = object(summary._property_context)
  const previousOfferedIds = Array.isArray(previousPropertyContext.offered_ids) ? previousPropertyContext.offered_ids : []
  const stillRelevantOffers = new Set(filterCatalog(turnCatalog, catalogQuery(interpretedPropertyContext.query)).map(unit => unit.id))
  const recoveryPropertyContext = { ...previousPropertyContext, ...interpretedPropertyContext,
    // Interpretation records the client's new category, filters, selection and
    // comparison target even if answering fails. New catalogue candidates are
    // not offers until their presentation is actually delivered.
    offered_ids: (Array.isArray(interpretedPropertyContext.offered_ids) ? interpretedPropertyContext.offered_ids : previousOfferedIds)
      .filter(id => previousOfferedIds.includes(id) && stillRelevantOffers.has(id)),
    last_reply: reply, pending_question: {} }
  const visitAlreadyHandled = audit.registration_verified === true || Object.keys(object(audit.completed_visit_action)).length > 0
  const pendingRequests = interpretation.requests.filter(request => !['tracking', 'courtesy'].includes(text(request.domain))
    && !(visitAlreadyHandled && request.domain === 'visit') && !(handoffNotice && request.domain === 'advisor'))
  summary._lead_introduction = rememberLeadIntroduction({ previous: previousSummary._lead_introduction,
    planned: summary._lead_introduction, profile: summary._lead_profile, reply, audit,
    accepted: true, followUpUsable: canTrackFollowUp, recovery: pendingRecovery })
  const savedSummary = { ...(Object.keys(summary).length ? summary : previousSummary), _commercial_memory: pendingRecovery ? memory : rememberCommercialReply(memory, reply),
    _follow_up_review: canTrackFollowUp ? {} : { usable: false, reply },
    _pending_requests: pendingRecovery ? pendingRequests : [],
    _response_recovery: pendingRecovery ? { ...object(object(audit.turn_completeness).recovery), source_message_id: activeLast.externalId,
      current_request: writingCurrent, objective: turnIntent.objective } : {},
    _last_operational_step: !canTrackFollowUp ? { kind: 'unverified_offer', reply } : pendingRecovery ? object(summary._last_operational_step || previousSummary._last_operational_step)
      : reviewedOffer === 'ambiguous' ? { kind: 'ambiguous_offer', reply }
      : reviewedOffer === 'information' ? { kind: 'information_offer', reply }
      : reviewedOffer === 'internal_advisor' ? { kind: 'internal_advisor_offer', reply }
      : reviewedOffer === 'financing_review' ? { kind: 'financing_consent', reply }
      : ((audit.source === 'financing' && audit.state === 'continuacion_pendiente') || audit.source === 'financing_question' || audit.source === 'budget_financing_guidance') && /(?:iniciar|iniciemos|revisión|revisemos)/i.test(reply) && /\?/.test(reply)
      ? { kind: 'financing_consent', reply } : {},
    ...(pendingRecovery ? { _unit_reference: propertyTurn.explicit === true && !propertyTurn.needsClarification
      ? propertyTurn.memory : previousSummary._unit_reference || {} } : audit.unit_reference ? { _unit_reference: audit.unit_reference } : {}),
    _property_context: pendingRecovery ? recoveryPropertyContext
      : minimalTurn ? { ...previousPropertyContext, last_reply: reply,
      ...(meaningfulText ? { pending_question: {}, focused_ids: [] } : {}) }
      : rememberPropertyReply(turnCatalog, summary._property_context || previousSummary._property_context, reply, audit),
    _pending_question: !meaningfulText ? previousSummary._pending_question || previousPropertyContext.pending_question || {} : audit.pending_question,
    _interpretation_pending: !meaningfulText && Boolean(text(rememberedQuestion.id)),
    _sales_memory: pendingRecovery ? { ...object(previousSummary._sales_memory), ...rememberSalesReply(previousSummary._sales_memory, context.historial, current, '') }
      : rememberSalesReply(previousSummary._sales_memory, context.historial, current, reply),
    _brand_introduced: previousSummary._brand_introduced === true || /la\s*vilet/i.test(reply) || (Array.isArray(context.historial) ? context.historial.map(object) : []).some(row => ['bot', 'asesor'].includes(text(row.role)) && /la\s*vilet/i.test(text(row.content))),
    _unit_models_sent: [...new Set([...sentModels, ...(sentModelId ? [sentModelId] : [])])] }
  const { error: memoryError } = await db().from('conversations').update({ summary: JSON.stringify(savedSummary) }).match(scope).eq('id', conversationId)
  if (text(declaredProfile.full_name) && text(declaredProfile.full_name) !== text(lead.name)) {
    const { error } = await db().from('leads').update({ name: text(declaredProfile.full_name) }).match(scope).eq('id', text(lead.id))
    trace.add('lead_profile_saved', 'Guardar nombre declarado', 'action', 'conversation.ts', error ? 'failed' : 'succeeded', {},
      { name_saved: !error, residence_saved_in_conversation: !memoryError }, error ? 'LEAD_DECLARED_NAME_SAVE_FAILED' : undefined)
  }
  // A scheduling failure must not mark an already accepted reply as uncertain.
  let nutrition: Row
  try { nutrition = pendingRecovery ? { scheduled: false, reason: 'response_pending_validation' } : businessScope.kind === 'out_of_scope' || businessScope.uncertain ? { scheduled: false, reason: 'outside_property_conversation' } : await scheduleNutrition24h(text(lead.id), conversationId, activeLast.externalId) }
  catch { nutrition = { scheduled: false, reason: 'schedule_failed' } }
  let nutritionWeekOne: Row
  try { nutritionWeekOne = pendingRecovery ? { scheduled: false, reason: 'response_pending_validation' } : businessScope.kind === 'out_of_scope' || businessScope.uncertain ? { scheduled: false, reason: 'outside_property_conversation' } : await scheduleNutritionWeekOne(text(lead.id), conversationId, activeLast.externalId) }
  catch { nutritionWeekOne = { scheduled: false, reason: 'schedule_failed' } }
  let nutritionLater: Row
  try { nutritionLater = pendingRecovery ? { scheduled: false, reason: 'response_pending_validation' } : businessScope.kind === 'out_of_scope' || businessScope.uncertain ? { scheduled: false, reason: 'outside_property_conversation' } : await scheduleNutritionLater(text(lead.id), conversationId, activeLast.externalId) }
  catch { nutritionLater = { scheduled: false, reason: 'schedule_failed' } }
  trace.finish(stateStep, memoryError ? 'failed' : 'succeeded', {
    memory_saved: !memoryError,
    nutrition_24h: object(nutrition).scheduled === true,
    nutrition_week_one: object(nutritionWeekOne).scheduled === true,
    nutrition_later: object(nutritionLater).scheduled === true,
  }, memoryError ? 'MEMORY_SAVE_FAILED' : undefined)
  return { action: 'accepted', leadId: lead.id, ...audit, memory_saved: !memoryError, nutrition, nutrition_week_one: nutritionWeekOne, nutrition_later: nutritionLater }
}
