import { NextResponse } from 'next/server'
import { assertAdmin } from '@/lib/auth/session'
import { tryCreateAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    await assertAdmin()
    const admin = tryCreateAdminClient()
    if (!admin) {
      return NextResponse.json({ error: 'Falta SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })
    }

    const { data: scenarios, error: scenariosError } = await admin
      .from('financing_scenarios')
      .select(
        '*, financing_partners(partner_name, annual_interest_rate), units(unit_number, published_commercial_price), leads(phone, name)',
      )
      .order('created_at', { ascending: false })
      .limit(50)

    if (scenariosError) throw scenariosError

    return NextResponse.json({ scenarios: scenarios ?? [] })
  } catch (error) {
    console.error('GET /api/financing/admin/overview', error)
    const message = error instanceof Error ? error.message : 'No se pudo cargar analytics'
    const status = message.includes('administrador') || message.includes('autenticado') ? 403 : 500
    return NextResponse.json({ error: message }, { status })
  }
}
