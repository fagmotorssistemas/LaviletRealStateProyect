import { TYPOLOGY_ASSETS_BUCKET, typologyAssetFileName, typologyAssetStoragePath } from '@/lib/typology-assets'
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

async function loadSharp() {
  const sharpMod = await import('sharp')
  const sharp = sharpMod.default
  if (typeof sharp !== 'function') {
    throw Object.assign(new Error('El conversor de imágenes no está disponible'), { status: 500 })
  }
  sharp.concurrency(1)
  sharp.cache(false)
  return sharp
}

/**
 * Effort solo cambia el tiempo y el peso. Sigue siendo VP8L.
 * En fotos de 8K el effort alto tarda varios minutos y la galería se queda con el PNG.
 */
function losslessEffort(width: number, height: number) {
  const pixels = width * height
  if (pixels > 8_000_000) return 0
  return 4
}

function renderBase(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '').replace(/-r\d+$/i, '')
}

/** WebP sin pérdida, tamaño original (solo se endereza la orientación). */
export async function encodeLosslessWebp(sourceBuffer: Buffer) {
  const sharp = await loadSharp()
  const header = await sharp(sourceBuffer, SHARP_OPTS).metadata()
  const headerWidth = header.width || 1
  const headerHeight = header.height || 1
  if (headerWidth <= 1 || headerHeight <= 1) {
    throw Object.assign(new Error('No se pudieron leer las dimensiones de la imagen'), { status: 400 })
  }
  const { data, info } = await sharp(sourceBuffer, SHARP_OPTS)
    .rotate()
    .webp({ lossless: true, effort: losslessEffort(headerWidth, headerHeight) })
    .toBuffer({ resolveWithObject: true })
  const width = info.width || headerWidth
  const height = info.height || headerHeight
  return { buffer: data, width, height }
}

export type ConvertRenderInput = {
  typologyCode: string
  uploadedFileName: string
  uploadedStoragePath: string
  /** Escena de galería. Una foto suelta (área común, local) no la tiene. */
  sceneKey: { room: string; finish: string | null; light: TourLightMode } | null
}

/**
 * Todo render (galería, local o área común) queda en WebP lossless.
 * No genera las variantes 2048/4096 del 360.
 */
export async function convertUploadedRenderToLosslessWebp(
  admin: SupabaseClient,
  input: ConvertRenderInput,
): Promise<TypologyAsset> {
  const { data: blob, error: dlErr } = await admin.storage
    .from(TYPOLOGY_ASSETS_BUCKET)
    .download(input.uploadedStoragePath)
  if (dlErr || !blob) {
    throw Object.assign(new Error(dlErr?.message || 'No se pudo leer el archivo subido'), { status: 500 })
  }

  const sourceBuffer = Buffer.from(await blob.arrayBuffer())
  const sourceRow = await findTypologyAssetByKey(
    admin,
    input.typologyCode,
    'render',
    input.uploadedFileName,
  )
  const sourceStamp = sourceRow?.created_at ?? null
  if (!sourceRow || !sourceStamp) {
    throw Object.assign(new Error('La subida ya no está disponible para convertir'), { status: 409 })
  }

  const encoded = await encodeLosslessWebp(sourceBuffer)
  const revision = Date.now()
  const webpFileName = input.sceneKey
    ? withSceneRevision(roomSceneFileName(input.sceneKey, undefined, 'webp'), revision)
    : withSceneRevision(`${typologyAssetFileName(input.uploadedFileName).replace(/\.[^.]+$/, '')}.webp`, revision)

  const stillSource = await findTypologyAssetByKey(
    admin,
    input.typologyCode,
    'render',
    input.uploadedFileName,
  )
  if (stillSource && stillSource.created_at !== sourceStamp) {
    return stillSource
  }
  if (!stillSource) {
    const current = await listTypologyAssets(admin, input.typologyCode)
    const replacement = current.find(
      (row) =>
        row.kind === 'render' &&
        /\.webp$/i.test(row.file_name) &&
        renderBase(row.file_name) === renderBase(input.uploadedFileName),
    )
    if (replacement) return replacement
  }

  const storagePath = typologyAssetStoragePath(input.typologyCode, 'render', webpFileName)
  const { error: upErr } = await admin.storage.from(TYPOLOGY_ASSETS_BUCKET).upload(storagePath, encoded.buffer, {
    upsert: true,
    contentType: 'image/webp',
    cacheControl: storageCacheControl(webpFileName),
  })
  if (upErr) {
    throw Object.assign(new Error(upErr.message || 'No se pudo guardar el WebP'), { status: 500 })
  }

  const stamped = new Date().toISOString()
  const existing = await findTypologyAssetByKey(admin, input.typologyCode, 'render', webpFileName)
  const asset = existing
    ? { ...existing, created_at: stamped, storage_path: storagePath }
    : await insertTypologyAsset(admin, {
        typology_code: input.typologyCode,
        kind: 'render',
        file_name: webpFileName,
        storage_path: storagePath,
      })
  if (existing) {
    await admin.from('typology_assets').update({ created_at: stamped, storage_path: storagePath }).eq('id', existing.id)
  }

  if (input.uploadedStoragePath !== storagePath) {
    await admin.storage.from(TYPOLOGY_ASSETS_BUCKET).remove([input.uploadedStoragePath])
  }

  const all = await listTypologyAssets(admin, input.typologyCode)
  const stale = all.filter((row) => {
    if (row.id === asset.id || row.file_name === webpFileName) return false
    if (row.kind !== 'render') return false
    if (row.file_name === input.uploadedFileName) return true
    if (!input.sceneKey) return renderBase(row.file_name) === renderBase(webpFileName)
    return fileMatchesScene(row.file_name, input.sceneKey.room, input.sceneKey.finish, input.sceneKey.light, {
      exactRoom: true,
    })
  })
  for (const row of stale) {
    try {
      await deleteTypologyAsset(admin, row.id)
    } catch (error) {
      console.error('cleanup stale render after webp convert', row.file_name, error)
    }
  }

  console.info('[typology-assets] render webp lossless', {
    typologyCode: input.typologyCode,
    from: input.uploadedFileName,
    to: webpFileName,
    bytesIn: sourceBuffer.byteLength,
    bytesOut: encoded.buffer.byteLength,
    width: encoded.width,
  })

  return asset
}

/**
 * 360: WebP del ambiente y variantes 2048 / 4096 / 8192.
 * Los renders de galería no pasan por aquí: van a WebP lossless.
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
