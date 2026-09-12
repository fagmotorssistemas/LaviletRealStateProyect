import { NextResponse } from 'next/server'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import { fetchFinancingConfig, fetchFinancingPartners, resolveUnitByParam } from '@/lib/financing/financingServer'
import { FINANCING_PROJECT_ID } from '@/types/financingSimulator'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  try {
    const admin = tryCreateAdminClient()
    if (!admin) {
      return NextResponse.json({ error: 'Falta SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })
    }

    const url = new URL(request.url)
    const unitParam = url.searchParams.get('unit') || url.searchParams.get('id') || ''
    const projectId = url.searchParams.get('project_id') || FINANCING_PROJECT_ID

    const [partners, config, unit] = await Promise.all([
      fetchFinancingPartners(admin, { activeOnly: true }),
      fetchFinancingConfig(admin, projectId),
      unitParam ? resolveUnitByParam(admin, unitParam) : Promise.resolve(null),
    ])

    return NextResponse.json({ partners, config, unit })
  } catch (error) {
    console.error('GET /api/financing/bootstrap', error)
    return NextResponse.json({ error: 'No se pudo cargar el simulador' }, { status: 500 })
  }
}
