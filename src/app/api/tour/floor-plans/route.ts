import { NextResponse } from 'next/server'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import { loadFloorPlanZones, listFloorPlanFloorSummaries } from '@/lib/tour/floorPlanZones'
import { FLOOR_PLAN_FLOORS, isFloorPlanLevel } from '@/lib/tour/floorPlanHotspots'

export const runtime = 'nodejs'

/** Lectura pública para el showroom (sin sesión CRM). */
export async function GET(request: Request) {
  const admin = tryCreateAdminClient()
  if (!admin) {
    return NextResponse.json({ error: 'Storage no configurado' }, { status: 503 })
  }

  const url = new URL(request.url)
  const typologyCode = url.searchParams.get('typology_code')?.trim() ?? ''
  if (!typologyCode) {
    return NextResponse.json({ error: 'Falta typology_code' }, { status: 400 })
  }

  if (url.searchParams.get('list') === '1') {
    const floors = await listFloorPlanFloorSummaries(admin, typologyCode, FLOOR_PLAN_FLOORS)
    return NextResponse.json({ floors })
  }

  const floor = Number(url.searchParams.get('floor') ?? '')
  if (!isFloorPlanLevel(floor)) {
    return NextResponse.json({ error: 'Falta floor válido' }, { status: 400 })
  }

  const doc = await loadFloorPlanZones(admin, typologyCode, floor)
  return NextResponse.json({ doc })
}
