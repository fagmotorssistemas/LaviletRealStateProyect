import { cookies, headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { after } from 'next/server'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import {
  LV_CONTACT_CONSENT_COOKIE,
  LV_VID_COOKIE,
  LV_VID_MAX_AGE,
  TOUR_TENANT_ID,
} from '@/lib/tour/trackingIds'
import { enrichTourLeadAfterIdentify } from '@/lib/tour/enrichTourLead'
import {
  rpcIdentifyTourLeadWithMetaOutbox,
  rpcRegisterTourInfoRequest,
  rpcSetTrackingPreference,
} from '@/lib/tour/tourRpc'
import { resolveVisitorGeo, clientIp } from '@/lib/tour/geo'
import { applyGeoCookies } from '@/lib/tour/visitorCookie'
import { resolveServerAdsConsentForVisitor } from '@/lib/meta/capiServer'
import { flushLocalMetaOutbox } from '@/lib/meta/localOutbox'
import { persistInfoRequestLeadEvent } from '@/lib/meta/infoRequestLeadProducer'
import { sanitizeMetaEventSourceUrl } from '@/lib/marketing/metaEventSourceUrl'

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

function identityErrorStatus(message: string) {
  if (/IDENTITY_CONFLICT_PHONE_EMAIL/i.test(message)) return 409
  if (/VISITOR_ALREADY_LINKED/i.test(message)) return 409
  if (/TOUR_INFO_REQUEST_/i.test(message)) return 400
  if (/IDENTIFY_TOUR_LEAD_/i.test(message)) return 400
  return 500
}

function humanIdentityError(message: string) {
  if (/IDENTITY_CONFLICT_PHONE_EMAIL/i.test(message)) {
    return 'El teléfono y el correo corresponden a contactos distintos. No se fusionan automáticamente.'
  }
  if (/VISITOR_ALREADY_LINKED/i.test(message)) {
    return 'Este recorrido ya está vinculado a otro contacto. Usa el mismo celular o continúa en ese dispositivo.'
  }
  if (/TOUR_INFO_REQUEST_UNIT_INVALID/i.test(message)) {
    return 'La unidad indicada no es válida para este proyecto.'
  }
  if (/TOUR_INFO_REQUEST_SESSION_INVALID/i.test(message)) {
    return 'La sesión del recorrido no es válida. Recarga e inténtalo de nuevo.'
  }
  return message
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
      request_kind?: 'identify' | 'info_request' | 'save_unit'
      client_request_id?: string
      motivo?: string
      mensaje?: string
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

    const requestKind =
      body.request_kind ||
      (phoneOnly ? 'save_unit' : body.motivo || body.unit_id ? 'info_request' : 'identify')

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
    const clientIpAddress = clientIp(h) || undefined
    const clientUa = h.get('user-agent') || undefined
    // body.consent = casilla de contacto/privacidad (no es ads).
    const adsConsent = await resolveServerAdsConsentForVisitor(admin, visitorKey)

    const realEmail = !isArtificialEmail(rawEmail) ? rawEmail : undefined
    const realName = !isArtificialName(rawName) ? rawName : undefined

    const conservative =
      (process.env.META_CORE_SETUP_CONSERVATIVE ||
        process.env.NEXT_PUBLIC_META_CORE_SETUP_CONSERVATIVE ||
        'true')
        .trim()
        .toLowerCase() !== 'false'

    const metaLeadPayload = {
      action_source: 'website',
      event_source_url:
        sanitizeMetaEventSourceUrl(body.event_source_url) || 'https://www.lavilett.com',
      phone,
      email: realEmail,
      full_name: realName,
      city: geo.city || undefined,
      country: geo.country || 'ec',
      fbp: body.fbp,
      fbc: body.fbc,
      fbclid: body.fbclid,
      client_ip_address: clientIpAddress,
      client_user_agent: clientUa,
      ...(conservative
        ? {}
        : {
            content_ids: body.unit_id ? [body.unit_id] : undefined,
            content_name: body.unit_number ? `Unidad ${body.unit_number}` : undefined,
            content_category: body.typology_code || undefined,
          }),
      visitor_key: visitorKey,
    }

    let identified
    try {
      identified = await rpcIdentifyTourLeadWithMetaOutbox(admin, {
        visitorKey,
        name: rawName,
        email: rawEmail,
        phone,
        adsConsent,
        deliveryLane: intendedLane(),
        // La identidad nunca crea Lead. Lead nace solo tras guardar tour_info_requests.
        emitLead: false,
        payload: metaLeadPayload,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo guardar el contacto'
      return NextResponse.json(
        { error: humanIdentityError(message) },
        { status: identityErrorStatus(message) },
      )
    }

    const leadId = identified.lead_id

    try {
      await rpcSetTrackingPreference(admin, {
        leadId,
        consent: true,
        reason: phoneOnly ? 'guardar_unidad' : requestKind === 'info_request' ? 'solicitud_info' : 'gate',
      })
    } catch (error) {
      console.error('set_tracking_preference', error)
    }

    const unitLabel = String(body.unit_number ?? '').trim()
    const interestRoom = body.interest_room
      ? body.interest_room
      : unitLabel
        ? `Unidad ${unitLabel}`
        : null
    const needsUnit =
      requestKind === 'save_unit' ||
      (requestKind === 'info_request' && Boolean(body.unit_id || body.unit_number))

    let enrichResult: { unitId: string | null; unitTypeId: string | null; sessionId: string | null }
    try {
      enrichResult = await enrichTourLeadAfterIdentify(admin, {
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
        requireUnit: needsUnit,
      })
    } catch (error) {
      console.error('enrich_tour_lead', error)
      const message = error instanceof Error ? error.message : 'No se pudo completar el contexto'
      // Identidad ya persistió; el cliente puede reintentar sin duplicar lead.
      return NextResponse.json(
        {
          error:
            needsUnit
              ? 'Se guardó el contacto, pero faltó la unidad. Reintenta para completar la solicitud.'
              : humanIdentityError(message),
          lead_id: leadId,
          incomplete: true,
        },
        { status: 422 },
      )
    }

    let infoRequest: { id: string; created: boolean; duplicate: boolean } | null = null
    let metaLead: { eventId: string; eventTime: number } | null = null
    if (requestKind === 'info_request') {
      const motivo =
        String(body.motivo ?? '').trim() ||
        String(body.interest_room ?? '').trim() ||
        'Consulta showroom'
      try {
        const registered = await rpcRegisterTourInfoRequest(admin, {
          leadId,
          visitorKey,
          sessionId: body.session_id || enrichResult.sessionId,
          unitId: enrichResult.unitId || body.unit_id || null,
          unitTypeId: enrichResult.unitTypeId || body.unit_type_id || null,
          typologyCode: body.typology_code || null,
          motivo,
          mensaje: body.mensaje ?? null,
          clientRequestId: body.client_request_id || null,
        })
        infoRequest = {
          id: registered.id,
          created: registered.created,
          duplicate: registered.duplicate,
        }
        const { data: savedRequest, error: savedRequestError } = await admin
          .from('tour_info_requests')
          .select('id, tenant_id, lead_id, created_at')
          .eq('id', registered.id)
          .eq('tenant_id', TOUR_TENANT_ID)
          .eq('lead_id', leadId)
          .maybeSingle()
        if (savedRequestError || !savedRequest) {
          throw new Error('TOUR_INFO_REQUEST_NOT_PERSISTED')
        }
        const persistedLead = await persistInfoRequestLeadEvent(admin, {
          leadId,
          visitorKey,
          requestId: registered.id,
          createdAt: savedRequest.created_at,
          payload: metaLeadPayload,
        })
        metaLead = {
          eventId: persistedLead.eventId,
          eventTime: persistedLead.eventTime,
        }
      } catch (error) {
        console.error('register_tour_info_request', error)
        const message = error instanceof Error ? error.message : 'No se pudo registrar la solicitud'
        return NextResponse.json(
          {
            error: humanIdentityError(message),
            lead_id: leadId,
            incomplete: true,
          },
          { status: identityErrorStatus(message) === 500 ? 422 : identityErrorStatus(message) },
        )
      }
    }

    after(async () => {
      try {
        await flushLocalMetaOutbox(admin)
      } catch (error) {
        console.error('[meta-outbox] after flush lead', {
          error: error instanceof Error ? error.message.slice(0, 180) : 'error',
        })
      }
    })

    const emitMetaLead = requestKind === 'info_request' && Boolean(metaLead?.eventId)
    const response = NextResponse.json({
      lead_id: leadId,
      emit_meta_lead: emitMetaLead,
      meta_event_id: emitMetaLead ? metaLead?.eventId : null,
      meta_event_time: emitMetaLead ? metaLead?.eventTime : null,
      request_kind: requestKind,
      info_request: infoRequest,
      unit_id: enrichResult.unitId,
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
      {
        error: /<!DOCTYPE|<html/i.test(message)
          ? 'No se pudo guardar el contacto'
          : humanIdentityError(message),
      },
      { status: identityErrorStatus(message) },
    )
  }
}
