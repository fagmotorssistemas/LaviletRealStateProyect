'use server'
import { assertCanAccessCrmPath, getSessionUser } from '@/lib/auth/session'
import { analyzeLeadConversation } from '@/lib/integrations/automation/conversation-analysis'
import { loadConversationAnalysisDashboard } from '@/services/conversationAnalysis.service'

const path = '/inmobiliaria/analisis-conversaciones'
const validId = (id: string) => /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(id)
async function context() {
  const session = await assertCanAccessCrmPath(path)
  const { supabase } = await getSessionUser()
  return { supabase, actor: { id: session.user.id, role: session.profile.role } }
}
export async function getConversationAnalysisDashboard() {
  const { supabase, actor } = await context()
  return loadConversationAnalysisDashboard(supabase, actor)
}
export async function getConversationAnalysisDetail(leadId: string) {
  if (!validId(leadId)) throw Error('Identificador inválido.')
  const { supabase, actor } = await context()
  const result = await loadConversationAnalysisDashboard(supabase, actor, [leadId], true)
  if (!result.items[0]) throw Error('No tiene acceso al lead solicitado.')
  return result.items[0]
}
export async function evaluateConversation(leadId: string) {
  if (!validId(leadId)) throw Error('Identificador inválido.')
  const { supabase } = await context()
  const lead = await supabase.from('leads').select('id,project_id').eq('id', leadId).maybeSingle()
  if (lead.error || !lead.data?.project_id) throw Error('No tiene acceso al lead solicitado.')
  await analyzeLeadConversation(lead.data.id, lead.data.project_id)
  return { ok: true }
}
export async function saveConversationAnalysisReview(input: { leadId: string; signature: string; status: string; note: string }) {
  if (!validId(input.leadId) || !['reviewing', 'actioned', 'resolved', 'dismissed'].includes(input.status)
    || typeof input.note !== 'string' || input.note.trim().length < 10 || input.note.length > 1500) throw Error('Escriba una observación de entre 10 y 1500 caracteres.')
  const { supabase, actor } = await context()
  const data = await loadConversationAnalysisDashboard(supabase, actor, [input.leadId])
  const item = data.items[0]
  if (!item?.canReview) throw Error('Solo el responsable o un administrador puede registrar esta revisión.')
  if (item.signature !== input.signature) throw Error('El caso cambió. Actualice su diagnóstico antes de guardar.')
  const { data: lead, error: readError } = await supabase.from('leads').select('tenant_id,project_id').eq('id', item.id).single()
  if (readError || !lead) throw Error('No se pudo comprobar el acceso al caso.')
  const { error } = await supabase.from('lead_conversation_analysis_reviews').insert({ lead_id: item.id, tenant_id: lead.tenant_id,
    project_id: lead.project_id, actor_id: actor.id, status: input.status, note: input.note.trim(), issue_signature: item.signature,
    baseline: { last_customer_at: item.lastCustomerAt, stage: item.stage, signal_keys: item.signals.map(s => s.key) } })
  if (error) throw Error('No se pudo guardar la revisión. Compruebe los permisos y la migración del panel.')
  return { ok: true }
}
