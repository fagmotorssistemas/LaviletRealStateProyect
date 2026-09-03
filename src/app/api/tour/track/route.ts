import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionProfile } from '@/lib/auth/session'

export const runtime = 'nodejs'

type TrackBody = {
  typologyCode?: string
  room?: string
  roomLabel?: string
  unitId?: string
  unitCode?: string
  seconds?: number
}

export async function POST(request: Request) {
  const session = await getSessionProfile()
  if (!session) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  let body: TrackBody
  try {
    body = (await request.json()) as TrackBody
  } catch {
    return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
  }

  const seconds = Math.max(0, Math.round(Number(body.seconds) || 0))
  if (seconds < 2) return NextResponse.json({ ok: true, skipped: true })

  const typologyCode = String(body.typologyCode ?? '').trim()
  const room = String(body.roomLabel || body.room || '').trim()
  if (!typologyCode && !room) {
    return NextResponse.json({ error: 'Falta tipología o ambiente' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: tenant } = await admin.from('tenants').select('id').limit(1).maybeSingle()
  if (!tenant?.id) {
    return NextResponse.json({ error: 'No hay tenant para registrar el tour' }, { status: 500 })
  }

  const sessionKey = session.user.id
  const { data: existing } = await admin
    .from('tour_sessions')
    .select('id, total_seconds')
    .eq('session_id', sessionKey)
    .maybeSingle()

  const now = new Date().toISOString()
  let tourSessionId = existing?.id as string | undefined

  if (tourSessionId) {
    const { error } = await admin
      .from('tour_sessions')
      .update({
        last_seen_at: now,
        total_seconds: Number(existing?.total_seconds ?? 0) + seconds,
        user_agent: request.headers.get('user-agent'),
      })
      .eq('id', tourSessionId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { data: created, error } = await admin
      .from('tour_sessions')
      .insert({
        tenant_id: tenant.id,
        session_id: sessionKey,
        source: 'web-360',
        device_type: 'web',
        user_agent: request.headers.get('user-agent'),
        started_at: now,
        last_seen_at: now,
        total_seconds: seconds,
        tracking_consent: true,
      })
      .select('id')
      .single()
    if (error || !created) {
      return NextResponse.json({ error: error?.message ?? 'No se pudo crear la sesión' }, { status: 500 })
    }
    tourSessionId = created.id
  }

  const { error: eventError } = await admin.from('tour_events').insert({
    tour_session_id: tourSessionId,
    event_type: 'room_dwell',
    room: room || null,
    seconds,
    metadata: {
      profile_id: session.user.id,
      typology_code: typologyCode || null,
      unit_id: body.unitId || null,
      unit_code: body.unitCode || null,
      room_id: body.room || null,
    },
  })

  if (eventError) return NextResponse.json({ error: eventError.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
