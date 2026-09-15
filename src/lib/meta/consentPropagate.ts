import 'server-only'

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

/**
 * Propaga grant/revoke a lavilet-meta-capi (cola Nest + registro de revocación).
 */
export async function propagateConsentToMetaBackend(input: {
  adsConsent: boolean
  leadId?: string | null
  visitorKey?: string | null
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
      }),
      cache: 'no-store',
    })
    return { ok: res.ok || res.status === 202, skipped: res.ok ? undefined : `http_${res.status}` }
  } catch {
    return { ok: false, skipped: 'network' }
  }
}
