import { cookies, headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { after } from 'next/server'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import {
  LV_CONTACT_CONSENT_COOKIE,
  LV_VID_COOKIE,
  LV_VID_MAX_AGE,
} from '@/lib/tour/trackingIds'
import { enrichTourLeadAfterIdentify } from '@/lib/tour/enrichTourLead'
import {
  rpcIdentifyTourLeadWithMetaOutbox,
  rpcSetTrackingPreference,
} from '@/lib/tour/tourRpc'
import { resolveVisitorGeo } from '@/lib/tour/geo'
import { applyGeoCookies } from '@/lib/tour/visitorCookie'
import { readServerAdsConsent } from '@/lib/meta/capiServer'
import { flushLocalMetaOutbox } from '@/lib/meta/localOutbox'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function isArtificialEmail(email: string) {
  return /@showroom\.lavilet$/i.test(email) || /^wa\.\d+@/i.test(email)
}

function isArtificialName(name: string) {
  return /^whatsapp/i.test(name.trim())
}

function intendedLane(): 'test' | 'live' {
  const explicit = process.env.META_CAPI_DELIVERY_LANE?.trim().toLowerCase()
  if (explicit === 'test' || explicit === 'live') return explicit
  const mode = process.env.META_MODE?.trim().toLowerCase()
  return mode === 'test' ? 'test' : 'live'
}

export async function POST(request: Request) {
  try {
    const admin = tryCreateAdminClient()
    if (!admin) {
      return NextResponse.json({ error: 'Falta SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })
    }

    let body: {
      name?: string
      email?: string
      phone?: string
      consent?: boolean
      mode?: 'full' | 'phone'
      visitor_key?: string
      session_id?: string
      typology_code?: string
      unit_type_id?: string
      interest_room?: string
      finish?: string
      light?: string
      unit_id?: string
      unit_number?: string
      fbp?: string
      fbc?: string
      fbclid?: string
      event_source_url?: string
    }
    try {
      body = (await request.json()) as typeof body
    } catch {
      return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
    }

    const phone = String(body.phone ?? '').trim()
    const phoneOnly = body.mode === 'phone' || (!body.name && !body.email && Boolean(phone))
    const digits = phone.replace(/\D/g, '')
    if (!phone || digits.length < 8) {
      return NextResponse.json({ error: 'Ingresá un celular válido' }, { status: 400 })
    }

    const rawName = phoneOnly
      ? `WhatsApp ····${digits.slice(-4)}`
      : String(body.name ?? '').trim()
    const rawEmail = phoneOnly
      ? `wa.${digits}@showroom.lavilet`
      : String(body.email ?? '').trim()

    if (!phoneOnly && (!rawName || !rawEmail)) {
      return NextResponse.json({ error: 'Completa nombre, correo y WhatsApp' }, { status: 400 })
    }
    if (!body.consent) {
      return NextResponse.json(
        {
          error: phoneOnly
            ? 'Marca la casilla para guardar tu departamento'
            : 'Marca la casilla para enviarte planos y disponibilidad',
        },
        { status: 400 },
      )
    }

    let visitorKey = ''
    let jar: Awaited<ReturnType<typeof cookies>> | null = null
    try {
      jar = await cookies()
      visitorKey = jar.get(LV_VID_COOKIE)?.value?.trim() ?? ''
    } catch (error) {
      console.error('tour lead cookies', error)
    }
    visitorKey = visitorKey || String(body.visitor_key ?? '').trim()
    if (!visitorKey) {
      return NextResponse.json({ error: 'Recarga la página e inténtalo de nuevo' }, { status: 400 })
    }

    const h = await headers()
    const geo = await resolveVisitorGeo(h, {
      city: jar?.get('lv_city')?.value,
      country: jar?.get('lv_country')?.value,
    })
    const clientIp = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || undefined
    const clientUa = h.get('user-agent') || undefined
    const adsConsent = await readServerAdsConsent()

    const realEmail = !isArtificialEmail(rawEmail) ? rawEmail : undefined
    const realName = !isArtificialName(rawName) ? rawName : undefined

    // Lead + outbox en una sola transacción Postgres (RPC).
    const identified = await rpcIdentifyTourLeadWithMetaOutbox(admin, {
      visitorKey,
      name: rawName,
      email: rawEmail,
      phone,
      adsConsent,
      deliveryLane: intendedLane(),
      payload: {
        action_source: 'website',
        event_source_url: body.event_source_url || 'https://www.lavilett.com/tour',
        phone,
        email: realEmail,
        full_name: realName,
        city: geo.city || undefined,
        country: geo.country || 'ec',
        fbp: body.fbp,
        fbc: body.fbc,
        fbclid: body.fbclid,
        client_ip_address: clientIp,
        client_user_agent: clientUa,
        content_ids: body.unit_id ? [body.unit_id] : undefined,
        content_name: body.unit_number ? `Unidad ${body.unit_number}` : undefined,
        content_category: body.typology_code || undefined,
        visitor_key: visitorKey,
      },
    })

    const leadId = identified.lead_id
    // external_id se fija al lead; el RPC ya guardó event_id en leads + outbox
    if (identified.meta_event_id && adsConsent) {
      // payload.external_id se completa en flush desde lead_id
    }

    try {
      await rpcSetTrackingPreference(admin, {
        leadId,
        consent: true,
        reason: phoneOnly ? 'guardar_unidad' : 'gate',
      })
    } catch (error) {
      console.error('set_tracking_preference', error)
    }

    try {
      const unitLabel = String(body.unit_number ?? '').trim()
      const interestRoom = body.interest_room
        ? body.interest_room
        : unitLabel
          ? `Unidad ${unitLabel}`
          : null
      await enrichTourLeadAfterIdentify(admin, {
        leadId,
        visitorKey,
        sessionId: body.session_id,
        typologyCode: body.typology_code,
        unitTypeId: body.unit_type_id,
        unitId: body.unit_id,
        unitNumber: body.unit_number,
        interestRoom,
        finish: body.finish,
        light: body.light,
        city: geo.city,
        country: geo.country,
      })
    } catch (error) {
      console.error('enrich_tour_lead', error)
    }

    after(() => {
      void flushLocalMetaOutbox(admin).catch((error) => {
        console.error('flushLocalMetaOutbox', error)
      })
    })

    const emitMetaLead = Boolean(identified.emit_meta_lead && identified.meta_event_id)
    const response = NextResponse.json({
      lead_id: leadId,
      emit_meta_lead: emitMetaLead,
      meta_event_id: emitMetaLead ? identified.meta_event_id : null,
    })
    response.cookies.set(LV_CONTACT_CONSENT_COOKIE, '1', {
      path: '/',
      maxAge: LV_VID_MAX_AGE,
      sameSite: 'lax',
    })
    applyGeoCookies(request, response, geo)
    return response
  } catch (error) {
    console.error('POST /api/tour/lead', error)
    const message = error instanceof Error ? error.message : 'No se pudo guardar el contacto'
    return NextResponse.json(
      { error: /<!DOCTYPE|<html/i.test(message) ? 'No se pudo guardar el contacto' : message },
      { status: 500 },
    )
  }
}
