import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireConstructionEditor } from '@/lib/tour/amenityAccess'
import {
  CONSTRUCTION_UPLOAD_MAX_BYTES,
  constructionFileType,
  constructionOriginalPath,
} from '@/lib/tour/constructionStorage'
import { TYPOLOGY_ASSETS_BUCKET } from '@/lib/typology-assets'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  const auth = await requireConstructionEditor()
  if (auth.error) return auth.error

  try {
    const body = (await request.json().catch(() => ({}))) as { file_name?: string; mime?: string; size?: number }
    const originalName = String(body.file_name ?? '').trim()
    const mime = String(body.mime ?? '').trim()
    const type = constructionFileType(originalName, mime)
    if (!type) return NextResponse.json({ error: 'Formato de foto o video no admitido' }, { status: 400 })
    const size = Number(body.size)
    if (!Number.isFinite(size) || size <= 0 || size > CONSTRUCTION_UPLOAD_MAX_BYTES) {
      return NextResponse.json({ error: 'El archivo supera el máximo de 512 MB' }, { status: 413 })
    }

    const extension = originalName.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase()
    const fileName = `${crypto.randomUUID()}.${extension === 'jpeg' ? 'jpg' : extension}`
    const storagePath = constructionOriginalPath(fileName)
    const admin = createAdminClient()
    const { data, error } = await admin.storage.from(TYPOLOGY_ASSETS_BUCKET).createSignedUploadUrl(storagePath)
    if (error || !data?.token || !data.path) {
      return NextResponse.json({ error: error?.message || 'No se pudo firmar la subida' }, { status: 500 })
    }
    return NextResponse.json({
      bucket: TYPOLOGY_ASSETS_BUCKET,
      path: data.path,
      token: data.token,
      storage_path: storagePath,
      file_name: fileName,
      content_type: mime || (type === 'video' ? 'video/mp4' : 'image/jpeg'),
    })
  } catch (error) {
    console.error('POST /api/tour/construction-updates/prepare', error)
    return NextResponse.json({ error: 'No se pudo preparar la subida' }, { status: 500 })
  }
}
