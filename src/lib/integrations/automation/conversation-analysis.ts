import 'server-only'
import { createHash } from 'node:crypto'
import { aiJson } from './ai'
import { db, object, scope, text, type Row } from './data'
import { automationSettings } from './config'
import { loadConversationAnalysisDashboard } from '@/services/conversationAnalysis.service'
import { redactAnalysisText } from '@/lib/inmobiliaria/conversationAnalysis'
import { ANALYSIS_VERSION, CONVERSATION_ANALYSIS_RULES, conversationAnalysisSchema, normalizeAnalysisAssessment } from './conversation-analysis-contract'

export async function analyzeLeadConversation(leadId: string, projectId: string) {
  const lead = await db().from('leads').select('id,tenant_id,project_id,handoff_status,tracking_opt_out_at,updated_at').eq('id', leadId).eq('project_id', projectId).maybeSingle()
  if (lead.error || !lead.data) throw Error('ANALYSIS_LEAD_UNAVAILABLE')
  const conversation = await db().from('conversations').select('id,last_message_at,summary').eq('lead_id', leadId).order('last_message_at', { ascending: false }).limit(1).maybeSingle()
  if (conversation.error || !conversation.data) throw Error('ANALYSIS_CONVERSATION_UNAVAILABLE')
  // Keep opening context plus the recent exchange; explicitly disclose the bound.
  const select = 'id,role,content,sent_at'
  const [opening, recent, operational] = await Promise.all([
    db().from('messages').select(select).eq('conversation_id', conversation.data.id).order('sent_at').order('id').limit(12),
    db().from('messages').select(select).eq('conversation_id', conversation.data.id).order('sent_at', { ascending: false }).order('id', { ascending: false }).limit(60),
    loadConversationAnalysisDashboard(db(), { id: '', role: null }, [leadId]),
  ])
  if (opening.error || recent.error || !recent.data?.length) throw Error('ANALYSIS_MESSAGES_UNAVAILABLE')
  const history = [...new Map([...(opening.data || []), ...recent.data].map(m => [m.id, m])).values()].sort((a, b) => a.sent_at.localeCompare(b.sent_at) || a.id.localeCompare(b.id))
  const last = history.at(-1)!, item = operational.items[0]
  if (!item) throw Error('ANALYSIS_OPERATIONAL_CONTEXT_UNAVAILABLE')
  const summary = object(conversation.data.summary), memory = object(summary._interpretation_memory)
  const snapshot = {
    stage: item.stage, lost: item.lost, won: item.won, future_interest: item.futureInterest, contact_stopped: item.contactStopped,
    closure_reason_recorded_by_team: item.closureReason,
    waiting: item.waiting, moment: item.moment, signals: item.signals, coverage: item.coverage,
    lead_updated_at: lead.data.updated_at,
    known_preferences: { property: object(memory.property), budget_status: object(memory.budget).status, selected_ids: object(summary._property_context).selected_ids },
    last_review: item.reviews[0] ? { id: item.reviews[0].id, status: item.reviews[0].status, note: redactAnalysisText(item.reviews[0].note) } : null,
  }
  const fingerprint = createHash('sha256').update(JSON.stringify({ history, snapshot, version: ANALYSIS_VERSION, prompt: CONVERSATION_ANALYSIS_RULES })).digest('hex')
  const previous = await db().from('lead_conversation_analyses').select('*').eq('conversation_id', conversation.data.id).eq('source_fingerprint', fingerprint).maybeSingle()
  if (previous.error) throw Error('ANALYSIS_STORAGE_UNAVAILABLE')
  if (previous.data) return previous.data
  const modelHistory = history.map(message => ({ ...message, content: redactAnalysisText(message.content).slice(0, 1400) }))
  const raw = await aiJson(CONVERSATION_ANALYSIS_RULES, { operational_context: snapshot, context_scope: 'opening_12_and_latest_60_messages',
    messages: modelHistory }, conversationAnalysisSchema)
  const assessment = normalizeAnalysisAssessment(raw, modelHistory as Row[])
  const analysis = { ...assessment, version: ANALYSIS_VERSION, scope: 'opening_12_and_latest_60_messages', evaluated_at: new Date().toISOString(),
    handoff_status: text(lead.data.handoff_status) || 'none', opt_out: Boolean(lead.data.tracking_opt_out_at),
    inactivity: Date.now() - Date.parse(last.sent_at) > 24 * 3600000, operational_snapshot: snapshot,
    code_version: process.env.VERCEL_GIT_COMMIT_SHA || process.env.AUTOMATION_CODE_VERSION || null }
  const saved = await db().from('lead_conversation_analyses').upsert({ tenant_id: lead.data.tenant_id, project_id: projectId, lead_id: leadId,
    conversation_id: conversation.data.id, source_last_message_at: last.sent_at, source_fingerprint: fingerprint, analysis }, { onConflict: 'conversation_id,source_fingerprint' }).select('*').single()
  if (saved.error) throw Error('ANALYSIS_SAVE_FAILED')
  return saved.data
}

/** One bounded analytical task per maintenance pass; never sends a message. */
export async function analyzeIdleConversation(config: Row, guard: () => Promise<void>) {
  if (process.env.CONVERSATION_ANALYSIS_AUTOMATIC === 'false') return { reason: 'automatic_analysis_disabled' }
  const single = automationSettings().testLeadId
  const allowed = single ? [single] : config.test_only === true ? (Array.isArray(config.test_lead_ids) ? config.test_lead_ids : []) : null
  const leads = await db().rpc('lv_idle_analysis_candidate', { p_tenant_id: scope.tenant_id, p_project_id: scope.project_id, p_allowed_lead_ids: allowed })
  if (leads.error) return { reason: 'analysis_candidates_unavailable' }
  const candidate = leads.data?.[0]
  if (!candidate) return { reason: 'no_idle_candidate' }
  await guard()
  try { await analyzeLeadConversation(candidate.lead_id, candidate.project_id); return { action: 'analysis_saved' } }
  catch { return { reason: 'analysis_failed_retry_later' } }
}
