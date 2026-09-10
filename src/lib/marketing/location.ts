import 'server-only'
import { TOUR_PROJECT_ID, TOUR_TENANT_ID } from '@/lib/tour/trackingIds'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import { SITE } from '@/lib/marketing/site'
import type { MarketingProjectLocation } from '@/lib/marketing/projectLocationTypes'
import { googleMapsUrl, validCoordinates } from '@/lib/inmobiliaria/projectLocation'

export type { MarketingProjectLocation }

export async function getMarketingProjectLocation(): Promise<MarketingProjectLocation | null> {
  const admin = tryCreateAdminClient()
  if (!admin) return null

  const { data, error } = await admin
    .from('projects')
    .select(
      'id, tenant_id, name, address, city, country, short_description, description, contact_phone, contact_email, construction_phase, developer_name',
    )
    .eq('id', TOUR_PROJECT_ID)
    .eq('tenant_id', TOUR_TENANT_ID)
    .maybeSingle()

  if (error || !data) {
    const { data: fallback } = await admin
      .from('projects')
      .select(
        'id, tenant_id, name, address, city, country, short_description, description, contact_phone, contact_email, construction_phase, developer_name',
      )
      .ilike('name', '%vilet%')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!fallback) return null
    return withMap(fallback)
  }

  return withMap(data)

  async function withMap(row: Parameters<typeof mapProject>[0] & { id: string; tenant_id: string }) {
    const { data: location } = await admin!.from('project_automation_config')
      .select('visit_latitude,visit_longitude').eq('project_id', row.id).eq('tenant_id', row.tenant_id).maybeSingle()
    const point = location?.visit_latitude != null && location?.visit_longitude != null
      ? { latitude: Number(location.visit_latitude), longitude: Number(location.visit_longitude) } : null
    return { ...mapProject(row), ...(point && validCoordinates(point.latitude, point.longitude) ? {
      latitude: point.latitude, longitude: point.longitude, mapsUrl: googleMapsUrl(point),
    } : {}) }
  }
}

function mapProject(row: {
  name: string
  address: string | null
  city: string | null
  country: string | null
  short_description: string | null
  description: string | null
  contact_phone: string | null
  contact_email: string | null
  construction_phase: string | null
  developer_name: string | null
}): MarketingProjectLocation {
  return {
    name: row.name || SITE.location.label,
    address: row.address,
    city: row.city,
    country: row.country,
    shortDescription: row.short_description,
    description: row.description,
    contactPhone: row.contact_phone,
    contactEmail: row.contact_email,
    constructionPhase: row.construction_phase,
    developerName: row.developer_name,
  }
}
