import { NextResponse } from 'next/server'
import { assertCanAccessCrmPath, getSessionUser } from '@/lib/auth/session'
import { classifyLeadControl, LEAD_CONTROL_THRESHOLDS } from '@/lib/inmobiliaria/leadControl'
import { getAccessibleTenantIds } from '@/lib/inmobiliaria/tenants'
import { createAdminClient } from '@/lib/supabase/admin'
import type { LeadControlExecution, LeadControlStep } from '@/types/leadControl'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const headers = { 'Cache-Control': 'no-store' }
type Row = Record<string, unknown>

function object(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {}
}

function text(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function nullableText(value: unknown) {
  const valueText = text(value).trim()
  return valueText || null
}

function numberOrNull(value: unknown) {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : null
}

function firstRelation(value: unknown): Row | null {
  if (Array.isArray(value)) return object(value[0])
  return Object.keys(object(value)).length ? object(value) : null
}

export async function GET() {
  try {
    const session = await assertCanAccessCrmPath('/inmobiliaria/automatizacion')
    if (!['asesor', 'admin'].includes(String(session.profile.role))) {
      return NextResponse.json({ error: 'No tiene acceso al control de leads' }, { status: 403, headers })
    }

    const { supabase } = await getSessionUser()
    const tenantIds = await getAccessibleTenantIds(supabase)
    if (!tenantIds.length) return NextResponse.json(emptyResponse(), { headers })

    const admin = createAdminClient()
    const [leadsResult, eventsResult, appointmentsResult] = await Promise.all([
      admin.from('vw_lead_automation_dashboard')
        .select('*')
        .in('tenant_id', tenantIds)
        .order('last_interaction_at', { ascending: false, nullsFirst: false })
        .limit(500),
      admin.from('lv_integration_events')
        .select('id,tenant_id,project_id,kind,status,payload,result,available_at,received_at,completed_at')
        .in('tenant_id', tenantIds)
        .neq('kind', 'lock')
        .order('received_at', { ascending: false })
        .limit(1500),
      admin.from('appointments')
        .select('id,lead_id,status,requested_at,scheduled_at,start_time')
        .in('tenant_id', tenantIds)
        .order('requested_at', { ascending: false })
        .limit(1000),
    ])
    if (leadsResult.error) throw leadsResult.error
    if (eventsResult.error) throw eventsResult.error
    if (appointmentsResult.error) throw appointmentsResult.error

    const leads = (leadsResult.data ?? []) as Row[]
    const leadIds = leads.map(row => text(row.lead_id)).filter(Boolean)
    const conversationsResult = leadIds.length
      ? await admin.from('conversations')
        .select('id,lead_id,status,last_message_at')
        .in('tenant_id', tenantIds)
        .in('lead_id', leadIds)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(1000)
      : { data: [], error: null }
    if (conversationsResult.error) throw conversationsResult.error

    const conversations = (conversationsResult.data ?? []) as Row[]
    const conversationIds = conversations.map(row => text(row.id)).filter(Boolean)
    const [messagesResult, stepsResult] = await Promise.all([
      conversationIds.length
        ? admin.from('messages')
          .select('id,conversation_id,role,content,sent_at')
          .in('conversation_id', conversationIds)
          .order('sent_at', { ascending: false })
          .limit(3000)
        : Promise.resolve({ data: [], error: null }),
      leadIds.length
        ? admin.from('lv_automation_execution_steps')
          .select('event_id,lead_id,step_order,step_key,label,category,status,source_module,started_at,completed_at,duration_ms,input_summary,output_summary,error_code,created_at')
          .in('tenant_id', tenantIds)
          .in('lead_id', leadIds)
          .order('created_at', { ascending: false })
          .limit(3000)
        : Promise.resolve({ data: [], error: null }),
    ])
    if (messagesResult.error) throw messagesResult.error

    const conversationLead = new Map(conversations.map(row => [text(row.id), text(row.lead_id)]))
    const lastMessageByLead = new Map<string, { role: string; content: string | null; sentAt: string }>()
    for (const row of (messagesResult.data ?? []) as Row[]) {
      const leadId = conversationLead.get(text(row.conversation_id))
      if (!leadId || lastMessageByLead.has(leadId)) continue
      lastMessageByLead.set(leadId, {
        role: text(row.role), content: nullableText(row.content), sentAt: text(row.sent_at),
      })
    }

    const latestAppointmentByLead = new Map<string, { status: string; requestedAt: string | null; scheduledAt: string | null }>()
    for (const row of (appointmentsResult.data ?? []) as Row[]) {
      const leadId = text(row.lead_id)
      if (!leadId || latestAppointmentByLead.has(leadId)) continue
      latestAppointmentByLead.set(leadId, {
        status: text(row.status), requestedAt: nullableText(row.requested_at),
        scheduledAt: nullableText(row.scheduled_at) || nullableText(row.start_time),
      })
    }

    const leadByKommo = new Map<number, string>()
    for (const row of leads) {
      const kommoId = numberOrNull(row.lead_kommo_id)
      if (kommoId != null) leadByKommo.set(kommoId, text(row.lead_id))
    }

    const rawSteps = stepsResult.error ? [] : (stepsResult.data ?? []) as Row[]
    const eventLead = new Map<string, string>()
    const stepsByEvent = new Map<string, LeadControlStep[]>()
    for (const row of rawSteps) {
      const eventId = text(row.event_id)
      const leadId = text(row.lead_id)
      if (eventId && leadId) eventLead.set(eventId, leadId)
      const step: LeadControlStep = {
        order: Number(row.step_order) || 0,
        key: text(row.step_key), label: text(row.label), category: text(row.category),
        status: text(row.status) as LeadControlStep['status'], source: text(row.source_module),
        startedAt: text(row.started_at), completedAt: text(row.completed_at),
        durationMs: Number(row.duration_ms) || 0, errorCode: nullableText(row.error_code),
        input: object(row.input_summary), output: object(row.output_summary),
      }
      stepsByEvent.set(eventId, [...(stepsByEvent.get(eventId) ?? []), step])
    }
    for (const steps of stepsByEvent.values()) steps.sort((a, b) => a.order - b.order)

    const executionsByLead = new Map<string, LeadControlExecution[]>()
    for (const row of (eventsResult.data ?? []) as Row[]) {
      const payload = object(row.payload)
      const result = object(row.result)
      const eventId = text(row.id)
      const leadId = eventLead.get(eventId)
        || nullableText(payload.leadId)
        || leadByKommo.get(Number(payload.kommoId))
      if (!leadId) continue
      const execution: LeadControlExecution = {
        id: eventId,
        kind: text(row.kind),
        status: text(row.status),
        action: nullableText(result.action) || nullableText(result.reason),
        occurredAt: nullableText(row.completed_at) || text(row.received_at),
        availableAt: nullableText(row.available_at),
        message: nullableText(payload.text) || nullableText(payload.message) || nullableText(payload.content),
        steps: stepsByEvent.get(eventId) ?? [],
      }
      const current = executionsByLead.get(leadId) ?? []
      if (current.length < 12) current.push(execution)
      executionsByLead.set(leadId, current)
    }

    const now = new Date()
    const rows = leads.map(row => {
      const leadId = text(row.lead_id)
      const assignee = firstRelation(row.assignee)
      return classifyLeadControl({
        leadId,
        kommoId: numberOrNull(row.lead_kommo_id),
        name: text(row.name),
        phone: nullableText(row.phone),
        projectName: nullableText(row.project_name),
        stage: text(row.stage),
        temperature: text(row.temperature),
        botEnabled: row.bot_enabled === true,
        trackingOptOutAt: nullableText(row.tracking_opt_out_at),
        assigneeName: nullableText(row.assignee_name) || nullableText(assignee?.full_name),
        assignedTo: nullableText(row.assigned_to),
        handoffStatus: text(row.handoff_status),
        handoffReason: nullableText(row.handoff_reason),
        sellerResponseDueAt: nullableText(row.seller_response_due_at),
        lastInteractionAt: nullableText(row.last_interaction_at),
        lastMessage: lastMessageByLead.get(leadId) ?? null,
        latestAppointment: latestAppointmentByLead.get(leadId) ?? null,
        executions: executionsByLead.get(leadId) ?? [],
        now,
      })
    }).sort((a, b) => {
      const stateOrder = { intervention: 0, waiting: 1, healthy: 2, intentional: 3 }
      return stateOrder[a.state] - stateOrder[b.state]
        || Date.parse(b.detectedAt) - Date.parse(a.detectedAt)
    })

    return NextResponse.json({
      generatedAt: now.toISOString(),
      thresholds: LEAD_CONTROL_THRESHOLDS,
      summary: {
        total: rows.length,
        intervention: rows.filter(row => row.state === 'intervention').length,
        waiting: rows.filter(row => row.state === 'waiting').length,
        healthy: rows.filter(row => row.state === 'healthy').length,
        intentional: rows.filter(row => row.state === 'intentional').length,
        unassigned: leads.filter(row => !row.assigned_to).length,
      },
      rows,
    }, { headers })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo cargar el control de leads'
    const status = /No autenticado/.test(message) ? 401 : /acceso/.test(message) ? 403 : 500
    return NextResponse.json({ error: status === 500 ? 'No se pudo cargar el control de leads' : message }, { status, headers })
  }
}

function emptyResponse() {
  return {
    generatedAt: new Date().toISOString(), thresholds: LEAD_CONTROL_THRESHOLDS,
    summary: { total: 0, intervention: 0, waiting: 0, healthy: 0, intentional: 0, unassigned: 0 },
    rows: [],
  }
}
