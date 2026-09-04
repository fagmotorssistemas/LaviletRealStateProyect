'use server'

import { assertCanAccessCrmPath, getCrmDataClient } from '@/lib/auth/session'
import { TOUR_TENANT_ID } from '@/lib/tour/trackingIds'

export type TourRecorridoRow = {
  sessionId: string
  visitorId: string
  leadId: string | null
  leadName: string | null
  leadEmail: string | null
  leadPhone: string | null
  identified: boolean
  totalSeconds: number
  startedAt: string
  lastSeenAt: string | null
  city: string | null
  country: string | null
  utmSource: string | null
  firstUtmSource: string | null
  landingPath: string | null
  salespersonRef: string | null
  deviceType: string | null
  trackingConsent: boolean
  topRoom: string | null
  rooms: { room: string; seconds: number }[]
}

export type TourRecorridoEvent = {
  id: string
  eventType: string
  room: string | null
  seconds: number
  createdAt: string
  typology: string | null
}

export type TourRecorridoDetail = TourRecorridoRow & {
  events: TourRecorridoEvent[]
}

type SessionRow = {
  id: string
  visitor_id: string
  lead_id: string | null
  started_at: string
  last_seen_at: string | null
  total_seconds: number | null
  city: string | null
  country: string | null
  utm_source: string | null
  landing_path: string | null
  salesperson_ref: string | null
  device_type: string | null
  tracking_consent: boolean | null
}

type LeadRow = {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  first_utm_source: string | null
}

type EventRow = {
  id: string
  tour_session_id: string
  event_type: string
  room: string | null
  seconds: number | null
  created_at: string
  metadata: { typology_code?: string | null } | null
}

function topRoomOf(rooms: { room: string; seconds: number }[]) {
  return rooms[0]?.room ?? null
}

function roomsFromEvents(rows: EventRow[]) {
  const map = new Map<string, number>()
  for (const row of rows) {
    if (row.event_type !== 'ambiente' && row.event_type !== 'salida') continue
    const room = String(row.room ?? '').trim()
    if (!room) continue
    map.set(room, (map.get(room) ?? 0) + Math.max(0, Number(row.seconds) || 0))
  }
  return [...map.entries()]
    .map(([room, seconds]) => ({ room, seconds }))
    .sort((a, b) => b.seconds - a.seconds)
}

async function mapSessions(
  sessions: SessionRow[],
  leads: LeadRow[],
  events: EventRow[],
): Promise<TourRecorridoRow[]> {
  const leadById = new Map(leads.map((row) => [row.id, row]))
  const eventsBySession = new Map<string, EventRow[]>()
  for (const row of events) {
    const list = eventsBySession.get(row.tour_session_id) ?? []
    list.push(row)
    eventsBySession.set(row.tour_session_id, list)
  }

  return sessions.map((session) => {
    const lead = session.lead_id ? leadById.get(session.lead_id) : undefined
    const rooms = roomsFromEvents(eventsBySession.get(session.id) ?? [])
    return {
      sessionId: session.id,
      visitorId: session.visitor_id,
      leadId: session.lead_id,
      leadName: lead?.name ?? null,
      leadEmail: lead?.email ?? null,
      leadPhone: lead?.phone ?? null,
      identified: Boolean(session.lead_id),
      totalSeconds: Math.max(0, Number(session.total_seconds) || 0),
      startedAt: session.started_at,
      lastSeenAt: session.last_seen_at,
      city: session.city,
      country: session.country,
      utmSource: session.utm_source,
      firstUtmSource: lead?.first_utm_source ?? session.utm_source,
      landingPath: session.landing_path,
      salespersonRef: session.salesperson_ref,
      deviceType: session.device_type,
      trackingConsent: Boolean(session.tracking_consent),
      topRoom: topRoomOf(rooms),
      rooms,
    }
  })
}

export async function listTourRecorridosAction(params?: {
  page?: number
  pageSize?: number
  identified?: 'all' | 'yes' | 'no'
}): Promise<{ data: TourRecorridoRow[]; total: number; error?: string }> {
  try {
    await assertCanAccessCrmPath('/inmobiliaria/recorrido')
    const client = await getCrmDataClient()
    const page = params?.page ?? 1
    const pageSize = params?.pageSize ?? 15
    const from = (page - 1) * pageSize
    const to = from + pageSize - 1

    let query = client
      .from('tour_sessions')
      .select(
        'id, visitor_id, lead_id, started_at, last_seen_at, total_seconds, city, country, utm_source, landing_path, salesperson_ref, device_type, tracking_consent',
        { count: 'exact' },
      )
      .eq('tenant_id', TOUR_TENANT_ID)
      .order('started_at', { ascending: false })

    if (params?.identified === 'yes') query = query.not('lead_id', 'is', null)
    if (params?.identified === 'no') query = query.is('lead_id', null)

    const { data, error, count } = await query.range(from, to)
    if (error) throw new Error(error.message)
    const sessions = (data ?? []) as SessionRow[]
    const leadIds = [...new Set(sessions.map((row) => row.lead_id).filter(Boolean))] as string[]
    const sessionIds = sessions.map((row) => row.id)

    const [leadsRes, eventsRes] = await Promise.all([
      leadIds.length
        ? client.from('leads').select('id, name, email, phone, first_utm_source').in('id', leadIds)
        : Promise.resolve({ data: [], error: null }),
      sessionIds.length
        ? client
            .from('tour_events')
            .select('id, tour_session_id, event_type, room, seconds, created_at, metadata')
            .in('tour_session_id', sessionIds)
        : Promise.resolve({ data: [], error: null }),
    ])
    if (leadsRes.error) throw new Error(leadsRes.error.message)
    if (eventsRes.error) throw new Error(eventsRes.error.message)

    return {
      data: await mapSessions(sessions, (leadsRes.data ?? []) as LeadRow[], (eventsRes.data ?? []) as EventRow[]),
      total: count ?? 0,
    }
  } catch (error) {
    console.error('listTourRecorridosAction', error)
    return { data: [], total: 0, error: error instanceof Error ? error.message : 'No se pudo leer el recorrido' }
  }
}

export async function getTourRecorridoAction(sessionId: string): Promise<TourRecorridoDetail | null> {
  await assertCanAccessCrmPath('/inmobiliaria/recorrido')
  const client = await getCrmDataClient()
  const { data: session, error } = await client
    .from('tour_sessions')
    .select(
      'id, visitor_id, lead_id, started_at, last_seen_at, total_seconds, city, country, utm_source, landing_path, salesperson_ref, device_type, tracking_consent',
    )
    .eq('id', sessionId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!session) return null

  const [{ data: lead }, { data: events, error: eventsError }] = await Promise.all([
    session.lead_id
      ? client.from('leads').select('id, name, email, phone, first_utm_source').eq('id', session.lead_id).maybeSingle()
      : Promise.resolve({ data: null }),
    client
      .from('tour_events')
      .select('id, tour_session_id, event_type, room, seconds, created_at, metadata')
      .eq('tour_session_id', sessionId)
      .order('created_at', { ascending: true }),
  ])
  if (eventsError) throw new Error(eventsError.message)

  const eventRows = (events ?? []) as EventRow[]
  const [row] = await mapSessions(
    [session as SessionRow],
    lead ? [lead as LeadRow] : [],
    eventRows,
  )
  return {
    ...row,
    events: eventRows.map((item) => ({
      id: item.id,
      eventType: item.event_type,
      room: item.room,
      seconds: Math.max(0, Number(item.seconds) || 0),
      createdAt: item.created_at,
      typology: item.metadata?.typology_code ?? null,
    })),
  }
}

export async function listLeadTourRecorridosAction(leadId: string): Promise<TourRecorridoDetail[]> {
  await assertCanAccessCrmPath('/inmobiliaria/recorrido')
  const client = await getCrmDataClient()
  const { data, error } = await client
    .from('tour_sessions')
    .select('id')
    .eq('lead_id', leadId)
    .order('started_at', { ascending: false })
  if (error) throw new Error(error.message)
  const details = await Promise.all((data ?? []).map((row) => getTourRecorridoAction(row.id)))
  return details.filter((row): row is TourRecorridoDetail => Boolean(row))
}
