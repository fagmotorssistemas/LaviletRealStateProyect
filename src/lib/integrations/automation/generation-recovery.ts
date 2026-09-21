import 'server-only'
import { assertLive, automationSettings } from './config'
import { autoConfig, db, object, one, permitted, rpc, scope, text, type Row } from './data'
import { botStopped, getKommoContact, getKommoLead, launchSalesbot, setKommoField } from './kommo'
import { inboundFromRow } from './webhook'
import { preserveCtwaForContact } from './ctwa-lead-store'
import type { Guard } from './visits'
import { normalized } from './sdr-rules'

export class GenerationRecoveryError extends Error {
  constructor(public original: unknown, public deliveryUncertain: boolean) { super('GENERATION_RECOVERY_FAILED') }
}

/** No AI, no replay of sales actions, and at most one attempt to send the notice. */
export async function recoverGenerationFailure(rows: Row[], guard: Guard, reason: string) {
  let sendStarted = false
  try {
    assertLive()
    const events = rows.map(row => inboundFromRow(row.payload)).sort((a, b) => a.sentAt.localeCompare(b.sentAt) || a.externalId.localeCompare(b.externalId))
    const last = events.at(-1)
    if (!last || events.some(e => e.kommoId !== last.kommoId || e.contactId !== last.contactId)) throw Error('MIXED_CONVERSATION_BATCH')
    if (Date.now() - Date.parse(last.sentAt) >= 24 * 3_600_000) return { action: 'expired', delivery_status: 'not_sent', requires_review: true, reason: 'REPLY_WINDOW_EXPIRED' }
    await guard()
    const config = await autoConfig(), settings = automationSettings()
    if (config.enabled !== true || config.dry_run !== false) return { action: 'disabled' }
    const remote = await getKommoLead(last.kommoId)
    const contacts = object(remote._embedded).contacts
    if (!Array.isArray(contacts) || !contacts.map(object).some(c => c.id === last.contactId)) throw Error('CONTACT_NOT_LINKED_TO_LEAD')
    const contact = await getKommoContact(last.contactId)
    const fields = (Array.isArray(contact.custom_fields_values) ? contact.custom_fields_values : []).map(object)
    const phoneField = fields.find(field => field.field_code === 'PHONE')
    const phone = text(object(Array.isArray(phoneField?.values) ? phoneField.values[0] : null).value)
    if (!phone.replace(/\D/g, '')) throw Error('CONTACT_PHONE_MISSING')
    let registration: Row = {}
    // Persistencia idempotente antes del gate test_only; no envía respuestas ni conversiones.
    for (const event of events) {
      await guard()
      registration = object(await rpc('register_inbound_message', { p_tenant_id: scope.tenant_id, p_project_id: scope.project_id,
        p_phone: phone, p_name: text(contact.name) || event.name || 'Sin nombre', p_source: event.origin, p_channel: 'whatsapp',
        p_campaign: null, p_contact_id: String(event.contactId), p_kommo_id: event.kommoId,
        p_external_message_id: event.externalId, p_content: event.text || '[Archivo recibido; interpretación pendiente]', p_tracking_consent: false }))
      if (!text(registration.lead_id) || !text(registration.conversation_id)) throw Error('INBOUND_RPC_CONTRACT_MISMATCH')
      await preserveCtwaForContact({
        contactId: event.contactId,
        kommoId: event.kommoId,
        externalMessageId: event.externalId,
        ctwa: event.ctwa,
      })
      if (registration.is_duplicate !== true) {
        const { error } = await db().from('messages').update({ sent_at: event.sentAt, media_type: event.media?.type ?? null, media_url: event.media?.url ?? null })
          .eq('conversation_id', registration.conversation_id).eq('external_message_id', event.externalId).eq('role', 'cliente')
        if (error) throw Error('INBOUND_TIMESTAMP_FAILED')
      }
    }
    const target = settings.testLeadId || (config.test_only === true ? text(config.test_lead_id) : null)
    if (target && Number((await one('leads', target)).kommo_id) !== last.kommoId) {
      try {
        if (text(registration.lead_id)) {
          const outsideLead = await one('leads', text(registration.lead_id))
          const { evaluateWaLeadSubmittedForCurrentTurn } = await import('@/lib/meta/waLeadSubmittedTurn')
          await evaluateWaLeadSubmittedForCurrentTurn({
            admin: db(),
            rpc,
            lead: { ...outsideLead, id: String(registration.lead_id) },
            contactId: last.contactId,
            currentMessage: events.map(e => e.text).join('\n').slice(0, 30_000),
            tenantId: scope.tenant_id,
            projectId: scope.project_id,
          })
        }
      } catch { /* soft-fail */ }
      return { action: 'outside_test_lead', message_persisted: true }
    }
    if (botStopped(remote)) {
      try {
        if (text(registration.lead_id)) {
          const pausedLead = await one('leads', text(registration.lead_id))
          const { evaluateWaLeadSubmittedForCurrentTurn } = await import('@/lib/meta/waLeadSubmittedTurn')
          await evaluateWaLeadSubmittedForCurrentTurn({
            admin: db(),
            rpc,
            lead: { ...pausedLead, id: String(registration.lead_id) },
            contactId: last.contactId,
            currentMessage: events.map(e => e.text).join('\n').slice(0, 30_000),
            tenantId: scope.tenant_id,
            projectId: scope.project_id,
          })
        }
      } catch { /* soft-fail */ }
      return { action: 'bot_paused' }
    }
    const lead = await one('leads', text(registration.lead_id)), conversationId = text(registration.conversation_id)
    const conversation = await one('conversations', conversationId)
    if (conversation.lead_id !== lead.id || Number(lead.kommo_id) !== last.kommoId) throw Error('CONVERSATION_SCOPE_MISMATCH')
    if (!permitted(config, lead, settings.testLeadId) || lead.bot_enabled !== true || lead.tracking_opt_out_at) {
      try {
        const { evaluateWaLeadSubmittedForCurrentTurn } = await import('@/lib/meta/waLeadSubmittedTurn')
        await evaluateWaLeadSubmittedForCurrentTurn({
          admin: db(),
          rpc,
          lead: { ...lead, id: String(lead.id) },
          contactId: last.contactId,
          currentMessage: events.map(e => e.text).join('\n').slice(0, 30_000),
          tenantId: scope.tenant_id,
          projectId: scope.project_id,
        })
      } catch { /* soft-fail */ }
      return { action: 'bot_paused' }
    }
    if (/no (?:me )?(?:envien|mande|manden|escriban|contacten)|dejen de (?:escribirme|contactarme)|no (?:quiero|deseo) recibir.*mensaj/.test(normalized(events.map(e => e.text).join(' ')))) {
      await rpc('set_tracking_preference', { p_lead_id: lead.id, p_consent: false, p_reason: 'solicitó no recibir más mensajes' })
      return { action: 'opt_out' }
    }
    async function canRespond() {
      await guard()
      const currentLead = await one('leads', text(lead.id)), currentConfig = await autoConfig()
      if (!permitted(currentConfig, currentLead, settings.testLeadId) || currentLead.tracking_opt_out_at
        || currentLead.bot_enabled !== true || Date.now() - Date.parse(last!.sentAt) >= 24 * 3_600_000) return false
      const kommo = await getKommoLead(last!.kommoId)
      if (botStopped(kommo)) return false
      const checks = await Promise.all([
        db().from('messages').select('id', { count: 'exact', head: true }).eq('conversation_id', conversationId).eq('role', 'bot').eq('tool_calls->>source_message_id', last!.externalId),
        db().from('messages').select('id', { count: 'exact', head: true }).eq('conversation_id', conversationId).eq('role', 'asesor').gt('sent_at', last!.sentAt),
        db().from('lv_integration_events').select('id', { count: 'exact', head: true }).match(scope).eq('contact_key', `${last!.kommoId}:${last!.contactId}`).eq('status', 'pending'),
        db().from('lv_outbox').select('id', { count: 'exact', head: true }).match(scope).eq('lead_id', lead.id).in('status', ['claimed', 'uncertain']),
      ])
      if (checks.some(check => check.error)) throw Error('RECOVERY_DELIVERY_CHECK_FAILED')
      if (checks[3].count) throw Error('UNRESOLVED_VISIT_SEND')
      return checks.every(check => !check.count)
    }
    if (!await canRespond()) return { action: 'superseded_or_paused' }
    const current = events.map(event => event.text || '[Archivo pendiente de revisar]').join('\n').slice(0, 1500)
    const handoffReason = `Atender consulta sin respuesta por fallo de generación (${reason}). Consulta: ${current}`
    await rpc('handoff_lead', { p_lead_id: lead.id, p_reason: handoffReason })
    const reactivated = await db().from('leads').update({ bot_enabled: true }).match(scope)
      .eq('id', lead.id).eq('handoff_reason', handoffReason).is('tracking_opt_out_at', null)
    if (reactivated.error) throw Error('HANDOFF_BOT_STATE_FAILED')
    const handed = await one('leads', text(lead.id))
    if (!['queued', 'assigned', 'acknowledged'].includes(text(handed.handoff_status))) throw Error('HANDOFF_NOT_RECORDED')
    const notice = 'Disculpe la demora. He dejado su consulta en la bandeja del equipo para que un asesor le ayude con ese detalle.'
    if (!await canRespond()) return { action: 'advisor_recovery', notice: 'superseded_or_paused', generation_error: reason }
    await setKommoField(last.kommoId, 457014, notice)
    if (!await canRespond()) return { action: 'advisor_recovery', notice: 'superseded_or_paused', generation_error: reason }
    sendStarted = true
    await launchSalesbot(last.kommoId, 15578)
    await rpc('register_outbound_message', { p_conversation_id: conversationId, p_content: notice, p_model: 'system:generation-recovery',
      p_tool_calls: { source_message_id: last.externalId, provider_status: 'accepted', source: 'generation_recovery', generation_error: reason } })
    return { action: 'advisor_recovery', delivery_status: 'accepted', generation_error: reason, requires_review: false }
  } catch (error) { throw new GenerationRecoveryError(error, sendStarted) }
}
