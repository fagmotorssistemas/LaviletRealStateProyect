import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionProfile } from '@/lib/auth/session'
import { canAccessPath, canWriteCrm } from '@/lib/inmobiliaria/roleAccess'
import {
  TYPOLOGY_ASSETS_BUCKET,
  TYPOLOGY_ASSET_MAX_BYTES,
  isTypologyAssetKind,
  typologyAssetFileName,
  typologyAssetStoragePath,
} from '@/lib/typology-assets'
import { findTypologyAssetByKey, insertTypologyAsset } from '@/services/inmobiliaria.service'

export const runtime = 'nodejs'
export const maxDuration = 60

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status })
}

export async function POST(request: Request) {
  console.info('[typology-assets] POST /api/typology-assets/upload')
  const session = await getSessionProfile()
  if (!session) return jsonError('No autenticado', 401)
  if (!canAccessPath(session.profile.role, '/inmobiliaria/inventario-2') || !canWriteCrm(session.profile.role)) {
    return jsonError('No tienes permiso para subir imágenes', 403)
  }

  const form = await request.formData()
  const typologyCode = String(form.get('typology_code') ?? '').trim()
  const kindRaw = String(form.get('kind') ?? '').trim()
  const uploaded = form.get('file')

  if (!typologyCode) return jsonError('Falta typology_code', 400)
  if (!isTypologyAssetKind(kindRaw)) return jsonError('kind debe ser plano o render', 400)
  if (!(uploaded instanceof Blob) || uploaded.size === 0) return jsonError('Falta el archivo', 400)

  const fileNameHint = uploaded instanceof File ? uploaded.name : 'archivo.png'
  const mime = uploaded.type || ''
  const isImage =
    mime.startsWith('image/') ||
    /\.(png|jpe?g|webp|gif)$/i.test(fileNameHint)
  if (!isImage) return jsonError(`El archivo no es una imagen (${fileNameHint || mime || 'sin tipo'})`, 400)
  if (uploaded.size > TYPOLOGY_ASSET_MAX_BYTES) {
    return jsonError(`El archivo supera ${TYPOLOGY_ASSET_MAX_BYTES / (1024 * 1024)} MB`, 413)
  }

  const fileName = typologyAssetFileName(fileNameHint)
  const storagePath = typologyAssetStoragePath(typologyCode, kindRaw, fileName)
  const admin = createAdminClient()

  const existing = await findTypologyAssetByKey(admin, typologyCode, kindRaw, fileName)
  if (existing) {
    return jsonError(
      `Ya existe ${fileName} para ${typologyCode} (${kindRaw}).`,
      409,
      { code: 'duplicate', file_name: fileName },
    )
  }

  const pngBuffer = Buffer.from(await uploaded.arrayBuffer())
  let webpBuffer: Buffer
  try {
    webpBuffer = await sharp(pngBuffer, { limitInputPixels: 80_000_000 })
      .webp({ lossless: true })
      .toBuffer()
  } catch {
    return jsonError('No se pudo convertir el PNG a WebP', 422)
  }

  const { error: upErr } = await admin.storage.from(TYPOLOGY_ASSETS_BUCKET).upload(storagePath, webpBuffer, {
    upsert: false,
    contentType: 'image/webp',
  })
  if (upErr) {
    if (/bucket not found/i.test(upErr.message)) {
      return jsonError('El bucket typology-assets no existe. Créalo en Supabase antes de subir.', 503)
    }
    if (/already exists|duplicate|resource already/i.test(upErr.message)) {
      return jsonError(
        `Ya existe ${fileName} para ${typologyCode} (${kindRaw}).`,
        409,
        { code: 'duplicate', file_name: fileName },
      )
    }
    return jsonError(upErr.message, 500)
  }

  try {
    const asset = await insertTypologyAsset(admin, {
      typology_code: typologyCode,
      kind: kindRaw,
      file_name: fileName,
      storage_path: storagePath,
    })
    return NextResponse.json({ asset })
  } catch (err) {
    await admin.storage.from(TYPOLOGY_ASSETS_BUCKET).remove([storagePath])
    const message = err instanceof Error ? err.message : 'No se pudo guardar la fila'
    if (/duplicate|unique|23505/i.test(message)) {
      return jsonError(
        `Ya existe ${fileName} para ${typologyCode} (${kindRaw}).`,
        409,
        { code: 'duplicate', file_name: fileName },
      )
    }
    return jsonError(message, 500)
  }
}
