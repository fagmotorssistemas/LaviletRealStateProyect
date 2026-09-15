import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'

function backendBaseUrl() {
  return (
    process.env.META_CAPI_BACKEND_URL?.trim() ||
    process.env.LA_VILET_CAPI_URL?.trim() ||
    ''
  ).replace(/\/$/, '')
}

function internalSecret() {
  return process.env.META_CAPI_INTERNAL_SECRET?.trim() || ''
}

export type ConsentLedgerRow = {
  id: string
  visitor_key: string | null
  lead_id: string | null
  ads_consent: boolean
  consent_version: number
  nest_status: string
  nest_attempts: number
}

async function postConsentToNest(input: {
  adsConsent: boolean
  leadId?: string | null
  visitorKey?: string | null
  consentVersion: number
}): Promise<{ ok: boolean; skipped?: string }> {
  const base = backendBaseUrl()
  const secret = internalSecret()
  if (!base || !secret) return { ok: false, skipped: 'not_configured' }

  const path = input.adsConsent ? '/api/v1/consent/grant' : '/api/v1/consent/revoke'
  try {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Internal-Secret': secret,
      },
      body: JSON.stringify({
        lead_id: input.leadId || undefined,
        visitor_key: input.visitorKey || undefined,
        consent_version: input.consentVersion,
      }),
      cache: 'no-store',
    })
    return {
      ok: res.ok || res.status === 202,
      skipped: res.ok || res.status === 202 ? undefined : `http_${res.status}`,
    }
  } catch {
    return { ok: false, skipped: 'network' }
  }
}

/**
 * Entrega filas pending/failed del ledger a Nest con reintentos.
 * No usa fire-and-forget: el caller debe await o after().
 */
export async function flushConsentLedgerToNest(
  admin: SupabaseClient,
  limit = 20,
): Promise<{ delivered: number; failed: number; skipped: number }> {
  const { data: rows, error } = await admin
    .from('meta_ads_consent_ledger')
    .select('id, visitor_key, lead_id, ads_consent, consent_version, nest_status, nest_attempts')
    .in('nest_status', ['pending', 'failed'])
    .order('consent_version', { ascending: true })
    .limit(limit)

  if (error || !rows?.length) return { delivered: 0, failed: 0, skipped: 0 }

  let delivered = 0
  let failed = 0
  let skipped = 0

  for (const row of rows as ConsentLedgerRow[]) {
    if (!backendBaseUrl() || !internalSecret()) {
      await admin
        .from('meta_ads_consent_ledger')
        .update({
          nest_status: 'skipped',
          last_error: 'not_configured',
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
      skipped += 1
      continue
    }

    const result = await postConsentToNest({
      adsConsent: row.ads_consent,
      leadId: row.lead_id,
      visitorKey: row.visitor_key,
      consentVersion: Number(row.consent_version),
    })

    if (result.ok) {
      await admin
        .from('meta_ads_consent_ledger')
        .update({
          nest_status: 'delivered',
          last_error: null,
          nest_attempts: (row.nest_attempts || 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
      delivered += 1
    } else if (result.skipped === 'not_configured') {
      await admin
        .from('meta_ads_consent_ledger')
        .update({
          nest_status: 'skipped',
          last_error: 'not_configured',
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
      skipped += 1
    } else {
      await admin
        .from('meta_ads_consent_ledger')
        .update({
          nest_status: 'failed',
          last_error: result.skipped || 'deliver_failed',
          nest_attempts: (row.nest_attempts || 0) + 1,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id)
      failed += 1
    }
  }

  return { delivered, failed, skipped }
}
