import { cookies, headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { after } from 'next/server'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import { LV_VID_COOKIE, TOUR_PROJECT_ID, TOUR_TENANT_ID } from '@/lib/tour/trackingIds'
import { rpcResolveLeadIdForVisitor } from '@/lib/tour/tourRpc'
import { resolveServerAdsConsentForVisitor } from '@/lib/meta/capiServer'
import { persistAddToWishlist } from '@/lib/meta/wishlistCapture'
import { flushLocalMetaOutbox } from '@/lib/meta/localOutbox'
import { sanitizeMetaEventSourceUrl } from '@/lib/marketing/metaEventSourceUrl'
import { clientIp } from '@/lib/tour/geo'
import {
  allowRateLimited,
  isUuid,
  type RateBucket,
} from '@/lib/meta/enqueueGuards'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RATE_WINDOW_MS = 60_000
const RATE_MAX = 12
const rateBucket: RateBucket = new Map()

/**
 * Captura AddToWishlist (favorito showroom).
 * Persistencia pending + flush Nest. No mas-promueve review_hold históricos.
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 })
  }

  const jar = await cookies()
  const visitorKey = jar.get(LV_VID_COOKIE)?.value?.trim() || ''
  if (!visitorKey) {
    return NextResponse.json({ ok: false, error: 'visitor no identificado' }, { status: 400 })
  }

  const admin = tryCreateAdminClient()
  if (!admin) {
    return NextResponse.json({ ok: false, error: 'admin_unavailable' }, { status: 503 })
  }

  const adsConsent = await resolveServerAdsConsentForVisitor(admin, visitorKey)
  if (!adsConsent) {
    return new NextResponse(null, { status: 204 })
  }

  const unitId = String(body.unit_id || '').trim()
  const eventId = String(body.event_id || '').trim()
  if (!unitId || !isUuid(unitId)) {
    return NextResponse.json({ ok: false, error: 'unit_id inválido' }, { status: 400 })
  }
  const suppliedEventTime = Number(body.event_time)
  const eventTime = Number.isFinite(suppliedEventTime) && suppliedEventTime > 0
    ? Math.floor(suppliedEventTime)
    : undefined
  if (!eventId || !isUuid(eventId)) {
    return NextResponse.json({ ok: false, error: 'event_id inválido' }, { status: 400 })
  }

  const h = await headers()
  const ip = clientIp(h) || 'unknown'
  if (!allowRateLimited(rateBucket, `${visitorKey}:${ip}`, Date.now(), RATE_WINDOW_MS, RATE_MAX)) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 })
  }

  let resolvedLeadId: string | null = null
  try {
    resolvedLeadId = await rpcResolveLeadIdForVisitor(admin, visitorKey)
  } catch (error) {
    console.error('[meta-wishlist] resolve lead', {
      error: error instanceof Error ? error.message.slice(0, 120) : 'error',
    })
  }

  const bodyLeadId = String(body.lead_id || '').trim()
  if (bodyLeadId) {
    if (!isUuid(bodyLeadId)) {
      return NextResponse.json({ ok: false, error: 'lead_id inválido' }, { status: 400 })
    }
    if (resolvedLeadId && bodyLeadId !== resolvedLeadId) {
      return NextResponse.json({ ok: false, error: 'lead_id no coincide con el visitante' }, { status: 403 })
    }
    if (!resolvedLeadId) resolvedLeadId = bodyLeadId
  }

  if (!resolvedLeadId) {
    return NextResponse.json({ ok: false, error: 'lead no resuelto' }, { status: 400 })
  }

  const { data: lead, error: leadError } = await admin
    .from('leads')
    .select('id, tenant_id')
    .eq('id', resolvedLeadId)
    .eq('tenant_id', TOUR_TENANT_ID)
    .maybeSingle()
  if (leadError || !lead) {
    return NextResponse.json({ ok: false, error: 'contacto no pertenece al proyecto' }, { status: 403 })
  }

  const { data: visitor } = await admin
    .from('tour_visitors')
    .select('id, lead_id')
    .eq('tenant_id', TOUR_TENANT_ID)
    .eq('visitor_key', visitorKey)
    .eq('lead_id', resolvedLeadId)
    .maybeSingle()
  if (!visitor) {
    return NextResponse.json({ ok: false, error: 'visitante no pertenece al contacto' }, { status: 403 })
  }

  const { data: savedFavorite, error: savedFavoriteError } = await admin
    .from('tour_events')
    .select('id')
    .eq('visitor_id', visitor.id)
    .eq('lead_id', resolvedLeadId)
    .eq('event_type', 'guardar_unidad')
    .contains('metadata', { action: 'save', unit_id: unitId })
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (savedFavoriteError || !savedFavorite) {
    return NextResponse.json({ ok: false, error: 'favorito no guardado' }, { status: 409 })
  }

  const { data: unit, error: unitError } = await admin
    .from('units')
    .select('id, unit_number, category, tenant_id, project_id')
    .eq('id', unitId)
    .eq('tenant_id', TOUR_TENANT_ID)
    .eq('project_id', TOUR_PROJECT_ID)
    .maybeSingle()

  if (unitError || !unit) {
    return NextResponse.json({ ok: false, error: 'inmueble no encontrado' }, { status: 404 })
  }

  const unitNumber =
    String(body.unit_number || '').trim() || String(unit.unit_number || '').trim() || unitId
  const typologyCode =
    String(body.typology_code || '').trim() || String(unit.category || '').trim() || null

  try {
    const persisted = await persistAddToWishlist(admin, {
      leadId: resolvedLeadId,
      visitorKey,
      unitId,
      unitNumber,
      typologyCode,
      eventId,
      eventTime,
      eventSourceUrl:
        sanitizeMetaEventSourceUrl(
          typeof body.event_source_url === 'string' ? body.event_source_url : undefined,
        ) || undefined,
      fbp: typeof body.fbp === 'string' ? body.fbp : undefined,
      fbc: typeof body.fbc === 'string' ? body.fbc : undefined,
      fbclid: typeof body.fbclid === 'string' ? body.fbclid : undefined,
      clientIpAddress: ip !== 'unknown' ? ip : undefined,
      clientUserAgent: h.get('user-agent') || undefined,
    })

    try {
      await flushLocalMetaOutbox(admin, { eventIds: [persisted.eventId], limit: 5 })
    } catch (error) {
      console.error('[meta-wishlist] sync flush', {
        event_id: persisted.eventId,
        error: error instanceof Error ? error.message.slice(0, 180) : 'error',
      })
    }

    after(async () => {
      try {
        await flushLocalMetaOutbox(admin, { limit: 20 })
      } catch (error) {
        console.error('[meta-wishlist] after flush', {
          event_id: persisted.eventId,
          error: error instanceof Error ? error.message.slice(0, 180) : 'error',
        })
      }
    })

    return NextResponse.json(
      { ok: true, event_id: persisted.eventId, inserted: persisted.inserted },
      { status: 202 },
    )
  } catch (error) {
    console.error('[meta-wishlist] persist', error)
    return NextResponse.json({ ok: false, error: 'persist_failed' }, { status: 500 })
  }
}
