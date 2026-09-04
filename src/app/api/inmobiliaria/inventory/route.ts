import { NextResponse } from 'next/server'
import { getCrmDataClient, getSessionProfile } from '@/lib/auth/session'
import { canAccessPath, knownRole } from '@/lib/inmobiliaria/roleAccess'
import { getAccessibleTenantIds } from '@/lib/inmobiliaria/tenants'
import { listActiveUnitTypes, listProjects, listUnits } from '@/services/inmobiliaria.service'
import type { InventorySortOption, UnitStatus } from '@/types/inmobiliaria'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function empty(error?: string, status = 200) {
  return NextResponse.json(
    { tenantId: '', tenantIds: [], projects: [], units: [], unitTypes: [], total: 0, error },
    { status },
  )
}

export async function GET(request: Request) {
  try {
    const session = await getSessionProfile()
    if (!session?.user) return empty('No autenticado', 401)

    const role = knownRole(session.profile.role)
    if (role === 'visitante' || (role && !canAccessPath(role, '/inmobiliaria/inventario'))) {
      return empty('No tienes acceso a esta sección', 403)
    }

    const supabase = await getCrmDataClient()
    const tenantIds = await getAccessibleTenantIds(supabase)
    if (!tenantIds.length) {
      return NextResponse.json({
        tenantId: '',
        tenantIds: [],
        projects: [],
        units: [],
        unitTypes: [],
        total: 0,
      })
    }

    const { searchParams } = new URL(request.url)
    const [projects, listed, unitTypes] = await Promise.all([
      listProjects(supabase, tenantIds[0], tenantIds),
      listUnits(supabase, {
        tenantId: tenantIds[0],
        tenantIds,
        projectId: searchParams.get('projectId') || undefined,
        status: (searchParams.get('status') || undefined) as UnitStatus | undefined,
        category: searchParams.get('category') || undefined,
        search: searchParams.get('search')?.trim() || undefined,
        sort: (searchParams.get('sortBy') || undefined) as InventorySortOption | undefined,
        page: Number(searchParams.get('page') || 1),
        pageSize: Number(searchParams.get('pageSize') || 10),
      }),
      listActiveUnitTypes(supabase, tenantIds),
    ])

    return NextResponse.json({
      tenantId: tenantIds[0],
      tenantIds,
      projects,
      units: listed.data,
      unitTypes,
      total: listed.total,
    })
  } catch (error) {
    console.error('GET /api/inmobiliaria/inventory', error)
    return empty(error instanceof Error ? error.message : 'No se pudo cargar el inventario', 500)
  }
}
