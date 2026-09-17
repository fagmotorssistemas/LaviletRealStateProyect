import { TYPOLOGY_ASSETS_BUCKET, typologyAssetStoragePath } from '@/lib/typology-assets'
import { roomSceneFileName } from '@/lib/tour/roomScene'
import type { TourLightMode } from '@/types/tour'
import type { TypologyAssetKind } from '@/types/inmobiliaria'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  findTypologyAssetByKey,
  insertTypologyAsset,
  deleteTypologyAsset,
  listTypologyAssets,
} from '@/services/inmobiliaria.service'
import type { TypologyAsset } from '@/types/inmobiliaria'

const SHARP_OPTS = {
  limitInputPixels: 268_402_689,
  sequentialRead: true,
  failOn: 'none' as const,
}

export type ConvertSceneInput = {
  typologyCode: string
  persistKind: TypologyAssetKind
  /** Nombre del archivo recién subido (puede ser .jpg/.png/.webp). */
  uploadedFileName: string
  uploadedStoragePath: string
  sceneKey: { room: string; finish: string | null; light: TourLightMode }
  /** Ambientes 360 del tour: WebP lossless. Galería: WebP con calidad alta. */
  mode: 'lossless' | 'quality'
}

/**
 * Descarga el original de Storage, lo convierte a WebP y deja la fila definitiva.
 * Para 360 (ambiente) usa lossless; para galería usa quality 90.
 */
export async function convertUploadedSceneToWebp(
  admin: SupabaseClient,
  input: ConvertSceneInput,
): Promise<TypologyAsset> {
  const { data: blob, error: dlErr } = await admin.storage
    .from(TYPOLOGY_ASSETS_BUCKET)
    .download(input.uploadedStoragePath)
  if (dlErr || !blob) {
    throw Object.assign(new Error(dlErr?.message || 'No se pudo leer el archivo subido'), {
      status: 500,
    })
  }

  const sourceBuffer = Buffer.from(await blob.arrayBuffer())
  const sharpMod = await import('sharp')
  const sharp = sharpMod.default
  if (typeof sharp !== 'function') {
    throw Object.assign(new Error('El conversor de imágenes no está disponible'), { status: 500 })
  }

  const pipeline = sharp(sourceBuffer, SHARP_OPTS).rotate()
  const meta = await pipeline.metadata()
  const webpBuffer =
    input.mode === 'lossless'
      ? await sharp(sourceBuffer, SHARP_OPTS).rotate().webp({ lossless: true, effort: 4 }).toBuffer()
      : await sharp(sourceBuffer, SHARP_OPTS).rotate().webp({ quality: 90, effort: 4 }).toBuffer()

  const webpFileName = roomSceneFileName(input.sceneKey, undefined, 'webp')
  const webpPath = typologyAssetStoragePath(input.typologyCode, input.persistKind, webpFileName)

  const { error: upErr } = await admin.storage.from(TYPOLOGY_ASSETS_BUCKET).upload(webpPath, webpBuffer, {
    upsert: true,
    contentType: 'image/webp',
    cacheControl: '0',
  })
  if (upErr) {
    throw Object.assign(new Error(upErr.message || 'No se pudo guardar el WebP'), { status: 500 })
  }

  // Variante 8192 solo si el original alcanza 8K (sin upscale), solo en 360 lossless.
  if (input.mode === 'lossless' && meta.width && meta.width >= 8192) {
    const hiName = roomSceneFileName(input.sceneKey, 8192, 'webp')
    const hiPath = typologyAssetStoragePath(input.typologyCode, input.persistKind, hiName)
    const hiBuffer = await sharp(sourceBuffer, SHARP_OPTS)
      .rotate()
      .resize(8192, null, { fit: 'inside', withoutEnlargement: true })
      .webp({ lossless: true, effort: 4 })
      .toBuffer()
    await admin.storage.from(TYPOLOGY_ASSETS_BUCKET).upload(hiPath, hiBuffer, {
      upsert: true,
      contentType: 'image/webp',
      cacheControl: '0',
    })
    const existingHi = await findTypologyAssetByKey(
      admin,
      input.typologyCode,
      input.persistKind,
      hiName,
    )
    if (existingHi) {
      await admin
        .from('typology_assets')
        .update({ created_at: new Date().toISOString(), storage_path: hiPath })
        .eq('id', existingHi.id)
    } else {
      await insertTypologyAsset(admin, {
        typology_code: input.typologyCode,
        kind: input.persistKind,
        file_name: hiName,
        storage_path: hiPath,
      })
    }
  }

  // Si el original no era el .webp definitivo, borrar el archivo fuente.
  if (input.uploadedStoragePath !== webpPath) {
    await admin.storage.from(TYPOLOGY_ASSETS_BUCKET).remove([input.uploadedStoragePath])
  }

  let asset = await findTypologyAssetByKey(
    admin,
    input.typologyCode,
    input.persistKind,
    webpFileName,
  )
  if (asset) {
    const stamped = new Date().toISOString()
    await admin
      .from('typology_assets')
      .update({ created_at: stamped, storage_path: webpPath })
      .eq('id', asset.id)
    asset = { ...asset, created_at: stamped, storage_path: webpPath }
  } else {
    asset = await insertTypologyAsset(admin, {
      typology_code: input.typologyCode,
      kind: input.persistKind,
      file_name: webpFileName,
      storage_path: webpPath,
    })
  }

  // Limpiar otras extensiones / tamaños viejos de la misma escena (excepto _8192 recién creado).
  const stem = `${input.sceneKey.room}_${input.sceneKey.finish ? `${input.sceneKey.finish}_` : ''}${input.sceneKey.light}`
  const all = await listTypologyAssets(admin, input.typologyCode)
  const keepNames = new Set([webpFileName, roomSceneFileName(input.sceneKey, 8192, 'webp')])
  const stale = all.filter((row) => {
    if (keepNames.has(row.file_name)) return false
    if (row.kind !== input.persistKind) return false
    const base = row.file_name.replace(/\.[^.]+$/, '').replace(/_(2048|4096|8192)$/i, '')
    return base === stem
  })
  for (const row of stale) {
    try {
      await deleteTypologyAsset(admin, row.id)
    } catch (error) {
      console.error('cleanup stale scene after webp convert', row.file_name, error)
    }
  }

  console.info('[typology-assets] webp convert', {
    typologyCode: input.typologyCode,
    mode: input.mode,
    from: input.uploadedFileName,
    to: webpFileName,
    bytesIn: sourceBuffer.byteLength,
    bytesOut: webpBuffer.byteLength,
    width: meta.width ?? null,
  })

  return asset
}
