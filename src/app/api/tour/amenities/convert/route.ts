import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAmenityEditor } from '@/lib/tour/amenityAccess'
import { convertAmenityPhotoToWebp } from '@/lib/tour/convertAmenityPhotoToWebp'
import {
  amenityOriginalPath,
  amenityWebpName,
  amenityWebpPath,
  isAmenityWebpName,
} from '@/lib/tour/amenityStorage'
import { TYPOLOGY_ASSETS_BUCKET } from '@/lib/typology-assets'

export const runtime = 'nodejs'
export const maxDuration = 300

/** Convierte la foto a WebP de galería y borra el archivo fuente. */
export async function POST(request: Request) {
  try {
    const auth = await requireAmenityEditor()
    if (auth.error) return auth.error

    const body = (await request.json().catch(() => ({}))) as {
      storage_path?: string
      file_name?: string
      original_name?: string
    }
    const storagePath = String(body.storage_path ?? '').trim()
    const fileName = String(body.file_name ?? '').trim()
    const originalName = String(body.original_name ?? fileName).trim()
    if (!storagePath || storagePath !== amenityOriginalPath(fileName)) {
      return NextResponse.json({ error: 'Ruta de almacenamiento inválida' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { data: blob, error: dlErr } = await admin.storage.from(TYPOLOGY_ASSETS_BUCKET).download(storagePath)
    if (dlErr || !blob) {
      return NextResponse.json({ error: dlErr?.message || 'No se pudo leer el archivo subido' }, { status: 404 })
    }

    const converted = await convertAmenityPhotoToWebp(Buffer.from(await blob.arrayBuffer()))
    const webpName = amenityWebpName(originalName)
    if (!isAmenityWebpName(webpName)) {
      return NextResponse.json({ error: 'No se pudo nombrar el WebP' }, { status: 400 })
    }
    const webpPath = amenityWebpPath(webpName)
    const { error: upErr } = await admin.storage.from(TYPOLOGY_ASSETS_BUCKET).upload(webpPath, converted.buffer, {
      upsert: true,
      contentType: 'image/webp',
      cacheControl: '31536000',
    })
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

    await admin.storage.from(TYPOLOGY_ASSETS_BUCKET).remove([storagePath])
    return NextResponse.json({ ok: true, name: webpName, format: 'webp' })
  } catch (error) {
    console.error('POST /api/tour/amenities/convert', error)
    const message = error instanceof Error ? error.message : 'No se pudo convertir la imagen'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
