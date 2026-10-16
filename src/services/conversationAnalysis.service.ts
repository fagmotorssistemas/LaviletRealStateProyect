import 'server-only'
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import { loadLeadPipelineSources, readPipelineRelated } from './leadPipelineSources.service'
import { analysisRecord as record, buildConversationAnalysisCase } from '@/lib/inmobiliaria/conversationAnalysis'
import type { AnalysisRow as Row, ConversationAnalysisDashboard } from '@/types/conversationAnalysis'

type Query = PromiseLike<{ data: unknown[] | null; error: { message: string; code?: string } | null }>
/** Authorized lead IDs always come from RLS before server-only reads. No workers or sends. */
export async function loadConversationAnalysisDashboard(client: SupabaseClient, actor: { id: string; role: string | null }, requestedIds?: string[], includeContent = false): Promise<ConversationAnalysisDashboard> {
  const sources = await loadLeadPipelineSources(client, requestedIds), admin = tryCreateAdminClient()
  const ids = sources.leads.map(l => String(l.id)), warnings = [...sources.warnings], coverage = { ...sources.coverage }
  const asOf = new Date().toISOString()
  async function optional(key: string, build: (chunk: string[], from: number, to: number) => Query, keys = ids): Promise<Row[]> {
    try {
      const rows = await readPipelineRelated(keys, build)
      coverage[key] = coverage[key] !== false
      return rows
    } catch {
      coverage[key] = false
      warnings.push(({ analyses: 'Las evaluaciones no están disponibles.', reviews: 'El registro de revisión requiere su migración.', incidents: 'No se pudieron comprobar todas las incidencias.', jobs: 'No se pudieron comprobar los seguimientos.', financing: 'No se pudo comprobar el avance financiero.', visits: 'No se pudo comprobar toda la coordinación de visitas.', content: 'El contenido de algunos mensajes no está disponible.' } as Record<string, string>)[key] || 'Una fuente del análisis no está disponible.')
      return []
    }
  }
  const server = () => { if (!admin) throw Error('ANALYSIS_SERVER_UNAVAILABLE'); return admin }
  const [analyses, reviews, visits, financing, jobs, versions, content] = await Promise.all([
    optional('analyses', (chunk, from, to) => server().from('lead_conversation_analyses').select('id,lead_id,conversation_id,analysis,created_at,source_last_message_at,source_fingerprint').in('lead_id', chunk).order('id').range(from, to)),
    optional('reviews', (chunk, from, to) => client.from('lead_conversation_analysis_reviews').select('id,lead_id,actor_id,status,note,issue_signature,baseline,created_at').in('lead_id', chunk).order('id').range(from, to)),
    optional('visits', (chunk, from, to) => client.from('appointment_reschedule_requests').select('id,lead_id,status,assigned_advisor_id,created_at,updated_at').in('lead_id', chunk).order('id').range(from, to)),
    optional('financing', (chunk, from, to) => client.from('financing_prequalifications').select('id,lead_id,explicit_consent,status,selected_partner_name,updated_at').in('lead_id', chunk).order('id').range(from, to)),
    optional('jobs', (chunk, from, to) => server().from('lv_integration_events').select('id,payload,status,available_at,received_at').eq('kind', 'maintenance').in('payload->>leadId', chunk).in('status', ['pending', 'processing']).order('id').range(from, to)),
    optional('versions', (chunk, from, to) => server().from('lv_automation_execution_steps').select('id,lead_id,conversation_id,started_at,output_summary').eq('step_key', 'execution_version').in('lead_id', chunk).order('id').range(from, to)),
    includeContent ? optional('content', (chunk, from, to) => client.from('messages').select('id,conversation_id,external_message_id,content').in('conversation_id', chunk).order('id').range(from, to), sources.conversations.map(c => String(c.id))) : Promise.resolve([] as Row[]),
  ])
  const incidents: Row[] = [], groups = new Map<string, Row[]>()
  for (const lead of sources.leads) {
    const key = JSON.stringify([lead.tenant_id, lead.project_id])
    groups.set(key, [...(groups.get(key) || []), lead])
  }
  coverage.incidents = true
  for (const leads of groups.values()) {
    const keys = leads.map(l => String(l.kommo_id || '')).filter(k => /^[1-9]\d*$/.test(k))
    for (const field of ['payload->>kommoId', 'contact_key']) incidents.push(...await optional('incidents', (chunk, from, to) => {
      const query = server().from('lv_integration_events')
        .select('id,tenant_id,project_id,payload,contact_key,status,result,received_at').eq('tenant_id', leads[0].tenant_id).eq('project_id', leads[0].project_id)
        .in('status', ['failed', 'uncertain', 'cancelled']).eq('result->>requires_review', 'true')
      // Inbound events use leadId:contactId; transport incidents may use just
      // leadId. IDs are numeric and tenant/project authorization remains bound.
      return (field === 'contact_key' ? query.or(chunk.flatMap(key => [`contact_key.eq.${key}`, `contact_key.like.${key}:%`]).join(','))
        : query.in(field, chunk)).order('id').range(from, to)
    }, keys))
  }
  const distinctIncidents = [...new Map(incidents.map(i => [i.id, i])).values()], contents = new Map(content.map(m => [m.id, m.content]))
  const contentsByExternal = new Map(content.filter(m => m.external_message_id).map(m => [JSON.stringify([m.conversation_id, m.external_message_id]), m.content]))
  const items = sources.leads.map(lead => {
    const own = (rows: Row[]) => rows.filter(r => r.lead_id === lead.id)
    const conversations = own(sources.conversations), conversationIds = new Set(conversations.map(c => c.id))
    const messages = sources.messages.filter(m => conversationIds.has(m.conversation_id)).map(m => ({ ...m,
      content: contents.get(m.id) ?? contentsByExternal.get(JSON.stringify([m.conversation_id, m.external_message_id])) }))
    const canReview = actor.role === 'admin' || actor.role === 'asesor' && (!lead.assigned_to || lead.assigned_to === actor.id)
    const item = buildConversationAnalysisCase({ lead, conversations, messages, scoreEvents: own(sources.events), appointments: own(sources.appointments),
      reservations: own(sources.reservations), sales: own(sources.sales), metadata: own(sources.metadata)[0], units: sources.units,
      history: own(sources.history), jobs: jobs.filter(j => record(j.payload).leadId === lead.id), visits: own(visits), financing: own(financing),
      incidents: distinctIncidents.filter(i => i.tenant_id === lead.tenant_id && i.project_id === lead.project_id
        && String(record(i.payload).kommoId || String(i.contact_key || '').split(':')[0]) === String(lead.kommo_id)), analyses: own(analyses),
      reviews: own(reviews).map(r => ({ ...r, actor_name: sources.profiles.find(p => p.id === r.actor_id)?.full_name })), versions: own(versions),
      advisorName: String(sources.profiles.find(p => p.id === lead.assigned_to)?.full_name || ''), projectName: String(sources.projects.find(p => p.id === lead.project_id)?.name || ''),
      asOf, canReview, coverage, warnings: [...new Set(warnings)] })
    item.signature = createHash('sha256').update(JSON.stringify({ signals: item.signals.map(s => [s.key, s.at]), analysis: item.analysisId,
      lastCustomer: item.lastCustomerAt, stage: item.stage, waiting: item.waiting })).digest('hex')
    return item
  })
  return { items, asOf, warnings: [...new Set(warnings)] }
}
