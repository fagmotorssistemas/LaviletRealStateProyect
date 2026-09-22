import { currentTopicReply } from './current-topic'
import { withConversationTone, conversationToneAudit } from './tone-settings'
import { visitTruthReply } from './visit-copy'
import { readinessInvitation, readinessPlaceClarification, type ProjectReadiness } from '@/lib/inmobiliaria/projectReadiness'
import { protectedSentences } from './turn-completeness'
import 'server-only'
import { activePrompt, aiJson, mediaText } from './ai'
import { OpenAIRequestError } from './openai-request'
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
import { variedReplyOpening } from './response-openings'
import { acceptedPriceOption, asksUnitPrice, unitPriceQuote, priceReplyIssues } from './price-reply'
import { scheduleNutrition24h } from './nutrition'
import { scheduleNutritionWeekOne } from './nutrition-week-one'
import { scheduleNutritionLater } from './nutrition-later'
import { nutritionContinuation } from './nutrition-week-one-rules'
import { brochureReply, BROCHURE_URL, launchVisitReply, vehicleScopeReply, wantsBrochure } from './project-material'
import { salesSubject } from './sales-subject'
import { classifyBusinessScope, type BusinessScopeDecision } from './business-scope'
import { financingFieldAnswer, financingCollectionIssues } from './financing-continuation'
import { directReply } from './direct-reply'
import { sectorClaimsReply } from './commercial-accuracy'
import { commercialEngagement, passiveSalesCopy, passiveSalesRules } from './commercial-engagement'
import { operationalReply } from './operational-copy'
import { locationAnswer, locationRequestKind, withVisitLocation } from './visit-location'
import { commercialCoverageIssues, commercialTurnTopics } from './multi-topic-turn'
import { completeTurnAnswer, turnAnswerFacts } from './turn-answer'
import { selectedVisitOption } from './visit-choice'
import { visitParserReady } from './visit-parser-health'
import { visitOptionsList } from '@/lib/inmobiliaria/visitProposalOptions'
import { asksForHouse, houseProductReply } from './product-fit'
import { declinesAllVisitAlternatives } from './visit-escalation'
import { completeTurnReply } from './turn-completeness'
import { validateCatalogReply } from './catalog-dialogue'
import { advisorOwnsConversation } from './human-attention'
import { traceForEvents, traceText, type AutomationExecutionTrace } from './execution-trace'
import { financingPrerequisiteReply } from './property-selection'
import { answersPendingQuestion, normalizedPendingQuestion, pendingQuestionFromReply } from './turn-semantics'
import { responsePlan } from './response-plan'
import { CONVERSATION_CONTRACT_VERSION, interpretConversationTurn, rememberInterpretedTurn } from './turn-interpretation'
import { decisionRecord, catalogSnapshot, type DecisionRecord } from './decision-record'
import { withAIExecutionTrace } from './ai-execution-trace'
import { assessMissingFacts } from './coverage-evidence'

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

export async function processConversation(rows: Row[], guard: Guard) {
  const trace = traceForEvents(rows)
  try {
    const result = await withAIExecutionTrace(trace, () => withConversationTone(() => processConversationWithTone(rows, guard, trace)))
    trace.add('execution_exit', 'Resultado de la ejecución', 'output', 'conversation.ts',
      ['accepted', 'confirmed'].includes(text(result.action)) ? 'succeeded' : 'skipped', {},
      { action: result.action, reason: object(result).reason || result.action })
    return result
  } catch (error) {
    trace.failOpenSteps(error)
    throw error
  } finally {
    await trace.flush()
  }
}
async function processConversationWithTone(rows: Row[], guard: Guard, trace: AutomationExecutionTrace) {
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
  let lead = await one('leads', text(inbound.registration.lead_id))
  trace.finish(inboundStep, 'succeeded', { lead_identified: true, conversation_identified: true, media_read_failed: inbound.mediaFailed })
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
        recentOfferText,
        tenantId: scope.tenant_id,
        projectId: scope.project_id,
      })
    } catch {
      /* soft-fail */
    }
    return { action: 'bot_paused' }
  }
  const activeLast = inbound.normalized[inbound.normalized.length - 1]
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
  trace.finish(contextStep, 'succeeded', {
    history_messages: Array.isArray(context.historial) ? context.historial.length : 0,
    has_project_context: Boolean(context.proyecto),
    has_visit_context: Boolean(context.cita || context.propuesta_visita),
  })
  const continuation = !inbound.mediaFailed ? nutritionContinuation(current, context.historial) : null
  if (continuation) current = continuation.message
  const originalTurn = current
  let reply = '', finalNotice = false, handoffNotice = '', pendingCommercialHandoff = ''
  let appliedVisitAction: Row | null = null
  let summary: Row = {}, audit: Row = {}, greetingTemplate = false
  let turnCatalog: Row[] = [], propertyTurn: Row = {}, currentSemantics: Row = {}
  let greeting = !inbound.mediaFailed && isGreetingOnly(current)
  const previousSummary = object(conversationBefore.summary)
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
      : await classifyBusinessScope(current, context.historial, previousSummary._brand_introduced === true)
    if (businessScope.kind === 'out_of_scope') {
      reply = businessScope.reply
      audit = { source: 'business_out_of_scope', business_scope: businessScope.kind }
    } else if (businessScope.uncertain) {
      reply = 'Disculpe, no alcancé a entender bien su consulta. ¿Qué le gustaría saber sobre La Vilet?'
      audit = { source: 'scope_clarification', business_scope: 'uncertain' }
    } else if (businessScope.kind === 'mixed') current = businessScope.property_message
  }
  trace.finish(scopeStep, 'succeeded', {
    scope: businessScope.kind,
    uncertain: businessScope.uncertain,
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
      assigned_advisor: Boolean(lead.assigned_advisor_id),
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
    const info=await commercialContext(lead,context.historial)
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
  const pendingQuestion = text(rememberedQuestion.question) && (lastResponse.includes(text(rememberedQuestion.question)) || previousSummary._interpretation_pending === true)
    ? rememberedQuestion
    : pendingQuestionFromReply(lastResponse)
  const interpretation = await interpretConversationTurn({
    resumen: previousSummary, historial: context.historial,
    historial_reciente: Array.isArray(context.historial) ? context.historial.slice(-8) : [],
    tema_actual: salesSubject(current, context.historial), alcance_negocio: businessScope.kind,
    ultima_pregunta: state.ultima_respuesta, pregunta_pendiente: pendingQuestion,
    contexto_propiedades: previousPropertyContext, catalogo_unidades: turnCatalog,
    propuestas: proposals, coordinacion_visita: visitDraft, financiamiento: finance,
    unidades_identificadas: initialReference.matches, mensaje_actual: originalTurn,
    mensaje_accion: businessScope.kind === 'out_of_scope' || businessScope.uncertain ? '' : current,
  }, { aiJson, activePrompt, onPromptRevision: revision => trace.setVersions({ promptVersions: { extractor_eventos: revision } }) })
  const { extracted, semantics: turnSemantics } = interpretation
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
  summary = { ...rememberInterpretedTurn(previousSummary, originalTurn, extracted),
    _unit_reference: minimalTurn ? previousSummary._unit_reference || {} : reference.memory,
    _property_context: minimalTurn ? previousPropertyContext : reference.context }
  extracted.turn_semantics = turnSemantics
  if(financeContinuation) Object.assign(extracted,financeContinuation)
  const financeInput = financingInputs(extracted, current, text(state.ultima_respuesta), finance, object(previousSummary._last_operational_step))
  extracted.financing_consent = financeInput.consent
  extracted.financing_partner = financeInput.partner
  const collectingVisit = visitDraft?.status === 'collecting'
  const semanticVisit = object(extracted.visit_intent)
  const semanticVisitRequest = semanticVisit.kind === 'request_visit' && !hasUnrelatedAppointmentTarget(current)
  // A semantic acceptance is actionable only while a durable visit draft is
  // already collecting details. This prevents a bare "sí" from starting a
  // visit while financing, pricing or another feature is active.
  const semanticVisitAcceptance = (semanticVisit.kind === 'accept_visit_preference' && collectingVisit)
    || answersPendingQuestion(turnSemantics, 'visit_invitation', 'affirmative')
  const explicitVisitRequest = explicitlyRequestsVisit(current)
  const invitationAccepted = acceptsVisitInvitation(current, text(state.ultima_respuesta))
  const visitSignal = explicitVisitRequest || semanticVisitRequest || semanticVisitAcceptance || invitationAccepted
  const canRequestVisit = !modelOnly && !asksVisitStatus(current, text(state.ultima_respuesta)) && (!repair || isVisitDetail(current))
    && (!isCourtesyOnly(current) || semanticVisitAcceptance || invitationAccepted)
    && (visitSignal || collectingVisit)
  if (canRequestVisit && visitSignal) extracted.events = [...new Set([...(extracted.events as string[]), 'requested_visit'])]
  if (!canRequestVisit) extracted.events = (extracted.events as string[]).filter(e => e !== 'requested_visit')
  const priceTurn = asksUnitPrice(current, ['property', 'mixed'].includes(businessScope.kind))
  const financeTurn = financeInput.consent === true || (!priceTurn && isFinancingTurn(extracted, current, text(state.ultima_respuesta), financeInput))
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
    if ((extracted.events as string[]).length) await rpc('apply_lead_events', { p_lead_id: lead.id, p_events: extracted.events, p_source_message_id: activeLast.externalId })
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
  const operationalTurn = extracted.requested_advisor === true || financeTurn
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
    const info = { ...await commercialContext(lead, context.historial), alcance_negocio: businessScope.kind,
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
    if (!reply && isProjectInformationRequest(current)
      && !/precio|valor|financ|credito|cuanto|dormitorio|\b\d{3}\b|visita|cita|agendar|constructora|entrega|ubicacion|sector|alrededor|cerca/i.test(current)) {
      const info = await commercialContext(lead, context.historial)
      reply = projectInformationReply(info, current, BROCHURE_URL)
      if (reply) audit = { source: 'project_overview', brochure_sent: true }
    }
    if (!reply && wantsBrochure(current, context.historial)) {
      const info = await commercialContext(lead, context.historial)
      reply = brochureReply(current, context.historial, text(info.modo_comercial),!!info.estado_proyecto)
      if (reply) audit = { source: 'brochure', brochure_sent: true }
    }
    if (!reply && acceptsUnitOptions(current, text(state.ultima_respuesta))) {
      const accepted = acceptedPriceOption(await commercialContext(lead, context.historial), current, previousSummary)
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
      const info = await commercialContext(lead, context.historial)
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
  if (!reply && !greeting && !modelOnly && proposals.length) {
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
        const visitInfo = await commercialContext(lead, context.historial)
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
      const financeAnswer = priceTurn || financeInput.consent === true ? '' : financingQuestionReply(current, finance.partners, text(state.ultima_respuesta))
      let financePrerequisite = ''
      if (financeTurn && !financeAnswer) {
        const selectionInfo = { ...await commercialContext(lead, context.historial), historial: context.historial,
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
        const visitInfo = await commercialContext(lead, context.historial)
        const quote = priceTurn ? unitPriceQuote({ ...visitInfo, alcance_negocio: businessScope.kind, financiamiento: finance, referencia_unidad: reference }, current, summary) : null
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
        const info = { ...await commercialContext(lead, context.historial), alcance_negocio: businessScope.kind, propuestas: proposals,
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
    const info = await commercialContext(lead, context.historial)
    if(info.estado_proyecto && /¿Qué día y a qué hora le gustaría venir\?/.test(reply)) {
      const invitation=readinessInvitation(info.estado_proyecto as ProjectReadiness).replace('¿Le gustaría','Podemos').replace('?','.')
      reply=reply.replace('¿Qué día y a qué hora le gustaría venir?',`${invitation} ¿Qué día y hora le convendrían?`)
    } else if (!info.estado_proyecto && info.modo_comercial === 'lanzamiento') reply = launchVisitReply(reply, object(info.politica_visitas).launchDestination === 'office' ? 'office' : 'site')
  }
  if (['financing', 'financing_question', 'financing_handoff', 'visit_intake', 'visit_status'].includes(text(audit.source))) {
    const info = { ...await commercialContext(lead, context.historial), alcance_negocio: businessScope.kind, financiamiento: await financingContext(lead) }
    const prepared = turnAnswerFacts(info, current, previousSummary)
    const completed = completeTurnAnswer(reply, prepared)
    reply = completed.reply
    // The semantic check below can answer topics outside this small factual
    // checklist. Only an actual information gap should trigger human help.
    audit = { ...audit, answered_topics: prepared.topics.filter(topic => !completed.missing.includes(topic)) }
  }
  // A specialist may protect its action, but must still account for other requests in the turn.
  if (interpretation.requests.length > 1) audit.coverage_complete = false
  const plannedResponse = responsePlan(reply, audit)
  const catalogBaseReply = audit.verified_catalog === true ? reply : ''
  audit = { ...audit, response_plan: plannedResponse, turn_contract: CONVERSATION_CONTRACT_VERSION,
    interpretation: interpretation.diagnostic }
  const commercialPromptRoute = !text(audit.source) || ['commercial', 'verified_information_gap'].includes(text(audit.source))
  const dialogueStep = trace.add('dialogue_decision', 'Decidir la respuesta y la siguiente pregunta', 'decision', 'conversation.ts · catalog-dialogue.ts', 'succeeded',
    { primary_intent: turnSemantics.primary_intent, operation: object(turnSemantics.property).operation },
    { source: text(audit.source) || 'commercial', action: text(audit.action) || null, catalog_query: audit.catalog_query,
      result_unit_ids: object(audit.catalog_results).unit_ids, pending_question: audit.pending_question,
      coverage_locked: plannedResponse.locked,
      catalog_snapshot: catalogSnapshot(object(audit.catalog_results).units), catalog_comparison: audit.catalog_comparison,
      base_preview: traceText(reply, 1000),
      decision: decisionRecord({ rule_id: `response.${text(audit.source) || 'commercial'}`, origin: audit.verified_catalog === true ? 'catalog' : commercialPromptRoute ? 'model' : 'policy',
        caused_by_step: audit.verified_catalog === true ? catalogStep : semanticStep,
        reason: audit.verified_catalog === true ? 'La consulta al catálogo determina las opciones y los datos de esta respuesta.' : 'La intención y el estado de la conversación determinan esta ruta de respuesta.',
        facts: { source: text(audit.source) || 'commercial', coverage_locked: plannedResponse.locked }, outcome: 'base_reply_prepared',
        setting: audit.verified_catalog === true
          ? { kind: 'code', label: 'Presentación del catálogo', source: 'catalog-dialogue.ts' }
          : commercialPromptRoute
            ? { kind: 'prompt', label: 'Conversación y orientación comercial', href: '/inmobiliaria/automatizacion/guion#respuestas', source: 'sdr.ts · respuesta_comercial · revisor_respuesta' }
            : { kind: 'code', label: 'Ruta especializada de respuesta', source: `conversation.ts · ruta ${text(audit.source)}` } }) })
  if (!plannedResponse.locked && ['visit_intake', 'visit_status', 'financing', 'financing_question', 'financing_handoff', 'budget_financing_guidance', 'unit_price', 'budget_guidance', 'interest_after_model', 'product_clarification', 'team_attendance'].includes(text(audit.source))) {
    await guard()
    const engagement = commercialEngagement(current, context.historial, previousSummary._sales_memory)
    const composed = await operationalReply(reply, current, context.historial, { ...audit, reglas_interes: passiveSalesRules(engagement) })
    const complete = !commercialCoverageIssues(composed.reply, commercialTurnTopics(current, context.historial, ['property', 'mixed'].includes(businessScope.kind))).length
    const respectsInterest = passiveSalesCopy(composed.reply, current, engagement) === composed.reply
    if (complete && respectsInterest) reply = composed.reply
    audit = { ...audit, ai_operational_copy: complete && respectsInterest && composed.generated, passive_sales: engagement.passive }
  }
  if (!finalNotice && !plannedResponse.locked && !['minimal_greeting', 'courtesy', 'media_not_understood', 'media_clarification', 'business_out_of_scope', 'vehicle_out_of_scope', 'scope_clarification', 'commercial_location_budget'].includes(text(audit.source))) {
    await guard()
    const info = { ...await commercialContext(lead, context.historial), alcance_negocio: businessScope.kind, financiamiento: await financingContext(lead), propuestas: proposals,
      estado_operativo: audit, coordinacion_visita: visitDraft, referencia_unidad: propertyTurn,
      property_context: object(propertyTurn.context), semantica_turno: currentSemantics,
      solicitudes_interpretadas: interpretation.requests,
      ...(audit.verified_catalog === true ? { catalogo: object(audit.catalog_results).units, catalog_results: audit.catalog_results, catalog_query: audit.catalog_query } : {}) }
    // The map URL is not a suggestion the writer may add opportunistically.
    if (!locationRequestKind(current)) delete (info as Row).ubicacion
    const quote = unitPriceQuote(info, current, Object.keys(summary).length ? summary : previousSummary)
    const coverageStep = trace.start('response_coverage', 'Revisar la respuesta y los datos pendientes', 'decision', 'turn-completeness.ts', {
      base_preview: traceText(reply, 1000), source: text(audit.source) || 'commercial',
      catalog_coverage: audit.catalog_coverage,
    })
    const reviewed = await completeTurnReply({ current, history: context.historial, baseReply: reply,
      verified: { ...info, _sales_memory: previousSummary._sales_memory, respuesta_precio_verificada: quote?.reply || null, precios_del_turno: quote?.prices || [] }, audit,
      preserveOperationalQuestion: ['financing', 'visit_intake', 'visit_status', 'visit_option_choice', 'unit_alternative', 'unit_alternative_journey', 'project_overview', 'project_information_choice'].includes(text(audit.source)) })
    const invalidPrice = reviewed.changed && quote?.quoted === true && priceReplyIssues(reviewed.reply, info, current, quote.prices).includes('unsupported_fact')
    const catalogValidation = validateCatalogReply(reviewed.reply, audit)
    if (!invalidPrice && catalogValidation.valid) {
      if(!financingCollectionIssues(reviewed.reply,audit,current)) reply = reviewed.reply
    }
    else {
      // Reject the rewrite, not the conversation. A valid catalogue quote does
      // not become an information gap because an AI draft changed its prices.
      // Keep genuine missing facts flagged by the review (e.g. an unknown fee).
      reviewed.audit = { ...reviewed.audit, status: invalidPrice ? 'rejected_price_guard' : 'rejected_catalog_guard',
        candidate_requests: reviewed.audit.requests, requests: [],
        issues: [invalidPrice ? 'unsupported_price_rewrite' : catalogValidation.reason || 'unsupported_catalog_rewrite'], retained_verified_reply: true }
      const originalGaps = (Array.isArray(reviewed.audit.candidate_requests) ? reviewed.audit.candidate_requests : []).map(object)
        .filter(request => request.base_status === 'missing_fact').map(request => text(request.fragment)).filter(Boolean)
      originalGaps.push(...(Array.isArray(reviewed.audit.missing_fact_fragments) ? reviewed.audit.missing_fact_fragments : [])
        .filter((fragment): fragment is string => typeof fragment === 'string' && current.includes(fragment)))
      reviewed.unresolved = assessMissingFacts(originalGaps, audit).unresolved
      reviewed.needsAdvisor = reviewed.unresolved.length > 0
    }
    const grounded = assessMissingFacts(reviewed.unresolved, audit, (Array.isArray(reviewed.audit.requests) ? reviewed.audit.requests : []).map(object))
    reviewed.unresolved = grounded.unresolved
    reviewed.needsAdvisor = reviewed.needsAdvisor && grounded.unresolved.length > 0
    reviewed.audit = { ...reviewed.audit, needs_advisor: reviewed.needsAdvisor, unresolved: reviewed.unresolved,
      handoff_assessments: [...(Array.isArray(reviewed.audit.handoff_assessments) ? reviewed.audit.handoff_assessments : []), ...grounded.assessments] }
    const requests = Array.isArray(reviewed.audit.requests) ? reviewed.audit.requests.map(object) : []
    const resolvedFromContext = !invalidPrice && catalogValidation.valid && !reviewed.needsAdvisor && reviewed.audit.status === 'checked'
      && requests.length > 0 && requests.every(request => ['answered', 'clarification', 'outside_scope'].includes(text(request.status)))
    const needsCommercialHandoff = !!pendingCommercialHandoff && !resolvedFromContext
    trace.finish(coverageStep, 'succeeded', {
      status: reviewed.audit.status, requests: reviewed.audit.requests, issues: reviewed.audit.issues,
      missing_fact_fragments: reviewed.audit.missing_fact_fragments, handoff_assessments: reviewed.audit.handoff_assessments,
      unresolved: reviewed.unresolved, needs_advisor: reviewed.needsAdvisor || needsCommercialHandoff,
      base_preview: reviewed.audit.base_preview, proposed_preview: reviewed.audit.proposed_preview,
      final_preview: traceText(reply, 1000),
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
    const truthfulVisitReply = visitTruthReply(reply, info, audit, proposals, protectedSentences)
    if (truthfulVisitReply !== reply) audit.visit_copy_guard = true
    reply = truthfulVisitReply
    const visitCoordinationHandled = audit.source === 'visit_intake'
      && ['collecting', 'submitted', 'closed_day', 'outside_hours', 'past'].includes(text(audit.action))
      && (!reviewed.unresolved.length || reviewed.unresolved.every(item => /\b(?:visitas?|citas?|fechas?|horas?|horarios?|agenda|agendar|reagendar|propuestas?)\b/i.test(item)))
    if (((reviewed.needsAdvisor && !visitCoordinationHandled) || needsCommercialHandoff) && !finalNotice) {
      const reason = reviewed.unresolved.length ? 'resolver consultas concretas pendientes: ' + reviewed.unresolved.join(' | ').slice(0, 650) : pendingCommercialHandoff
      const notice = await transferToAdvisor(reason, { rule_id: 'advisor.verified_information_gap', origin: 'coverage_review', caused_by_step: coverageStep,
        facts: { unresolved: reviewed.unresolved, review_status: reviewed.audit.status, pending_commercial_handoff: pendingCommercialHandoff || null } })
      reply = reply.replace(/\s*¿[^?]+\?\s*$/, '').trim() + '\n\n' + notice
      audit = { ...audit, additional_questions_handoff: true }
    }
  }
  // A writer may improve the answer, but cannot hide a handoff already performed.
  if (handoffNotice && !reply.includes(handoffNotice)) {
    reply = reply.replace(/\s*¿[^?]+\?\s*$/, '').trim() + '\n\n' + handoffNotice
  }
  if (!['business_out_of_scope', 'vehicle_out_of_scope', 'media_not_understood', 'scope_clarification', 'location_handoff'].includes(text(audit.source)) && locationRequestKind(current)) {
    reply = withVisitLocation(reply, await commercialContext(lead, context.historial), true)
  }
  if (businessScope.kind === 'mixed' && businessScope.reply) reply = businessScope.reply + '\n\n' + reply
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
  const direct = directReply(currentTopicReply(sectorClaimsReply(reply),current),current)
  if(direct !== reply) audit.direct_reply_guard = true
  reply = naturalConversationReply(variedReplyOpening(direct, context.historial), text(lead.name), turnGreeting, activeLast.sentAt)
  // The last prose transformation is checked too, before any external send.
  const finalCatalogValidation = validateCatalogReply(reply, audit)
  if (!finalCatalogValidation.valid && catalogBaseReply) {
    reply = naturalConversationReply(catalogBaseReply, text(lead.name), turnGreeting, activeLast.sentAt)
    if (locationRequestKind(current)) reply = withVisitLocation(reply, await commercialContext(lead, context.historial), true)
    if (businessScope.kind === 'mixed' && businessScope.reply) reply = businessScope.reply + '\n\n' + reply
    if (handoffNotice && !reply.includes(handoffNotice)) reply = reply.replace(/\s*¿[^?]+\?\s*$/, '').trim() + '\n\n' + handoffNotice
    audit.final_catalog_guard = finalCatalogValidation.reason || 'unsupported_catalog_rewrite'
  }
  const declaredPending = normalizedPendingQuestion(audit.pending_question, turnCatalog)
  // A protected catalog question retains its referent; other routes migrate via the legacy classifier.
  const replyPending = text(declaredPending.question) && reply.includes(text(declaredPending.question))
    ? declaredPending : pendingQuestionFromReply(reply)
  audit.pending_question = reply.includes('?') ? replyPending : {}
  if (!reply.trim() || reply.length > 3000) throw new Error('EMPTY_OR_LONG_REPLY')
  trace.finish(validationStep, 'succeeded', {
    response_length: reply.length,
    response_preview: traceText(reply, 280),
    direct_reply_adjusted: audit.direct_reply_guard === true,
    turn_completeness_checked: Boolean(audit.turn_completeness),
    coverage_status: text(object(audit.turn_completeness).status) || (plannedResponse.locked ? 'protected_operational_reply' : 'deterministic_reply'),
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
  await setKommoField(last.kommoId, 457014, reply)
  if (!await authorized()) {
    trace.finish(deliveryStep, 'paused', { action: 'paused_before_salesbot', reason: 'AUTHORIZATION_CHANGED' })
    return { action: 'paused_before_salesbot' }
  }
  await launchSalesbot(last.kommoId, 15578)
  if (continuation) audit.nutrition_continuation = { topic: continuation.topic, source_message_id: continuation.sourceMessageId }
  audit.conversation_tone = conversationToneAudit()
  await rpc('register_outbound_message', { p_conversation_id: conversationId, p_content: reply,
    p_model: greetingTemplate ? 'template:saludo_inicial' : process.env.OPENAI_MODEL, p_tool_calls: { source_message_id: activeLast.externalId, provider_status: 'accepted', processing_ms: Date.now() - processingStarted, ...audit } })
  trace.finish(deliveryStep, 'succeeded', {
    action: 'accepted', provider: 'kommo_salesbot', response_registered: true, delivery_confirmed: false,
  })
  const stateStep = trace.start('state_persisted', 'Guardar estado y seguimientos', 'action', 'conversation.ts · nutrition.ts', {
    lead_id: text(lead.id),
  })
  const sentModels = Array.isArray(previousSummary._unit_models_sent) ? previousSummary._unit_models_sent : []
  const sentModelId = text(object(audit.unit_model).unit_id)
  const savedSummary = { ...(Object.keys(summary).length ? summary : previousSummary), _commercial_memory: rememberCommercialReply(memory, reply),
    _pending_requests: [],
    _last_operational_step: ((audit.source === 'financing' && audit.state === 'continuacion_pendiente') || audit.source === 'financing_question' || audit.source === 'budget_financing_guidance') && /(?:iniciar|iniciemos|revisión|revisemos)/i.test(reply) && /\?/.test(reply)
      ? { kind: 'financing_consent', reply } : {},
    ...(audit.unit_reference ? { _unit_reference: audit.unit_reference } : {}),
    _property_context: minimalTurn ? { ...previousPropertyContext, last_reply: reply,
      ...(meaningfulText ? { pending_question: {}, focused_ids: [] } : {}) }
      : rememberPropertyReply(turnCatalog, summary._property_context || previousSummary._property_context, reply, audit),
    _pending_question: !meaningfulText ? previousSummary._pending_question || previousPropertyContext.pending_question || {} : audit.pending_question,
    _interpretation_pending: !meaningfulText && Boolean(text(rememberedQuestion.id)),
    _sales_memory: rememberSalesReply(previousSummary._sales_memory, context.historial, current, reply),
    _brand_introduced: previousSummary._brand_introduced === true || /la\s*vilet/i.test(reply) || (Array.isArray(context.historial) ? context.historial.map(object) : []).some(row => ['bot', 'asesor'].includes(text(row.role)) && /la\s*vilet/i.test(text(row.content))),
    _unit_models_sent: [...new Set([...sentModels, ...(sentModelId ? [sentModelId] : [])])] }
  const { error: memoryError } = await db().from('conversations').update({ summary: JSON.stringify(savedSummary) }).match(scope).eq('id', conversationId)
  // A scheduling failure must not mark an already accepted reply as uncertain.
  let nutrition: Row
  try { nutrition = businessScope.kind === 'out_of_scope' || businessScope.uncertain ? { scheduled: false, reason: 'outside_property_conversation' } : await scheduleNutrition24h(text(lead.id), conversationId, activeLast.externalId) }
  catch { nutrition = { scheduled: false, reason: 'schedule_failed' } }
  let nutritionWeekOne: Row
  try { nutritionWeekOne = businessScope.kind === 'out_of_scope' || businessScope.uncertain ? { scheduled: false, reason: 'outside_property_conversation' } : await scheduleNutritionWeekOne(text(lead.id), conversationId, activeLast.externalId) }
  catch { nutritionWeekOne = { scheduled: false, reason: 'schedule_failed' } }
  let nutritionLater: Row
  try { nutritionLater = businessScope.kind === 'out_of_scope' || businessScope.uncertain ? { scheduled: false, reason: 'outside_property_conversation' } : await scheduleNutritionLater(text(lead.id), conversationId, activeLast.externalId) }
  catch { nutritionLater = { scheduled: false, reason: 'schedule_failed' } }
  trace.finish(stateStep, memoryError ? 'failed' : 'succeeded', {
    memory_saved: !memoryError,
    nutrition_24h: object(nutrition).scheduled === true,
    nutrition_week_one: object(nutritionWeekOne).scheduled === true,
    nutrition_later: object(nutritionLater).scheduled === true,
  }, memoryError ? 'MEMORY_SAVE_FAILED' : undefined)
  return { action: 'accepted', leadId: lead.id, ...audit, memory_saved: !memoryError, nutrition, nutrition_week_one: nutritionWeekOne, nutrition_later: nutritionLater }
}
