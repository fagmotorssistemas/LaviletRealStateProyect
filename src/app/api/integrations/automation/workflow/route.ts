import { NextResponse } from 'next/server'
import { getSessionProfile, getSessionUser } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAccessibleTenantIds } from '@/lib/inmobiliaria/tenants'
import { executionOutcome, executionRoute } from '@/lib/integrations/automation/execution-route'
import { sanitizeTraceSummary, traceText } from '@/lib/integrations/automation/trace-summary'
import { readWorkflowCursor, writeWorkflowCursor, WORKFLOW_PAGE_SIZE } from './pagination'
import { reviewReferenceSnapshot } from '@/lib/integrations/automation/semantic-review'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const headers = { 'Cache-Control': 'no-store' }

type Row = Record<string, unknown>

type ExecutionStep = {
  order: number
  key: string
  label: string
  category: string
  status: string
  source: string
  startedAt: string
  completedAt: string
  durationMs: number
  input: Row
  output: Row
  errorCode: string | null
}

function object(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
}

function text(value: unknown) {
  return typeof value === 'string' ? value : ''
}

export async function GET(request: Request) {
  try {
    const session = await getSessionProfile()
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401, headers })
    if (session.profile.role !== 'admin') return NextResponse.json({ executions: [] }, { headers })

    const { supabase } = await getSessionUser()
    const tenantIds = await getAccessibleTenantIds(supabase)
    if (!tenantIds.length) return NextResponse.json({ executions: [] }, { headers })

    const params = new URL(request.url).searchParams
    const view = params.get('view') || 'conversations'
    const query = (params.get('q') || '').trim()
    if (!['conversations', 'maintenance'].includes(view) || query.length > 100) return NextResponse.json({ error: 'Filtro de búsqueda no válido' }, { status: 400, headers })
    let cursor
    try { cursor = readWorkflowCursor(params.get('cursor')) }
    catch { return NextResponse.json({ error: 'La página solicitada no es válida' }, { status: 400, headers }) }
    const admin = createAdminClient()
    let leadFilter = ''
    if (query && view === 'conversations') {
      // Search before pagination, scoped to accessible tenants. Do not interpolate
      // user text into PostgREST's logical filter syntax.
      let search = admin.from('leads').select('tenant_id,project_id,kommo_id')
        .in('tenant_id', tenantIds)
      if (/^\d+$/.test(query) && Number.isSafeInteger(Number(query))) search = search.eq('kommo_id', Number(query))
      else search = search.ilike('name', `%${query.replace(/[\\%_]/g, char => '\\' + char)}%`)
      const matches = await search.limit(201)
      if (matches.error) throw matches.error
      if ((matches.data || []).length > 200) return NextResponse.json({ error: 'Hay demasiados leads con ese nombre. Escriba un nombre más completo o el ID de Kommo.' }, { status: 400, headers })
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
      const identities = (matches.data || []).filter(lead => tenantIds.includes(lead.tenant_id)
        && uuid.test(lead.tenant_id) && uuid.test(lead.project_id) && Number.isSafeInteger(Number(lead.kommo_id)) && Number(lead.kommo_id) > 0)
      if (!identities.length) return NextResponse.json({ executions: [], nextCursor: null }, { headers })
      leadFilter = identities.map(lead => `and(tenant_id.eq.${lead.tenant_id},project_id.eq.${lead.project_id},payload->>kommoId.eq.${Number(lead.kommo_id)})`).join(',')
    }
    let eventQuery = admin.from('lv_integration_events')
      .select('id,tenant_id,project_id,kind,status,payload,result,received_at,completed_at')
      .in('tenant_id', tenantIds)
      .in('kind', view === 'maintenance' ? ['maintenance'] : ['inbound'])
      .order('received_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(WORKFLOW_PAGE_SIZE + 1)
    // Cursor values are restricted to an ISO timestamp and UUID before interpolation.
    const cursorFilter = cursor ? `received_at.lt.${cursor.at},and(received_at.eq.${cursor.at},id.lt.${cursor.id})` : ''
    if (leadFilter && cursorFilter) eventQuery = eventQuery.or(`and(or(${leadFilter}),or(${cursorFilter}))`)
    else if (leadFilter || cursorFilter) eventQuery = eventQuery.or(leadFilter || cursorFilter)
    const events = await eventQuery
    if (events.error) throw events.error
    const page = (events.data || []).slice(0, WORKFLOW_PAGE_SIZE)
    const last = page.at(-1)
    const nextCursor = (events.data || []).length > WORKFLOW_PAGE_SIZE && last
      ? writeWorkflowCursor(last.received_at, last.id) : null
    const eventIds = page.map(row => row.id)
    const stepQuery = eventIds.length ? await admin.from('lv_automation_execution_steps')
      .select('event_id,conversation_id,step_order,step_key,label,category,status,source_module,started_at,completed_at,duration_ms,input_summary,output_summary,error_code')
      .in('tenant_id', tenantIds)
      .in('event_id', eventIds)
      .order('step_order', { ascending: true }) : { data: [], error: null }
    // Mientras se aplica la migración, la pantalla conserva la ruta inferida anterior.
    // La ausencia de la tabla de auditoría no puede bloquear la operación del bot.
    const stepsByEvent = new Map<string, ExecutionStep[]>()
    const conversationByEvent = new Map<string, string>()
    if (!stepQuery.error) {
      for (const step of stepQuery.data || []) {
        const eventId = text(step.event_id)
        if (step.conversation_id) conversationByEvent.set(eventId, text(step.conversation_id))
        const normalized: ExecutionStep = {
          order: Number(step.step_order), key: text(step.step_key), label: text(step.label),
          category: text(step.category), status: text(step.status), source: text(step.source_module),
          startedAt: text(step.started_at), completedAt: text(step.completed_at),
          durationMs: Number(step.duration_ms) || 0,
          input: sanitizeTraceSummary(step.input_summary), output: sanitizeTraceSummary(step.output_summary),
          errorCode: text(step.error_code) || null,
        }
        stepsByEvent.set(eventId, [...(stepsByEvent.get(eventId) || []), normalized])
      }
    }

    const kommoIds = [...new Set(page.map(row => Number(object(row.payload).kommoId)).filter(id => Number.isSafeInteger(id) && id > 0))]
    const leads = kommoIds.length ? await admin.from('leads')
      .select('id,name,tenant_id,project_id,kommo_id,tracking_opt_out_at')
      .in('tenant_id', tenantIds)
      .in('kommo_id', kommoIds) : { data: [], error: null }
    if (leads.error) throw leads.error
    const leadByKommo = new Map((leads.data || []).map(row => [`${row.tenant_id}:${row.project_id}:${row.kommo_id}`, row as Row]))

    const executions = page.map(row => {
      const payload = object(row.payload), result = object(row.result)
      const lead = leadByKommo.get(`${row.tenant_id}:${row.project_id}:${Number(payload.kommoId)}`)
      const action = text(result.action) || text(result.reason)
      const content = text(payload.text) || text(payload.message) || text(payload.content)
      const references = reviewReferenceSnapshot(result)
      const steps = (stepsByEvent.get(row.id) || []).map(step => step.key === 'response_coverage' && references.length
        ? { ...step, output: { ...step.output, review_reference_snapshot: sanitizeTraceSummary({ units: references }).units,
          review_reference_source: 'event_result.turn_completeness.writer_contract.hechos_protegidos' } } : step)
      const trace = executionRoute(steps, row.kind, payload, result, lead)
      return {
        id: row.id,
        leadGroupId: payload.kommoId ? `${row.tenant_id}:${row.project_id}:${payload.kommoId}` : null,
        conversationId: conversationByEvent.get(row.id) || null,
        batchId: text(trace.versions.batch_id) || null,
        batchEventIds: Array.isArray(trace.versions.batch_event_ids) ? trace.versions.batch_event_ids.filter(id => typeof id === 'string') : [],
        batchSize: Number(steps.find(step => step.key === 'message_received')?.input.messages_in_batch) || 1,
        kind: row.kind,
        receivedAt: row.received_at,
        workflowId: trace.workflowId,
        path: trace.path,
        status: row.status,
        action,
        outcome: executionOutcome(row.status, action),
        occurredAt: row.completed_at || row.received_at,
        leadName: traceText(lead?.name, 90) || (payload.kommoId ? `Lead Kommo #${payload.kommoId}` : 'Tarea automática'),
        message: traceText(content, 600),
        traceAvailable: steps.length > 0,
        traceSource: trace.traceSource,
        traceWarning: stepQuery.error ? 'AUDIT_READ_FAILED' : !steps.length ? 'NO_RECORDED_STEPS' : null,
        stopReason: trace.stopReason,
        versions: trace.versions,
        steps,
      }
    })
    return NextResponse.json({ executions, nextCursor }, { headers })
  } catch {
    return NextResponse.json({ error: 'No se pudieron cargar las ejecuciones recientes' }, { status: 503, headers })
  }
}
