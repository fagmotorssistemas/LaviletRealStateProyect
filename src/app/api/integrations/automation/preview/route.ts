import { NextResponse } from 'next/server'
import { getSessionProfile } from '@/lib/auth/session'
import { previewVisits } from '@/lib/integrations/automation/visits'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export async function GET() {
  const headers = { 'Cache-Control': 'no-store' }
  const session = await getSessionProfile()
  if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401, headers })
  if (session.profile.role !== 'admin') return NextResponse.json({ error: 'Solo administradores' }, { status: 403, headers })
  try { return NextResponse.json({ databaseWrites: false, sends: false, visits: await previewVisits() }, { headers }) }
  catch { return NextResponse.json({ error: 'Vista previa no disponible; comprobar migraciones' }, { status: 503, headers }) }
}
