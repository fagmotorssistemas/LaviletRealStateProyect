import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import { LV_VID_COOKIE, TOUR_TENANT_ID } from '@/lib/tour/trackingIds'
import { infoRequestKey } from '@/lib/tour/infoRequests'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const unitId = params.get('unit_id')?.trim() || null
  const typologyCode = params.get('typology_code')?.trim() || null
  const visitorKey = (await cookies()).get(LV_VID_COOKIE)?.value?.trim()
  if (!visitorKey) return NextResponse.json({ record: null }, { headers: { 'Cache-Control': 'no-store' } })

  const admin = tryCreateAdminClient()
  if (!admin) return NextResponse.json({ record: null }, { headers: { 'Cache-Control': 'no-store' } })

  const { data: visitor, error: visitorError } = await admin
    .from('tour_visitors')
    .select('id, lead_id')
    .eq('tenant_id', TOUR_TENANT_ID)
    .eq('visitor_key', visitorKey)
    .maybeSingle()
  if (visitorError) return NextResponse.json({ error: 'Could not check request status' }, { status: 503 })
  if (!visitor) return NextResponse.json({ record: null }, { headers: { 'Cache-Control': 'no-store' } })

  let query = admin
    .from('tour_info_requests')
    .select('created_at')
    .eq('tenant_id', TOUR_TENANT_ID)
    .or(visitor.lead_id ? `visitor_id.eq.${visitor.id},lead_id.eq.${visitor.lead_id}` : `visitor_id.eq.${visitor.id}`)
  query = unitId ? query.eq('unit_id', unitId) : query.is('unit_id', null)
  query = typologyCode && !unitId ? query.eq('typology_code', typologyCode) : !unitId ? query.is('typology_code', null) : query
  const { data: row, error } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) return NextResponse.json({ error: 'Could not check request status' }, { status: 503 })
  return NextResponse.json({ record: row ? {
    key: infoRequestKey(unitId, typologyCode),
    unitNumber: null,
    sentAt: row.created_at,
  } : null }, { headers: { 'Cache-Control': 'no-store' } })
}
