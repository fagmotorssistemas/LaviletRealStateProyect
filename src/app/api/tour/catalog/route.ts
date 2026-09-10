import { NextResponse } from 'next/server'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import { getTypologyAssetPublicUrl } from '@/services/inmobiliaria.service'
import { TOUR_TENANT_ID } from '@/lib/tour/trackingIds'
import { ensureDefaultFinishPackages } from '@/lib/tour/tourRpc'
import {
  isTourPanoramaFileName,
  roomsShareFamily,
  tourHomeSlug,
  vistaRoomSlug,
  unionTourRooms,
} from '@/lib/tour/tourRooms'
import { buildRoomScenes, parseRoomSceneFileName, pickRoomScene, TOUR_SCENE_LIGHTS } from '@/lib/tour/roomScene'
import { loadTypologyHotspots } from '@/lib/tour/typologyHotspots'
import type { TypologyAsset } from '@/types/inmobiliaria'
import type { SupabaseClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type UnitTypeRow = {
  id: string
  name: string
  slug: string
  description: string | null
  bedrooms: number | null
  bathrooms: number | null
}

type UnitRow = {
  id: string
  unit_number: string
  unit_type_id: string | null
  floor: string | null
  floor_number: number | null
  published_commercial_price: number | null
  status: string
  bedrooms: number | null
  bathrooms: number | null
  bathrooms_full: number | null
  bathrooms_half: number | null
  spaces: string[] | null
  area_internal_m2: number | null
  area_exterior_m2: number | null
  area_terrace_covered_m2: number | null
  area_terrace_open_m2: number | null
}

export async function GET() {
  const admin = tryCreateAdminClient()
  if (!admin) return NextResponse.json({ error: 'Falta SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })
  const [{ data: typologies, error: tErr }, assetsRes, { data: units, error: uErr }, finishesRes] =
    await Promise.all([
      admin
        .from('unit_types')
        .select('id, name, slug, description, bedrooms, bathrooms')
        .eq('tenant_id', TOUR_TENANT_ID)
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
      admin
        .from('typology_assets')
        .select('id, typology_code, kind, file_name, storage_path, sort_order, created_at')
        .order('sort_order', { ascending: true }),
      admin
        .from('units')
        .select(
          'id, unit_number, unit_type_id, floor, floor_number, published_commercial_price, status, bedrooms, bathrooms, bathrooms_full, bathrooms_half, spaces, area_internal_m2, area_exterior_m2, area_terrace_covered_m2, area_terrace_open_m2',
        )
        .eq('tenant_id', TOUR_TENANT_ID)
        .order('unit_number', { ascending: true }),
      admin
        .from('finish_packages')
        .select('slug, name, sort_order')
        .eq('tenant_id', TOUR_TENANT_ID)
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
    ])
  const assets = assetsRes.error ? [] : assetsRes.data

  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 })
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 })

  const fromDb = uniqueFinishes(finishesRes.data ?? [])
  if (fromDb.length === 0) await ensureDefaultFinishPackages(admin)
  const finishes =
    fromDb.length > 0
      ? fromDb
      : [
          { slug: 'nogal', name: 'Nogal' },
          { slug: 'roble', name: 'Roble' },
        ]
  const typeById = new Map((typologies ?? []).map((row) => [row.id, row]))
  const assetsByCode = new Map<string, TypologyAsset[]>()
  for (const row of (assets ?? []) as TypologyAsset[]) {
    const list = assetsByCode.get(row.typology_code) ?? []
    list.push(row)
    assetsByCode.set(row.typology_code, list)
  }

  const catalogTypologies = await Promise.all(
    ((typologies ?? []) as UnitTypeRow[]).map((row) =>
      toCatalogTypology(admin, row, (units ?? []) as UnitRow[], assetsByCode, finishes),
    ),
  )

  return NextResponse.json(
    {
    finishes,
    lights: TOUR_SCENE_LIGHTS,
    typologies: catalogTypologies,
    units: ((units ?? []) as UnitRow[]).map((row) => {
      const type = typeById.get(row.unit_type_id)
      return {
        id: row.id,
        unit_id: row.id,
        unit_type_id: row.unit_type_id,
        unit_code: row.unit_number,
        unit_number: row.unit_number,
        typology_code: type?.name ?? null,
        floor: row.floor,
        floor_label: row.floor,
        floor_number: row.floor_number ?? null,
        price: row.published_commercial_price,
        published_commercial_price: row.published_commercial_price,
        status: row.status,
        bedrooms: row.bedrooms,
        bathrooms_full: row.bathrooms_full ?? row.bathrooms,
        bathrooms_half: row.bathrooms_half ?? 0,
        spaces: Array.isArray(row.spaces) ? row.spaces : [],
        area_internal_m2: row.area_internal_m2,
        area_exterior_m2: row.area_exterior_m2,
        area_terrace_covered_m2: row.area_terrace_covered_m2,
        area_terrace_open_m2: row.area_terrace_open_m2,
      }
    }),
    },
    {
      headers: {
        'Cache-Control': 'private, no-store, no-cache, must-revalidate',
      },
    },
  )
}

async function toCatalogTypology(
  admin: SupabaseClient,
  row: UnitTypeRow,
  units: UnitRow[],
  assetsByCode: Map<string, TypologyAsset[]>,
  finishes: { slug: string; name: string }[],
) {
  const list = assetsByCode.get(row.name) ?? assetsByCode.get(row.slug) ?? []
  const toPublic = (item: TypologyAsset) => ({
    id: item.id,
    file_name: item.file_name,
    url: getTypologyAssetPublicUrl(admin, item.storage_path, item.created_at),
  })
  const publicAssets = list.map(toPublic)
  const typeUnits = units.filter((unit) => unit.unit_type_id === row.id)
  const roomDefs = unionTourRooms(
    typeUnits.map((unit) => ({
      bedrooms: unit.bedrooms ?? row.bedrooms,
      bathrooms_full: unit.bathrooms_full ?? unit.bathrooms,
      bathrooms_half: unit.bathrooms_half,
      spaces: Array.isArray(unit.spaces) ? unit.spaces : [],
    })),
  )
  const rooms =
    roomDefs.length > 0
      ? roomDefs
      : unionTourRooms([
          {
            bedrooms: row.bedrooms,
            bathrooms_full: row.bathrooms,
            bathrooms_half: 0,
            spaces: ['Sala', 'Cocina'],
          },
        ])
  const slots = rooms.some((room) => room.slug === 'dormitorio' || room.slug.startsWith('dormitorio-'))
    ? rooms
    : [...rooms, { slug: 'dormitorio', label: 'Dormitorio' }]
  const homeSlug = tourHomeSlug(rooms)
  const panoScenes = buildRoomScenes(publicAssets, homeSlug)
  const defaultFinish = finishes[0]?.slug ?? null
  const defaultPano = pickRoomScene(panoScenes, defaultFinish, 'dia') ?? panoScenes[0]
  const panoAsset = defaultPano
    ? list.find((item) => item.file_name === defaultPano.file_name)
    : undefined
  const variants: Partial<Record<'2048' | '4096' | '8192', string>> = {
    ...(defaultPano?.widths ?? {}),
  }
  const catalogRooms = rooms
    .map((room) => {
      const scenes = buildRoomScenes(publicAssets, room.slug)
      const selected = pickRoomScene(scenes, defaultFinish, 'dia')
      return {
        slug: room.slug,
        label: room.label,
        url: selected?.url ?? null,
        scenes,
      }
    })
    .filter((item) => Boolean(item.url) && item.scenes.length > 0)
  const placed = await loadTypologyHotspots(admin, row.name)

  return {
    id: row.id,
    code: row.name,
    name: row.description || row.name,
    category: row.bedrooms && row.bedrooms >= 2 ? 'departamento' : 'suite',
    panorama:
      !panoAsset && panoScenes.length === 0
        ? null
        : {
            id: panoAsset?.id ?? defaultPano?.file_name ?? 'pano',
            file_name: panoAsset?.file_name ?? defaultPano?.file_name ?? '',
            url: defaultPano?.url ?? (panoAsset
              ? getTypologyAssetPublicUrl(admin, panoAsset.storage_path, panoAsset.created_at)
              : ''),
            variants,
            scenes: panoScenes,
          },
    renders: list
      .filter(
        (item) =>
          item.kind === 'render' &&
          !isTourPanoramaFileName(item.file_name) &&
          !parseRoomSceneFileName(item.file_name),
      )
      .map(toPublic),
    planos: list.filter((item) => item.kind === 'plano').map(toPublic),
    vistas: slots.map((room) => {
      const slug = vistaRoomSlug(room.slug)
      const scenes = buildRoomScenes(publicAssets, slug)
      const selected = pickRoomScene(scenes, defaultFinish, 'dia')
      return {
        slug,
        label: room.label,
        url: selected?.url ?? null,
        scenes,
      }
    }),
    slots: slots.map((room) => ({ slug: room.slug, label: room.label })),
    rooms: catalogRooms,
    hotspots: placed.filter((pin) => {
      if (pin.kind === 'look') return true
      return catalogRooms.some((room) => roomsShareFamily(room.slug, pin.slug))
    }),
  }
}

function uniqueFinishes(rows: Array<{ slug: string; name: string }>) {
  const seen = new Set<string>()
  const list: { slug: string; name: string }[] = []
  for (const row of rows) {
    if (!row.slug || seen.has(row.slug)) continue
    seen.add(row.slug)
    list.push({ slug: row.slug, name: row.name })
  }
  return list
}
