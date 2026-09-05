import type { SupabaseClient } from '@supabase/supabase-js'
import { TYPOLOGY_ASSETS_BUCKET } from '@/lib/typology-assets'
import type { TourPlacedHotspot } from '@/types/tour'

export const TYPOLOGY_HOTSPOTS_FILE = 'tour-hotspots.webp'

export function typologyHotspotsPath(typologyCode: string) {
  return `${typologyCode}/${TYPOLOGY_HOTSPOTS_FILE}`
}

export function parseTypologyHotspots(value: unknown): TourPlacedHotspot[] {
  if (!Array.isArray(value)) return []
  const items: TourPlacedHotspot[] = []
  const seen = new Set<string>()
  for (const row of value) {
    if (!row || typeof row !== 'object') continue
    const item = row as Partial<TourPlacedHotspot>
    const slug = typeof item.slug === 'string' ? item.slug.trim() : ''
    const label = typeof item.label === 'string' ? item.label.trim() : ''
    const yaw = typeof item.yaw === 'number' ? item.yaw : Number(item.yaw)
    const pitch = typeof item.pitch === 'number' ? item.pitch : Number(item.pitch)
    if (!slug || !Number.isFinite(yaw) || !Number.isFinite(pitch)) continue
    if (seen.has(slug)) continue
    seen.add(slug)
    items.push({
      id: typeof item.id === 'string' && item.id ? item.id : slug,
      slug,
      label: label || slug,
      yaw,
      pitch,
    })
  }
  return items
}

function parseHotspotFile(text: string): TourPlacedHotspot[] {
  const trimmed = text.trim()
  try {
    return parseTypologyHotspots(JSON.parse(trimmed))
  } catch {
    const fromDesc = trimmed.match(/<desc>([\s\S]*?)<\/desc>/)
    if (fromDesc?.[1]) {
      try {
        return parseTypologyHotspots(JSON.parse(fromDesc[1]))
      } catch {
        return []
      }
    }
    return []
  }
}

export async function loadTypologyHotspots(
  supabase: SupabaseClient,
  typologyCode: string,
): Promise<TourPlacedHotspot[]> {
  const paths = [typologyHotspotsPath(typologyCode), `${typologyCode}/tour-hotspots.json`]
  for (const path of paths) {
    const { data, error } = await supabase.storage.from(TYPOLOGY_ASSETS_BUCKET).download(path)
    if (error || !data) continue
    try {
      const parsed = parseHotspotFile(await data.text())
      if (parsed.length > 0 || path.endsWith('.webp')) return parsed
    } catch {
      continue
    }
  }
  return []
}

export async function saveTypologyHotspots(
  supabase: SupabaseClient,
  typologyCode: string,
  hotspots: TourPlacedHotspot[],
): Promise<TourPlacedHotspot[]> {
  const next = parseTypologyHotspots(hotspots)
  const { error } = await supabase.storage.from(TYPOLOGY_ASSETS_BUCKET).upload(
    typologyHotspotsPath(typologyCode),
    JSON.stringify(next),
    { upsert: true, contentType: 'image/webp', cacheControl: '0' },
  )
  if (error) throw new Error(error.message || 'No se pudieron guardar los puntos')
  return next
}
