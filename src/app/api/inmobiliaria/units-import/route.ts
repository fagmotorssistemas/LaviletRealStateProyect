import { NextResponse } from 'next/server'
import { getSessionProfile } from '@/lib/auth/session'
import { knownRole } from '@/lib/inmobiliaria/roleAccess'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import { listUnitsImport, listUnitsImportFacets } from '@/services/inmobiliaria.service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function empty(error: string, status = 200) {
  return NextResponse.json(
    { data: [], total: 0, categories: [], floors: [], error },
    { status },
  )
}

export async function GET(request: Request) {
  try {
    const session = await getSessionProfile()
    if (!session?.user) return empty('No autenticado', 401)

    const role = knownRole(session.profile.role)
    if (role === 'visitante') return empty('No tienes acceso a esta sección', 403)

    const admin = tryCreateAdminClient()
    if (!admin) return empty('Falta SUPABASE_SERVICE_ROLE_KEY en el servidor', 500)

    const { searchParams } = new URL(request.url)
    const [listed, facets] = await Promise.all([
      listUnitsImport(admin, {
        search: searchParams.get('search') ?? undefined,
        category: searchParams.get('category') ?? undefined,
        floorNumber: searchParams.get('floorNumber') ?? undefined,
        status: searchParams.get('status') ?? undefined,
        page: Number(searchParams.get('page') || 1),
        pageSize: Number(searchParams.get('pageSize') || 10),
      }),
      listUnitsImportFacets(admin),
    ])

    return NextResponse.json({
      data: listed.data,
      total: listed.total,
      categories: facets.categories,
      floors: facets.floors,
    })
  } catch (error) {
    console.error('GET /api/inmobiliaria/units-import', error)
    return empty(error instanceof Error ? error.message : 'No se pudo leer units_import')
  }
}
