import { NextResponse } from 'next/server'
import { assertCanAccessCrmPath, getSessionUser } from '@/lib/auth/session'
import { getAccessibleTenantIds } from '@/lib/inmobiliaria/tenants'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control': 'no-store' }
const tasks = ['nutrition_24h', 'nutrition_week_one', 'nutrition_week_two', 'nutrition_week_three']

export async function GET(request: Request) {
  try {
    const session = await assertCanAccessCrmPath('/inmobiliaria/automatizacion')
    if (!['admin', 'asesor'].includes(String(session.profile.role))) {
      return NextResponse.json({ error: 'Sin acceso a seguimientos' }, { status: 403, headers })
    }
    const leadId = new URL(request.url).searchParams.get('leadId') || ''
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(leadId)) {
      return NextResponse.json({ error: 'Lead inválido' }, { status: 400, headers })
    }
    const { supabase } = await getSessionUser()
    const tenantIds = await getAccessibleTenantIds(supabase)
    if (!tenantIds.length) return NextResponse.json({ error: 'Sin acceso al lead' }, { status: 403, headers })
    const admin = createAdminClient()
    let query = admin.from('leads').select('id,tenant_id,project_id').eq('id', leadId).in('tenant_id', tenantIds)
    if (session.profile.role !== 'admin') query = query.eq('assigned_to', session.user.id)
    const lead = await query.maybeSingle()
    if (lead.error) throw lead.error
    if (!lead.data) return NextResponse.json({ error: 'Lead no encontrado' }, { status: 404, headers })
    // Only read this lead's follow-up jobs. Do not expose payloads or inbound events.
    const result = await admin.from('lv_integration_events')
      .select('id,payload,status,available_at,received_at,completed_at,result')
      .eq('tenant_id', lead.data.tenant_id).eq('project_id', lead.data.project_id)
      .eq('kind', 'maintenance').contains('payload', { leadId }).in('payload->>task', tasks)
      .order('received_at', { ascending: false }).limit(30)
    if (result.error) throw result.error
    const jobs = (result.data || []).map(event => ({
      id: event.id, task: event.payload?.task, status: event.status,
      scheduled_at: event.available_at, created_at: event.received_at, completed_at: event.completed_at,
      reason: typeof event.result?.reason === 'string' ? event.result.reason : null,
      delivery_status: typeof event.result?.delivery_status === 'string' ? event.result.delivery_status : null,
    }))
    return NextResponse.json({ jobs }, { headers })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    const status = /No autenticado/.test(message) ? 401 : /acceso/.test(message) ? 403 : 500
    return NextResponse.json({ error: status === 500 ? 'No se pudieron consultar los seguimientos' : message }, { status, headers })
  }
}
