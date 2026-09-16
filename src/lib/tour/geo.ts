import { decodeHeader } from '@/lib/tour/visitorCookie'
import { isPublicClientIp, pickTrustedClientIp } from '@/lib/meta/trustedClientIp'

export type VisitorGeo = {
  city: string | null
  country: string | null
}

const geoCache = new Map<string, VisitorGeo>()

function first(value: string | null | undefined) {
  const text = String(value ?? '').trim()
  return text || null
}

export { isPrivateIp, isPublicClientIp } from '@/lib/meta/trustedClientIp'

/**
 * IP del visitante desde cabeceras de plataforma (Vercel).
 * Ver `pickTrustedClientIp`.
 */
export function clientIp(headers: Headers) {
  const onVercel = process.env.VERCEL === '1' || Boolean(process.env.VERCEL_ENV)
  return pickTrustedClientIp((name) => headers.get(name), { onVercel })
}

export function readRequestGeo(headers: Headers, extras?: { city?: string | null; country?: string | null }): VisitorGeo {
  const city =
    first(decodeHeader(headers.get('x-vercel-ip-city'))) ||
    first(decodeHeader(headers.get('cf-ipcity'))) ||
    first(headers.get('x-lv-city')) ||
    first(extras?.city)
  const country = (
    first(decodeHeader(headers.get('x-vercel-ip-country'))) ||
    first(headers.get('cf-ipcountry')) ||
    first(headers.get('x-lv-country')) ||
    first(extras?.country)
  )?.toUpperCase() ?? null
  return { city, country }
}

async function lookupGeo(ip: string | null): Promise<VisitorGeo> {
  const key = ip && isPublicClientIp(ip) ? ip : 'self'
  const cached = geoCache.get(key)
  if (cached) return cached

  const url = key === 'self' ? 'https://ipwho.is/' : `https://ipwho.is/${encodeURIComponent(key)}`
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(2500),
      cache: 'no-store',
    })
    if (!response.ok) return { city: null, country: null }
    const json = (await response.json()) as {
      success?: boolean
      city?: string
      country_code?: string
    }
    if (json.success === false) return { city: null, country: null }
    const geo: VisitorGeo = {
      city: first(json.city),
      country: first(json.country_code)?.toUpperCase() ?? null,
    }
    if (geo.city || geo.country) geoCache.set(key, geo)
    return geo
  } catch {
    return { city: null, country: null }
  }
}

export async function resolveVisitorGeo(
  headers: Headers,
  extras?: { city?: string | null; country?: string | null },
): Promise<VisitorGeo> {
  const fromHeaders = readRequestGeo(headers, extras)
  if (fromHeaders.city && fromHeaders.country) return fromHeaders

  const lookedUp = await lookupGeo(clientIp(headers))
  return {
    city: fromHeaders.city || lookedUp.city,
    country: fromHeaders.country || lookedUp.country,
  }
}
