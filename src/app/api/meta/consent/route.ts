import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import {
  LV_ADS_CONSENT_COOKIE,
  LV_CONSENT_COOKIE,
  LV_VID_COOKIE,
  LV_VID_MAX_AGE,
} from '@/lib/tour/trackingIds'
import { LV_CONSENT_MAX_AGE } from '@/lib/tour/consent'
import { rpcRevokeMetaAdsConsent } from '@/lib/tour/tourRpc'
import { setLeadAdsConsent } from '@/lib/meta/localOutbox'
import { propagateConsentToMetaBackend } from '@/lib/meta/consentPropagate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Persiste / retira consentimiento ads en Supabase + Nest.
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
  const value = body.ads_consent ? 'full' : 'denied'

  const res = NextResponse.json({ ok: true, ads_consent: body.ads_consent })
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

  const admin = tryCreateAdminClient()
  if (admin) {
    if (body.ads_consent) {
      if (body.lead_id) {
        try {
          await setLeadAdsConsent(admin, body.lead_id, true)
        } catch (error) {
          console.error('setLeadAdsConsent', error)
        }
      }
    } else {
      try {
        await rpcRevokeMetaAdsConsent(admin, {
          leadId: body.lead_id || null,
          visitorKey: visitorKey || null,
        })
      } catch (error) {
        console.error('rpcRevokeMetaAdsConsent', error)
      }
    }
  }

  void propagateConsentToMetaBackend({
    adsConsent: body.ads_consent,
    leadId: body.lead_id || null,
    visitorKey: visitorKey || null,
  }).catch((error) => {
    console.error('propagateConsentToMetaBackend', error)
  })

  return res
}
