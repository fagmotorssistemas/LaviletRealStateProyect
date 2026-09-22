import { after, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { automationSettings, secretMatches } from '@/lib/integrations/automation/config'
import { rpc } from '@/lib/integrations/automation/data'
import {
  attachCtwaProbeSummary,
  limitedBody,
  logKommoCtwaFieldProbe,
  normalizeKommoWebhook,
  probeKommoCtwaFields,
  type AdvisorOutbound,
  type Inbound,
  type KommoCtwaFieldProbe,
} from '@/lib/integrations/automation/webhook'
import { accelerateTestMessages, testResponseMode } from '@/lib/integrations/automation/test-response-mode'
import { TEST_RESPONSE_SECONDS } from '@/lib/inmobiliaria/testResponseMode'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'no-store' }
  const provided = request.headers.get('x-kommo-webhook-secret') || new URL(request.url).searchParams.get('key')
  if (!secretMatches(provided, process.env.KOMMO_WEBHOOK_SECRET)) return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers })
  const settings = automationSettings()
  if (!settings.live) return NextResponse.json({ error: 'Recepción no activada' }, { status: 503, headers })
  const correlationId = request.headers.get('x-request-id')?.trim() || randomUUID()
  let events: Inbound[] = []
  let advisorOutbound: AdvisorOutbound[] = []
  let probe: KommoCtwaFieldProbe | null = null
  try {
    const raw = await limitedBody(request)
    const contentType = request.headers.get('content-type') || ''
    try {
      probe = probeKommoCtwaFields(raw, contentType, correlationId)
      logKommoCtwaFieldProbe(probe)
    } catch {
      console.info(JSON.stringify({
        event: 'kommo_ctwa_field_probe',
        correlationId,
        probeFailed: true,
        reason: 'PARSE_OR_UNSUPPORTED',
      }))
    }
    const normalized = normalizeKommoWebhook(raw, contentType)
    events = normalized.inbound.filter(event => Date.parse(event.sentAt) >= Date.parse(settings.activatedAt))
    advisorOutbound = normalized.advisorOutbound
      .filter(event => Date.parse(event.sentAt) >= Date.parse(settings.activatedAt))
    if (probe) events = attachCtwaProbeSummary(events, probe)
  } catch {
    return NextResponse.json({ error: 'Evento inválido' }, { status: 400, headers })
  }
  try {
    // Persist before acknowledging. An optional post-response task wakes the same worker.
    const inserted = events.length ? await rpc<number>('lv_app_receive', { p_events: events }) : 0
    const advisorInserted = advisorOutbound.length
      ? await rpc<number>('lv_app_receive_advisor_outbound', { p_events: advisorOutbound }) : 0
    if(inserted) after(async()=>{
      try {
        const mode=await testResponseMode()
        if(!mode||!events.some(e=>e.kommoId===mode.kommoId))return
        await new Promise(resolve=>setTimeout(resolve,TEST_RESPONSE_SECONDS*1000))
        const contacts=await accelerateTestMessages(events,mode.version)
        if(!contacts.length)return
        const {runAutomation}=await import('@/lib/integrations/automation/worker')
        for(const contact of contacts) await runAutomation(contact)
      } catch {
        // Persisted events remain available to the scheduled worker; never replay sends here.
        console.error('TEST_RESPONSE_WAKE_FAILED')
      }
    })
    return NextResponse.json({
      accepted: true,
      received: events.length + advisorOutbound.length,
      inbound: events.length,
      advisor_outbound: advisorOutbound.length,
      inserted: inserted + advisorInserted,
      inbound_inserted: inserted,
      advisor_outbound_inserted: advisorInserted,
      correlationId,
      ctwaProbe: probe
        ? {
            fieldsAbsent: probe.fieldsAbsent,
            pathCount: probe.referralOrCtwaPaths.length,
            extracted: Object.values(probe.extractedByIndex).some(Boolean),
          }
        : null,
    }, { status: 200, headers })
  } catch {
    return NextResponse.json({ error: 'No se pudo persistir el evento' }, { status: 503, headers })
  }
}
