import { NextResponse } from 'next/server'
import { secretMatches } from '@/lib/integrations/automation/config'
import { runAutomation } from '@/lib/integrations/automation/worker'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'no-store' }
  const authorization = request.headers.get('authorization')
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : null
  if (!secretMatches(token, process.env.AUTOMATION_CRON_SECRET || process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers })
  }
  try { return NextResponse.json(await runAutomation(), { headers }) }
  catch { return NextResponse.json({ error: 'Automatización no disponible; revisar configuración y migraciones' }, { status: 503, headers }) }
}

// Compatible con cron que invoca GET. Siempre exige el secreto del servidor.
export const GET = POST
