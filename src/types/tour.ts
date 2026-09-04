// ─── Tour DB Types ──────────────────────────────────────────
// Generados a partir del esquema real de Supabase (proyecto xhjnyntywqhczdtecgim).
// NO agregar columnas que no existan en la base.

import type { UnitStatus } from '@/types/inmobiliaria'

export type TourLightMode = 'dia' | 'noche'

// ─── unit_types ─────────────────────────────────────────────
export interface UnitType {
  id: string
  tenant_id: string
  project_id: string
  name: string
  slug: string
  description: string | null
  bedrooms: number | null
  bathrooms: number | null
  area_internal_m2: number | null
  area_terrace_m2: number | null
  area_total_m2: number | null
  minimap_url: string | null
  minimap_storage_path: string | null
  floor_plan_asset_id: string | null
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

// ─── finish_packages ────────────────────────────────────────
export interface FinishPackage {
  id: string
  tenant_id: string
  project_id: string
  name: string
  slug: string
  description: string | null
  swatch_url: string | null
  sort_order: number
  is_default: boolean
  is_active: boolean
  created_at: string
}

// ─── tour_panoramas ─────────────────────────────────────────
/** Variantes por ancho almacenadas en `variants` jsonb. */
export interface PanoramaVariants {
  [width: string]: {
    url: string
    storage_path?: string | null
    file_size_bytes?: number | null
  }
}

export interface TourPanorama {
  id: string
  tenant_id: string
  unit_type_id: string
  room: string
  room_label: string | null
  finish_package_id: string | null
  light: TourLightMode
  url: string
  storage_path: string | null
  width_px: number | null
  height_px: number | null
  file_size_bytes: number | null
  variants: PanoramaVariants
  initial_yaw: number
  initial_pitch: number
  map_x: number | null
  map_y: number | null
  map_heading: number | null
  hotspots: TourHotspot[]
  sort_order: number
  is_published: boolean
  created_at: string
  updated_at: string
}

/** Hotspot almacenado en tour_panoramas.hotspots jsonb. */
export interface TourHotspot {
  id: string
  type?: 'info' | 'link'
  yaw: number
  pitch: number
  tooltip?: string
  /** Si type=link, room destino. */
  target_room?: string
  html?: string
  style?: Record<string, string>
}

// ─── tour_transitions ───────────────────────────────────────
export interface TourTransition {
  id: string
  tenant_id: string
  unit_type_id: string
  from_room: string
  to_room: string
  video_url: string
  storage_path: string | null
  duration_ms: number | null
  poster_url: string | null
  created_at: string
}

// ─── Panorama con relaciones resueltas (joins) ──────────────
export interface TourPanoramaRow extends TourPanorama {
  unit_type: Pick<UnitType, 'id' | 'slug' | 'name' | 'minimap_url'>
  finish_package: Pick<FinishPackage, 'id' | 'slug' | 'name'> | null
}

// ─── Unidades asociadas a una tipología ─────────────────────
export interface TourUnitSummary {
  id: string
  unit_number: string
  floor: string | null
  published_commercial_price: number | null
  status: UnitStatus
  area_total_m2: number | null
  bedrooms: number | null
  bathrooms: number | null
  bathrooms_full?: number | null
  bathrooms_half?: number | null
  spaces?: string[]
  slug: string | null
  typology_code?: string | null
}

export type TourRoomPhoto = {
  slug: string
  label: string
  url: string | null
}

export type TourAssetRef = {
  id: string
  file_name: string
  url: string
}

export type TourTypologyOption = {
  id: string
  code: string
  name: string
  category: string
  panorama: TourAssetRef | null
  renders: TourAssetRef[]
  planos: TourAssetRef[]
  rooms: TourRoomPhoto[]
}

export type TourPublicCatalog = {
  typologies: TourTypologyOption[]
  units: Array<{
    id: string
    unit_code: string
    unit_type_id: string | null
    typology_code: string | null
    floor_label: string | null
    floor_number: number | null
    price: number | null
    status: UnitStatus
    bedrooms: number | null
    bathrooms_full: number | null
    bathrooms_half: number | null
    spaces: string[]
    area_internal_m2: number | null
  }>
}
