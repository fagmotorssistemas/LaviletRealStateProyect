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
import type { KommoMessageEvidence } from '@/lib/integrations/automation/message-evidence'
import { acceptsKommoTestContactBatch } from '@/lib/integrations/automation/kommoWebhookIsolation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'no-store' }
  const provided = request.headers.get('x-kommo-webhook-secret') || new URL(request.url).searchParams.get('key')
  if (!secretMatches(provided, process.env.KOMMO_WEBHOOK_SECRET)) return NextResponse.json({ error: 'No autorizado' }, { status: 401, headers })
  const settings = automationSettings()
  const correlationId = request.headers.get('x-request-id')?.trim() || randomUUID()
  let events: Inbound[] = []
  let advisorOutbound: AdvisorOutbound[] = []
  let evidence: KommoMessageEvidence[] = []
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
    evidence = normalized.evidence
    events = normalized.inbound.filter(event => Date.parse(event.sentAt) >= Date.parse(settings.activatedAt))
    advisorOutbound = normalized.advisorOutbound
      .filter(event => Date.parse(event.sentAt) >= Date.parse(settings.activatedAt))
    if (probe) events = attachCtwaProbeSummary(events, probe)
  } catch {
    return NextResponse.json({ error: 'Evento inválido' }, { status: 400, headers })
  }

  // Aislamiento operativo opcional: rechaza el lote completo antes de cualquier
  // RPC cuando contiene una persona distinta del contacto de prueba configurado.
  if (process.env.KOMMO_WEBHOOK_ALLOWED_CONTACT_ID?.trim()) {
    const contactIds = [...evidence, ...events, ...advisorOutbound].map(item => item.contactId)
    if (!acceptsKommoTestContactBatch(process.env.KOMMO_WEBHOOK_ALLOWED_CONTACT_ID, contactIds)) {
      return NextResponse.json({ accepted: true, filtered: 'test_contact_only' }, { status: 200, headers })
    }
  }
  try {
    // Persist before acknowledging. An optional post-response task wakes the same worker.
    // Independent, idempotent journal: captures bot/unknown authors and media
    // before the existing activation/manual-takeover filters. No business effects.
    const persisted = await rpc<{evidence_inserted:number;inbound_inserted:number;advisor_inserted:number}>('lv_receive_kommo_observation', {
      p_evidence: evidence,
      p_inbound: settings.live ? events : [],
      p_advisor: settings.live ? advisorOutbound : [],
    })
    // Synchronization does not depend on permission to launch commercial bots.
    // Preserve the existing automation gate after the observation is durable.
    if (!settings.live) return NextResponse.json({ accepted: true, evidence_observed: evidence.length, automation: 'disabled' }, { status: 200, headers })
    const inserted = persisted.inbound_inserted
    const advisorInserted = persisted.advisor_inserted
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
      evidence_observed: evidence.length,
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
    // No payload, secret or URL in logs. 503 is not proof of a provider retry.
    console.error(JSON.stringify({event:'kommo_observation_persist_failed',correlationId,evidenceCount:evidence.length,inboundCount:events.length,advisorCount:advisorOutbound.length}))
    return NextResponse.json({ error: 'No se pudo persistir el evento' }, { status: 503, headers })
  }
}
