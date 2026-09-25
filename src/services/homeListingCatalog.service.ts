import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { LAVILET_PROJECT_ID, LAVILET_TENANT_ID } from '@/lib/integrations/lavilet'
import { SITE } from '@/lib/marketing/site'
import {
  buildHomeListingCatalog,
  homeListingImagePublicUrl,
  type HomeListingBuildResult,
  type HomeListingImageAsset,
  type HomeListingUnitInput,
  type HomeListingUnitMedia,
} from '@/lib/meta/homeListingCatalog'
import { TYPOLOGY_ASSETS_BUCKET } from '@/lib/typology-assets'

const SITE_ORIGIN = 'https://www.lavilett.com'
const COMMERCIAL_IMAGE_URL =
  'https://xhjnyntywqhczdtecgim.supabase.co/storage/v1/object/public/imagenes%20lavilet/comerciales_lavilet.png'

/** Provincia real de Cuenca (Ecuador); requerida por Meta como address.region. */
const LAVILET_REGION = 'Azuay'
/** Barrio publicado del proyecto. */
const LAVILET_NEIGHBORHOOD = 'Puertas del Sol'

export type HomeListingCatalogSnapshot = HomeListingBuildResult & {
  generatedAt: string
  projectId: string
  datasetCompatibilityNote: string
}

export async function buildLaviletHomeListingCatalog(
  admin: SupabaseClient,
): Promise<HomeListingCatalogSnapshot> {
  const supabaseUrl = String(process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '')
  if (!supabaseUrl) throw new Error('Falta NEXT_PUBLIC_SUPABASE_URL')

  const [projectRes, visitRes, unitsRes, assetsRes, mediaRes] = await Promise.all([
    admin
      .from('projects')
      .select('id,name,address,city,country')
      .eq('id', LAVILET_PROJECT_ID)
      .eq('tenant_id', LAVILET_TENANT_ID)
      .maybeSingle(),
    admin
      .from('project_automation_config')
      .select('visit_latitude,visit_longitude')
      .eq('project_id', LAVILET_PROJECT_ID)
      .eq('tenant_id', LAVILET_TENANT_ID)
      .maybeSingle(),
    admin
      .from('units')
      .select(
        'id,unit_number,category,status,is_published,published_commercial_price,bedrooms,bathrooms,bathrooms_full,area_internal_m2,area_total_m2,floor,description,typology_code,parking_assigned,project_id',
      )
      .eq('project_id', LAVILET_PROJECT_ID)
      .eq('tenant_id', LAVILET_TENANT_ID)
      .order('unit_number', { ascending: true }),
    admin
      .from('typology_assets')
      .select('typology_code,file_name,storage_path,kind')
      .eq('kind', 'render'),
    admin
      .from('unit_media')
      .select('unit_id,url,is_cover,sort_order,mime_type,type'),
  ])

  if (projectRes.error) throw projectRes.error
  if (visitRes.error) throw visitRes.error
  if (unitsRes.error) throw unitsRes.error
  if (assetsRes.error) throw assetsRes.error
  if (mediaRes.error) throw mediaRes.error
  if (!projectRes.data) throw new Error('Proyecto La Vilet no encontrado')

  const latitude =
    visitRes.data?.visit_latitude != null
      ? Number(visitRes.data.visit_latitude)
      : SITE.location.lat
  const longitude =
    visitRes.data?.visit_longitude != null
      ? Number(visitRes.data.visit_longitude)
      : SITE.location.lng

  const typologyImages: HomeListingImageAsset[] = (assetsRes.data || [])
    .filter((row) => row.typology_code && row.storage_path && row.file_name)
    .map((row) => ({
      typologyCode: String(row.typology_code),
      fileName: String(row.file_name),
      storagePath: String(row.storage_path),
      publicUrl: homeListingImagePublicUrl(
        supabaseUrl,
        TYPOLOGY_ASSETS_BUCKET,
        String(row.storage_path),
        String(row.file_name),
      ),
    }))

  const unitMedia: HomeListingUnitMedia[] = (mediaRes.data || [])
    .filter((row) => row.unit_id && row.url)
    .map((row) => ({
      unitId: String(row.unit_id),
      url: String(row.url),
      isCover: row.is_cover === true,
      sortOrder: Number(row.sort_order) || 0,
      mimeType: row.mime_type == null ? null : String(row.mime_type),
    }))

  const units: HomeListingUnitInput[] = (unitsRes.data || []).map((row) => ({
    id: String(row.id),
    unit_number: String(row.unit_number),
    category: row.category == null ? null : String(row.category),
    status: row.status == null ? null : String(row.status),
    is_published: row.is_published == null ? null : Boolean(row.is_published),
    published_commercial_price:
      row.published_commercial_price == null ? null : Number(row.published_commercial_price),
    bedrooms: row.bedrooms == null ? null : Number(row.bedrooms),
    bathrooms: row.bathrooms == null ? null : Number(row.bathrooms),
    bathrooms_full: row.bathrooms_full == null ? null : Number(row.bathrooms_full),
    area_internal_m2: row.area_internal_m2 == null ? null : Number(row.area_internal_m2),
    area_total_m2: row.area_total_m2 == null ? null : Number(row.area_total_m2),
    floor: row.floor == null ? null : String(row.floor),
    description: row.description == null ? null : String(row.description),
    typology_code: row.typology_code == null ? null : String(row.typology_code),
    parking_assigned: row.parking_assigned == null ? null : Number(row.parking_assigned),
    project_id: String(row.project_id),
  }))

  const built = buildHomeListingCatalog({
    units,
    project: {
      id: String(projectRes.data.id),
      name: String(projectRes.data.name),
      address: projectRes.data.address,
      city: projectRes.data.city || SITE.city.split(',')[0]?.trim() || 'Cuenca',
      country: projectRes.data.country || 'Ecuador',
      latitude,
      longitude,
      neighborhood: LAVILET_NEIGHBORHOOD,
      region: LAVILET_REGION,
      postalCode: null,
      siteOrigin: SITE_ORIGIN,
      commercialImageUrl: COMMERCIAL_IMAGE_URL,
    },
    typologyImages,
    unitMedia,
  })

  return {
    ...built,
    generatedAt: new Date().toISOString(),
    projectId: LAVILET_PROJECT_ID,
    datasetCompatibilityNote:
      'home_listing_id = units.id. Pixel/CAPI deben usar content_ids=[units.id] y content_type=home_listing (también con Core Setup ON; Nest preserva ids+type). Dataset web 923439043758658; no messaging WhatsApp.',
  }
}
