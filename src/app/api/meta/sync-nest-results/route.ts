import { NextResponse } from 'next/server'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import { syncNestOutboxResults } from '@/lib/meta/syncNestOutboxResults'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Sync Nest lookup → conversion_log (sin reenvío Graph).
 * Auth: Authorization: Bearer CRON_SECRET | X-Internal-Secret == META_CAPI_INTERNAL_SECRET
 */
export async function GET(request: Request) {
  const auth = request.headers.get('authorization') || ''
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  const internal = request.headers.get('x-internal-secret')?.trim() || ''
  const cronSecret = process.env.CRON_SECRET?.trim() || ''
  const capiSecret = process.env.META_CAPI_INTERNAL_SECRET?.trim() || ''

  const ok =
    (cronSecret && bearer === cronSecret) ||
    (capiSecret && (internal === capiSecret || bearer === capiSecret))
  if (!ok) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  const admin = tryCreateAdminClient()
  if (!admin) {
    return NextResponse.json({ ok: false, error: 'admin_unavailable' }, { status: 503 })
  }

  const url = new URL(request.url)
  const limitRaw = Number(url.searchParams.get('limit') || '25')
  const limit = Number.isFinite(limitRaw) ? limitRaw : 25

  const result = await syncNestOutboxResults(admin, { limit })
  return NextResponse.json({ ok: true, ...result })
}
