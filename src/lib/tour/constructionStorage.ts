import type { SupabaseClient } from '@supabase/supabase-js'
import { TYPOLOGY_ASSETS_BUCKET } from '@/lib/typology-assets'
import type { ConstructionMedia } from './constructionProgress'

export const CONSTRUCTION_PREFIX = 'obra'
export const CONSTRUCTION_ORIGINAL_PREFIX = 'obra/_original'
export const CONSTRUCTION_UPLOAD_MAX_BYTES = 512 * 1024 * 1024

const mediaExtension = /\.(jpe?g|png|webp|gif|mp4|webm|mov)$/i
const storedName = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpe?g|png|webp|gif|mp4|webm|mov)$/i
const publishedName = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:webp|mp4|webm|mov)$/i

export function constructionFileType(name: string, mime: string): 'image' | 'video' | null {
  const extension = name.match(mediaExtension)?.[1]?.toLowerCase()
  if (!extension) return null
  const type = ['mp4', 'webm', 'mov'].includes(extension) ? 'video' : 'image'
  if (mime && !mime.startsWith(`${type}/`) && !(extension === 'mov' && mime === 'application/octet-stream')) return null
  return type
}

export function constructionOriginalPath(name: string) {
  return `${CONSTRUCTION_ORIGINAL_PREFIX}/${name}`
}

export function constructionPublishedPath(name: string) {
  return `${CONSTRUCTION_PREFIX}/${name}`
}

export function isConstructionOriginalName(name: string) {
  return storedName.test(name)
}

export function constructionPublicPath(admin: SupabaseClient, media: ConstructionMedia): string | null {
  try {
    const actual = new URL(media.url)
    const base = new URL(admin.storage.from(TYPOLOGY_ASSETS_BUCKET).getPublicUrl(`${CONSTRUCTION_PREFIX}/`).data.publicUrl)
    if (actual.origin !== base.origin || !actual.pathname.startsWith(base.pathname) || actual.search || actual.hash) return null
    const name = actual.pathname.slice(base.pathname.length)
    if (!publishedName.test(name)) return null
    const expectedType = /\.webp$/i.test(name) ? 'image' : 'video'
    return expectedType === media.type ? constructionPublishedPath(name) : null
  } catch {
    return null
  }
}
