import { NextResponse, type NextRequest } from 'next/server'
import { LV_VID_COOKIE, LV_VID_MAX_AGE } from '@/lib/tour/trackingIds'

export function isSecureRequest(request: NextRequest | Request) {
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  if (forwarded === 'https') return true
  if ('nextUrl' in request) return request.nextUrl.protocol === 'https:'
  try {
    return new URL(request.url).protocol === 'https:'
  } catch {
    return false
  }
}

export function visitorCookieOptions(secure: boolean) {
  return {
    path: '/' as const,
    maxAge: LV_VID_MAX_AGE,
    expires: new Date(Date.now() + LV_VID_MAX_AGE * 1000),
    sameSite: 'lax' as const,
    secure,
    httpOnly: false,
  }
}

export function decodeHeader(value: string | null) {
  if (!value) return ''
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function readVercelGeo(request: Request) {
  return {
    city:
      decodeHeader(request.headers.get('x-vercel-ip-city')) ||
      request.headers.get('x-lv-city') ||
      '',
    country:
      decodeHeader(request.headers.get('x-vercel-ip-country')) ||
      request.headers.get('x-lv-country') ||
      '',
  }
}

/** Escribe lv_vid desde el servidor. Si ya existe, se reenvía el mismo UUID con Max-Age. */
export function applyVisitorCookie(request: NextRequest, response: NextResponse) {
  const secure = isSecureRequest(request)
  const visitorKey = request.cookies.get(LV_VID_COOKIE)?.value?.trim() || crypto.randomUUID()
  response.cookies.set(LV_VID_COOKIE, visitorKey, visitorCookieOptions(secure))

  const { city, country } = readVercelGeo(request)
  if (city) {
    response.headers.set('x-lv-city', city)
    response.cookies.set('lv_city', city, visitorCookieOptions(secure))
  }
  if (country) {
    response.headers.set('x-lv-country', country)
    response.cookies.set('lv_country', country, visitorCookieOptions(secure))
  }
  return visitorKey
}
