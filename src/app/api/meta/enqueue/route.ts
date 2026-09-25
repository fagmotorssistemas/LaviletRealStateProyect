import { cookies, headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { after } from 'next/server'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import { LV_VID_COOKIE, TOUR_TENANT_ID } from '@/lib/tour/trackingIds'
import { rpcResolveLeadIdForVisitor } from '@/lib/tour/tourRpc'
import { resolveServerAdsConsentForVisitor } from '@/lib/meta/capiServer'
import { flushLocalMetaOutbox, persistMetaConversion } from '@/lib/meta/localOutbox'
import { sanitizeMetaEventSourceUrl } from '@/lib/marketing/metaEventSourceUrl'
import { clientIp } from '@/lib/tour/geo'
import { homeListingCatalogIdentityParams, isMetaCoreSetupConservativeEnv } from '@/lib/meta/homeListingContent'
import {
  allowRateLimited,
  assertVisitKeyMatchesVisitor,
  buildUnitVisitKey,
  isAllowedEnqueueEventName,
  isUuid,
  type RateBucket,
} from '@/lib/meta/enqueueGuards'
import { buildShowroomGeneralVisitKey } from '@/lib/meta/metaMeasurementContract'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const RATE_WINDOW_MS = 60_000
const RATE_MAX = 12
const rateBucket: RateBucket = new Map()

/**
 * Solo ViewContent desde el navegador.
 * Lead/Schedule/Wishlist se generan en operaciones de negocio verificadas.
 * Subtipos internos (showroom_general | detalle_unidad) no alteran content_* publicitario.
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
    return new NextResponse(null, { status: 204 })
  }

  let resolvedLeadId: string | null = null
  try {
    resolvedLeadId = await rpcResolveLeadIdForVisitor(admin, visitorKey)
  } catch (error) {
    console.error('[meta-enqueue] resolve lead for visitor', {
      error: error instanceof Error ? error.message.slice(0, 120) : 'error',
    })
  }

  const eventId = String(body.event_id || '').trim()
  if (!eventId || !isUuid(eventId)) {
    return NextResponse.json({ ok: false, error: 'event_id inválido' }, { status: 400 })
  }
  const suppliedEventTime = Number(body.event_time)
  const eventTime = Number.isFinite(suppliedEventTime) && suppliedEventTime > 0
    ? Math.floor(suppliedEventTime)
    : undefined

  const subtypeRaw = String(body.lv_internal_subtype || '').trim()
  const isShowroomGeneral = subtypeRaw === 'showroom_general'
  const unitId = String(body.unit_id || '').trim()

  const h = await headers()
  const ip = clientIp(h) || 'unknown'
  if (!allowRateLimited(rateBucket, `${visitorKey}:${ip}`, Date.now(), RATE_WINDOW_MS, RATE_MAX)) {
    return NextResponse.json({ ok: false, error: 'rate_limited' }, { status: 429 })
  }

  const conservative = isMetaCoreSetupConservativeEnv()

  const eventSourceUrl =
    sanitizeMetaEventSourceUrl(
      typeof body.event_source_url === 'string' ? body.event_source_url : undefined,
    ) || undefined

  const sharedUser = {
    fbp: typeof body.fbp === 'string' ? body.fbp : undefined,
    fbc: typeof body.fbc === 'string' ? body.fbc : undefined,
    fbclid: typeof body.fbclid === 'string' ? body.fbclid : undefined,
    client_ip_address: ip !== 'unknown' ? ip : undefined,
    client_user_agent: h.get('user-agent') || undefined,
  }

  let visitKey: string
  let payload: Record<string, unknown>

  if (isShowroomGeneral) {
    visitKey = buildShowroomGeneralVisitKey(visitorKey)
    const bodyVisit = String(body.visit_key || '').trim()
    if (bodyVisit && bodyVisit !== visitKey) {
      return NextResponse.json({ ok: false, error: 'visit_key no coincide con el visitante' }, { status: 403 })
    }
    payload = {
      action_source: 'website',
      event_source_url: eventSourceUrl,
      lv_internal_subtype: 'showroom_general',
      ...sharedUser,
    }
  } else {
    if (!unitId || !isUuid(unitId)) {
      return NextResponse.json({ ok: false, error: 'unit_id inválido' }, { status: 400 })
    }
    const expectedVisitKey = buildUnitVisitKey(visitorKey, unitId)
    visitKey = String(body.visit_key || '').trim() || expectedVisitKey
    if (!assertVisitKeyMatchesVisitor(visitKey, visitorKey, unitId)) {
      return NextResponse.json({ ok: false, error: 'visit_key no coincide con el visitante' }, { status: 403 })
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

    payload = {
      action_source: 'website',
      event_source_url: eventSourceUrl,
      lv_internal_subtype: 'detalle_unidad',
      unit_id: unitId,
      ...(homeListingCatalogIdentityParams(unitId, {
        unitNumber: unit.unit_number,
        includeContentName: !conservative,
      }) || {}),
      ...sharedUser,
    }
  }

  let canonicalEventId = eventId
  try {
    const persisted = await persistMetaConversion(admin, {
      eventName: 'ViewContent',
      idempotencyKey: visitKey,
      eventId,
      eventTime,
      visitorKey,
      leadId: resolvedLeadId,
      adsConsentRequired: true,
      payload,
    })
    canonicalEventId = persisted.eventId
  } catch (error) {
    console.error('persist ViewContent', error)
    return NextResponse.json({ ok: false, error: 'persist_failed' }, { status: 500 })
  }

  try {
    await flushLocalMetaOutbox(admin, { eventIds: [canonicalEventId], limit: 5 })
  } catch (error) {
    console.error('[meta-outbox] sync flush', {
      event_id: canonicalEventId,
      error: error instanceof Error ? error.message.slice(0, 180) : 'error',
    })
  }

  after(async () => {
    try {
      await flushLocalMetaOutbox(admin, { limit: 20 })
    } catch (error) {
      console.error('[meta-outbox] after flush', {
        event_id: canonicalEventId,
        error: error instanceof Error ? error.message.slice(0, 180) : 'error',
      })
    }
  })

  return NextResponse.json(
    { ok: true, visit_key: visitKey, event_id: canonicalEventId },
    { status: 202 },
  )
}
