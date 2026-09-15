import 'server-only'
import { LATER_ROUTES, type LaterWeek } from '@/lib/inmobiliaria/nutritionLater'
import { nutritionSendTime } from '@/lib/inmobiliaria/nutrition24h'
import { assertLive } from './config'
import { db, one, object, rpc, scope, text, type Row } from './data'
import { nutritionLeadEligible } from './nutrition-context'
import { weekOneContext, weekOneSettings } from './nutrition-week-one'
import { laterChoice } from './nutrition-later-rules'
import { botStopped, getKommoLead, launchSalesbot, setKommoField, verifyLaterTemplates } from './kommo'
import type { Guard } from './visits'

export async function scheduleNutritionLater(leadId: string, conversationId: string, externalId: string) {
  const settings = await weekOneSettings()
  const weeks = ([2, 3] as const).filter(w => settings.later[w].enabled && Number.isFinite(Date.parse(settings.later[w].activatedAt || '')))
  if (!weeks.length) return { scheduled: false, reason: 'disabled' }
  const lead = await one('leads', leadId), conversation = await one('conversations', conversationId)
  if (!nutritionLeadEligible(lead)) return { scheduled: false, reason: 'ineligible' }
  if (conversation.lead_id !== leadId) throw Error('NUTRITION_CONVERSATION_MISMATCH')
  const { data, error } = await db().from('messages').select('id,sent_at,external_message_id').eq('conversation_id', conversationId).eq('role', 'cliente')
    .order('sent_at', { ascending: false }).order('id', { ascending: false }).limit(1)
  if (error) throw Error('NUTRITION_ANCHOR_FAILED')
  const anchor = object(data?.[0]), at = Date.parse(text(anchor.sent_at))
  if (anchor.external_message_id !== externalId || !Number.isFinite(at)) return { scheduled: false, reason: 'old_input' }
  const jobs = weeks.flatMap(week => {
    if (at < Date.parse(settings.later[week].activatedAt!)) return []
    const due = nutritionSendTime(at + week * 7 * 86_400_000, settings.hours)
    return due ? [{ ...scope, kind: 'maintenance', contact_key: null, event_key: `nutrition${week}w:${conversationId}:${anchor.id}`, available_at: new Date(due).toISOString(),
      payload: { task: LATER_ROUTES[week].task, leadId, conversationId, kommoId: Number(lead.kommo_id), anchorId: anchor.id, anchorAt: anchor.sent_at, activatedAt: settings.later[week].activatedAt } }] : []
  })
  if (!jobs.length) return { scheduled: false, reason: 'old_input_or_no_hours' }
  const result = await db().from('lv_integration_events').upsert(jobs, { onConflict: 'project_id,event_key', ignoreDuplicates: true })
  if (result.error) throw Error('NUTRITION_SCHEDULE_FAILED')
  return { scheduled: true, weeks: jobs.map(j => j.payload.task) }
}
export async function cancelNutritionLater(kommoId: number) {
  const { error } = await db().from('lv_integration_events').update({ status: 'cancelled', completed_at: new Date().toISOString(), result: { reason: 'new_client_message' } })
    .match(scope).eq('kind', 'maintenance').eq('status', 'pending').contains('payload', { kommoId }).in('payload->>task', [LATER_ROUTES[2].task, LATER_ROUTES[3].task])
  if (error) throw Error('NUTRITION_CANCEL_FAILED')
}
export async function sendNutritionLater(job: Row, guard: Guard) {
  assertLive(); await guard()
  const payload = object(job.payload)
  const week: LaterWeek | null = payload.task === LATER_ROUTES[2].task ? 2 : payload.task === LATER_ROUTES[3].task ? 3 : null
  if (!week) throw Error('INVALID_NUTRITION_WEEK')
  if (!Number.isFinite(Date.parse(text(payload.anchorAt))) || Date.now() - Date.parse(text(payload.anchorAt)) > (week * 7 + 14) * 86_400_000) return { action: 'cancelled', reason: 'expired' }
  let c = await weekOneContext(payload, week)
  if (c.reason || !c.lead) return { action: 'cancelled', reason: c.reason }
  if (c.due > Date.now() + 1000) return { action: 'deferred', nextAt: new Date(c.due).toISOString() }
  const choose = (context: typeof c) => context.lead && laterChoice(week, context.lead, context.history, context.memory.outbound, context.financing.partners)
  const choice = choose(c)
  if (!choice) return { action: 'cancelled', reason: 'no_relevant_new_content' }
  if (!(await verifyLaterTemplates())[week]) return { action: 'cancelled', reason: 'template_not_approved_or_mismatched' }
  if (botStopped(await getKommoLead(Number(payload.kommoId)))) return { action: 'cancelled', reason: 'kommo_paused' }
  const route = LATER_ROUTES[week], signature = JSON.stringify({ config: c.settings.later[week], choice })
  await guard()
  await setKommoField(Number(payload.kommoId), route.fieldId, choice.topic)
  c = await weekOneContext(payload, week)
  if (c.reason || !c.lead) return { action: 'cancelled', reason: c.reason }
  if (signature !== JSON.stringify({ config: c.settings.later[week], choice: choose(c) })) return { action: 'cancelled', reason: 'content_changed_before_send' }
  if (c.due > Date.now() + 1000) return { action: 'deferred', nextAt: new Date(c.due).toISOString() }
  if (botStopped(await getKommoLead(Number(payload.kommoId)))) return { action: 'cancelled', reason: 'kommo_paused' }
  await guard()
  await launchSalesbot(Number(payload.kommoId), route.botId)
  const receipt = { week, ...choice, template_id: route.templateId, salesbot_id: route.botId, attachment_id: route.attachmentId }
  await rpc('register_outbound_message', { p_conversation_id: payload.conversationId, p_content: choice.body, p_model: `template:${route.task}`,
    p_tool_calls: { provider_status: 'accepted', source_message_id: payload.anchorId, [route.task]: receipt } })
  return { ...receipt, content_action: choice.action, action: 'accepted', provider_status: 'accepted_not_delivery_confirmed' }
}
