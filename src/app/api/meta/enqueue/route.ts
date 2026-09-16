import { cookies, headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { after } from 'next/server'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import { LV_VID_COOKIE, TOUR_TENANT_ID } from '@/lib/tour/trackingIds'
import { resolveServerAdsConsentForVisitor } from '@/lib/meta/capiServer'
import { flushLocalMetaOutbox, persistMetaConversion } from '@/lib/meta/localOutbox'
import {
  allowRateLimited,
  assertVisitKeyMatchesVisitor,
  buildUnitVisitKey,
  isAllowedEnqueueEventName,
  isUuid,
  type RateBucket,
} from '@/lib/meta/enqueueGuards'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RATE_WINDOW_MS = 60_000
const RATE_MAX = 12
const rateBucket: RateBucket = new Map()

/**
 * Solo ViewContent desde el navegador.
 * Lead/Schedule se generan únicamente en operaciones de negocio verificadas.
 */
export async function POST(request: Request) {
  let body: Record<string, unknown>
  try {
    body = (await request.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 })
  }

  const eventName = String(body.event_name || '')
  if (!isAllowedEnqueueEventName(eventName)) {
    return NextResponse.json(
      { ok: false, error: 'Solo ViewContent está permitido en este endpoint' },
      { status: 403 },
    )
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
    // 204 no admite cuerpo; el cliente interpreta skipped por status.
    return new NextResponse(null, { status: 204 })
  }

  const unitId = String(body.unit_id || '').trim()
  const eventId = String(body.event_id || '').trim()
  if (!unitId || !isUuid(unitId)) {
    return NextResponse.json({ ok: false, error: 'unit_id inválido' }, { status: 400 })
  }
  if (!eventId || !isUuid(eventId)) {
    return NextResponse.json({ ok: false, error: 'event_id inválido' }, { status: 400 })
  }

  const expectedVisitKey = buildUnitVisitKey(visitorKey, unitId)
  const visitKey = String(body.visit_key || '').trim() || expectedVisitKey
  if (!assertVisitKeyMatchesVisitor(visitKey, visitorKey, unitId)) {
    return NextResponse.json({ ok: false, error: 'visit_key no coincide con el visitante' }, { status: 403 })
  }

  const h = await headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || 'unknown'
  if (!allowRateLimited(rateBucket, `${visitorKey}:${ip}`, Date.now(), RATE_WINDOW_MS, RATE_MAX)) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 })
  }

  const { data: unit, error: unitError } = await admin
    .from('units')
    .select('id, unit_number, category, tenant_id')
    .eq('id', unitId)
    .eq('tenant_id', TOUR_TENANT_ID)
    .maybeSingle()

  if (unitError || !unit) {
    return NextResponse.json({ ok: false, error: 'inmueble no encontrado' }, { status: 404 })
  }

  const contentName =
    typeof body.content_name === 'string' && body.content_name.trim()
      ? body.content_name.trim()
      : `Unidad ${unit.unit_number}`
  const contentCategory =
    typeof body.content_category === 'string' && body.content_category.trim()
      ? body.content_category.trim()
      : unit.category || 'unit'

  try {
    await persistMetaConversion(admin, {
      eventName: 'ViewContent',
      idempotencyKey: visitKey,
      eventId,
      visitorKey,
      adsConsentRequired: true,
      payload: {
        action_source: 'website',
        event_source_url:
          typeof body.event_source_url === 'string' ? body.event_source_url : undefined,
        content_ids: [unitId],
        content_name: contentName,
        content_category: contentCategory,
        fbp: typeof body.fbp === 'string' ? body.fbp : undefined,
        fbc: typeof body.fbc === 'string' ? body.fbc : undefined,
        fbclid: typeof body.fbclid === 'string' ? body.fbclid : undefined,
        client_ip_address: ip !== 'unknown' ? ip : undefined,
        client_user_agent: h.get('user-agent') || undefined,
      },
    })
  } catch (error) {
    console.error('persist ViewContent', error)
    return NextResponse.json({ ok: false, error: 'persist_failed' }, { status: 500 })
  }

  // Flush síncrono del event_id: evita depender solo de after()/waitUntil.
  try {
    await flushLocalMetaOutbox(admin, { eventIds: [eventId], limit: 5 })
  } catch (error) {
    console.error('[meta-outbox] sync flush', {
      event_id: eventId,
      error: error instanceof Error ? error.message.slice(0, 180) : 'error',
    })
  }

  // Retención extra post-respuesta por si hay más pendientes de la misma lane.
  after(async () => {
    try {
      await flushLocalMetaOutbox(admin, { limit: 20 })
    } catch (error) {
      console.error('[meta-outbox] after flush', {
        event_id: eventId,
        error: error instanceof Error ? error.message.slice(0, 180) : 'error',
      })
    }
  })

  return NextResponse.json({ ok: true, visit_key: visitKey, event_id: eventId }, { status: 202 })
}
