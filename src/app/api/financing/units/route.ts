import { NextResponse } from 'next/server'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import { TOUR_PROJECT_ID } from '@/lib/tour/trackingIds'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const admin = tryCreateAdminClient()
    if (!admin) {
      return NextResponse.json({ error: 'Falta SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })
    }

    const { data, error } = await admin
      .from('units')
      .select('id, unit_number, bedrooms, published_commercial_price, status, is_published')
      .eq('project_id', TOUR_PROJECT_ID)
      .eq('is_published', true)
      .in('status', ['disponible', 'en_preventa', 'reservado'])
      .order('unit_number', { ascending: true })
      .limit(200)

    if (error) throw error
    return NextResponse.json({ units: data ?? [] })
  } catch (error) {
    console.error('GET /api/financing/units', error)
    return NextResponse.json({ error: 'No se pudieron cargar las unidades' }, { status: 500 })
  }
}
