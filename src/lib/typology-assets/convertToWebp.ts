import {
  TYPOLOGY_ASSETS_BUCKET,
  galleryRenderMobileFileName,
  typologyAssetFileName,
  typologyAssetStoragePath,
  typologyRenderOriginalPath,
} from '@/lib/typology-assets'
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

function renderBase(fileName: string) {
  return fileName.replace(/\.[^.]+$/, '').replace(/_2048$/i, '').replace(/-r\d+$/i, '')
}

const RENDER_EDGE = { desktop: 3840, mobile: 2048 } as const
const RENDER_BUDGET = { desktop: 1_500_000, mobile: 600_000 } as const

/** WebP con pérdida, calidad alta. Baja la calidad de a 5 solo si se pasa del tope. */
async function encodeRenderWebp(sourceBuffer: Buffer, edge: number, budget: number) {
  const sharp = await loadSharp()
  let quality = 90
  let encoded: { data: Buffer; info: { width?: number; height?: number } } | null = null
  while (quality >= 70) {
    encoded = await sharp(sourceBuffer, SHARP_OPTS)
      .rotate()
      .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
      .webp({ quality, effort: 5, smartSubsample: true })
      .toBuffer({ resolveWithObject: true })
    if (encoded.data.length <= budget) break
    quality -= 5
  }
  if (!encoded) {
    throw Object.assign(new Error('No se pudo convertir el render'), { status: 500 })
  }
  const width = encoded.info.width || 1
  const height = encoded.info.height || 1
  if (width <= 1 || height <= 1) {
    throw Object.assign(new Error('No se pudieron leer las dimensiones de la imagen'), { status: 400 })
  }
  return { buffer: encoded.data, width, height, quality }
}

export type ConvertRenderInput = {
  typologyCode: string
  uploadedFileName: string
  uploadedStoragePath: string
  /** Escena de galería. Una foto suelta (área común, local) no la tiene. */
  sceneKey: { room: string; finish: string | null; light: TourLightMode } | null
  /** Reconversión: no borra el archivo que ya estaba publicado. */
  keepSource?: boolean
}

/**
 * Render de galería, local o área común: WebP calidad alta a 3840 px
 * y una variante de 2048 px. El original queda en `render/_original`.
 */
export async function convertUploadedRenderToWebp(
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

  if (!input.keepSource && !input.uploadedStoragePath.includes('/_original/')) {
    const originalPath = typologyRenderOriginalPath(input.typologyCode, input.uploadedFileName)
    const ext = (input.uploadedFileName.match(/\.([^.]+)$/i)?.[1] || 'jpg').toLowerCase()
    const contentType =
      ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg'
    const { error: originalErr } = await admin.storage.from(TYPOLOGY_ASSETS_BUCKET).upload(originalPath, sourceBuffer, {
      upsert: true,
      contentType,
      cacheControl: '31536000',
    })
    if (originalErr) {
      throw Object.assign(new Error(originalErr.message || 'No se pudo guardar el original'), { status: 500 })
    }
  }

  const desktop = await encodeRenderWebp(sourceBuffer, RENDER_EDGE.desktop, RENDER_BUDGET.desktop)
  const mobile = await encodeRenderWebp(sourceBuffer, RENDER_EDGE.mobile, RENDER_BUDGET.mobile)
  const revision = Date.now()
  const webpFileName = input.sceneKey
    ? withSceneRevision(roomSceneFileName(input.sceneKey, undefined, 'webp'), revision)
    : withSceneRevision(`${typologyAssetFileName(input.uploadedFileName).replace(/\.[^.]+$/, '')}.webp`, revision)
  const mobileFileName = galleryRenderMobileFileName(webpFileName)

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
  const mobilePath = typologyAssetStoragePath(input.typologyCode, 'render', mobileFileName)
  const publish = async (path: string, fileName: string, buffer: Buffer) => {
    const { error: upErr } = await admin.storage.from(TYPOLOGY_ASSETS_BUCKET).upload(path, buffer, {
      upsert: true,
      contentType: 'image/webp',
      cacheControl: storageCacheControl(fileName),
    })
    if (upErr) {
      throw Object.assign(new Error(upErr.message || 'No se pudo guardar el WebP'), { status: 500 })
    }
  }
  await publish(storagePath, webpFileName, desktop.buffer)
  await publish(mobilePath, mobileFileName, mobile.buffer)

  const stamped = new Date().toISOString()
  let asset: TypologyAsset
  if (input.keepSource && sourceRow) {
    const { error: updErr } = await admin
      .from('typology_assets')
      .update({ file_name: webpFileName, storage_path: storagePath, created_at: stamped })
      .eq('id', sourceRow.id)
    if (updErr) throw Object.assign(new Error(updErr.message || 'No se pudo actualizar el render'), { status: 500 })
    asset = { ...sourceRow, file_name: webpFileName, storage_path: storagePath, created_at: stamped }
  } else {
    const existing = await findTypologyAssetByKey(admin, input.typologyCode, 'render', webpFileName)
    asset = existing
      ? { ...existing, created_at: stamped, storage_path: storagePath }
      : await insertTypologyAsset(admin, {
          typology_code: input.typologyCode,
          kind: 'render',
          file_name: webpFileName,
          storage_path: storagePath,
        })
    if (existing) {
      await admin.from('typology_assets').update({ created_at: stamped, storage_path: storagePath, file_name: webpFileName }).eq('id', existing.id)
    }
  }

  if (!input.keepSource && input.uploadedStoragePath !== storagePath && !input.uploadedStoragePath.includes('/_original/')) {
    await admin.storage.from(TYPOLOGY_ASSETS_BUCKET).remove([input.uploadedStoragePath])
  }

  if (!input.keepSource) {
    const all = await listTypologyAssets(admin, input.typologyCode)
    const stale = all.filter((row) => {
      if (row.id === asset.id || row.file_name === webpFileName || row.file_name === mobileFileName) return false
      if (row.storage_path.includes('/_original/')) return false
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
  }

  console.info('[typology-assets] render webp', {
    typologyCode: input.typologyCode,
    from: input.uploadedFileName,
    to: webpFileName,
    mobile: mobileFileName,
    bytesIn: sourceBuffer.byteLength,
    bytesDesktop: desktop.buffer.byteLength,
    bytesMobile: mobile.buffer.byteLength,
    qualityDesktop: desktop.quality,
    qualityMobile: mobile.quality,
    width: desktop.width,
  })

  return asset
}

/**
 * 360: WebP del ambiente y variantes 2048 / 4096 / 8192.
 * Los renders de galería no pasan por aquí: van a WebP de alta calidad.
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
