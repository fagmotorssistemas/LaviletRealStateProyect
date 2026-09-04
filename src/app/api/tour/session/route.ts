import { cookies, headers } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import { LV_CONSENT_COOKIE, LV_VID_COOKIE } from '@/lib/tour/trackingIds'
import { rpcStartTourSession } from '@/lib/tour/tourRpc'
import { applyVisitorCookie, decodeHeader } from '@/lib/tour/visitorCookie'

export const runtime = 'nodejs'

function deviceType(userAgent: string, width: number) {
  const ua = userAgent.toLowerCase()
  if (/ipad|tablet/.test(ua)) return 'tablet'
  if (/mobi|iphone|android/.test(ua) || (width > 0 && width < 768)) return 'movil'
  return 'escritorio'
}

function first(value: string | null | undefined) {
  return String(value ?? '').trim() || null
}

function pathFromUrl(value: string | null) {
  if (!value) return null
  try {
    const url = new URL(value)
    return `${url.pathname}${url.search}` || null
  } catch {
    return first(value)
  }
}

function searchFromPath(path: string | null) {
  if (!path || !path.includes('?')) return ''
  return path.slice(path.indexOf('?') + 1)
}

export async function POST(request: NextRequest) {
  const admin = tryCreateAdminClient()
  if (!admin) {
    return NextResponse.json({ error: 'Falta SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })
  }

  let body: {
    utm_source?: string
    utm_medium?: string
    utm_campaign?: string
    salesperson_ref?: string
    referrer?: string
    landing_path?: string
    screen_width?: number
    city?: string
    country?: string
  } = {}
  try {
    body = (await request.json()) as typeof body
  } catch {
    body = {}
  }

  const jar = await cookies()
  const hdrs = await headers()
  const visitorKey = jar.get(LV_VID_COOKIE)?.value?.trim() || crypto.randomUUID()

  const userAgent = hdrs.get('user-agent') ?? ''
  const screenWidth = Number(body.screen_width) || 0
  const landingPath =
    first(body.landing_path) || pathFromUrl(first(body.referrer) || hdrs.get('referer'))
  const landingQuery = new URLSearchParams(searchFromPath(landingPath))

  const city =
    first(decodeHeader(hdrs.get('x-vercel-ip-city'))) ||
    first(hdrs.get('x-lv-city')) ||
    first(jar.get('lv_city')?.value) ||
    first(body.city)
  const country =
    first(decodeHeader(hdrs.get('x-vercel-ip-country'))) ||
    first(hdrs.get('x-lv-country')) ||
    first(jar.get('lv_country')?.value) ||
    first(body.country)

  try {
    const started = await rpcStartTourSession(admin, {
      visitorKey,
      utmSource: first(body.utm_source) || first(landingQuery.get('utm_source')),
      utmMedium: first(body.utm_medium) || first(landingQuery.get('utm_medium')),
      utmCampaign: first(body.utm_campaign) || first(landingQuery.get('utm_campaign')),
      salespersonRef: first(body.salesperson_ref) || first(landingQuery.get('b')),
      referrer: first(body.referrer) || first(hdrs.get('referer')),
      landingPath,
      deviceType: deviceType(userAgent, screenWidth),
      userAgent,
      screenWidth: screenWidth || null,
      city,
      country,
      trackingConsent: jar.get(LV_CONSENT_COOKIE)?.value === 'full',
    })
    const response = NextResponse.json(started)
    request.cookies.set(LV_VID_COOKIE, visitorKey)
    applyVisitorCookie(request, response)
    return response
  } catch (error) {
    console.error('POST /api/tour/session', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'No se pudo abrir la sesión' },
      { status: 500 },
    )
  }
}
