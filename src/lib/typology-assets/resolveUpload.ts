import {
  isTypologyAssetKind,
  typologyAssetFileName,
  typologyAssetStoragePath,
} from '@/lib/typology-assets'
import { isTourRoomSlug, isVistaRoomSlug, tourRoomFileName } from '@/lib/tour/tourRooms'
import { roomSceneFileName } from '@/lib/tour/roomScene'
import type { TourLightMode } from '@/types/tour'
import type { TypologyAssetKind } from '@/types/inmobiliaria'

export const TYPOLOGY_UPLOAD_MAX_BYTES = 80 * 1024 * 1024

export type TypologyUploadMeta = {
  typologyCode: string
  kind: TypologyAssetKind
  persistKind: TypologyAssetKind
  fileName: string
  storagePath: string
  contentType: string
  upsertScene: boolean
  sceneKey: { room: string; finish: string | null; light: TourLightMode } | null
  room: string
  finish: string | null
  light: TourLightMode | null
  planoVariant: '2d' | '3d' | null
}

export function resolveTypologyUploadMeta(input: {
  typology_code: string
  kind: string
  file_name: string
  mime?: string | null
  size?: number | null
  room?: string | null
  finish?: string | null
  light?: string | null
  plano_variant?: string | null
}): TypologyUploadMeta {
  const typologyCode = String(input.typology_code ?? '').trim()
  const kindRaw = String(input.kind ?? '').trim()
  const room = String(input.room ?? '').trim()
  const finishRaw = String(input.finish ?? '').trim()
  const lightRaw = String(input.light ?? '').trim()
  const finish = finishRaw || null
  const light: TourLightMode | null = lightRaw === 'noche' || lightRaw === 'dia' ? lightRaw : null
  const fileNameHint = String(input.file_name ?? '').trim() || 'archivo.jpg'
  const mime = String(input.mime ?? '').trim()
  const size = typeof input.size === 'number' ? input.size : Number(input.size)

  if (!typologyCode) throw Object.assign(new Error('Falta typology_code'), { status: 400 })
  if (!isTypologyAssetKind(kindRaw)) {
    throw Object.assign(new Error('kind debe ser plano, render o ambiente'), { status: 400 })
  }
  if (kindRaw === 'ambiente' && !isTourRoomSlug(room)) {
    throw Object.assign(new Error('Falta el ambiente o el 360 de la tipología'), { status: 400 })
  }
  if (Number.isFinite(size) && size <= 0) {
    throw Object.assign(new Error('Falta el archivo'), { status: 400 })
  }
  if (Number.isFinite(size) && size > TYPOLOGY_UPLOAD_MAX_BYTES) {
    throw Object.assign(new Error('La imagen supera el máximo de 80 MB'), { status: 413 })
  }

  const isImage =
    mime.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(fileNameHint)
  if (!isImage) {
    throw Object.assign(
      new Error(`El archivo no es una imagen (${fileNameHint || mime || 'sin tipo'})`),
      { status: 400 },
    )
  }

  const hintExt = (fileNameHint.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase()
  const mimeExt =
    mime === 'image/png'
      ? 'png'
      : mime === 'image/webp'
        ? 'webp'
        : mime === 'image/jpeg' || mime === 'image/jpg'
          ? 'jpg'
          : ''
  const sourceExt = (mimeExt || hintExt || 'jpg').replace(/jpeg/, 'jpg')

  const persistKind: TypologyAssetKind = kindRaw === 'ambiente' ? 'render' : kindRaw
  const isGalleryScene =
    kindRaw === 'render' && Boolean(room) && Boolean(light) && isVistaRoomSlug(room)
  const sceneKey =
    ((kindRaw === 'ambiente' || isGalleryScene) && light
      ? { room, finish, light }
      : null) as { room: string; finish: string | null; light: TourLightMode } | null

  const planoVariantRaw = String(input.plano_variant ?? '').trim().toLowerCase()
  const planoVariant = planoVariantRaw === '2d' || planoVariantRaw === '3d' ? planoVariantRaw : null

  let fileName = sceneKey
    ? roomSceneFileName(sceneKey, undefined, sourceExt)
    : kindRaw === 'ambiente'
      ? tourRoomFileName(room, sourceExt)
      : typologyAssetFileName(fileNameHint)
  if (persistKind === 'plano' && planoVariant && !fileName.startsWith(`${planoVariant}-`)) {
    fileName = `${planoVariant}-${fileName}`
  }

  const contentType = mime.startsWith('image/')
    ? mime
    : sourceExt === 'png'
      ? 'image/png'
      : sourceExt === 'webp'
        ? 'image/webp'
        : sourceExt === 'gif'
          ? 'image/gif'
          : 'image/jpeg'

  return {
    typologyCode,
    kind: kindRaw,
    persistKind,
    fileName,
    storagePath: typologyAssetStoragePath(typologyCode, persistKind, fileName),
    contentType,
    upsertScene: Boolean(sceneKey),
    sceneKey,
    room,
    finish,
    light,
    planoVariant,
  }
}
