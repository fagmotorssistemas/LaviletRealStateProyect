import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstructionEditor } from '@/lib/tour/amenityAccess'
import { convertAmenityPhotoToWebp } from '@/lib/tour/convertAmenityPhotoToWebp'
import {
  constructionOriginalPath,
  constructionPublishedPath,
  isConstructionOriginalName,
} from '@/lib/tour/constructionStorage'
import { TYPOLOGY_ASSETS_BUCKET } from '@/lib/typology-assets'

export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: Request) {
  const auth = await requireConstructionEditor()
  if (auth.error) return auth.error

  try {
    const body = (await request.json().catch(() => ({}))) as { storage_path?: string; file_name?: string }
    const fileName = String(body.file_name ?? '').trim()
    const storagePath = String(body.storage_path ?? '').trim()
    if (!isConstructionOriginalName(fileName) || storagePath !== constructionOriginalPath(fileName)) {
      return NextResponse.json({ error: 'Ruta de almacenamiento inválida' }, { status: 400 })
    }

    const admin = createAdminClient()
    const bucket = admin.storage.from(TYPOLOGY_ASSETS_BUCKET)
    const video = /\.(?:mp4|webm|mov)$/i.test(fileName)
    const publishedName = video ? fileName : fileName.replace(/\.[^.]+$/, '.webp')
    const publishedPath = constructionPublishedPath(publishedName)
    if (video) {
      const { error } = await bucket.copy(storagePath, publishedPath)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    } else {
      const { data: blob, error: downloadError } = await bucket.download(storagePath)
      if (downloadError || !blob) {
        return NextResponse.json({ error: downloadError?.message || 'No se pudo leer la foto' }, { status: 404 })
      }
      const converted = await convertAmenityPhotoToWebp(Buffer.from(await blob.arrayBuffer()))
      const { error } = await bucket.upload(publishedPath, converted.buffer, {
        contentType: 'image/webp',
        cacheControl: '31536000',
      })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const { error: removeError } = await bucket.remove([storagePath])
    if (removeError) console.error('No se pudo limpiar el original de obra', removeError)
    const url = bucket.getPublicUrl(publishedPath).data.publicUrl
    return NextResponse.json({ type: video ? 'video' : 'image', url })
  } catch (error) {
    console.error('POST /api/tour/construction-updates/convert', error)
    return NextResponse.json({ error: 'No se pudo procesar el archivo' }, { status: 500 })
  }
}
