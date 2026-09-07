import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveUnitTypeId } from '@/lib/tour/tourRpc'
import { LEAD_SOURCE, normalizeSource } from '@/lib/leads/sources'

const AUTO_RESUME_RE = /^Showroom 360/i

const FINISH_LABELS: Record<string, string> = {
  nogal: 'Nogal',
  roble: 'Roble',
  'acabado-1': 'Acabado 1',
  'acabado-2': 'Acabado 2',
}

function first(value: unknown) {
  const text = String(value ?? '').trim()
  return text || null
}

function finishLabel(slug: string | null | undefined) {
  const value = first(slug)
  if (!value) return null
  return FINISH_LABELS[value] ?? value
}

function lightLabel(value: string | null | undefined) {
  const light = first(value)?.toLowerCase()
  if (light === 'dia') return 'Día'
  if (light === 'noche') return 'Noche'
  return first(value)
}

export function buildShowroomResume(input: {
  typologyCode?: string | null
  interestRoom?: string | null
  finish?: string | null
  light?: string | null
}) {
  const lines = ['Showroom 360']
  const typology = first(input.typologyCode)
  if (typology) lines.push(`Tipología: ${typology}`)
  const room = first(input.interestRoom)
  if (room) lines.push(`Ambiente de interés: ${room}`)
  const finish = finishLabel(input.finish)
  if (finish) lines.push(`Acabado: ${finish}`)
  const light = lightLabel(input.light)
  if (light) lines.push(`Luz: ${light}`)
  return lines.join('\n')
}

export async function enrichTourLeadAfterIdentify(
  admin: SupabaseClient,
  args: {
    leadId: string
    visitorKey: string
    sessionId?: string | null
    typologyCode?: string | null
    unitTypeId?: string | null
    interestRoom?: string | null
    finish?: string | null
    light?: string | null
    city?: string | null
    country?: string | null
  },
) {
  const now = new Date().toISOString()
  let session: {
    id: string
    unit_type_id: string | null
    city: string | null
    country: string | null
    utm_source: string | null
    utm_medium: string | null
    utm_campaign: string | null
    salesperson_ref: string | null
    landing_path: string | null
    started_at: string | null
  } | null = null

  if (args.sessionId) {
    const { data } = await admin.from('tour_sessions').select('*').eq('id', args.sessionId).maybeSingle()
    session = data
  }
  if (!session) {
    const { data: visitor } = await admin
      .from('tour_visitors')
      .select('id')
      .eq('visitor_key', args.visitorKey)
      .maybeSingle()
    if (visitor?.id) {
      const { data } = await admin
        .from('tour_sessions')
        .select('*')
        .eq('visitor_id', visitor.id)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      session = data
    }
  }

  const unitTypeId =
    first(args.unitTypeId) || session?.unit_type_id || (await resolveUnitTypeId(admin, args.typologyCode))
  let bedrooms: number | null = null
  let typologyCode = first(args.typologyCode)

  if (unitTypeId) {
    const { data: type } = await admin
      .from('unit_types')
      .select('name, bedrooms')
      .eq('id', unitTypeId)
      .maybeSingle()
    if (type) {
      bedrooms = type.bedrooms ?? null
      typologyCode = typologyCode || first(type.name)
    }
  }

  const { data: lead } = await admin
    .from('leads')
    .select(
      'resume, preferred_category, preferred_bedrooms, city, country, first_utm_source, first_utm_medium, first_utm_campaign, first_salesperson_ref, first_landing_path, first_touch_at, source, channel_origin, behavior_signals, tracking_consent_at',
    )
    .eq('id', args.leadId)
    .maybeSingle()

  const resume = buildShowroomResume({
    typologyCode,
    interestRoom: args.interestRoom,
    finish: args.finish,
    light: args.light,
  })

  const patch: Record<string, unknown> = {
    last_interaction_at: now,
    tracking_consent: true,
  }
  if (!lead?.source) patch.source = LEAD_SOURCE.showroom_360
  else patch.source = normalizeSource(String(lead.source))
  if (!lead?.channel_origin) patch.channel_origin = 'web'
  if (!lead?.resume || AUTO_RESUME_RE.test(String(lead.resume))) patch.resume = resume
  if (!lead?.preferred_category) {
    if (bedrooms && bedrooms >= 2) patch.preferred_category = 'departamento'
    else if (typologyCode) patch.preferred_category = 'suite'
  }
  if (lead?.preferred_bedrooms == null && bedrooms != null) patch.preferred_bedrooms = bedrooms
  if (!lead?.city && (session?.city || first(args.city))) patch.city = session?.city || first(args.city)
  if (!lead?.country && (session?.country || first(args.country))) {
    patch.country = session?.country || first(args.country)
  }
  if (!lead?.first_utm_source && session?.utm_source) patch.first_utm_source = session.utm_source
  if (!lead?.first_utm_medium && session?.utm_medium) patch.first_utm_medium = session.utm_medium
  if (!lead?.first_utm_campaign && session?.utm_campaign) {
    patch.first_utm_campaign = session.utm_campaign
    patch.source_campaign = session.utm_campaign
  }
  if (!lead?.first_salesperson_ref && session?.salesperson_ref) {
    patch.first_salesperson_ref = session.salesperson_ref
  }
  if (!lead?.first_landing_path && session?.landing_path) patch.first_landing_path = session.landing_path
  if (!lead?.first_touch_at) patch.first_touch_at = session?.started_at || now
  if (!lead?.tracking_consent_at) patch.tracking_consent_at = now
  if (!lead?.behavior_signals) {
    patch.behavior_signals = {
      showroom: {
        typology: typologyCode,
        room: first(args.interestRoom),
        finish: first(args.finish),
        light: first(args.light),
      },
    }
  }

  const { error: leadError } = await admin.from('leads').update(patch).eq('id', args.leadId)
  if (leadError) console.error('enrich tour lead', leadError)

  if (session?.id) {
    const sessionPatch: Record<string, unknown> = {
      tracking_consent: true,
      lead_id: args.leadId,
    }
    if (unitTypeId) sessionPatch.unit_type_id = unitTypeId
    if (!session.city && first(args.city)) sessionPatch.city = first(args.city)
    if (!session.country && first(args.country)) sessionPatch.country = first(args.country)
    const { error: sessionError } = await admin.from('tour_sessions').update(sessionPatch).eq('id', session.id)
    if (sessionError) console.error('enrich tour session', sessionError)
  }
}
