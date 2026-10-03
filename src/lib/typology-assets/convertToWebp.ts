import { TYPOLOGY_ASSETS_BUCKET, typologyAssetStoragePath } from '@/lib/typology-assets'
import { storageCacheControl } from '@/lib/storage/cacheControl'
import { fileMatchesScene, roomSceneFileName, withSceneRevision } from '@/lib/tour/roomScene'
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

const TOUR_WIDTHS = [4096, 2048] as const

/**
 * Descarga el original de Storage, lo convierte a WebP y deja la fila definitiva.
 * 360: WebP q92 y variantes 2048 / 4096 / 8192. Galería: lado mayor 3200, q88.
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
  const sourceRow = await findTypologyAssetByKey(
    admin,
    input.typologyCode,
    input.persistKind,
    input.uploadedFileName,
  )
  const sourceStamp = sourceRow?.created_at ?? null
  if (!sourceRow || !sourceStamp) {
    throw Object.assign(new Error('La subida ya no está disponible para convertir'), { status: 409 })
  }

  const sharpMod = await import('sharp')
  const sharp = sharpMod.default
  if (typeof sharp !== 'function') {
    throw Object.assign(new Error('El conversor de imágenes no está disponible'), { status: 500 })
  }
  sharp.concurrency(1)

  const pipeline = sharp(sourceBuffer, SHARP_OPTS).rotate()
  const meta = await pipeline.metadata()
  const webpOptions =
    input.mode === 'lossless'
      ? { quality: 92, effort: 4, smartSubsample: true as const }
      : { quality: 88, effort: 4, smartSubsample: true as const }
  const webpBuffer = await sharp(sourceBuffer, SHARP_OPTS)
    .rotate()
    .resize(
      input.mode === 'quality' ? 3200 : 8192,
      input.mode === 'quality' ? 3200 : null,
      { fit: 'inside', withoutEnlargement: true },
    )
    .webp(webpOptions)
    .toBuffer()

  const revision = Date.now()
  const webpFileName = withSceneRevision(roomSceneFileName(input.sceneKey, undefined, 'webp'), revision)

  const stillSource = await findTypologyAssetByKey(
    admin,
    input.typologyCode,
    input.persistKind,
    input.uploadedFileName,
  )
  if (!stillSource || stillSource.created_at !== sourceStamp) {
    console.info('[typology-assets] webp convert skipped, source replaced', {
      typologyCode: input.typologyCode,
      from: input.uploadedFileName,
    })
    return stillSource ?? sourceRow
  }

  const publish = async (fileName: string, buffer: Buffer) => {
    const storagePath = typologyAssetStoragePath(input.typologyCode, input.persistKind, fileName)
    const { error: upErr } = await admin.storage.from(TYPOLOGY_ASSETS_BUCKET).upload(storagePath, buffer, {
      upsert: true,
      contentType: 'image/webp',
      cacheControl: storageCacheControl(fileName),
    })
    if (upErr) {
      throw Object.assign(new Error(upErr.message || 'No se pudo guardar el WebP'), { status: 500 })
    }
    const existing = await findTypologyAssetByKey(admin, input.typologyCode, input.persistKind, fileName)
    const stamped = new Date().toISOString()
    if (existing) {
      await admin.from('typology_assets').update({ created_at: stamped, storage_path: storagePath }).eq('id', existing.id)
      return { ...existing, created_at: stamped, storage_path: storagePath }
    }
    return insertTypologyAsset(admin, {
      typology_code: input.typologyCode,
      kind: input.persistKind,
      file_name: fileName,
      storage_path: storagePath,
    })
  }

  let asset = await publish(webpFileName, webpBuffer)
  const variantNames: string[] = []
  if (input.mode === 'lossless') {
    const fullName = withSceneRevision(roomSceneFileName(input.sceneKey, 8192, 'webp'), revision)
    await publish(fullName, webpBuffer)
    variantNames.push(fullName)
    for (const width of TOUR_WIDTHS) {
      const variantName = withSceneRevision(roomSceneFileName(input.sceneKey, width, 'webp'), revision)
      const variantBuffer = await sharp(sourceBuffer, SHARP_OPTS)
        .rotate()
        .resize(width, null, { fit: 'inside', withoutEnlargement: true })
        .webp(webpOptions)
        .toBuffer()
      await publish(variantName, variantBuffer)
      variantNames.push(variantName)
    }
  }

  const webpPath = typologyAssetStoragePath(input.typologyCode, input.persistKind, webpFileName)
  if (input.uploadedStoragePath !== webpPath) {
    await admin.storage.from(TYPOLOGY_ASSETS_BUCKET).remove([input.uploadedStoragePath])
  }

  const all = await listTypologyAssets(admin, input.typologyCode)
  const keepNames = new Set([webpFileName, ...variantNames])
  const stale = all.filter((row) => {
    if (keepNames.has(row.file_name) || row.id === asset.id) return false
    if (row.kind !== input.persistKind) return false
    return fileMatchesScene(row.file_name, input.sceneKey.room, input.sceneKey.finish, input.sceneKey.light, {
      exactRoom: true,
    })
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
