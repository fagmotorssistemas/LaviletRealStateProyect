import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import { LV_CONSENT_COOKIE, LV_VID_COOKIE, LV_VID_MAX_AGE } from '@/lib/tour/trackingIds'
import { rpcIdentifyTourLead, rpcSetTrackingPreference } from '@/lib/tour/tourRpc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const admin = tryCreateAdminClient()
    if (!admin) {
      return NextResponse.json({ error: 'Falta SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })
    }

    let body: { name?: string; email?: string; phone?: string; consent?: boolean; visitor_key?: string }
    try {
      body = (await request.json()) as typeof body
    } catch {
      return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
    }

    const name = String(body.name ?? '').trim()
    const email = String(body.email ?? '').trim()
    const phone = String(body.phone ?? '').trim()
    if (!name || !email || !phone) {
      return NextResponse.json({ error: 'Completa nombre, correo y WhatsApp' }, { status: 400 })
    }
    if (!body.consent) {
      return NextResponse.json({ error: 'Marca la casilla para enviarte planos y disponibilidad' }, { status: 400 })
    }

    let visitorKey = ''
    try {
      visitorKey = (await cookies()).get(LV_VID_COOKIE)?.value?.trim() ?? ''
    } catch (error) {
      console.error('tour lead cookies', error)
    }
    visitorKey = visitorKey || String(body.visitor_key ?? '').trim()
    if (!visitorKey) {
      return NextResponse.json({ error: 'Recarga la página e inténtalo de nuevo' }, { status: 400 })
    }

    const leadId = await rpcIdentifyTourLead(admin, { visitorKey, name, email, phone })
    try {
      await rpcSetTrackingPreference(admin, { leadId, consent: true, reason: 'gate' })
    } catch (error) {
      console.error('set_tracking_preference', error)
    }
    const response = NextResponse.json({ lead_id: leadId })
    response.cookies.set(LV_CONSENT_COOKIE, '1', {
      path: '/',
      maxAge: LV_VID_MAX_AGE,
      sameSite: 'lax',
    })
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
