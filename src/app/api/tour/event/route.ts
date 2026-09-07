import { NextResponse } from 'next/server'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import { isTourEventType } from '@/lib/tour/trackingIds'
import { resolveFinishPackageId, resolveUnitTypeId, rpcLogTourEvent, touchTourSession } from '@/lib/tour/tourRpc'

export const runtime = 'nodejs'

type EventBody = {
  session_id?: string
  visitor_id?: string
  event_type?: string
  heartbeat?: boolean
  room?: string
  unit_type_id?: string
  typology_code?: string
  finish_package_id?: string
  finish?: string
  light?: string
  seconds?: number
  metadata?: Record<string, unknown>
}

async function readBody(request: Request): Promise<EventBody> {
  const text = await request.text()
  if (!text) return {}
  return JSON.parse(text) as EventBody
}

export async function POST(request: Request) {
  const admin = tryCreateAdminClient()
  if (!admin) {
    return NextResponse.json({ error: 'Falta SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })
  }

  let body: EventBody
  try {
    body = await readBody(request)
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }

  const eventType = String(body.event_type ?? '')
  if (!body.session_id || !body.visitor_id) {
    return NextResponse.json({ error: 'Falta session_id o visitor_id' }, { status: 400 })
  }

  try {
    const unitTypeId = body.unit_type_id || (await resolveUnitTypeId(admin, body.typology_code))
    const seconds = body.seconds == null ? 0 : Math.max(0, Math.round(Number(body.seconds) || 0))

    if (body.heartbeat) {
      await touchTourSession(admin, { sessionId: body.session_id, seconds, unitTypeId })
      return NextResponse.json({ ok: true })
    }

    if (!isTourEventType(eventType)) {
      return NextResponse.json({ error: 'event_type no válido' }, { status: 400 })
    }

    const finishSlug = String(body.finish ?? body.metadata?.finish ?? '').trim() || null
    const finishPackageId = body.finish_package_id || (await resolveFinishPackageId(admin, finishSlug))
    await rpcLogTourEvent(admin, {
      sessionId: body.session_id,
      visitorId: body.visitor_id,
      eventType,
      room: body.room,
      unitTypeId,
      finishPackageId,
      light: body.light,
      seconds,
      metadata: {
        ...(body.metadata ?? {}),
        ...(body.typology_code ? { typology_code: body.typology_code } : {}),
        ...(finishSlug ? { finish: finishSlug } : {}),
        ...(body.light ? { light: body.light } : {}),
      },
    })
    await touchTourSession(admin, { sessionId: body.session_id, unitTypeId })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('POST /api/tour/event', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudo guardar el evento' },
      { status: 500 },
    )
  }
}
