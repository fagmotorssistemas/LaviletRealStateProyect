import { NextResponse } from 'next/server'
import { assertCanAccessCrmPath, getSessionUser } from '@/lib/auth/session'
import { canWriteCrm } from '@/lib/inmobiliaria/roleAccess'
import { getAccessibleTenantIds } from '@/lib/inmobiliaria/tenants'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const headers = { 'Cache-Control': 'no-store' }
const actions = new Set(['claim'])

export async function GET() {
  try {
    const session = await assertCanAccessCrmPath('/inmobiliaria/automatizacion')
    if (!['asesor', 'admin'].includes(String(session.profile.role))) {
      return NextResponse.json({ error: 'No tiene acceso a esta bandeja' }, { status: 403, headers })
    }
    const { supabase } = await getSessionUser()
    const tenantIds = await getAccessibleTenantIds(supabase)
    if (!tenantIds.length) return NextResponse.json({ count: 0 }, { headers })
    const result = await createAdminClient().from('leads')
      .select('id', { count: 'exact', head: true })
      .in('tenant_id', tenantIds)
      .in('handoff_status', ['queued', 'assigned', 'acknowledged'])
    if (result.error) throw result.error
    return NextResponse.json({ count: result.count ?? 0 }, { headers })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo consultar la bandeja'
    const status = /No autenticado/.test(message) ? 401 : /acceso/.test(message) ? 403 : 500
    return NextResponse.json({ error: status === 500 ? 'No se pudo consultar la bandeja' : message }, { status, headers })
  }
}

export async function PATCH(request: Request) {
  try {
    const session = await assertCanAccessCrmPath('/inmobiliaria/automatizacion')
    if (!canWriteCrm(session.profile.role) || !['asesor', 'admin'].includes(String(session.profile.role))) {
      return NextResponse.json({ error: 'No tiene permiso para atender leads' }, { status: 403, headers })
    }
    const body = await request.json() as { leadId?: unknown; action?: unknown }
    const leadId = typeof body.leadId === 'string' ? body.leadId.trim() : ''
    const action = typeof body.action === 'string' ? body.action.trim() : ''
    if (!/^[0-9a-f-]{36}$/i.test(leadId) || !actions.has(action)) {
      return NextResponse.json({ error: 'Acción inválida' }, { status: 400, headers })
    }

    const { supabase } = await getSessionUser()
    const tenantIds = await getAccessibleTenantIds(supabase)
    if (!tenantIds.length) return NextResponse.json({ error: 'No tiene acceso a proyectos' }, { status: 403, headers })

    const admin = createAdminClient()
    const current = await admin.from('leads')
      .select('id,tenant_id,assigned_to,handoff_status,handoff_assigned_at')
      .eq('id', leadId)
      .in('tenant_id', tenantIds)
      .maybeSingle()
    if (current.error) throw current.error
    if (!current.data) return NextResponse.json({ error: 'Lead no encontrado' }, { status: 404, headers })

    const lead = current.data
    const ownsLead = lead.assigned_to === session.user.id
    const now = new Date().toISOString()
    if (lead.assigned_to && !ownsLead) {
      return NextResponse.json({ error: 'Este lead ya está asignado a otro asesor' }, { status: 409, headers })
    }
    if (!['queued', 'assigned'].includes(String(lead.handoff_status))) {
      return NextResponse.json({ error: 'El lead ya no está pendiente de asignación' }, { status: 409, headers })
    }
    const changes = {
      assigned_to: session.user.id,
      handoff_status: 'assigned',
      handoff_assigned_at: lead.handoff_assigned_at ?? now,
      updated_at: now,
    }

    let updateQuery = admin.from('leads').update(changes)
      .eq('id', leadId)
      .eq('tenant_id', lead.tenant_id)
      .eq('handoff_status', String(lead.handoff_status))

    updateQuery = lead.assigned_to
      ? updateQuery.eq('assigned_to', session.user.id)
      : updateQuery.is('assigned_to', null)

    const updated = await updateQuery
      .select('id,handoff_status,assigned_to')
      .maybeSingle()
    if (updated.error) throw updated.error
    if (!updated.data) return NextResponse.json({ error: 'El estado cambió mientras se procesaba la acción' }, { status: 409, headers })

    return NextResponse.json({ lead: updated.data }, { headers })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo actualizar la atención'
    const status = /No autenticado/.test(message) ? 401 : /acceso/.test(message) ? 403 : 500
    return NextResponse.json({ error: status === 500 ? 'No se pudo actualizar la atención' : message }, { status, headers })
  }
}
