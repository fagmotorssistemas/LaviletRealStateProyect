import { NextResponse } from 'next/server'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import { getTypologyAssetPublicUrl } from '@/services/inmobiliaria.service'
import { TOUR_TENANT_ID } from '@/lib/tour/trackingIds'
import {
  isTourPanoramaFileName,
  panoWidthFromFileName,
  stillAssetForRoom,
  TOUR_PANO_SLUG,
  vistaRoomSlug,
  typologyPanoramaAsset,
  typologyPanoramaVariants,
  unionTourRooms,
} from '@/lib/tour/tourRooms'
import { buildRoomScenes, parseRoomSceneFileName, pickRoomScene, TOUR_SCENE_LIGHTS } from '@/lib/tour/roomScene'
import type { TypologyAsset } from '@/types/inmobiliaria'

export const runtime = 'nodejs'

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
          'id, unit_number, unit_type_id, floor, published_commercial_price, status, bedrooms, bathrooms, bathrooms_full, bathrooms_half, spaces, area_internal_m2',
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

  return NextResponse.json({
    finishes,
    lights: TOUR_SCENE_LIGHTS,
    typologies: (typologies ?? []).map((row) => {
      const list = assetsByCode.get(row.name) ?? assetsByCode.get(row.slug) ?? []
      const toPublic = (item: TypologyAsset) => ({
        id: item.id,
        file_name: item.file_name,
        url: getTypologyAssetPublicUrl(admin, item.storage_path),
      })
      const publicAssets = list.map(toPublic)
      const typeUnits = (units ?? []).filter((unit) => unit.unit_type_id === row.id)
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
      const panoScenes = buildRoomScenes(publicAssets, TOUR_PANO_SLUG)
      const defaultFinish = finishes[0]?.slug ?? null
      const defaultPano = pickRoomScene(panoScenes, defaultFinish, 'dia')
      const legacyPano = typologyPanoramaAsset(list)
      return {
        id: row.id,
        code: row.name,
        name: row.description || row.name,
        category: row.bedrooms && row.bedrooms >= 2 ? 'departamento' : 'suite',
        panorama: (() => {
          const asset = defaultPano
            ? list.find((item) => item.file_name === defaultPano.file_name) ?? legacyPano
            : legacyPano
          if (!asset && panoScenes.length === 0) return null
          const variants: Partial<Record<'2048' | '4096' | '8192', string>> = {
            ...(defaultPano?.widths ?? {}),
          }
          if (!defaultPano) {
            for (const item of typologyPanoramaVariants(list)) {
              const width = panoWidthFromFileName(item.file_name)
              if (width) variants[String(width) as '2048' | '4096' | '8192'] = getTypologyAssetPublicUrl(admin, item.storage_path)
            }
          }
          return {
            id: asset?.id ?? defaultPano?.file_name ?? 'pano',
            file_name: asset?.file_name ?? defaultPano?.file_name ?? '',
            url: asset ? getTypologyAssetPublicUrl(admin, asset.storage_path) : defaultPano?.url ?? '',
            variants,
            scenes: panoScenes,
          }
        })(),
        renders: list
          .filter(
            (item) =>
              item.kind === 'render' &&
              !isTourPanoramaFileName(item.file_name) &&
              !parseRoomSceneFileName(item.file_name),
          )
          .map(toPublic),
        planos: list.filter((item) => item.kind === 'plano').map(toPublic),
        vistas: rooms.map((room) => {
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
        rooms: rooms.map((room) => {
          const scenes = buildRoomScenes(publicAssets, room.slug)
          const selected = pickRoomScene(scenes, defaultFinish, 'dia')
          const asset = stillAssetForRoom(list, room.slug)
          return {
            slug: room.slug,
            label: room.label,
            url: selected?.url ?? (asset ? getTypologyAssetPublicUrl(admin, asset.storage_path) : null),
            scenes,
          }
        }),
      }
    }),
    units: (units ?? []).map((row) => {
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
        floor_number: null,
        price: row.published_commercial_price,
        published_commercial_price: row.published_commercial_price,
        status: row.status,
        bedrooms: row.bedrooms,
        bathrooms_full: row.bathrooms_full ?? row.bathrooms,
        bathrooms_half: row.bathrooms_half ?? 0,
        spaces: Array.isArray(row.spaces) ? row.spaces : [],
        area_internal_m2: row.area_internal_m2,
      }
    }),
  })
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
