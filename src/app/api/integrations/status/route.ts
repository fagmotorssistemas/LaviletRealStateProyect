import { NextResponse } from 'next/server'
import { getSessionProfile } from '@/lib/auth/session'
import { getIntegrationStatus } from '@/lib/integrations/status'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const headers = { 'Cache-Control': 'no-store' }
  try {
    const session = await getSessionProfile()
    if (!session) return NextResponse.json({ error: 'No autenticado' }, { status: 401, headers })
    if (session.profile.role !== 'admin') {
      return NextResponse.json({ error: 'Solo administradores' }, { status: 403, headers })
    }
    return NextResponse.json(await getIntegrationStatus(), { headers })
  } catch {
    return NextResponse.json({ error: 'No se pudo comprobar la integración' }, { status: 503, headers })
  }
}
