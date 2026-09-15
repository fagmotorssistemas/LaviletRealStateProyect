import { cookies } from 'next/headers'
import { NextResponse, after } from 'next/server'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import {
  LV_ADS_CONSENT_COOKIE,
  LV_CONSENT_COOKIE,
  LV_VID_COOKIE,
  LV_VID_MAX_AGE,
} from '@/lib/tour/trackingIds'
import { LV_CONSENT_MAX_AGE } from '@/lib/tour/consent'
import {
  rpcRecordMetaAdsConsent,
  rpcResolveLeadIdForVisitor,
} from '@/lib/tour/tourRpc'
import { flushConsentLedgerToNest } from '@/lib/meta/consentPropagate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Persiste consentimiento ads (ledger versionado) y entrega durable a Nest.
 * lead_id del cuerpo se ignora: se resuelve desde el visitante en servidor.
 */
export async function POST(request: Request) {
  let body: { ads_consent?: boolean; lead_id?: string }
  try {
    body = (await request.json()) as typeof body
  } catch {
    return NextResponse.json({ ok: false, error: 'JSON inválido' }, { status: 400 })
  }

  if (typeof body.ads_consent !== 'boolean') {
    return NextResponse.json({ ok: false, error: 'ads_consent boolean requerido' }, { status: 400 })
  }

  const jar = await cookies()
  const visitorKey = jar.get(LV_VID_COOKIE)?.value?.trim() || ''
  if (!visitorKey) {
    return NextResponse.json({ ok: false, error: 'visitor no identificado' }, { status: 400 })
  }

  const value = body.ads_consent ? 'full' : 'denied'
  const admin = tryCreateAdminClient()
  if (!admin) {
    return NextResponse.json({ ok: false, error: 'admin_unavailable' }, { status: 503 })
  }

  let resolvedLeadId: string | null = null
  try {
    resolvedLeadId = await rpcResolveLeadIdForVisitor(admin, visitorKey)
  } catch (error) {
    console.error('rpcResolveLeadIdForVisitor', error)
  }

  // No confiar en lead_id del cliente. Si lo envían, debe coincidir con el resuelto.
  const claimedLead = typeof body.lead_id === 'string' ? body.lead_id.trim() : ''
  if (claimedLead && resolvedLeadId && claimedLead !== resolvedLeadId) {
    return NextResponse.json(
      { ok: false, error: 'lead_id no corresponde al visitante' },
      { status: 403 },
    )
  }
  if (claimedLead && !resolvedLeadId) {
    return NextResponse.json(
      { ok: false, error: 'lead_id no verificable para este visitante' },
      { status: 403 },
    )
  }

  let recorded: Awaited<ReturnType<typeof rpcRecordMetaAdsConsent>>
  try {
    recorded = await rpcRecordMetaAdsConsent(admin, {
      adsConsent: body.ads_consent,
      visitorKey,
      leadId: resolvedLeadId,
    })
  } catch (error) {
    console.error('rpcRecordMetaAdsConsent', error)
    return NextResponse.json({ ok: false, error: 'persist_failed' }, { status: 500 })
  }

  after(() => {
    flushConsentLedgerToNest(admin).catch((error) => {
      console.error('flushConsentLedgerToNest', error)
    })
  })

  const res = NextResponse.json({
    ok: true,
    ads_consent: body.ads_consent,
    lead_id: resolvedLeadId,
    consent_version: recorded.consent_version,
    ledger_id: recorded.id,
  })
  res.cookies.set(LV_ADS_CONSENT_COOKIE, value, {
    path: '/',
    maxAge: LV_CONSENT_MAX_AGE || LV_VID_MAX_AGE,
    sameSite: 'lax',
  })
  res.cookies.set(LV_CONSENT_COOKIE, value, {
    path: '/',
    maxAge: LV_CONSENT_MAX_AGE || LV_VID_MAX_AGE,
    sameSite: 'lax',
  })
  return res
}
