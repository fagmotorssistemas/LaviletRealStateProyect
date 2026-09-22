import { NextResponse } from 'next/server'
import { secretMatches } from '@/lib/integrations/automation/config'
import { syncNestLookupToConversionLog } from '@/lib/meta/nestLookupSync'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const DEFAULT_EVENT_IDS = [
  '73332442-ad30-41cb-a84e-213062c81807',
  '123ddc30-a6dc-4861-a87e-9ea22cebd313',
  '80d45198-eef3-4a69-93f5-7c43057b89b7',
]

/** Misma higiene que admin.ts: quita comillas y extrae JWT si viene embebido. */
function normalizeSecret(raw: string | null | undefined): string {
  const trimmed = String(raw ?? '')
    .trim()
    .replace(/^["']|["']$/g, '')
  const jwt = trimmed.match(
    /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/,
  )
  return jwt?.[0] ?? trimmed
}

function authorized(request: Request): boolean {
  const authorization = request.headers.get('authorization')
  const bearer = normalizeSecret(
    authorization?.startsWith('Bearer ') ? authorization.slice(7) : null,
  )
  const internal = normalizeSecret(request.headers.get('x-internal-secret'))
  const candidates = [
    process.env.NEST_LOOKUP_SYNC_TOKEN,
    process.env.CRON_SECRET,
    process.env.AUTOMATION_CRON_SECRET,
    process.env.META_CAPI_INTERNAL_SECRET,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  ].map((v) => normalizeSecret(v))

  return candidates.some(
    (expected) =>
      secretMatches(bearer || null, expected || undefined) ||
      secretMatches(internal || null, expected || undefined),
  )
}

export async function POST(request: Request) {
  const headers = { 'Cache-Control': 'no-store' }
  if (!authorized(request)) {
    return NextResponse.json(
      { ok: false, error: 'No autorizado', utc: new Date().toISOString() },
      { status: 401, headers },
    )
  }

  let eventIds = DEFAULT_EVENT_IDS
  try {
    const body = (await request.json()) as { event_ids?: unknown }
    if (Array.isArray(body?.event_ids) && body.event_ids.length) {
      eventIds = body.event_ids
        .map((id) => String(id || '').trim())
        .filter(Boolean)
        .slice(0, 40)
    }
  } catch {
    // body opcional: usa los tres IDs de verificación
  }

  try {
    const admin = createAdminClient()
    const result = await syncNestLookupToConversionLog(admin, eventIds)
    const anyFetchFail = result.results.some((r) => !r.fetch.ok)
    return NextResponse.json(
      {
        ok: !anyFetchFail,
        purchase_delivery_enabled:
          process.env.META_PURCHASE_DELIVERY_ENABLED?.trim().toLowerCase() ===
          'true',
        resend_to_meta: false,
        ...result,
      },
      { status: anyFetchFail ? 502 : 200, headers },
    )
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'sync_failed',
        utc: new Date().toISOString(),
      },
      { status: 500, headers },
    )
  }
}
