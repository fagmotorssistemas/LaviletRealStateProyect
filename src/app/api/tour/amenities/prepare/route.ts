import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireAmenityEditor } from '@/lib/tour/amenityAccess'
import { AMENITY_UPLOAD_MAX_BYTES, amenityOriginalPath } from '@/lib/tour/amenityStorage'
import { TYPOLOGY_ASSETS_BUCKET, typologyAssetFileName } from '@/lib/typology-assets'

export const runtime = 'nodejs'

/** Firma la subida del original. La conversión a WebP va en /convert. */
export async function POST(request: Request) {
  try {
    const auth = await requireAmenityEditor()
    if (auth.error) return auth.error

    const body = (await request.json().catch(() => ({}))) as {
      file_name?: string
      mime?: string | null
      size?: number
    }
    const originalName = String(body.file_name ?? '').trim()
    const size = Number(body.size)
    if (!originalName) return NextResponse.json({ error: 'Falta el archivo' }, { status: 400 })
    if (!Number.isFinite(size) || size <= 0 || size > AMENITY_UPLOAD_MAX_BYTES) {
      return NextResponse.json({ error: 'La imagen supera el máximo de 512 MB' }, { status: 413 })
    }

    const storedName = `${Date.now()}-${typologyAssetFileName(originalName)}`
    const storagePath = amenityOriginalPath(storedName)
    const admin = createAdminClient()
    const { data, error } = await admin.storage
      .from(TYPOLOGY_ASSETS_BUCKET)
      .createSignedUploadUrl(storagePath, { upsert: true })

    if (error || !data?.token || !data.path) {
      return NextResponse.json(
        { error: error?.message || 'No se pudo firmar la subida' },
        { status: 500 },
      )
    }

    return NextResponse.json({
      bucket: TYPOLOGY_ASSETS_BUCKET,
      path: data.path,
      token: data.token,
      storage_path: storagePath,
      file_name: storedName,
      original_name: originalName,
      content_type: body.mime || 'image/jpeg',
    })
  } catch (error) {
    console.error('POST /api/tour/amenities/prepare', error)
    const message = error instanceof Error ? error.message : 'No se pudo preparar la subida'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
