import { decodeHeader } from '@/lib/tour/visitorCookie'

export type VisitorGeo = {
  city: string | null
  country: string | null
}

const geoCache = new Map<string, VisitorGeo>()

function first(value: string | null | undefined) {
  const text = String(value ?? '').trim()
  return text || null
}

function isPrivateIp(ip: string) {
  return /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|::1$|::ffff:127\.)/.test(ip)
}

export function clientIp(headers: Headers) {
  const raw =
    first(headers.get('x-vercel-forwarded-for')) ||
    first(headers.get('cf-connecting-ip')) ||
    first(headers.get('x-real-ip')) ||
    first(headers.get('x-forwarded-for'))
  if (!raw) return null
  return raw.split(',')[0]?.trim() || null
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
  const key = ip && !isPrivateIp(ip) ? ip : 'self'
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
