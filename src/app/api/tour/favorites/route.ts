import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import { LV_VID_COOKIE } from '@/lib/tour/trackingIds'
import { normalizeShowroomPhone } from '@/lib/tour/showroomIdentity'

export const runtime = 'nodejs'

type FavoriteRow = {
  unitId: string
  unitNumber: string
  typologyCode: string | null
  floor: string | null
  savedAt: string
}

function metaString(meta: Record<string, unknown> | null | undefined, key: string) {
  const value = meta?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function buildFavorites(events: Array<{ created_at: string; metadata: Record<string, unknown> | null }>) {
  const map = new Map<string, FavoriteRow>()
  const chronological = [...events].sort((a, b) => a.created_at.localeCompare(b.created_at))
  for (const event of chronological) {
    const meta = event.metadata ?? {}
    const unitId = metaString(meta, 'unit_id')
    const unitNumber = metaString(meta, 'unit_number')
    if (!unitId || !unitNumber) continue
    const action = metaString(meta, 'action')
    if (action === 'remove') {
      map.delete(unitId)
      continue
    }
    map.set(unitId, {
      unitId,
      unitNumber,
      typologyCode: metaString(meta, 'typology_code'),
      floor: metaString(meta, 'floor'),
      savedAt: event.created_at,
    })
  }
  return [...map.values()].sort((a, b) => b.savedAt.localeCompare(a.savedAt))
}

/** Lista favoritos del visitante (cookie lv_vid) y, si hay teléfono, del lead. */
export async function GET(request: Request) {
  const admin = tryCreateAdminClient()
  if (!admin) {
    return NextResponse.json({ error: 'Storage no configurado' }, { status: 503 })
  }

  const jar = await cookies()
  const visitorKey = jar.get(LV_VID_COOKIE)?.value?.trim()
  const phone = normalizeShowroomPhone(
    new URL(request.url).searchParams.get('phone') ?? '',
  )

  if (!visitorKey && !phone) {
    return NextResponse.json({ favorites: [] })
  }

  try {
    const sessionIds = new Set<string>()

    if (visitorKey) {
      const { data: visitor } = await admin
        .from('tour_visitors')
        .select('id')
        .eq('visitor_key', visitorKey)
        .maybeSingle()
      if (visitor?.id) {
        const { data: sessions } = await admin
          .from('tour_sessions')
          .select('id')
          .eq('visitor_id', visitor.id)
          .limit(40)
        for (const row of sessions ?? []) sessionIds.add(row.id)
      }
    }

    if (phone) {
      const digits = phone.replace(/\D/g, '')
      const { data: leads } = await admin
        .from('leads')
        .select('id, phone')
        .or(`phone.eq.${phone},phone.ilike.%${digits.slice(-8)}`)
        .limit(8)
      const leadIds = (leads ?? []).map((row) => row.id)
      if (leadIds.length > 0) {
        const { data: sessions } = await admin
          .from('tour_sessions')
          .select('id')
          .in('lead_id', leadIds)
          .limit(60)
        for (const row of sessions ?? []) sessionIds.add(row.id)
      }
    }

    if (sessionIds.size === 0) {
      return NextResponse.json({ favorites: [] as FavoriteRow[] })
    }

    const { data: events, error } = await admin
      .from('tour_events')
      .select('created_at, metadata')
      .eq('event_type', 'guardar_unidad')
      .in('tour_session_id', [...sessionIds])
      .order('created_at', { ascending: true })
      .limit(300)

    if (error) throw error
    const favorites = buildFavorites((events ?? []) as Array<{ created_at: string; metadata: Record<string, unknown> | null }>)
    return NextResponse.json({ favorites })
  } catch (error) {
    console.error('GET /api/tour/favorites', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudieron leer favoritos' },
      { status: 500 },
    )
  }
}
