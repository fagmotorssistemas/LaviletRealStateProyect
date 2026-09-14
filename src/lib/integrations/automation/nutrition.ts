import 'server-only'
import { assertLive, automationSettings } from './config'
import { autoConfig, db, object, one, permitted, rpc, scope, text, type Row } from './data'
import { botStopped, getKommoLead, launchSalesbot, setKommoField, verifyNutritionTemplate } from './kommo'
import { nutrition24hConfig, nutrition24hReady, nutritionSendTime } from '@/lib/inmobiliaria/nutrition24h'
import { nutritionLeadEligible, nutritionMessage } from './nutrition-context'
import type { Guard } from './visits'

async function settings() {
  const [project, config] = await Promise.all([
    db().from('projects').select('policies_json').eq('tenant_id', scope.tenant_id).eq('id', scope.project_id).maybeSingle(),
    db().from('project_automation_config').select('business_hours').match(scope).maybeSingle(),
  ])
  if (project.error || config.error) throw Error('NUTRITION_SETTINGS_FAILED')
  return { config: nutrition24hConfig(project.data?.policies_json), hours: config.data?.business_hours }
}

export async function cancelNutrition24h(kommoId: number) {
  const { error } = await db().from('lv_integration_events').update({ status: 'cancelled', completed_at: new Date().toISOString(), result: { reason: 'new_client_message' } })
    .match(scope).eq('kind', 'maintenance').eq('status', 'pending').contains('payload', { task: 'nutrition_24h', kommoId })
  if (error) throw Error('NUTRITION_CANCEL_FAILED')
}

// Called after an actual bot reply is accepted. No backfill of old silent leads,
// and no nutrition if the lead's question is still awaiting a response.
export async function scheduleNutrition24h(leadId: string, conversationId: string, externalId: string) {
  const { config, hours } = await settings()
  if (!nutrition24hReady(config)) return { scheduled: false, reason: 'disabled_or_unapproved' }
  const lead = await one('leads', leadId)
  if (!nutritionLeadEligible(lead)) return { scheduled: false, reason: 'ineligible' }
  const conversation = await one('conversations', conversationId)
  if (conversation.lead_id !== leadId) throw Error('NUTRITION_CONVERSATION_MISMATCH')
  const { data, error } = await db().from('messages').select('id,external_message_id,sent_at,content').eq('conversation_id', conversationId)
    .eq('role', 'cliente').order('sent_at', { ascending: false }).order('id', { ascending: false }).limit(1)
  if (error) throw Error('NUTRITION_ANCHOR_FAILED')
  const anchor = object(data?.[0]), sentAt = Date.parse(text(anchor.sent_at))
  if (anchor.external_message_id !== externalId || !Number.isFinite(sentAt) || sentAt < Date.parse(config.activatedAt!)) return { scheduled: false, reason: 'old_input' }
  const due = nutritionSendTime(sentAt + 86_400_000, hours)
  if (due === null) return { scheduled: false, reason: 'no_business_hours' }
  const { error: writeError } = await db().from('lv_integration_events').upsert({ ...scope,
    event_key: `nutrition24h:${conversationId}:${text(anchor.id)}`, kind: 'maintenance',
    // Deliberately null: inbound batching must never absorb a scheduled follow-up.
    contact_key: null, available_at: new Date(due).toISOString(),
    payload: { task: 'nutrition_24h', leadId, conversationId, anchorId: anchor.id, anchorAt: anchor.sent_at,
      kommoId: Number(lead.kommo_id), activatedAt: config.activatedAt },
  }, { onConflict: 'project_id,event_key', ignoreDuplicates: true })
  if (writeError) throw Error('NUTRITION_SCHEDULE_FAILED')
  return { scheduled: true }
}

async function context(payload: Row) {
  const lead = await one('leads', text(payload.leadId)), conversation = await one('conversations', text(payload.conversationId))
  if (conversation.lead_id !== lead.id) throw Error('NUTRITION_CONVERSATION_MISMATCH')
  const [messages, visits, inputs, conversations, jobs, auto, config] = await Promise.all([
    db().from('messages').select('id,role,content,sent_at,tool_calls,model_used').eq('conversation_id', conversation.id).order('sent_at', { ascending: false }).order('id', { ascending: false }).limit(40),
    db().from('appointments').select('id').match(scope).eq('lead_id', lead.id).not('status', 'in', '(cancelado,atendido)').or(`start_time.is.null,start_time.gt.${new Date().toISOString()}`).limit(1),
    db().from('lv_integration_events').select('id').match(scope).eq('kind', 'inbound').like('contact_key', `${Number(lead.kommo_id)}:%`).in('status', ['pending', 'processing', 'uncertain']).limit(1),
    db().from('conversations').select('id').match(scope).eq('lead_id', lead.id).order('last_message_at', { ascending: false }).limit(1),
    db().from('lv_outbox').select('id').match(scope).eq('lead_id', lead.id).in('status', ['pending', 'claimed', 'uncertain']).limit(1),
    autoConfig(), settings(),
  ])
  if ([messages, visits, inputs, conversations, jobs].some(r => r.error)) throw Error('NUTRITION_CONTEXT_FAILED')
  const history = (messages.data || []).reverse() as Row[]
  const lastClient = history.filter(m => m.role === 'cliente').at(-1)
  let reason = ''
  if (!nutrition24hReady(config.config) || config.config.activatedAt !== payload.activatedAt) reason = 'disabled_or_changed'
  else if (!nutritionLeadEligible(lead) || !permitted(auto, lead, automationSettings().testLeadId)) reason = 'ineligible'
  else if (Number(lead.kommo_id) !== Number(payload.kommoId) || conversations.data?.[0]?.id !== conversation.id || lastClient?.id !== payload.anchorId) reason = 'new_context'
  else if (visits.data?.length || jobs.data?.length) reason = 'active_visit'
  else if (inputs.data?.length) reason = 'pending_input'
  else if (history.some(m => m.role === 'asesor' && Date.parse(text(m.sent_at)) >= Date.parse(text(payload.anchorAt)))) reason = 'human_attention'
  else if (history.at(-1)?.role !== 'bot') reason = 'unanswered_input'
  else if (/^(?:no(?: muchas)? gracias|no|por ahora no|no me interesa)[.!\s]*$/i.test(text(lastClient?.content))) reason = 'declined'
  const due = nutritionSendTime(Math.max(Date.now(), Date.parse(text(payload.anchorAt)) + 86_400_000), config.hours)
  if (!due) reason = reason || 'no_business_hours'
  return { lead, conversation, history, config: config.config, reason, due }
}

export async function sendNutrition24h(job: Row, guard: Guard) {
  assertLive(); await guard()
  const payload = object(job.payload)
  let c = await context(payload)
  if (c.reason) return { action: 'cancelled', reason: c.reason }
  if (Date.now() - Date.parse(text(payload.anchorAt)) > 7 * 86_400_000) return { action: 'cancelled', reason: 'expired' }
  if (c.due! > Date.now() + 1000) return { action: 'deferred', nextAt: new Date(c.due!).toISOString() }
  // An ambiguous previous attempt is never resent. Cap this touch to once a week
  // even when the client resumes and then goes silent again the following day.
  const { data: previous, error } = await db().from('lv_integration_events').select('status,result,completed_at')
    .match(scope).neq('id', job.id).contains('payload', { task: 'nutrition_24h', leadId: payload.leadId }).in('status', ['completed', 'uncertain'])
    .order('received_at', { ascending: false }).limit(100)
  if (error) throw Error('NUTRITION_HISTORY_FAILED')
  if (previous?.some(row => row.status === 'uncertain' || (object(row.result).action === 'accepted' && Date.now() - Date.parse(row.completed_at) < 7 * 86_400_000))) return { action: 'cancelled', reason: 'previous_followup' }
  if (botStopped(await getKommoLead(Number(payload.kommoId)))) return { action: 'cancelled', reason: 'kommo_paused' }
  if (!await verifyNutritionTemplate(c.config.templateName, c.config.fieldId)) return { action: 'cancelled', reason: 'template_not_approved_or_mismatched' }
  const { data: catalog, error: catalogError } = await db().from('units').select('id,unit_number,category').match(scope).eq('is_published', true).limit(100)
  if (catalogError) throw Error('NUTRITION_CATALOG_FAILED')
  const rendered = nutritionMessage(c.lead, c.history, object(c.conversation.summary), catalog || [])
  await guard()
  await setKommoField(Number(payload.kommoId), c.config.fieldId, rendered.topic)
  const route = JSON.stringify(c.config)
  c = await context(payload)
  if (c.reason || JSON.stringify(c.config) !== route) return { action: 'cancelled', reason: c.reason || 'route_changed' }
  if (c.due! > Date.now() + 1000) return { action: 'deferred', nextAt: new Date(c.due!).toISOString() }
  if (botStopped(await getKommoLead(Number(payload.kommoId)))) return { action: 'cancelled', reason: 'kommo_paused' }
  await guard()
  await launchSalesbot(Number(payload.kommoId), c.config.botId)
  await rpc('register_outbound_message', { p_conversation_id: payload.conversationId, p_content: rendered.body,
    p_model: 'template:nutrition_24h', p_tool_calls: { provider_status: 'accepted', nutrition_24h: true, source_message_id: payload.anchorId, context: rendered.context } })
  return { action: 'accepted', context: rendered.context, provider_status: 'accepted_not_delivery_confirmed' }
}
