import { NextResponse } from 'next/server'
import { getCrmDataClient, getSessionProfile } from '@/lib/auth/session'
import { canAccessPath, knownRole } from '@/lib/inmobiliaria/roleAccess'
import { getAccessibleTenantIds } from '@/lib/inmobiliaria/tenants'
import {
  listProjects,
  listSalesClosings,
  listSoldLeadsAsClosings,
  listSoldUnitsAsClosings,
  listTeamProfiles,
} from '@/services/inmobiliaria.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function empty(error?: string, status = 200) {
  return NextResponse.json(
    { tenantId: '', closings: [], projects: [], advisors: [], error },
    { status },
  )
}

export async function GET(request: Request) {
  try {
    const session = await getSessionProfile()
    if (!session?.user) return empty('No autenticado', 401)

    const role = knownRole(session.profile.role)
    if (role === 'visitante' || (role && !canAccessPath(role, '/inmobiliaria/ventas'))) {
      return empty('No tienes acceso a esta sección', 403)
    }

    const supabase = await getCrmDataClient()
    const tenantIds = await getAccessibleTenantIds(supabase)
    if (!tenantIds.length) {
      return NextResponse.json({ tenantId: '', closings: [], projects: [], advisors: [] })
    }

    const { searchParams } = new URL(request.url)
    const projectId = searchParams.get('projectId') || undefined
    const soldById = searchParams.get('soldById') || undefined
    const from = searchParams.get('from') || undefined
    const to = searchParams.get('to') || undefined
    const search = searchParams.get('search') || undefined

    const [projects, advisors, closings] = await Promise.all([
      listProjects(supabase, tenantIds[0], tenantIds),
      listTeamProfiles(supabase).catch(() => []),
      listSalesClosings(supabase, { tenantIds, projectId, soldById, from, to, search }).catch(() => []),
    ])

    const [soldUnits, soldLeads] = await Promise.all([
      soldById
        ? Promise.resolve([])
        : listSoldUnitsAsClosings(supabase, {
            tenantIds,
            projectId,
            from,
            to,
            excludeUnitIds: closings.map((row) => row.unit_id),
          }).catch(() => []),
      listSoldLeadsAsClosings(supabase, {
        tenantIds,
        soldById,
        from,
        to,
        excludeLeadIds: closings.map((row) => row.lead_id).filter(Boolean) as string[],
      }).catch(() => []),
    ])

    const q = search?.replace(/[%(),]/g, '').trim().toLowerCase()
    const extras = [...soldUnits, ...soldLeads].filter((row) => {
      if (projectId && row.unit?.project_id && row.unit.project_id !== projectId) return false
      if (!q) return true
      const haystack = [row.unit?.unit_number, row.unit?.project?.name, row.lead?.name, row.sold_by?.full_name, row.notes]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      return haystack.includes(q)
    })

    const merged = [...closings, ...extras].sort(
      (a, b) => Date.parse(b.sale_at) - Date.parse(a.sale_at),
    )

    return NextResponse.json({
      tenantId: tenantIds[0],
      closings: merged,
      projects,
      advisors,
    })
  } catch (error) {
    console.error('GET /api/inmobiliaria/sales', error)
    return empty(error instanceof Error ? error.message : 'No se pudo cargar el reporte de ventas', 500)
  }
}
