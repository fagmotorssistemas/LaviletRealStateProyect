import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import { readMessageEvidence } from './marketingEvidence.service'
import { pipelineIssue } from '@/lib/inmobiliaria/leadPipelineDiagnostics'
import type { LeadPipelineIssue } from '@/types/leadPipeline'

export type PipelineSourceRow = Record<string, unknown>
type ReadQuery = PromiseLike<{ data: unknown[] | null; error: { message: string; code?: string } | null }>

/** PostgREST caps each response. Read every authorized row before calculating
 * totals or grouping columns; never present one page as the entire pipeline. */
export async function readPipelinePages(build: (from: number, to: number) => ReadQuery): Promise<PipelineSourceRow[]> {
  const result: PipelineSourceRow[] = []
  for (let offset = 0; ; offset += 1000) {
    const response = await build(offset, offset + 999)
    if (response.error) throw Object.assign(new Error(response.error.message), response.error)
    result.push(...(response.data || []) as PipelineSourceRow[])
    if (!response.data || response.data.length < 1000) return result
  }
}

export async function readPipelineRelated(
  ids: string[], build: (ids: string[], from: number, to: number) => ReadQuery,
): Promise<PipelineSourceRow[]> {
  const result: PipelineSourceRow[] = []
  for (let index = 0; index < ids.length; index += 150) {
    const chunk = ids.slice(index, index + 150)
    result.push(...await readPipelinePages((from, to) => build(chunk, from, to)))
  }
  return result
}

export async function loadLeadPipelineSources(client: SupabaseClient, requestedIds?: string[]) {
  // The caller's authenticated client is intentional: authorized lead IDs must
  // come from RLS, not from a service-role tenant-wide enumeration.
  const leads = requestedIds
    ? await readPipelineRelated(requestedIds, (ids, from, to) => client.from('leads').select('*').in('id', ids).order('id').range(from, to))
    : await readPipelinePages((from, to) => client.from('leads').select('*').order('id').range(from, to))
  const ids = leads.map(row => String(row.id))
  const admin = tryCreateAdminClient()
  const warnings: string[] = []
  const issues: LeadPipelineIssue[] = []
  const coverage: Record<string, boolean> = {}
  async function optional(key: string, label: string, load: () => Promise<PipelineSourceRow[]>) {
    try { const result = await load(); coverage[key] = true; return result }
    catch (error) {
      coverage[key] = false
      const issue = pipelineIssue(key, label, error, crypto.randomUUID())
      issues.push(issue)
      warnings.push(`${label}: ${issue.message}`)
      console.error('lead_pipeline_source_failed', { source: key, code: issue.code, category: issue.category, reference: issue.reference })
      return []
    }
  }
  const [conversations, events, appointments, reservations, sales, metadata, units, profiles, projects, history] = await Promise.all([
    optional('conversations', 'el contexto de conversación', () => readPipelineRelated(ids, (chunk, from, to) => client.from('conversations')
      .select('id,lead_id,tenant_id,project_id,summary,started_at,last_message_at,status').in('lead_id', chunk).order('id').range(from, to))),
    optional('events', 'el historial de señales comerciales', () => readPipelineRelated(ids, (chunk, from, to) => client.from('lead_score_events')
      .select('id,lead_id,event_type,reason,source_message_id,created_at').in('lead_id', chunk).order('id').range(from, to))),
    optional('appointments', 'las citas', () => readPipelineRelated(ids, (chunk, from, to) => client.from('appointments')
      .select('*,responsible:profiles!appointments_responsible_id_fkey(full_name)').in('lead_id', chunk).order('id').range(from, to))),
    optional('reservations', 'Solicitudes de reserva', async () => {
      if (!ids.length) return []
      if (!admin) throw Object.assign(new Error('Server configuration unavailable'), { code: 'SERVER_CONFIGURATION_MISSING' })
      // IDs come exclusively from the caller's RLS-authorized lead query above.
      // This table intentionally allows server-only reads. Never enumerate it
      // with service role before establishing that exact authorized scope.
      return readPipelineRelated(ids, (chunk, from, to) => admin.from('lead_reservation_requests')
        .select('id,lead_id,unit_ids,evidence,source_message_id,source_sent_at,request_status,created_at')
        .in('lead_id', chunk).order('id').range(from, to))
    }),
    optional('sales', 'los cierres de venta', () => readPipelineRelated(ids, (chunk, from, to) => client.from('unit_sales_closings')
      .select('id,lead_id,tenant_id,unit_id,sale_at,contract_id').in('lead_id', chunk).order('id').range(from, to))),
    optional('metadata', 'Ficha comercial guardada', () => readPipelineRelated(ids, (chunk, from, to) => client.from('lead_commercial_profiles')
      .select('*').in('lead_id', chunk).order('lead_id').range(from, to))),
    optional('units', 'las unidades del proyecto', () => readPipelineRelated([...new Set(leads.map(row => row.project_id).filter(Boolean).map(String))],
      (chunk, from, to) => client.from('units').select('id,tenant_id,project_id,unit_number,category,status,published_commercial_price').in('project_id', chunk).order('id').range(from, to))),
    optional('profiles', 'los responsables', () => readPipelineRelated([...new Set(leads.map(row => row.assigned_to).filter(Boolean).map(String))],
      (chunk, from, to) => client.from('profiles').select('id,full_name,avatar_url').in('id', chunk).order('id').range(from, to))),
    optional('projects', 'los proyectos', () => readPipelineRelated([...new Set(leads.map(row => row.project_id).filter(Boolean).map(String))],
      (chunk, from, to) => client.from('projects').select('id,name').in('id', chunk).order('id').range(from, to))),
    optional('history', 'Historial de etapas', () => readPipelineRelated(ids,
      (chunk, from, to) => client.from('lead_commercial_stage_observations').select('*').in('lead_id', chunk).order('id').range(from, to))),
  ])
  const conversationIds = conversations.map(row => String(row.id))
  let messages = await optional('messages', 'la evidencia de atención', () => readPipelineRelated(conversationIds, (chunk, from, to) => client.from('messages')
    .select('id,conversation_id,role,sent_at,tool_calls,model_used,external_message_id').in('conversation_id', chunk).order('id').range(from, to)))
  if (admin) {
    // Human WhatsApp answers can exist in the synchronization journal without
    // being bot messages. Resolve only already-authorized lead IDs and do not
    // serialize journal content or unverified contact matches to the client.
    for (const tenantId of [...new Set(leads.map(lead => String(lead.tenant_id)))]) {
      const ownLeads = leads.filter(lead => lead.tenant_id === tenantId)
      const evidence = await readMessageEvidence(admin, tenantId, ownLeads.map(lead => String(lead.id)), new Date().toISOString(),
        ownLeads.map(lead => ({ id: String(lead.id), contact_id: typeof lead.contact_id === 'string' ? lead.contact_id : null,
          kommo_id: typeof lead.kommo_id === 'number' ? lead.kommo_id : null })))
      if (!evidence.available) warnings.push('No se pudo comprobar toda la sincronización de WhatsApp; la atención puede estar incompleta.')
      coverage.whatsapp_evidence = coverage.whatsapp_evidence !== false && evidence.available
      for (const message of evidence.rows) {
        const conversation = conversations.filter(row => row.lead_id === message.lead_id)
          .sort((a, b) => String(b.started_at).localeCompare(String(a.started_at)))[0]
        if (conversation && Date.parse(message.sent_at) < Date.parse(String(conversation.started_at))) continue
        messages = messages.filter(row => !(row.conversation_id === conversation?.id && row.external_message_id === message.external_message_id))
        messages.push({ id: `journal:${message.id}`, lead_id: message.lead_id, conversation_id: conversation?.id,
          external_message_id: message.external_message_id, role: message.direction === 'incoming' ? 'cliente' : message.author_type === 'bot' ? 'bot' : 'asesor',
          sent_at: message.sent_at, delivery_status: message.delivery_status,
          verified_source: message.source === 'webhook' ? 'kommo_webhook' : 'kommo_history' })
      }
    }
  }
  return { leads, conversations, events, appointments, reservations, sales, metadata, units, profiles, projects, messages, history, warnings, issues, coverage }
}
