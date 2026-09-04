import type { TourEventType } from '@/lib/tour/trackingIds'

export type TourTrackIds = {
  visitor_id: string
  session_id: string
}

export type TourEventPayload = {
  event_type: TourEventType
  room?: string | null
  typology_code?: string | null
  unit_type_id?: string | null
  finish?: string | null
  light?: string | null
  seconds?: number | null
  metadata?: Record<string, unknown>
}

let ids: TourTrackIds | null = null
let opening: Promise<TourTrackIds | null> | null = null
const queued: TourEventPayload[] = []

function cookieValue(name: string) {
  if (typeof document === 'undefined') return ''
  const row = document.cookie.split('; ').find((part) => part.startsWith(`${name}=`))
  return row ? decodeURIComponent(row.split('=').slice(1).join('=')) : ''
}

function queryParam(name: string) {
  if (typeof window === 'undefined') return ''
  return new URLSearchParams(window.location.search).get(name) ?? ''
}

export function getVisitorKey() {
  return cookieValue('lv_vid')
}

export function getTourTrackIds() {
  return ids
}

export async function openTourSession(): Promise<TourTrackIds | null> {
  if (ids) return ids
  if (opening) return opening
  opening = (async () => {
    const response = await fetch('/api/tour/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        utm_source: queryParam('utm_source'),
        utm_medium: queryParam('utm_medium'),
        utm_campaign: queryParam('utm_campaign'),
        salesperson_ref: queryParam('b'),
        referrer: typeof document !== 'undefined' ? document.referrer : '',
        landing_path: typeof window !== 'undefined' ? `${window.location.pathname}${window.location.search}` : '',
        screen_width: typeof window !== 'undefined' ? window.innerWidth : 0,
        city: cookieValue('lv_city'),
        country: cookieValue('lv_country'),
      }),
    })
    if (!response.ok) {
      console.error('openTourSession', await response.text())
      return null
    }
    const json = (await response.json()) as TourTrackIds
    ids = json
    flushQueuedEvents()
    return json
  })().finally(() => {
    opening = null
  })
  return opening
}

function postTourEvent(payload: TourEventPayload, opts?: { beacon?: boolean }) {
  const current = ids
  if (!current) return
  const body = JSON.stringify({
    session_id: current.session_id,
    visitor_id: current.visitor_id,
    ...payload,
  })
  if (opts?.beacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
    const blob = new Blob([body], { type: 'application/json' })
    if (navigator.sendBeacon('/api/tour/event', blob)) return
  }
  void fetch('/api/tour/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  })
    .then(async (response) => {
      if (!response.ok) {
        console.error('log_tour_event', payload.event_type, await response.text())
      }
    })
    .catch((error) => {
      console.error('log_tour_event', payload.event_type, error)
    })
}

function flushQueuedEvents() {
  if (!ids) return
  const pending = queued.splice(0)
  for (const payload of pending) postTourEvent(payload)
}

export function logTourEvent(payload: TourEventPayload, opts?: { beacon?: boolean }) {
  if (!ids) {
    queued.push(payload)
    return
  }
  postTourEvent(payload, opts)
}

export async function identifyTourLead(input: {
  name: string
  email: string
  phone: string
  consent: boolean
}) {
  const response = await fetch('/api/tour/identify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const json = (await response.json()) as { lead_id?: string; error?: string }
  if (!response.ok || !json.lead_id) {
    throw new Error(json.error || 'No se pudo guardar el contacto')
  }
  logTourEvent({ event_type: 'lead_identificado', metadata: { lead_id: json.lead_id } })
  return json.lead_id
}
