import 'server-only'
import { activePrompt, aiJson, mediaText } from './ai'
import { assertLive, automationSettings } from './config'
import { normalizeEvents, validateIntent } from './conversation-rules'
import { autoConfig, db, object, one, permitted, rpc, scope, text, type Row } from './data'
import { botStopped, getKommoContact, getKommoLead, launchSalesbot, setKommoField } from './kommo'
import { inboundFromRow, type Inbound } from './webhook'
import type { Guard } from './visits'
import { isGreetingOnly, qualifiedFacts, sdrState } from './sdr-rules'
import { commercialContext, commercialReply, publishedUnitCatalog } from './sdr'
import { appendUnitModel, unitModelDelivery } from './unit-model'
import { isUnitVisualRequest } from './unit-visual-request'
import { greetingForTurn, isCourtesyOnly, minimalGreeting, naturalConversationReply } from './conversation-style'

import { financingContext, financingInputs, financingReply, financingQuestionReply, isFinancingTurn, avoidFinancingRepeat, priceFinancingReply } from './financing'
import { intakeReply, isVisitDetail, needsVisitHelp, visitTurnIntent, visitBusinessHoursReply } from './visit-intake'
import { asksVisitStatus, asksTeamAttendance, teamAttendanceReply, declinedFollowup, explicitlyRequestsVisit, isConversationRepair, TURN_RULES, visitStatusReply } from './turn-routing'
import { commercialMemory, rememberCommercialReply, projectOverviewReply } from './commercial-experience'
import { resolveCatalogReference } from './catalog-reference'
import { fabricatedActionRequest, mediaClarificationReply } from './clarification'
import { acceptsUnitOptions, acceptsVisitInvitation, rememberSalesReply } from './sales-policy'
import { mediaFailureReply, unreadMediaMarker } from './media-format'
import { variedReplyOpening } from './response-openings'
import { acceptedPriceOption, asksUnitPrice, unitPriceQuote, priceReplyIssues } from './price-reply'
import { scheduleNutrition24h } from './nutrition'
import { brochureReply, BROCHURE_URL, launchVisitReply, vehicleScopeReply, wantsBrochure } from './project-material'
import { salesSubject } from './sales-subject'
import { classifyBusinessScope, type BusinessScopeDecision } from './business-scope'
import { operationalReply } from './operational-copy'
import { locationAnswer, locationRequestKind, withVisitLocation } from './visit-location'
import { commercialCoverageIssues, commercialTurnTopics } from './multi-topic-turn'
import { completeTurnAnswer, turnAnswerFacts } from './turn-answer'
import { selectedVisitOption } from './visit-choice'
import { visitParserReady } from './visit-parser-health'
import { visitOptionsList } from '@/lib/inmobiliaria/visitProposalOptions'
import { asksForHouse, houseProductReply } from './product-fit'
import { declinesAllVisitAlternatives, escalateVisitCoordination } from './visit-escalation'
import { completeTurnReply } from './turn-completeness'

export const visitIntentPrompt = `Clasifique la respuesta a una propuesta de visita usando el historial cronológico.
Devuelva JSON {"intent":"accept|counterproposal|reject|cancel|question|unclear|opt_out"}.
accept: aceptación inequívoca y sin condiciones de la propuesta enviada y vigente, status=awaiting_client.
Un sí/ok solo acepta si responde directamente a esa propuesta o a una aclaración explícita de confirmación.
Si hay otra pregunta posterior, dudas, condiciones, cambio de horario o una pregunta adicional, no acepte.
counterproposal: pide otro día/hora. reject: rechaza ese horario. cancel: pide cancelar la visita completa.
question: pregunta sobre visita u otro tema. unclear: ambiguo, varias citas o falta evidencia.
opt_out: pide no recibir mensajes. Con propuesta null no asigne accept/cancel/reject/counterproposal.
Un saludo, una consulta comercial o cambiar de tema son question, aunque exista una cita pendiente. unclear se limita a respuestas ambiguas SOBRE la cita. Con status=awaiting_advisor, dar el horario solicitado es counterproposal, no accept. No confunda una solicitud de llamada con una visita.
Evalúe el turno completo, no solo su última frase. Si primero dice cancelar y después aclara que prefiere otro día, es counterproposal. «No puedo a esa hora, mejor a las 3» es counterproposal y conserva el día de la propuesta. «No puedo asistir» sin alternativa es cancel; «no puedo a esa hora» es reject. Un agradecimiento sin consulta ni decisión pendiente es question. Use los mensajes previos del cliente para entender respuestas parciales como «a las 4» después de «hoy».
No invente intervalos ni acciones ejecutadas.`

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
        mediaFailed = true
        mediaErrors.push(error instanceof Error && /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'MEDIA_PROCESSING_FAILED')
        content = [event.text, unreadMediaMarker(event.media)].filter(Boolean).join('\n')
      }
    }
    const result = object(await rpc('register_inbound_message', {
      p_tenant_id: scope.tenant_id, p_project_id: scope.project_id, p_phone: phone,
      p_name: text(contact.name) || event.name || 'Sin nombre', p_source: event.origin, p_channel: 'whatsapp',
      p_campaign: null, p_contact_id: String(event.contactId), p_kommo_id: event.kommoId,
      p_external_message_id: event.externalId, p_content: content, p_tracking_consent: false,
    }))
    if (!text(result.lead_id) || !text(result.conversation_id)) throw new Error('INBOUND_RPC_CONTRACT_MISMATCH')
    registration = result
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
  assertLive()
  const events = rows.map(row => inboundFromRow(row.payload)).sort((a, b) => a.sentAt.localeCompare(b.sentAt) || a.externalId.localeCompare(b.externalId))
  const last = events[events.length - 1]
  if (!last || events.some(e => e.kommoId !== last.kommoId || e.contactId !== last.contactId)) throw new Error('MIXED_CONVERSATION_BATCH')
  if (Date.now() - Date.parse(last.sentAt) >= 24 * 3_600_000) return { action: 'expired' }
  const initialConfig = await autoConfig()
  if (initialConfig.enabled !== true || initialConfig.dry_run !== false) return { action: 'disabled' }
  const settings = automationSettings()
  // En pruebas no crear ni procesar otros leads.
  const target = settings.testLeadId || (initialConfig.test_only === true ? text(initialConfig.test_lead_id) : null)
  if (target) { const l = await one('leads', target); if (Number(l.kommo_id) !== last.kommoId) return { action: 'outside_test_lead' } }
  const inbound = await register(events, guard)
  if (!inbound.hasNew) return { action: 'duplicate' }
  let lead = await one('leads', text(inbound.registration.lead_id))
  if (!permitted(initialConfig, lead, settings.testLeadId) || lead.bot_enabled !== true || inbound.stopped) return { action: 'bot_paused' }
  const activeLast = inbound.normalized[inbound.normalized.length - 1]
  let current = inbound.normalized.map(e => e.text).join('\n').slice(0, 30_000)
  const meaningfulText = current.replace(/\[Archivo no interpretado[^\]]*\]|\[Sticker recibido\]/g, '').trim()
  const processingStarted = Date.now()
  const context = object(await rpc('lv_app_conversation_context', { p_lead: lead.id, p_message: activeLast.externalId }))
  let reply = '', finalNotice = false
  let summary: Row = {}, audit: Row = {}, greetingTemplate = false
  let greeting = !inbound.mediaFailed && isGreetingOnly(current)
  const conversationBefore = await one('conversations', text(inbound.registration.conversation_id))
  const previousSummary = object(conversationBefore.summary)
  let businessScope: BusinessScopeDecision = { kind: 'neutral', property_message: current, reply: '', uncertain: false }
  if (!inbound.mediaFailed && meaningfulText && !greeting && !isCourtesyOnly(current)) {
    businessScope = await classifyBusinessScope(current, context.historial)
    if (businessScope.kind === 'out_of_scope') {
      reply = businessScope.reply
      audit = { source: 'business_out_of_scope', business_scope: businessScope.kind }
    } else if (businessScope.uncertain) {
      reply = 'Disculpe, no alcancé a entender bien su consulta. ¿Qué le gustaría saber sobre La Vilet?'
      audit = { source: 'scope_clarification', business_scope: 'uncertain' }
    } else if (businessScope.kind === 'mixed') current = businessScope.property_message
  }
  const modelOnly = isUnitVisualRequest(current) && !explicitlyRequestsVisit(current)
  async function transferToAdvisor(reason: string) {
    await guard()
    await rpc('handoff_lead', { p_lead_id: lead.id, p_reason: `${reason}. Consulta pendiente: ${current.slice(0, 650)}` })
    lead = await one('leads', text(lead.id))
    if (!['queued', 'assigned', 'acknowledged'].includes(text(lead.handoff_status))) throw new Error('HANDOFF_NOT_RECORDED')
    const { error } = await db().from('leads').update({ bot_enabled: false }).match(scope).eq('id', lead.id)
    if (error) throw new Error('HANDOFF_PAUSE_FAILED')
    await setKommoField(last.kommoId, 451530, 'true')
    finalNotice = true
    return lead.handoff_status === 'queued'
      ? 'He dejado su consulta en la bandeja del equipo para que un asesor le ayude con ese detalle. Podrá continuar por aquí sin volver a explicar lo que busca.'
      : 'He pasado su consulta a un asesor de nuestro equipo para que le ayude con ese detalle y continúe atendiéndole por aquí.'
  }
  async function collectVisit(args: Row) {
    if (!await visitParserReady()) {
      // Preserve the request in the actual advisor queue; do not ask for the
      // same date again or manufacture a booking using the old SQL parser.
      const message = await transferToAdvisor('revisar la solicitud de visita y el horario indicado; coordinación automática en actualización')
      return { action: 'advisor_handoff', message }
    }
    return object(await rpc('lv_collect_visit_intake', args))
  }
  const memory = commercialMemory(previousSummary._commercial_memory, context.historial, current)
  const state = sdrState(lead, context.historial)
  const repair = isConversationRepair(current) && !!state.ultima_respuesta
  if (repair) greeting = false
  const turnGreeting = greetingForTurn(current, context.historial, lead.last_bot_message_at, activeLast.sentAt)
  const proposals = (Array.isArray(context.propuestas) ? context.propuestas : []).map(object)
  const { data: visitDraft, error: draftError } = await db().from('lv_visit_intakes').select('status,needs_help,preferred_period').eq('conversation_id', inbound.registration.conversation_id).maybeSingle()
  if (draftError) throw new Error('VISIT_INTAKE_CONTEXT_FAILED')
  if (!inbound.mediaFailed) {
    if (!reply && asksTeamAttendance(current)) {
      const appointments = await db().from('appointments').select('id,status,start_time,end_time').match(scope)
        .eq('lead_id', lead.id).in('status', ['aceptado', 'reprogramado']).gt('end_time', activeLast.sentAt)
      if (appointments.error) {
        reply = await transferToAdvisor('verificar a qué cita se refiere el cliente y si espera una visita del equipo')
        audit = { source: 'advisor_handoff' }
      } else {
        reply = teamAttendanceReply(appointments.data || [], proposals)
        audit = { source: 'team_attendance', verified_appointments: appointments.data || [] }
      }
    }
    if (!reply && asksForHouse(current)) {
      reply = houseProductReply(current, text(state.ultima_respuesta))
      if (/financ|cr[eé]dito|hipoteca/i.test(current)) reply += ' ' + priceFinancingReply(current, await financingContext(lead))
      audit = { source: 'product_clarification' }
    }
    if (!reply && businessScope.kind !== 'property' && businessScope.kind !== 'mixed' && !/asesor|persona|humano|no me (?:escrib|contact)|dejen de/i.test(current)) {
      reply = vehicleScopeReply(current, context.historial)
      if (reply) audit = { source: 'vehicle_out_of_scope' }
    }
    if (!reply && wantsBrochure(current, context.historial)) {
      const info = await commercialContext(lead, context.historial)
      reply = brochureReply(current, context.historial, text(info.modo_comercial))
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
    if (!reply && asksVisitStatus(current)) {
      reply = visitStatusReply(proposals, visitDraft?.status === 'collecting')
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
        reply = await transferToAdvisor('compartir la ubicación verificada del proyecto')
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
  if (!reply && !inbound.mediaFailed && isCourtesyOnly(current) && !proposals.some(p => p.status === 'awaiting_client')) {
    if (isCourtesyOnly(text(state.ultima_respuesta)) || /^Con mucho gusto, ¡le esperamos!$/i.test(text(state.ultima_respuesta))) return { action: 'courtesy_already_acknowledged' }
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
    if (current.includes('[Sticker recibido]') && !inbound.mediaFailed) return { action: 'reaction_only' }
    reply = mediaFailureReply(activeLast.media, inbound.mediaErrors)
    audit = { source: 'media_not_understood', media_errors: inbound.mediaErrors }
  }
  if (!reply && businessScope.kind === 'mixed' && (explicitlyRequestsVisit(current) || ((proposals.length || visitDraft?.status === 'collecting') && (isVisitDetail(current) || /cancel|reprogram/i.test(current))))) {
    // The existing SQL appointment parser reads the original message. Let a human
    // resolve mixed bookings so a flight's date cannot become the property's date.
    reply = await transferToAdvisor('coordinación inmobiliaria mezclada con otra gestión; verificar únicamente la visita al proyecto')
    audit = { source: 'mixed_visit_handoff' }
  }
  if (!reply && !greeting && !modelOnly && proposals.length) {
    await guard()
    const proposal: Row | null = proposals.length === 1 ? { ...proposals[0], source_sent_at: activeLast.sentAt } : null
    const classification = await aiJson(visitIntentPrompt + '\n' + TURN_RULES, { mensaje_cliente: current,
      propuesta: proposal && visitDraft?.status === 'collecting' ? { ...proposal, status: 'awaiting_advisor' } : proposal,
      historial: context.historial })
    const options = Array.isArray(proposal?.proposed_options) ? proposal.proposed_options.map(object) : []
    const selected = selectedVisitOption(current, options, activeLast.sentAt)
    const override = visitTurnIntent(current)
    const intent = validateIntent(classification.intent === 'opt_out' ? classification : selected !== null ? { intent: 'accept' }
      : override === 'counterproposal' ? { intent: override } : classification, proposal, activeLast.sentAt, text(context.mensaje_actual_at))
    if (intent === 'opt_out') {
      await guard(); await rpc('set_tracking_preference', { p_lead_id: lead.id, p_consent: false, p_reason: 'solicitó no recibir más mensajes' })
      reply = 'Hemos registrado su solicitud de no recibir más mensajes.'; finalNotice = true
    } else if (proposal && declinesAllVisitAlternatives(current, proposal, intent)) {
      await guard()
      let escalated: Row | null = null
      try {
        escalated = await escalateVisitCoordination({ proposal, current, history: context.historial, messageId: activeLast.externalId })
      } catch (failure) {
        // A timeout may follow a committed transaction. Never rotate the
        // advisor again without first checking the durable request and pause.
        let stored: Row
        try {
          await guard()
          const verified = await Promise.all([
            one('appointment_reschedule_requests', text(proposal.request_id || proposal.id)),
            one('leads', text(lead.id)),
          ])
          stored = verified[0]; lead = verified[1]
        } catch { throw new Error('VISIT_URGENT_RESULT_UNKNOWN') }
        if (stored.coordination_urgent_at && stored.source_message_id === activeLast.externalId
          && stored.status === 'awaiting_advisor' && lead.bot_enabled === false) {
          escalated = { action: 'escalated', request_id: stored.id, bot_paused: true, recovered_after_error: true }
        } else if (stored.coordination_urgent_at || stored.status !== 'awaiting_client' || stored.proposed_by !== 'advisor'
          || lead.bot_enabled !== true) {
          return { action: 'visit_coordination_changed', request_id: stored.id }
        } else if (failure instanceof Error && /RPC_LV_ESCALATE_VISIT_COORDINATION_(?:PGRST202|42883)$/.test(failure.message)) {
          // Only a definitely absent RPC proves it never mutated this request.
          reply = await transferToAdvisor('coordinación urgente: rechazó las alternativas de visita; llamar para acordar un horario y revisar la solicitud pendiente')
          audit = { source: 'advisor_handoff', urgent_coordination_fallback: true }
        } else { throw new Error('VISIT_URGENT_RESULT_UNKNOWN') }
      }
      if (escalated) {
        lead = await one('leads', text(lead.id))
        if (lead.bot_enabled !== false) throw new Error('VISIT_URGENT_PAUSE_NOT_VERIFIED')
        finalNotice = true
        reply = text(escalated.message) || 'Entendemos. He pasado su solicitud al equipo para que un asesor se comunique con usted y puedan coordinar la visita directamente.'
        audit = { source: 'visit_urgent_handoff', request_id: escalated.request_id, bot_paused: true,
          recovered_after_error: escalated.recovered_after_error === true }
        await guard()
        try { await setKommoField(last.kommoId, 451530, 'true') }
        catch { audit = { ...audit, kommo_pause_sync: 'pending' } }
      }
    } else if (proposal && intent === 'accept' && options.length > 1) {
      if (selected === null) {
        reply = `¿Cuál de estos horarios le queda mejor?\n\n${visitOptionsList(options.map(o => ({ start_time: text(o.start_time), end_time: text(o.end_time) })))}`
        audit = { source: 'visit_option_choice' }
      } else {
        await guard()
        const result = object(await rpc('lv_client_select_visit_option', { p_request_id: proposal.request_id || proposal.id,
          p_option_index: selected, p_message_id: activeLast.externalId }))
        if (result.status !== 'confirmed') throw new Error('VISIT_OPTION_NOT_CONFIRMED')
        return { action: 'confirmed', selected_option: selected }
      }
    } else if (proposal && (intent === 'counterproposal' || intent === 'reject' || (intent === 'unclear' && visitDraft?.status === 'collecting'))) {
      await guard()
      const result = await collectVisit({ p_lead: lead.id, p_message: activeLast.externalId,
        p_needs_help: needsVisitHelp(current), p_previous_request: proposal.request_id || proposal.id, p_snapshot: proposal })
      reply = text(result.message) || intakeReply(result, activeLast.sentAt)
      audit = { source: result.action === 'advisor_handoff' ? 'advisor_handoff' : 'visit_intake', action: result.action, preference: result.slot }
    } else if (proposal && intent === 'unclear') {
      reply = proposal.status === 'awaiting_advisor'
        ? 'El equipo todavía está revisando el horario. Le confirmaremos por aquí en cuanto esté listo.'
        : 'Para evitar una confusión, ¿le queda bien el horario de la propuesta que le enviamos?'
    } else if (proposal && intent !== 'question') {
      await guard()
      const applied = object(await rpc('lv_apply_client_visit_intent', { p_tenant: scope.tenant_id, p_project: scope.project_id,
        p_lead: lead.id, p_request: proposal.request_id || proposal.id, p_message: activeLast.externalId, p_intent: intent, p_snapshot: proposal }))
      if (['confirmed', 'duplicate'].includes(text(applied.action))) return { action: applied.action }
      if (!['reply', 'stale', 'conversation'].includes(text(applied.action))) throw new Error('VISIT_INTENT_RPC_CONTRACT_MISMATCH')
      reply = text(applied.mensaje)
      if (intent === 'cancel' && applied.action === 'reply') {
        const { error } = await db().from('lv_visit_intakes').delete().eq('conversation_id', inbound.registration.conversation_id)
        if (error) throw new Error('VISIT_DRAFT_CANCEL_FAILED')
      }
    } else if (!proposal && intent === 'unclear') reply = '¿A qué día y horario de visita se refiere?'
  }
  if (!reply) {
    await guard()
    const finance = await financingContext(lead)
    const reference = resolveCatalogReference(await publishedUnitCatalog(), current, previousSummary._unit_reference, context.historial)
    const [summaryPrompt, extractorPrompt] = await Promise.all([activePrompt('resumen_conversacion'), activePrompt('extractor_eventos')])
    const [newSummary, rawEvents] = await Promise.all([
      aiJson(summaryPrompt, { historial: context.historial, resumen_anterior: previousSummary, mensaje_actual: current }),
      aiJson(extractorPrompt + '\n' + TURN_RULES + '\nUse la última pregunta REAL del bot, no una pregunta omitida del resumen. En coordinación de visita, expresar duda o pedir sugerencia activa requested_visit y visit_needs_help=true; jamás requested_advisor solo por pedir horario. Una fecha parcial responde a la coordinación y activa requested_visit. Extraiga financing_partner incluso si la entidad no está entre las disponibles; no convierta información comercial en consentimiento.',
        { resumen: previousSummary, historial: context.historial, tema_actual: salesSubject(current, context.historial), ultima_pregunta: state.ultima_respuesta, propuestas: proposals, coordinacion_visita: visitDraft, financiamiento: finance, unidades_identificadas:reference.matches, mensaje_actual: current })
    ])
    summary = {...newSummary, _unit_reference: reference.memory, _sales_memory: previousSummary._sales_memory}
    const extracted = normalizeEvents(rawEvents, current)
    const financeInput = financingInputs(extracted, current, text(state.ultima_respuesta), finance, object(previousSummary._last_operational_step))
    extracted.financing_consent = financeInput.consent
    extracted.financing_partner = financeInput.partner
    const collectingVisit = visitDraft?.status === 'collecting'
    const canRequestVisit = !modelOnly && !asksVisitStatus(current) && (!repair || isVisitDetail(current)) && !isCourtesyOnly(current)
      && (explicitlyRequestsVisit(current) || collectingVisit || acceptsVisitInvitation(current, text(state.ultima_respuesta)))
    if (canRequestVisit && (explicitlyRequestsVisit(current) || acceptsVisitInvitation(current, text(state.ultima_respuesta)))) extracted.events = [...new Set([...(extracted.events as string[]), 'requested_visit'])]
    if (!canRequestVisit) extracted.events = (extracted.events as string[]).filter(e => e !== 'requested_visit')
    const priceTurn = asksUnitPrice(current, ['property', 'mixed'].includes(businessScope.kind))
    const financeTurn = financeInput.consent === true || (!priceTurn && isFinancingTurn(extracted, current, text(state.ultima_respuesta), financeInput))
    if (!financeTurn) extracted.events = (extracted.events as string[]).filter(e => e !== 'asked_financing')
    await guard()
    if (extracted.opt_out) {
      await rpc('set_tracking_preference', { p_lead_id: lead.id, p_consent: false, p_reason: 'solicitó no recibir más mensajes' })
      reply = 'Hemos registrado su solicitud de no recibir más mensajes.'; finalNotice = true
    } else {
      if (extracted.tracking_consent) await rpc('set_tracking_preference', { p_lead_id: lead.id, p_consent: true, p_reason: 'aceptó recibir novedades' })
      await rpc('apply_lead_events', { p_lead_id: lead.id, p_events: extracted.events, p_source_message_id: activeLast.externalId })
      // Do not persist UUIDs invented by extraction or arbitrarily pick among equal-sized units.
      const unitId = (reference.explicit || isUnitVisualRequest(current)) && reference.matches.length === 1 ? reference.matches[0].id : null
      if (unitId) extracted.preferred_category = reference.matches[0].category
      const previousCategory = lead.preferred_category
      const declarations = object(await rpc('save_lead_declarations', { p_lead_id: lead.id, p_preferred_category: extracted.preferred_category,
        p_purchase_purpose: extracted.purchase_purpose, p_unit_id: unitId }))
      lead = { ...lead, ...declarations }
      const facts = qualifiedFacts(object(extracted.qualification), current)
      const categoryChanged = previousCategory && lead.preferred_category !== previousCategory
      if (categoryChanged && !unitId) { reference.matches = []; summary._unit_reference = {} }
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
      const financeAnswer = priceTurn || financeInput.consent === true ? '' : financingQuestionReply(current, finance.partners, text(state.ultima_respuesta))
      // A question about a product is not an application or consent to collect personal data.
      let fin: Row = {}, financeFailure = ''
      if (financeTurn && !financeAnswer) {
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
      const visitRequested = (extracted.events as string[]).includes('requested_visit')
        || (canRequestVisit && visitDraft?.status === 'collecting' && !financeTurn
          && (isVisitDetail(current) || needsVisitHelp(current)))
      if (financeFailure) {
        reply = await transferToAdvisor('continuar la revisión de financiamiento' + (financeInput.partner ? ' con ' + financeInput.partner : '') + '; comprobar el avance previo antes de volver a solicitar datos')
        if (financeInput.partner) reply = `Le ayudaremos a revisar la opción con ${financeInput.partner}. ` + reply
        audit = { source: 'financing_handoff', failure_code: financeFailure, selected_partner: financeInput.partner }
      } else if (!visitRequested && (extracted.requested_advisor || fin.ready_for_handoff === true)) {
        reply = await transferToAdvisor(extracted.requested_advisor ? 'pidió hablar con un asesor' : 'información lista para revisión')
        audit = { source: 'advisor_handoff' }
      } else if (visitRequested) {
        await guard()
        const visitInfo = await commercialContext(lead, context.historial)
        const quote = priceTurn ? unitPriceQuote({ ...visitInfo, alcance_negocio: businessScope.kind, financiamiento: finance, referencia_unidad: reference }, current, summary) : null
        if (quote?.needsAdvisor) {
          reply = await transferToAdvisor('confirmar el precio solicitado y ayudar a coordinar la visita')
          audit = { source: 'price_and_visit_handoff' }
        } else {
          const result = await collectVisit({ p_lead: lead.id, p_message: activeLast.externalId,
            p_needs_help: false })
          reply = text(result.message) || intakeReply(result, activeLast.sentAt)
          if (result.action === 'collecting' && needsVisitHelp(current)) reply = visitBusinessHoursReply(visitInfo.horario_atencion, result, activeLast.sentAt) || reply
          const overview = projectOverviewReply(visitInfo, current)
          if (overview) reply = overview + ' ' + reply
          if (quote) reply = quote.reply.replace(/\s*¿[^?]+\?\s*$/, '') + ' ' + reply
          audit = { source: result.action === 'advisor_handoff' ? 'advisor_handoff' : 'visit_intake', action: result.action, preference: result.slot }
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
          reply = await transferToAdvisor('continuar la revisión de financiamiento y comprobar los datos que faltan' + (financeInput.partner ? ' con ' + financeInput.partner : ''))
          audit = { source: 'financing_handoff', failure_code: 'UNKNOWN_FINANCING_STATE', selected_partner: financeInput.partner }
        }
      }
      else {
        const model = unitModelDelivery(reference, current, context.historial, previousSummary._unit_models_sent)
        const info = { ...await commercialContext(lead, context.historial), alcance_negocio: businessScope.kind, propuestas: proposals,
          coordinacion_visita: visitDraft, financiamiento: finance, reglas_del_turno: TURN_RULES, memoria_comercial: memory,
          referencia_unidad:reference, archivos_no_leidos:inbound.mediaErrors,
          modelo_3d: model ? { unidad: model.unit_number, se_adjunta_en_esta_respuesta: true, modelo_especifico_disponible: model.model_available, texto_de_entrega: model.caption } : null }
        const generated = await commercialReply(info, current, summary, guard)
        audit = generated.audit
        if (audit.requires_advisor === true) {
          // A missing answer must not erase the independent facts we can supply.
          const partial = completeTurnAnswer('', turnAnswerFacts(info, current, summary)).reply
          reply = [partial, await transferToAdvisor(text(audit.handoff_reason))].filter(Boolean).join('\n\n')
        } else reply = appendUnitModel(generated.reply, model)
        if (model && reply.includes(model.url)) audit = { ...audit, unit_model: model }
      }
    }
  }
  if (inbound.mediaErrors.length) audit = {...audit, media_errors: inbound.mediaErrors}
  if (audit.source === 'visit_intake') {
    const info = await commercialContext(lead, context.historial)
    if (info.modo_comercial === 'lanzamiento') reply = launchVisitReply(reply, object(info.politica_visitas).launchDestination === 'office' ? 'office' : 'site')
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
  if (['visit_intake', 'visit_status', 'financing', 'financing_question', 'financing_handoff', 'budget_financing_guidance', 'unit_price', 'budget_guidance', 'interest_after_model', 'product_clarification', 'team_attendance'].includes(text(audit.source))) {
    await guard()
    const composed = await operationalReply(reply, current, context.historial, audit)
    const complete = !commercialCoverageIssues(composed.reply, commercialTurnTopics(current, context.historial, ['property', 'mixed'].includes(businessScope.kind))).length
    if (complete) reply = composed.reply
    audit = { ...audit, ai_operational_copy: complete && composed.generated }
  }
  if (!['minimal_greeting', 'courtesy', 'media_not_understood', 'media_clarification', 'business_out_of_scope', 'vehicle_out_of_scope', 'scope_clarification'].includes(text(audit.source))) {
    await guard()
    const info = { ...await commercialContext(lead, context.historial), alcance_negocio: businessScope.kind, financiamiento: await financingContext(lead), propuestas: proposals,
      estado_operativo: audit, coordinacion_visita: visitDraft }
    // The map URL is not a suggestion the writer may add opportunistically.
    if (!locationRequestKind(current)) delete (info as Row).ubicacion
    const quote = unitPriceQuote(info, current, previousSummary)
    const reviewed = await completeTurnReply({ current, history: context.historial, baseReply: reply,
      verified: { ...info, respuesta_precio_verificada: quote?.reply || null, precios_del_turno: quote?.prices || [] }, audit,
      preserveOperationalQuestion: ['financing', 'visit_intake', 'visit_status', 'visit_option_choice'].includes(text(audit.source)) })
    const invalidPrice = reviewed.changed && quote?.quoted === true && priceReplyIssues(reviewed.reply, info, current, quote.prices).includes('unsupported_fact')
    if (!invalidPrice) reply = reviewed.reply
    else { reviewed.needsAdvisor = true; reviewed.unresolved.push('comparar las categorías y precios consultados sin mezclar unidades') }
    audit = { ...audit, turn_completeness: reviewed.audit }
    if (reviewed.needsAdvisor && !finalNotice) {
      const notice = await transferToAdvisor('resolver consultas concretas pendientes: ' + reviewed.unresolved.join(' | ').slice(0, 650))
      reply = reply.replace(/\s*¿[^?]+\?\s*$/, '').trim() + '\n\n' + notice
      audit = { ...audit, additional_questions_handoff: true }
    }
  }
  if (!['business_out_of_scope', 'vehicle_out_of_scope', 'media_not_understood', 'scope_clarification', 'location_handoff'].includes(text(audit.source)) && locationRequestKind(current)) {
    reply = withVisitLocation(reply, await commercialContext(lead, context.historial), true)
  }
  if (businessScope.kind === 'mixed' && businessScope.reply) reply = businessScope.reply + '\n\n' + reply
  reply = naturalConversationReply(variedReplyOpening(reply, context.historial), text(lead.name), turnGreeting, activeLast.sentAt)
  if (!reply.trim() || reply.length > 3000) throw new Error('EMPTY_OR_LONG_REPLY')
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
  if (!await authorized()) return { action: 'paused_before_reply' }
  // Un envío de visita incierto podría reutilizar campos o haber iniciado otra conversación.
  const { count, error } = await db().from('lv_outbox').select('id', { count: 'exact', head: true })
    .match(scope).eq('lead_id', lead.id).in('status', ['claimed', 'uncertain'])
  if (error || count) throw new Error('UNRESOLVED_VISIT_SEND')
  await setKommoField(last.kommoId, 457014, reply)
  if (!await authorized()) return { action: 'paused_before_salesbot' }
  await launchSalesbot(last.kommoId, 15578)
  await rpc('register_outbound_message', { p_conversation_id: conversationId, p_content: reply,
    p_model: greetingTemplate ? 'template:saludo_inicial' : process.env.OPENAI_MODEL, p_tool_calls: { source_message_id: activeLast.externalId, provider_status: 'accepted', processing_ms: Date.now() - processingStarted, ...audit } })
  const sentModels = Array.isArray(previousSummary._unit_models_sent) ? previousSummary._unit_models_sent : []
  const sentModelId = text(object(audit.unit_model).unit_id)
  const savedSummary = { ...(Object.keys(summary).length ? summary : previousSummary), _commercial_memory: rememberCommercialReply(memory, reply),
    _last_operational_step: ((audit.source === 'financing' && audit.state === 'continuacion_pendiente') || audit.source === 'financing_question' || audit.source === 'budget_financing_guidance') && /(?:iniciar|iniciemos|revisión|revisemos)/i.test(reply) && /\?/.test(reply)
      ? { kind: 'financing_consent', reply } : {},
    ...(audit.unit_reference ? { _unit_reference: audit.unit_reference } : {}),
    _sales_memory: rememberSalesReply(previousSummary._sales_memory, context.historial, current, reply),
    _unit_models_sent: [...new Set([...sentModels, ...(sentModelId ? [sentModelId] : [])])] }
  const { error: memoryError } = await db().from('conversations').update({ summary: JSON.stringify(savedSummary) }).match(scope).eq('id', conversationId)
  // A scheduling failure must not mark an already accepted reply as uncertain.
  let nutrition: Row
  try { nutrition = businessScope.kind === 'out_of_scope' || businessScope.uncertain ? { scheduled: false, reason: 'outside_property_conversation' } : await scheduleNutrition24h(text(lead.id), conversationId, activeLast.externalId) }
  catch { nutrition = { scheduled: false, reason: 'schedule_failed' } }
  return { action: 'accepted', leadId: lead.id, ...audit, memory_saved: !memoryError, nutrition }
}
