import type { SupabaseClient } from '@supabase/supabase-js'
import { buildTourNodes, type TourNodeSource, type TourNodesResult } from '@/lib/tour/buildTourNodes'
import {
  getMockRoomVariantUrls,
  getMockTourCatalog,
  getMockTourNodes,
  getMockTourUnits,
  MOCK_TOUR_UNIT_TYPE_SLUG,
} from '@/lib/tour/mockTourData'
import type { TourWidth } from '@/lib/tour/pickTourWidth'
import type {
  TourHotspot,
  TourLightMode,
  TourPanoramaRow,
  TourUnitSummary,
} from '@/types/tour'

export type { TourNodesResult }

export type TourCatalog = {
  unitTypeSlug: string
  unitTypeName: string
  finishes: { slug: string; name: string }[]
  lights: { slug: TourLightMode; label: string }[]
}

export type TourSource = 'mock' | 'db'

export function getTourSource(): TourSource {
  return process.env.NEXT_PUBLIC_TOUR_SOURCE === 'db' ? 'db' : 'mock'
}

export function getTourUnitTypeSlug(): string {
  return process.env.NEXT_PUBLIC_TOUR_UNIT_TYPE || MOCK_TOUR_UNIT_TYPE_SLUG
}

function isMockSource(): boolean {
  return getTourSource() === 'mock'
}

async function resolveDbContext(): Promise<{ supabase: SupabaseClient; tenantId: string }> {
  const { createClient } = await import('@/lib/supabase/client')
  const { getAccessibleTenantIds } = await import('@/lib/inmobiliaria/tenants')
  const supabase = createClient()
  const envTenant = process.env.NEXT_PUBLIC_TOUR_TENANT_ID
  const tenantIds = await getAccessibleTenantIds(supabase)
  const tenantId = envTenant || tenantIds[0]
  if (!tenantId) throw new Error('No hay tenant para NEXT_PUBLIC_TOUR_SOURCE=db')
  return { supabase, tenantId }
}

function rowToSource(p: TourPanoramaRow): TourNodeSource {
  const hotspots: TourHotspot[] = Array.isArray(p.hotspots) ? p.hotspots : []
  return {
    id: p.id,
    room: p.room,
    roomLabel: p.room_label,
    url: p.url,
    variants: p.variants ?? {},
    hotspots,
    initialYaw: p.initial_yaw,
    initialPitch: p.initial_pitch,
    mapX: p.map_x,
    mapY: p.map_y,
    mapHeading: p.map_heading,
    finishSlug: p.finish_package?.slug ?? null,
  }
}

/**
 * Nodos para el plugin virtual-tour de PSV.
 *
 * 2 round-trips:
 *   RT-1  unit_types slug → id
 *   RT-2  finish_packages slug → id + panoramas  (paralelas)
 *
 * El filtro de acabado opera sobre finish_package_id. Filas con
 * finish_package_id = NULL (ambientes neutros) se incluyen siempre.
 * tour_transitions se ignora: el plugin no reproduce esos videos.
 */
export async function getTourNodes(
  supabase: SupabaseClient,
  tenantId: string,
  unitTypeSlug: string,
  finishSlug: string,
  light: TourLightMode,
  preferredWidth = 4096,
): Promise<TourNodesResult> {
  const { data: utRow, error: utErr } = await supabase
    .from('unit_types')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('slug', unitTypeSlug)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (utErr) throw utErr
  if (!utRow) return { nodes: [], startNodeId: undefined }
  const unitTypeId: string = utRow.id

  const [fpResult, panoResult] = await Promise.all([
    supabase
      .from('finish_packages')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('slug', finishSlug)
      .eq('is_active', true)
      .limit(1)
      .maybeSingle(),
    supabase
      .from('tour_panoramas')
      .select(
        `
        *,
        unit_type:unit_types!inner ( id, slug, name, minimap_url ),
        finish_package:finish_packages ( id, slug, name )
      `,
      )
      .eq('tenant_id', tenantId)
      .eq('unit_type_id', unitTypeId)
      .eq('light', light)
      .eq('is_published', true)
      .order('sort_order', { ascending: true }),
  ])

  if (fpResult.error) throw fpResult.error
  if (panoResult.error) throw panoResult.error

  const finishPackageId: string | null = fpResult.data?.id ?? null
  const allPanoramas = (panoResult.data ?? []) as unknown as TourPanoramaRow[]
  const panoramas = allPanoramas.filter(
    (p) => p.finish_package_id === null || p.finish_package_id === finishPackageId,
  )

  if (panoramas.length === 0) return { nodes: [], startNodeId: undefined }
  return buildTourNodes(panoramas.map(rowToSource), preferredWidth)
}

export async function getUnitsByType(
  supabase: SupabaseClient,
  tenantId: string,
  unitTypeId: string,
): Promise<TourUnitSummary[]> {
  const { data, error } = await supabase
    .from('units')
    .select(
      'id, unit_number, floor, published_commercial_price, status, area_total_m2, bedrooms, bathrooms, slug',
    )
    .eq('tenant_id', tenantId)
    .eq('unit_type_id', unitTypeId)
    .eq('is_published', true)
    .order('unit_number', { ascending: true })

  if (error) throw error
  return (data ?? []) as TourUnitSummary[]
}

/** Fachada que usa el visor. mock | db según NEXT_PUBLIC_TOUR_SOURCE. */
export async function loadTourNodes(params: {
  unitTypeSlug: string
  finishSlug: string
  light: TourLightMode
  preferredWidth?: number
}): Promise<TourNodesResult> {
  const width = params.preferredWidth ?? 4096
  if (isMockSource()) {
    return getMockTourNodes(params.unitTypeSlug, params.finishSlug, params.light, width)
  }
  const { supabase, tenantId } = await resolveDbContext()
  return getTourNodes(
    supabase,
    tenantId,
    params.unitTypeSlug,
    params.finishSlug,
    params.light,
    width,
  )
}

export async function loadTourUnits(unitTypeSlug = getTourUnitTypeSlug()): Promise<TourUnitSummary[]> {
  if (isMockSource()) return getMockTourUnits()

  const { supabase, tenantId } = await resolveDbContext()
  const { data, error } = await supabase
    .from('unit_types')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('slug', unitTypeSlug)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (!data) return []
  return getUnitsByType(supabase, tenantId, data.id)
}

export async function loadTourCatalog(unitTypeSlug = getTourUnitTypeSlug()): Promise<TourCatalog> {
  if (isMockSource()) return getMockTourCatalog()

  const { supabase, tenantId } = await resolveDbContext()
  const { data: utRow, error: utErr } = await supabase
    .from('unit_types')
    .select('id, name, slug, project_id')
    .eq('tenant_id', tenantId)
    .eq('slug', unitTypeSlug)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (utErr) throw utErr
  if (!utRow) return getMockTourCatalog()

  const { data: finishes, error: fpErr } = await supabase
    .from('finish_packages')
    .select('slug, name')
    .eq('tenant_id', tenantId)
    .eq('project_id', utRow.project_id)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (fpErr) throw fpErr

  return {
    unitTypeSlug: utRow.slug,
    unitTypeName: utRow.name,
    finishes: (finishes ?? []).map((f) => ({ slug: f.slug, name: f.name })),
    lights: [
      { slug: 'dia', label: 'Día' },
      { slug: 'noche', label: 'Noche' },
    ],
  }
}

export async function loadRoomVariantUrls(room: string, width: TourWidth): Promise<string[]> {
  if (isMockSource()) return getMockRoomVariantUrls(room, width)

  const { supabase, tenantId } = await resolveDbContext()
  const unitTypeSlug = getTourUnitTypeSlug()
  const { data: utRow, error: utErr } = await supabase
    .from('unit_types')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('slug', unitTypeSlug)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (utErr) throw utErr
  if (!utRow) return []

  const { data, error } = await supabase
    .from('tour_panoramas')
    .select('url, variants')
    .eq('tenant_id', tenantId)
    .eq('unit_type_id', utRow.id)
    .eq('room', room)
    .eq('is_published', true)

  if (error) throw error

  return (data ?? [])
    .map((row) => {
      const variants = (row.variants ?? {}) as Record<string, { url?: string }>
      return variants[String(width)]?.url ?? (row.url as string)
    })
    .filter(Boolean)
}
