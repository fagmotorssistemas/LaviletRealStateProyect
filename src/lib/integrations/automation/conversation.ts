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

import { financingContext, financingInputs, financingReply, financingQuestionReply, isFinancingTurn, avoidFinancingRepeat } from './financing'
import { intakeReply, isVisitDetail, needsVisitHelp } from './visit-intake'
import { asksVisitStatus, declinedFollowup, explicitlyRequestsVisit, isConversationRepair, TURN_RULES, visitStatusReply } from './turn-routing'
import { commercialMemory, rememberCommercialReply } from './commercial-experience'
import { resolveCatalogReference } from './catalog-reference'
import { fabricatedActionRequest, mediaClarificationReply } from './clarification'

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
        content = [event.text, '[Archivo no interpretado: no se pudo leer este adjunto; esto no limita el canal a texto]'].filter(Boolean).join('\n')
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
  const current = inbound.normalized.map(e => e.text).join('\n').slice(0, 30_000)
  const modelOnly = isUnitVisualRequest(current) && !explicitlyRequestsVisit(current)
  const meaningfulText = current.replace(/\[Archivo no interpretado[^\]]*\]|\[Sticker recibido\]/g, '').trim()
  const processingStarted = Date.now()
  const context = object(await rpc('lv_app_conversation_context', { p_lead: lead.id, p_message: activeLast.externalId }))
  let reply = '', finalNotice = false
  let summary: Row = {}, audit: Row = {}, greetingTemplate = false
  let greeting = !inbound.mediaFailed && isGreetingOnly(current)
  const conversationBefore = await one('conversations', text(inbound.registration.conversation_id))
  const previousSummary = object(conversationBefore.summary)
  const memory = commercialMemory(previousSummary._commercial_memory, context.historial, current)
  const state = sdrState(lead, context.historial)
  const repair = isConversationRepair(current) && !!state.ultima_respuesta
  if (repair) greeting = false
  const turnGreeting = greetingForTurn(current, context.historial, lead.last_bot_message_at, activeLast.sentAt)
  const proposals = (Array.isArray(context.propuestas) ? context.propuestas : []).map(object)
  const { data: visitDraft, error: draftError } = await db().from('lv_visit_intakes').select('status,needs_help,preferred_period').eq('conversation_id', inbound.registration.conversation_id).maybeSingle()
  if (draftError) throw new Error('VISIT_INTAKE_CONTEXT_FAILED')
  if (!inbound.mediaFailed) {
    reply = mediaClarificationReply(current)
    if (reply) audit = { source: 'media_clarification' }
    if (!reply && fabricatedActionRequest(current)) { reply = 'Para confirmarle una cita o una reserva, primero debe quedar registrada y aprobada en el sistema. Puedo ayudarle a coordinarla.'; audit = {source:'action_not_recorded'} }
    if (!reply) {reply = declinedFollowup(current, text(state.ultima_respuesta)); if (reply) audit = { source: 'declined_followup' }}
    if (!reply && asksVisitStatus(current)) {
      reply = visitStatusReply(proposals, visitDraft?.status === 'collecting')
      if (reply) audit = { source: 'visit_status' }
    }
    if (!reply && repair && !/asesor|persona|humano/i.test(current) && !explicitlyRequestsVisit(current)) {
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
      : welcome.length <= 140 && !/la\s*vilet|proyecto|vivienda|invertir|local comercial/i.test(welcome)
        ? welcome : minimalGreeting(turnGreeting)
    greetingTemplate = true; audit = { source: 'minimal_greeting' }
  }
  if (!meaningfulText) {
    if (current.includes('[Sticker recibido]') && !inbound.mediaFailed) return { action: 'reaction_only' }
    reply = 'No alcancé a leer este archivo. ¿Puede enviarlo más nítido o escribir el número de la unidad?'
  }
  if (!reply && !greeting && !modelOnly && proposals.length) {
    await guard()
    const proposal: Row | null = proposals.length === 1 ? { ...proposals[0], source_sent_at: activeLast.sentAt } : null
    const classification = await aiJson(visitIntentPrompt + '\n' + TURN_RULES, { mensaje_cliente: current,
      propuesta: proposal && visitDraft?.status === 'collecting' ? { ...proposal, status: 'awaiting_advisor' } : proposal,
      historial: context.historial })
    const intent = validateIntent(classification, proposal, activeLast.sentAt, text(context.mensaje_actual_at))
    if (intent === 'opt_out') {
      await guard(); await rpc('set_tracking_preference', { p_lead_id: lead.id, p_consent: false, p_reason: 'solicitó no recibir más mensajes' })
      reply = 'Hemos registrado su solicitud de no recibir más mensajes.'; finalNotice = true
    } else if (proposal && (intent === 'counterproposal' || intent === 'reject' || (intent === 'unclear' && visitDraft?.status === 'collecting'))) {
      await guard()
      const result = object(await rpc('lv_collect_visit_intake', { p_lead: lead.id, p_message: activeLast.externalId,
        p_needs_help: needsVisitHelp(current), p_previous_request: proposal.request_id || proposal.id, p_snapshot: proposal }))
      reply = intakeReply(result)
      audit = { source: 'visit_intake', action: result.action, preference: result.slot }
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
        { resumen: previousSummary, historial: context.historial, ultima_pregunta: state.ultima_respuesta, propuestas: proposals, coordinacion_visita: visitDraft, financiamiento: finance, unidades_identificadas:reference.matches, mensaje_actual: current })
    ])
    summary = {...newSummary, _unit_reference: reference.memory}
    const extracted = normalizeEvents(rawEvents, current)
    const financeInput = financingInputs(extracted, current, text(state.ultima_respuesta), finance)
    extracted.financing_consent = financeInput.consent
    extracted.financing_partner = financeInput.partner
    const collectingVisit = visitDraft?.status === 'collecting'
    const canRequestVisit = !modelOnly && !asksVisitStatus(current) && !repair && !isCourtesyOnly(current)
      && (explicitlyRequestsVisit(current) || collectingVisit || !proposals.length)
    if (!canRequestVisit) extracted.events = (extracted.events as string[]).filter(e => e !== 'requested_visit')
    const financeTurn = isFinancingTurn(extracted, current, text(state.ultima_respuesta), financeInput)
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
      const financeAnswer = financingQuestionReply(current, finance.partners, text(state.ultima_respuesta))
      // A question about a product is not an application or consent to collect personal data.
      const fin = financeTurn && !financeAnswer ? object(await rpc('process_financing_message_v2', { p_lead_id: lead.id,
        p_asked_financing: (extracted.events as string[]).includes('asked_financing') || !!financeInput.partner,
        ...Object.fromEntries(['financing_consent', 'financing_partner', 'full_name', 'applicant_type', 'national_id',
          'employment_stability_months', 'job_title', 'monthly_income', 'ruc'].map(key => ['p_' + key, extracted[key]])),
        p_source_message_id: activeLast.externalId, p_current_message: current })) : {}
      const visitRequested = (extracted.events as string[]).includes('requested_visit')
        || (canRequestVisit && visitDraft?.status === 'collecting' && !financeTurn
          && (isVisitDetail(current) || needsVisitHelp(current)))
      if (!visitRequested && (extracted.requested_advisor || fin.ready_for_handoff === true)) {
        await guard()
        await rpc('handoff_lead', { p_lead_id: lead.id, p_reason: extracted.requested_advisor ? 'pidió hablar con un asesor' : 'información lista para revisión' })
        lead = await one('leads', text(lead.id))
        if (!['queued', 'assigned', 'acknowledged'].includes(text(lead.handoff_status))) throw new Error('HANDOFF_NOT_RECORDED')
        const { error } = await db().from('leads').update({ bot_enabled: false }).match(scope).eq('id', lead.id)
        if (error) throw new Error('HANDOFF_PAUSE_FAILED')
        await setKommoField(last.kommoId, 451530, 'true')
        reply = lead.handoff_status === 'queued' ? 'Su solicitud quedó en espera de un asesor de nuestro equipo.' : 'Un asesor de nuestro equipo continuará con su atención.'
        finalNotice = true
      } else if (visitRequested) {
        await guard()
        const result = object(await rpc('lv_collect_visit_intake', { p_lead: lead.id, p_message: activeLast.externalId,
          p_needs_help: extracted.visit_needs_help === true || needsVisitHelp(current) }))
        reply = intakeReply(result)
        audit = { source: 'visit_intake', action: result.action, preference: result.slot }
      } else if (financeAnswer) {
        reply = financeAnswer
        audit = { source: 'financing_question' }
      } else if (fin.active === true) {
        reply = avoidFinancingRepeat(financingReply(fin, finance.partners, financeInput.unsupported), current, text(state.ultima_respuesta), fin, finance.partners)
        audit = { source: 'financing', state: fin.state, selected_partner: fin.selected_partner_name }
      }
      else {
        const model = unitModelDelivery(reference, current, context.historial, previousSummary._unit_models_sent)
        const info = { ...await commercialContext(lead, context.historial), propuestas: proposals,
          coordinacion_visita: visitDraft, financiamiento: finance, reglas_del_turno: TURN_RULES, memoria_comercial: memory,
          referencia_unidad:reference, archivos_no_leidos:inbound.mediaErrors,
          modelo_3d: model ? { unidad: model.unit_number, se_adjunta_en_esta_respuesta: true } : null }
        const generated = await commercialReply(info, current, summary, guard)
        reply = appendUnitModel(generated.reply, model); audit = generated.audit
        if (model && reply.includes(model.url)) audit = { ...audit, unit_model: model }
      }
    }
  }
  if (inbound.mediaErrors.length) audit = {...audit, media_errors: inbound.mediaErrors}
  reply = naturalConversationReply(reply, text(lead.name), turnGreeting, activeLast.sentAt)
  if (!reply.trim() || reply.length > 1500) throw new Error('EMPTY_OR_LONG_REPLY')
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
    _unit_models_sent: [...new Set([...sentModels, ...(sentModelId ? [sentModelId] : [])])] }
  const { error: memoryError } = await db().from('conversations').update({ summary: JSON.stringify(savedSummary) }).match(scope).eq('id', conversationId)
  return { action: 'accepted', leadId: lead.id, ...audit, memory_saved: !memoryError }
}
