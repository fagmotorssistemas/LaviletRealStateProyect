import { TYPOLOGY_ASSETS_BUCKET, typologyAssetFileName } from '@/lib/typology-assets'
import { getTypologyAssetPublicUrl } from '@/services/inmobiliaria.service'
import type { SupabaseClient } from '@supabase/supabase-js'
import { amenityCaptionFromFile, sortAmenityItems, type AmenityGalleryItem } from '@/lib/tour/amenityImages'

export const AMENITY_PREFIX = 'amenidades'
export const AMENITY_ORIGINAL_PREFIX = 'amenidades/_original'
export const AMENITY_UPLOAD_MAX_BYTES = 512 * 1024 * 1024

export function amenityWebpName(originalName: string, revision = Date.now()) {
  const base = typologyAssetFileName(originalName).replace(/\.[^.]+$/, '') || 'amenidad'
  return `${base}-r${revision}.webp`
}

export function amenityOriginalPath(fileName: string) {
  return `${AMENITY_ORIGINAL_PREFIX}/${fileName}`
}

export function amenityWebpPath(fileName: string) {
  return `${AMENITY_PREFIX}/${fileName}`
}

export function isAmenityWebpName(name: string) {
  return /^[a-z0-9-]+\.webp$/i.test(name) && !name.includes('/') && !name.includes('..')
}

export async function listStoredAmenities(admin: SupabaseClient): Promise<AmenityGalleryItem[]> {
  const { data, error } = await admin.storage.from(TYPOLOGY_ASSETS_BUCKET).list(AMENITY_PREFIX, {
    limit: 200,
    sortBy: { column: 'name', order: 'asc' },
  })
  if (error) throw new Error(error.message || 'No se pudieron listar las amenidades')

  const items = (data ?? [])
    .filter((item) => item.name && isAmenityWebpName(item.name) && item.id)
    .filter((item) => !/\bsin\s+personas?\b/i.test(item.name))
    .map((item) => {
      const caption = amenityCaptionFromFile(item.name)
      const version = item.updated_at || item.created_at || item.name
      return {
        name: item.name,
        title: caption.title,
        titleEn: caption.titleEn,
        imageUrl: getTypologyAssetPublicUrl(admin, amenityWebpPath(item.name), version),
      }
    })
  return sortAmenityItems(items)
}
