import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import { LV_CONSENT_COOKIE, LV_VID_COOKIE, LV_VID_MAX_AGE } from '@/lib/tour/trackingIds'
import { rpcIdentifyTourLead, rpcSetTrackingPreference } from '@/lib/tour/tourRpc'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const admin = tryCreateAdminClient()
  if (!admin) {
    return NextResponse.json({ error: 'Falta SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })
  }

  let body: { name?: string; email?: string; phone?: string; consent?: boolean }
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

  const visitorKey = (await cookies()).get(LV_VID_COOKIE)?.value?.trim()
  if (!visitorKey) {
    return NextResponse.json({ error: 'Falta la cookie lv_vid' }, { status: 400 })
  }

  try {
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
    console.error('POST /api/tour/identify', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudo identificar el lead' },
      { status: 500 },
    )
  }
}
