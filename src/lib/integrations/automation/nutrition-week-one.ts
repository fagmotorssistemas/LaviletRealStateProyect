import 'server-only'
import { nutritionWeekOneConfig, nutritionWeekOneReady, WEEK_ONE_BROCHURE_URL, WEEK_ONE_ROUTES } from '@/lib/inmobiliaria/nutritionWeekOne'
import { nutritionSendTime } from '@/lib/inmobiliaria/nutrition24h'
import { botVisitPolicy } from '@/lib/inmobiliaria/botVisits'
import { assertLive, automationSettings } from './config'
import { autoConfig, db, one, object, permitted, rpc, scope, text, type Row } from './data'
import { nutritionLeadEligible } from './nutrition-context'
import { botStopped, getKommoLead, launchSalesbot, setKommoField, verifyWeekOneTemplates } from './kommo'
import { financingContext } from './financing'
import { sharedBrochure, weekOneChoice } from './nutrition-week-one-rules'
import type { Guard } from './visits'

const DAY = 86_400_000
export async function weekOneSettings() {
  const [project, automation] = await Promise.all([
    db().from('projects').select('policies_json').match({ tenant_id: scope.tenant_id, id: scope.project_id }).maybeSingle(),
    db().from('project_automation_config').select('business_hours,mode').match(scope).maybeSingle(),
  ])
  if (project.error || automation.error) throw Error('WEEK_ONE_SETTINGS_FAILED')
  return { config: nutritionWeekOneConfig(project.data?.policies_json), hours: automation.data?.business_hours,
    visits: botVisitPolicy(project.data?.policies_json, automation.data?.mode || 'lanzamiento') }
}

export async function scheduleNutritionWeekOne(leadId: string, conversationId: string, externalId: string) {
  const settings = await weekOneSettings()
  if (!nutritionWeekOneReady(settings.config)) return { scheduled: false, reason: 'disabled' }
  const lead = await one('leads', leadId), conversation = await one('conversations', conversationId)
  if (!nutritionLeadEligible(lead)) return { scheduled: false, reason: 'ineligible' }
  if (conversation.lead_id !== leadId) throw Error('WEEK_ONE_CONVERSATION_MISMATCH')
  const { data, error } = await db().from('messages').select('id,sent_at,external_message_id').eq('conversation_id', conversationId)
    .eq('role', 'cliente').order('sent_at', { ascending: false }).order('id', { ascending: false }).limit(1)
  if (error) throw Error('WEEK_ONE_ANCHOR_FAILED')
  const anchor = object(data?.[0]), at = Date.parse(text(anchor.sent_at))
  if (anchor.external_message_id !== externalId || !Number.isFinite(at) || at < Date.parse(settings.config.activatedAt!)) return { scheduled: false, reason: 'old_input' }
  const due = nutritionSendTime(at + 7 * DAY, settings.hours)
  if (!due) return { scheduled: false, reason: 'no_business_hours' }
  const result = await db().from('lv_integration_events').upsert({ ...scope, kind: 'maintenance', contact_key: null,
    event_key: `nutrition1w:${conversationId}:${anchor.id}`, available_at: new Date(due).toISOString(),
    payload: { task: 'nutrition_week_one', leadId, conversationId, kommoId: Number(lead.kommo_id), anchorId: anchor.id, anchorAt: anchor.sent_at, activatedAt: settings.config.activatedAt } },
    { onConflict: 'project_id,event_key', ignoreDuplicates: true })
  if (result.error) throw Error('WEEK_ONE_SCHEDULE_FAILED')
  return { scheduled: true, nextAt: new Date(due).toISOString() }
}

/** Same Kommo contact across leads and conversations; never cross project/tenant boundaries. */
export async function weekOneMemory(lead: Row) {
  const contact = text(lead.contact_id)
  let relatedQuery = db().from('leads').select('id,kommo_id,bot_enabled,tracking_opt_out_at,handoff_status,behavior_signals').match(scope)
  relatedQuery = /^\d+$/.test(contact) ? relatedQuery.eq('contact_id', contact) : relatedQuery.eq('id', lead.id)
  const related = await relatedQuery.limit(101)
  if (related.error || !related.data?.length || related.data.length > 100) throw Error('WEEK_ONE_CONTACT_MEMORY_FAILED')
  const leads = related.data as Row[], leadIds = leads.map(l => text(l.id))
  const conversations = await db().from('conversations').select('id').match(scope).in('lead_id', leadIds).limit(501)
  if (conversations.error || conversations.data?.length === 501) throw Error('WEEK_ONE_HISTORY_LIMIT')
  const ids = (conversations.data || []).map(c => c.id)
  const outbound: Row[] = []
  for (let from = 0; ids.length && from <= 5000; from += 500) {
    const page = await db().from('messages').select('id,role,content,sent_at,media_url,tool_calls,model_used').in('conversation_id', ids)
      .in('role', ['bot', 'asesor']).order('sent_at', { ascending: false }).order('id', { ascending: false }).range(from, from + 499)
    if (page.error) throw Error('WEEK_ONE_HISTORY_FAILED')
    outbound.push(...page.data || [])
    if ((page.data?.length || 0) < 500) break
    if (from === 5000) throw Error('WEEK_ONE_HISTORY_LIMIT')
  }
  const latest = ids.length ? await db().from('messages').select('id').in('conversation_id', ids).eq('role', 'cliente')
    .order('sent_at', { ascending: false }).order('id', { ascending: false }).limit(1) : { data: [], error: null }
  if (latest.error) throw Error('WEEK_ONE_CONTACT_ANCHOR_FAILED')
  return { leads, leadIds, outbound, latestClientId: latest.data?.[0]?.id, brochureShared: sharedBrochure(outbound, leads) }
}

async function weekOneContext(payload: Row) {
  const [lead, conversation, settings, auto] = await Promise.all([one('leads', text(payload.leadId)), one('conversations', text(payload.conversationId)), weekOneSettings(), autoConfig()])
  if (conversation.lead_id !== lead.id) throw Error('WEEK_ONE_CONVERSATION_MISMATCH')
  if (!nutritionWeekOneReady(settings.config) || payload.activatedAt !== settings.config.activatedAt) return { reason: 'disabled_or_changed' } as const
  if (!nutritionLeadEligible(lead) || !permitted(auto, lead, automationSettings().testLeadId) || Number(lead.kommo_id) !== Number(payload.kommoId)) return { reason: 'ineligible' } as const
  const memory = await weekOneMemory(lead)
  const [messages, latest, visits, drafts, inputs, jobs, financing, qualifications] = await Promise.all([
    db().from('messages').select('id,role,content,sent_at,tool_calls').eq('conversation_id', conversation.id).order('sent_at', { ascending: false }).order('id', { ascending: false }).limit(40),
    db().from('conversations').select('id').match(scope).eq('lead_id', lead.id).order('last_message_at', { ascending: false }).limit(1),
    db().from('appointments').select('id').match(scope).in('lead_id', memory.leadIds).not('status', 'in', '(cancelado,atendido)').or(`start_time.is.null,start_time.gt.${new Date().toISOString()}`).limit(1),
    db().from('lv_visit_intakes').select('conversation_id').match(scope).in('lead_id', memory.leadIds).eq('status', 'collecting').limit(1),
    db().from('lv_integration_events').select('id,payload').match(scope).eq('kind', 'inbound').in('status', ['pending', 'processing', 'uncertain'])
      .in('payload->>kommoId', memory.leads.map(l => String(l.kommo_id))).limit(1),
    db().from('lv_outbox').select('id').match(scope).in('lead_id', memory.leadIds).in('status', ['pending', 'claimed', 'uncertain']).limit(1),
    financingContext(lead),
    db().from('financing_prequalifications').select('id').match(scope).in('lead_id', memory.leadIds).eq('explicit_consent', true).limit(1),
  ])
  if ([messages, latest, visits, drafts, inputs, jobs, qualifications].some(r => r.error)) throw Error('WEEK_ONE_CONTEXT_FAILED')
  const history = (messages.data || []).reverse() as Row[]
  const lastClient = history.findLast(m => m.role === 'cliente')
  if (latest.data?.[0]?.id !== conversation.id || lastClient?.id !== payload.anchorId || memory.latestClientId !== payload.anchorId) return { reason: 'new_context' } as const
  if (memory.leads.some(l => l.bot_enabled !== true || l.tracking_opt_out_at || (l.handoff_status && l.handoff_status !== 'none'))) return { reason: 'contact_paused' } as const
  if (inputs.data?.length || history.at(-1)?.role !== 'bot') return { reason: 'unanswered_input' } as const
  if (visits.data?.length || drafts.data?.length || jobs.data?.length || qualifications.data?.length) return { reason: 'active_coordination' } as const
  if (memory.outbound.some(m => m.role === 'asesor' && Date.parse(text(m.sent_at)) >= Date.parse(text(payload.anchorAt)))) return { reason: 'human_attention' } as const
  if (/^(?:no(?: muchas)? gracias|no|por ahora no|no me interesa)[.!\s]*$/i.test(text(lastClient?.content))) return { reason: 'declined' } as const
  if (memory.outbound.some(m => object(m.tool_calls).nutrition_week_one)) return { reason: 'week_one_already_sent' } as const
  const attempts = await db().from('lv_integration_events').select('status,result,completed_at').match(scope).eq('kind', 'maintenance')
    .in('payload->>leadId', memory.leadIds).in('payload->>task', ['nutrition_24h', 'nutrition_week_one']).in('status', ['completed', 'uncertain', 'cancelled']).limit(1000)
  if (attempts.error || attempts.data?.length === 1000) throw Error('WEEK_ONE_ATTEMPTS_FAILED')
  if (attempts.data?.some(a => a.status === 'uncertain' || object(a.result).requires_review === true)) return { reason: 'previous_attempt_needs_review' } as const
  const accepted = memory.outbound.filter(m => /^template:nutrition_/.test(text(m.model_used)))
  const lastFollowup = Math.max(0, ...accepted.map(m => Date.parse(text(m.sent_at)) || 0), ...(attempts.data || []).filter(a => object(a.result).action === 'accepted').map(a => Date.parse(a.completed_at || '') || 0))
  const due = nutritionSendTime(Math.max(Date.now(), Date.parse(text(payload.anchorAt)) + 7 * DAY, lastFollowup + 7 * DAY), settings.hours)
  if (!due) return { reason: 'no_business_hours' } as const
  return { reason: '', lead, conversation, settings, memory, history, financing, due } as const
}

export async function brochureLinkReady() {
  try {
    const response = await fetch(WEEK_ONE_BROCHURE_URL, { method: 'HEAD', redirect: 'follow', signal: AbortSignal.timeout(10000), cache: 'no-store' })
    return response.ok && new URL(response.url).origin === 'https://www.lavilett.com'
      && /application\/pdf|text\/html/.test(response.headers.get('content-type') || '')
      && !/\/login|\/acceso-pendiente/.test(new URL(response.url).pathname)
  } catch { return false }
}

export async function sendNutritionWeekOne(job: Row, guard: Guard) {
  assertLive(); await guard()
  const payload = object(job.payload)
  if (!Number.isFinite(Date.parse(text(payload.anchorAt))) || Date.now() - Date.parse(text(payload.anchorAt)) > 21 * DAY) return { action: 'cancelled', reason: 'expired' }
  let c = await weekOneContext(payload)
  if (c.reason || !c.lead) return { action: 'cancelled', reason: c.reason }
  if (c.due > Date.now() + 1000) return { action: 'deferred', nextAt: new Date(c.due).toISOString(), reason: 'business_hours_or_shared_frequency' }
  const catalog = await db().from('units').select('id,unit_number,category,bedrooms').match(scope).eq('is_published', true).eq('status', 'disponible').limit(100)
  if (catalog.error) throw Error('WEEK_ONE_CATALOG_FAILED')
  const choose = (context: typeof c) => context.lead && weekOneChoice(context.settings.config, context.lead, context.history, context.memory.outbound, catalog.data || [], context.memory.brochureShared,
    { financing: context.financing.partners.length > 0, visits: context.settings.visits.allowSuggestions && context.settings.visits.launchDestination === 'office' })
  const choice = choose(c)
  if (!choice) return { action: 'cancelled', reason: 'no_relevant_new_content' }
  const approved = await verifyWeekOneTemplates()
  if (!approved[choice.kind]) return { action: 'cancelled', reason: 'template_not_approved_or_mismatched' }
  if (choice.kind === 'brochure' && !await brochureLinkReady()) return { action: 'cancelled', reason: 'brochure_link_unavailable', requires_review: true }
  if (botStopped(await getKommoLead(Number(payload.kommoId)))) return { action: 'cancelled', reason: 'kommo_paused' }
  const signature = JSON.stringify({ config: c.settings.config, choice })
  await guard()
  if (choice.kind === 'followup') await setKommoField(Number(payload.kommoId), WEEK_ONE_ROUTES.followup.fieldId, choice.topic)
  c = await weekOneContext(payload)
  if (c.reason || !c.lead) return { action: 'cancelled', reason: c.reason }
  if (signature !== JSON.stringify({ config: c.settings.config, choice: choose(c) })) return { action: 'cancelled', reason: 'content_changed_before_send' }
  if (c.due > Date.now() + 1000) return { action: 'deferred', nextAt: new Date(c.due).toISOString() }
  if (botStopped(await getKommoLead(Number(payload.kommoId)))) return { action: 'cancelled', reason: 'kommo_paused' }
  await guard()
  const route = WEEK_ONE_ROUTES[choice.kind]
  await launchSalesbot(Number(payload.kommoId), route.botId)
  const receipt = { kind: choice.kind, action: choice.action, topic: choice.topic, unit_id: choice.unitId || null, reason: choice.reason, template_id: route.templateId, salesbot_id: route.botId }
  await rpc('register_outbound_message', { p_conversation_id: payload.conversationId, p_content: choice.body, p_model: 'template:nutrition_week_one',
    p_tool_calls: { provider_status: 'accepted', source_message_id: payload.anchorId, nutrition_week_one: receipt, ...(choice.kind === 'brochure' ? { brochure_sent: true } : {}) } })
  return { ...receipt, content_action: receipt.action, action: 'accepted', provider_status: 'accepted_not_delivery_confirmed' }
}

export async function cancelNutritionWeekOne(kommoId: number) {
  const { error } = await db().from('lv_integration_events').update({ status: 'cancelled', completed_at: new Date().toISOString(), result: { reason: 'new_client_message' } })
    .match(scope).eq('kind', 'maintenance').eq('status', 'pending').contains('payload', { task: 'nutrition_week_one', kommoId })
  if (error) throw Error('WEEK_ONE_CANCEL_FAILED')
}
