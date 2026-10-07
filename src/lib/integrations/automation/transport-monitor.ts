import 'server-only'
import { LAVILET_KOMMO_ORIGIN } from '../lavilet'
import { autoConfig, db, object, scope, text, type Row } from './data'
import { assertLive, automationSettings } from './config'
import { inboundFreshness } from './inbound-freshness'
import { reserveKommoCall } from './kommo-admission'

type TransportIssue = { id: string; kommoId: number; at: string; minutes: number | null }
export type TransportHealth = {
  checkedAt: string; error: string | null; limited: boolean;
  missing: TransportIssue[]; delayed: TransportIssue[];
}

/** Events prove presence in Kommo, not channel, message content or WhatsApp delivery. */
export function compareIncomingEvents(events: Row[], received: Row[], managedIds: number[], now: number) {
  const managed = new Set(managedIds)
  const observed = new Map(received.map(row => [text(row.event_key).replace(/^inbound:/, ''), row]))
  const missing: TransportIssue[] = [], delayed: TransportIssue[] = []
  for (const event of events) {
    if (event.type !== 'incoming_chat_message' || event.entity_type !== 'lead' || !managed.has(Number(event.entity_id))) continue
    const message = object(object(event.value_after).message)
    const origin = text(message.origin).toLowerCase()
    if (origin && !['waba', 'whatsapp'].includes(origin)) continue
    const id = text(message.id)
    const atMs = Number(event.created_at) * 1000
    if (!id || !Number.isFinite(atMs) || atMs <= 0 || now - atMs < 120_000) continue
    const row = observed.get(id)
    const issue = { id, kommoId: Number(event.entity_id), at: new Date(atMs).toISOString(), minutes: null as number | null }
    if (!row) missing.push(issue)
    else {
      const timing = inboundFreshness(text(object(row.payload).sentAt), text(row.received_at))
      if (timing.delayed) delayed.push({ ...issue, minutes: timing.lagMinutes })
    }
  }
  return { missing, delayed }
}

let cached: { expires: number; promise: Promise<TransportHealth> } | undefined

/** Read-only and bounded. No event is replayed from an ID without its original text. */
export function transportHealth(now = Date.now()): Promise<TransportHealth> {
  if (cached && cached.expires > now) return cached.promise
  const promise = inspectTransport(now).catch(error => ({ checkedAt: new Date(now).toISOString(),
    error: error instanceof Error && /^KOMMO_MONITOR_[A-Z0-9_]+$/.test(error.message) ? error.message : 'KOMMO_MONITOR_UNAVAILABLE',
    limited: false, missing: [], delayed: [] }))
  cached = { expires: now + 60_000, promise }
  return promise
}

async function inspectTransport(now: number): Promise<TransportHealth> {
  const empty = { checkedAt: new Date(now).toISOString(), error: null, limited: false, missing: [], delayed: [] }
  const config = await autoConfig(), settings = automationSettings()
  if (config.enabled !== true || config.dry_run !== false) return empty
  if (!process.env.KOMMO_ACCESS_TOKEN || new URL(process.env.KOMMO_BASE_URL || '').origin !== LAVILET_KOMMO_ORIGIN) {
    throw Error('KOMMO_MONITOR_CONFIGURATION')
  }
  const activated = Date.parse(settings.activatedAt)
  const from = Math.max(now - 2 * 3_600_000, Number.isFinite(activated) ? activated : 0)
  const events: Row[] = []
  let limited = false
  for (let page = 1; page <= 3; page++) {
    // The live account returns 204 with filter[entity]=lead even when matching
    // lead events exist. Check entity_type locally rather than hiding those events.
    const query = new URLSearchParams({ 'filter[type]': 'incoming_chat_message',
      'filter[created_at][from]': String(Math.floor(from / 1000)), limit: '100', page: String(page) })
    await reserveKommoCall()
    const response = await fetch(`${LAVILET_KOMMO_ORIGIN}/api/v4/events?${query}`, {
      headers: { Authorization: `Bearer ${process.env.KOMMO_ACCESS_TOKEN}` }, cache: 'no-store', redirect: 'error',
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) { await response.body?.cancel(); throw Error(`KOMMO_MONITOR_${response.status}`) }
    if (response.status === 204) break
    const body = object(await response.json())
    const batch = object(body._embedded).events
    if (!Array.isArray(batch)) throw Error('KOMMO_MONITOR_INVALID_RESPONSE')
    events.push(...batch.map(object))
    const hasNext = Boolean(object(object(body._links).next).href)
    if (!hasNext) break
    if (page === 3) limited = true
  }
  const ids = [...new Set(events.map(event => Number(event.entity_id)).filter(id => Number.isSafeInteger(id) && id > 0))]
  if (!ids.length) return { ...empty, limited }
  let leadQuery = db().from('leads').select('id,kommo_id').match(scope).eq('bot_enabled', true).is('tracking_opt_out_at', null).in('kommo_id', ids)
  if (settings.testLeadId) leadQuery = leadQuery.eq('id', settings.testLeadId)
  else if (config.test_only === true) leadQuery = leadQuery.in('id', Array.isArray(config.test_lead_ids)
    ? config.test_lead_ids : [config.test_lead_id].filter(Boolean))
  const leads = await leadQuery.abortSignal(AbortSignal.timeout(5_000))
  if (leads.error) throw Error('KOMMO_MONITOR_LEAD_READ')
  const managedIds = (leads.data || []).map(lead => Number(lead.kommo_id))
  const keys = [...new Set(events.filter(event => managedIds.includes(Number(event.entity_id)))
    .map(event => text(object(object(event.value_after).message).id)).filter(Boolean))]
  const received: Row[] = []
  for (let offset = 0; offset < keys.length; offset += 100) {
    const result = await db().from('lv_integration_events').select('event_key,received_at,payload').match(scope)
      .eq('kind', 'inbound').in('event_key', keys.slice(offset, offset + 100).map(id => `inbound:${id}`))
      .abortSignal(AbortSignal.timeout(5_000))
    if (result.error) throw Error('KOMMO_MONITOR_EVENT_READ')
    received.push(...result.data || [])
  }
  return { ...empty, limited, ...compareIncomingEvents(events, received, managedIds, now) }
}

/** The scheduled worker retains missing-message incidents even after the rolling window ends. */
export async function syncTransportIncidents(readHealth: () => Promise<TransportHealth> = transportHealth) {
  assertLive()
  const health = await readHealth()
  if (health.error) return { checked_at: health.checkedAt, error: health.error }
  try {
    if (health.missing.length) {
      const inserted = await db().from('lv_integration_events').upsert(health.missing.map(item => ({ ...scope,
        event_key: `transport_missing:${item.id}`, kind: 'maintenance', status: 'cancelled', contact_key: String(item.kommoId),
        completed_at: health.checkedAt,
        result: { reason: 'KOMMO_INBOUND_NOT_OBSERVED', requires_review: true, delivery_status: 'not_sent',
          source_message_id: item.id, provider_event_at: item.at },
      })), { onConflict: 'project_id,event_key', ignoreDuplicates: true }).abortSignal(AbortSignal.timeout(5_000))
      if (inserted.error) throw Error('KOMMO_MONITOR_SAVE_FAILED')
    }
    const outstanding = await db().from('lv_integration_events').select('id,result').match(scope)
      .eq('status', 'cancelled').eq('kind', 'maintenance').eq('result->>reason', 'KOMMO_INBOUND_NOT_OBSERVED')
      .contains('result', { requires_review: true }).order('received_at', { ascending: false }).limit(100)
      .abortSignal(AbortSignal.timeout(5_000))
    if (outstanding.error) throw Error('KOMMO_MONITOR_SAVE_FAILED')
    const rows = outstanding.data || []
    let recovered = 0
    if (rows.length) {
      const observed = await db().from('lv_integration_events').select('event_key').match(scope).eq('kind', 'inbound')
        .in('event_key', rows.map(row => `inbound:${text(object(row.result).source_message_id)}`))
        .abortSignal(AbortSignal.timeout(5_000))
      if (observed.error) throw Error('KOMMO_MONITOR_SAVE_FAILED')
      const keys = new Set((observed.data || []).map(row => row.event_key))
      const updateDeadline = Date.now() + 10_000
      for (const row of rows) {
        if (Date.now() >= updateDeadline) break
        if (!keys.has(`inbound:${text(object(row.result).source_message_id)}`)) continue
        const updated = await db().from('lv_integration_events').update({ result: { ...object(row.result),
          requires_review: false, recovery: 'webhook_received', recovered_at: health.checkedAt } }).match(scope)
          .eq('id', row.id).eq('status', 'cancelled').abortSignal(AbortSignal.timeout(5_000))
        if (updated.error) throw Error('KOMMO_MONITOR_SAVE_FAILED')
        recovered++
      }
    }
    return { checked_at: health.checkedAt, missing: health.missing.length, delayed: health.delayed.length, recovered, limited: health.limited }
  } catch {
    // Monitoring cannot turn a successful send into a failed automation task.
    return { checked_at: health.checkedAt, error: 'KOMMO_MONITOR_SAVE_FAILED' }
  }
}
