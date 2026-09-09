import { NextResponse } from 'next/server'
import { automationSettings, secretMatches } from '@/lib/integrations/automation/config'
import { rpc } from '@/lib/integrations/automation/data'
import { limitedBody, normalizeWebhook } from '@/lib/integrations/automation/webhook'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'no-store' }
  const provided = request.headers.get('x-kommo-webhook-secret') || new URL(request.url).searchParams.get('key')
  if (!secretMatches(provided, process.env.KOMMO_WEBHOOK_SECRET)) return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers })
  const settings = automationSettings()
  if (!settings.live) return NextResponse.json({ error: 'Recepción no activada' }, { status: 503, headers })
  let events
  try {
    const raw = await limitedBody(request)
    events = normalizeWebhook(raw, request.headers.get('content-type') || '')
      .filter(event => Date.parse(event.sentAt) >= Date.parse(settings.activatedAt))
  } catch {
    return NextResponse.json({ error: 'Evento inválido' }, { status: 400, headers })
  }
  try {
    // Solo persistencia. La IA, Kommo y la lógica de negocio se ejecutan desde el worker.
    const inserted = events.length ? await rpc('lv_app_receive', { p_events: events }) : 0
    return NextResponse.json({ accepted: true, received: events.length, inserted }, { status: 200, headers })
  } catch {
    return NextResponse.json({ error: 'No se pudo persistir el evento' }, { status: 503, headers })
  }
}
