import type { SupabaseClient } from '@supabase/supabase-js'
import { TOUR_PROJECT_ID, TOUR_TENANT_ID, type TourEventType } from '@/lib/tour/trackingIds'

function rpcError(prefix: string, error: { message?: string; code?: string; details?: string; hint?: string }) {
  const parts = [error.message, error.code, error.details, error.hint].filter(Boolean)
  return new Error(`${prefix}: ${parts.join(' · ') || 'error de Supabase'}`)
}

export type StartedTourSession = {
  visitor_id: string
  session_id: string
}

export async function rpcStartTourSession(
  admin: SupabaseClient,
  args: {
    visitorKey: string
    utmSource?: string | null
    utmMedium?: string | null
    utmCampaign?: string | null
    salespersonRef?: string | null
    referrer?: string | null
    landingPath?: string | null
    deviceType?: string | null
    userAgent?: string | null
    screenWidth?: number | null
    city?: string | null
    country?: string | null
    trackingConsent?: boolean
  },
): Promise<StartedTourSession> {
  const { data, error } = await admin.rpc('start_tour_session', {
    p_tenant_id: TOUR_TENANT_ID,
    p_visitor_key: args.visitorKey,
    p_utm_source: args.utmSource || null,
    p_utm_medium: args.utmMedium || null,
    p_utm_campaign: args.utmCampaign || null,
    p_salesperson_ref: args.salespersonRef || null,
    p_referrer: args.referrer || null,
    p_landing_path: args.landingPath || null,
    p_device_type: args.deviceType || null,
    p_user_agent: args.userAgent || null,
    p_screen_width: args.screenWidth ?? null,
    p_city: args.city || null,
    p_country: args.country || null,
    p_tracking_consent: Boolean(args.trackingConsent),
  })
  if (error) throw rpcError('start_tour_session', error)
  const row = Array.isArray(data) ? data[0] : data
  if (!row?.visitor_id || !row?.session_id) {
    throw new Error('start_tour_session no devolvió visitor_id y session_id')
  }
  const returned = String(row.session_id)
  const { data: session, error: sessionError } = await admin
    .from('tour_sessions')
    .select('id')
    .eq('visitor_id', row.visitor_id)
    .or(`id.eq.${returned},session_id.eq.${returned}`)
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (sessionError) console.error('start_tour_session lookup', sessionError)
  return { visitor_id: row.visitor_id, session_id: session?.id ?? returned }
}

export async function rpcLogTourEvent(
  admin: SupabaseClient,
  args: {
    sessionId: string
    visitorId: string
    eventType: TourEventType
    room?: string | null
    unitTypeId?: string | null
    finishPackageId?: string | null
    light?: string | null
    seconds?: number | null
    metadata?: Record<string, unknown> | null
  },
) {
  const { error } = await admin.rpc('log_tour_event', {
    p_session_id: args.sessionId,
    p_visitor_id: args.visitorId,
    p_event_type: args.eventType,
    p_room: args.room || null,
    p_unit_type_id: args.unitTypeId || null,
    p_finish_package_id: args.finishPackageId || null,
    p_light: args.light || null,
    p_seconds: args.seconds ?? null,
    p_metadata: args.metadata ?? {},
  })
  if (error) throw rpcError('log_tour_event', error)
}

export async function rpcIdentifyTourLead(
  admin: SupabaseClient,
  args: { visitorKey: string; name: string; email: string; phone: string },
): Promise<string> {
  const { data, error } = await admin.rpc('identify_tour_lead', {
    p_tenant_id: TOUR_TENANT_ID,
    p_visitor_key: args.visitorKey,
    p_name: args.name,
    p_email: args.email,
    p_phone: args.phone,
    p_project_id: TOUR_PROJECT_ID,
  })
  if (error) throw rpcError('identify_tour_lead', error)
  const leadId = typeof data === 'string' ? data : data?.lead_id ?? data?.[0]?.lead_id ?? data?.[0]
  if (!leadId || typeof leadId !== 'string') {
    throw new Error('identify_tour_lead no devolvió lead_id')
  }
  return leadId
}

export async function rpcSetTrackingPreference(
  admin: SupabaseClient,
  args: { leadId: string; consent: boolean; reason?: string },
) {
  const { error } = await admin.rpc('set_tracking_preference', {
    p_lead_id: args.leadId,
    p_consent: args.consent,
    p_reason: args.reason || 'gate',
  })
  if (error) throw rpcError('set_tracking_preference', error)
}

export async function resolveUnitTypeId(admin: SupabaseClient, code?: string | null) {
  const value = String(code ?? '').trim()
  if (!value) return null
  if (/^[0-9a-f-]{36}$/i.test(value)) return value
  const { data } = await admin
    .from('unit_types')
    .select('id')
    .eq('tenant_id', TOUR_TENANT_ID)
    .or(`name.ilike.${value},slug.ilike.${value.toLowerCase()}`)
    .limit(1)
    .maybeSingle()
  return data?.id ?? null
}

export async function resolveFinishPackageId(admin: SupabaseClient, slug?: string | null) {
  const value = String(slug ?? '').trim()
  if (!value) return null
  if (/^[0-9a-f-]{36}$/i.test(value)) return value
  const { data } = await admin
    .from('finish_packages')
    .select('id')
    .eq('tenant_id', TOUR_TENANT_ID)
    .eq('slug', value)
    .limit(1)
    .maybeSingle()
  return data?.id ?? null
}
