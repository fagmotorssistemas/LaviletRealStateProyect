import { NextResponse } from 'next/server'
import { getSessionProfile, getSessionUser } from '@/lib/auth/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAccessibleTenantIds } from '@/lib/inmobiliaria/tenants'
import { executionOutcome, executionRoute } from '@/lib/integrations/automation/execution-route'
import { sanitizeTraceSummary, traceText } from '@/lib/integrations/automation/trace-summary'

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

export async function GET() {
  try {
    const session = await getSessionProfile()
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401, headers })
    if (session.profile.role !== 'admin') return NextResponse.json({ executions: [] }, { headers })

    const { supabase } = await getSessionUser()
    const tenantIds = await getAccessibleTenantIds(supabase)
    if (!tenantIds.length) return NextResponse.json({ executions: [] }, { headers })

    const admin = createAdminClient()
    const events = await admin.from('lv_integration_events')
      .select('id,tenant_id,project_id,kind,status,payload,result,received_at,completed_at')
      .in('tenant_id', tenantIds)
      .in('kind', ['inbound', 'maintenance'])
      .order('received_at', { ascending: false })
      .limit(30)
    if (events.error) throw events.error

    const eventIds = (events.data || []).map(row => row.id)
    const stepQuery = eventIds.length ? await admin.from('lv_automation_execution_steps')
      .select('event_id,step_order,step_key,label,category,status,source_module,started_at,completed_at,duration_ms,input_summary,output_summary,error_code')
      .in('tenant_id', tenantIds)
      .in('event_id', eventIds)
      .order('step_order', { ascending: true }) : { data: [], error: null }
    // Mientras se aplica la migración, la pantalla conserva la ruta inferida anterior.
    // La ausencia de la tabla de auditoría no puede bloquear la operación del bot.
    const stepsByEvent = new Map<string, ExecutionStep[]>()
    if (!stepQuery.error) {
      for (const step of stepQuery.data || []) {
        const eventId = text(step.event_id)
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

    const kommoIds = [...new Set((events.data || []).map(row => Number(object(row.payload).kommoId)).filter(Number.isSafeInteger))]
    const leads = kommoIds.length ? await admin.from('leads')
      .select('id,name,kommo_id,tracking_opt_out_at')
      .in('tenant_id', tenantIds)
      .in('kommo_id', kommoIds) : { data: [], error: null }
    if (leads.error) throw leads.error
    const leadByKommo = new Map((leads.data || []).map(row => [Number(row.kommo_id), row as Row]))

    const executions = (events.data || []).map(row => {
      const payload = object(row.payload), result = object(row.result)
      const lead = leadByKommo.get(Number(payload.kommoId))
      const action = text(result.action) || text(result.reason)
      const content = text(payload.text) || text(payload.message) || text(payload.content)
      const steps = stepsByEvent.get(row.id) || []
      const trace = executionRoute(steps, row.kind, payload, result, lead)
      return {
        id: row.id,
        workflowId: trace.workflowId,
        path: trace.path,
        status: row.status,
        action,
        outcome: executionOutcome(row.status, action),
        occurredAt: row.completed_at || row.received_at,
        leadName: text(lead?.name) || (payload.kommoId ? `Lead Kommo #${payload.kommoId}` : 'Tarea automática'),
        message: traceText(content, 180),
        traceAvailable: steps.length > 0,
        traceSource: trace.traceSource,
        traceWarning: stepQuery.error ? 'AUDIT_READ_FAILED' : !steps.length ? 'NO_RECORDED_STEPS' : null,
        stopReason: trace.stopReason,
        versions: trace.versions,
        steps,
      }
    })
    return NextResponse.json({ executions }, { headers })
  } catch {
    return NextResponse.json({ error: 'No se pudieron cargar las ejecuciones recientes' }, { status: 503, headers })
  }
}
