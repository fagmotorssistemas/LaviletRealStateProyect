import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionProfile } from '@/lib/auth/session'
import { canAccessPath, canWriteCrm } from '@/lib/inmobiliaria/roleAccess'
import {
  TYPOLOGY_ASSETS_BUCKET,
  TYPOLOGY_ASSET_MAX_BYTES,
  TYPOLOGY_PANO_MAX_BYTES,
  isTypologyAssetKind,
  typologyAssetFileName,
  typologyAssetStoragePath,
} from '@/lib/typology-assets'
import {
  isTourRoomSlug,
  TOUR_PANO_FILE_8192,
  TOUR_PANO_SLUG,
  tourPanoFileName,
  tourRoomFileName,
} from '@/lib/tour/tourRooms'
import {
  deleteTypologyAsset,
  findTypologyAssetByKey,
  insertTypologyAsset,
} from '@/services/inmobiliaria.service'

export const runtime = 'nodejs'
export const maxDuration = 120

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status })
}

export async function POST(request: Request) {
  console.info('[typology-assets] POST /api/typology-assets/upload')
  const session = await getSessionProfile()
  if (!session) return jsonError('No autenticado', 401)
  const canManageTypologyImages =
    canAccessPath(session.profile.role, '/inmobiliaria/inventario') ||
    canAccessPath(session.profile.role, '/inmobiliaria/inventario-2')
  if (!canManageTypologyImages || !canWriteCrm(session.profile.role)) {
    return jsonError('No tienes permiso para subir imágenes', 403)
  }

  const form = await request.formData()
  const typologyCode = String(form.get('typology_code') ?? '').trim()
  const kindRaw = String(form.get('kind') ?? '').trim()
  const uploaded = form.get('file')

  const room = String(form.get('room') ?? '').trim()
  if (!typologyCode) return jsonError('Falta typology_code', 400)
  if (!isTypologyAssetKind(kindRaw)) return jsonError('kind debe ser plano, render o ambiente', 400)
  const isPanoSlot = kindRaw === 'ambiente' && room === TOUR_PANO_SLUG
  if (kindRaw === 'ambiente' && !isTourRoomSlug(room)) {
    return jsonError('Falta el ambiente o el 360 de la tipología', 400)
  }
  if (!(uploaded instanceof Blob) || uploaded.size === 0) return jsonError('Falta el archivo', 400)

  const fileNameHint = uploaded instanceof File ? uploaded.name : 'archivo.png'
  const mime = uploaded.type || ''
  const isImage =
    mime.startsWith('image/') ||
    /\.(png|jpe?g|webp|gif)$/i.test(fileNameHint)
  if (!isImage) return jsonError(`El archivo no es una imagen (${fileNameHint || mime || 'sin tipo'})`, 400)
  const maxBytes = isPanoSlot ? TYPOLOGY_PANO_MAX_BYTES : TYPOLOGY_ASSET_MAX_BYTES
  if (uploaded.size > maxBytes) {
    return jsonError(`El archivo supera ${maxBytes / (1024 * 1024)} MB`, 413)
  }

  const persistKind = kindRaw === 'ambiente' ? 'render' : kindRaw
  const fileName = kindRaw === 'ambiente' ? tourRoomFileName(room) : typologyAssetFileName(fileNameHint)
  const admin = createAdminClient()

  const existing = await findTypologyAssetByKey(admin, typologyCode, persistKind, fileName)
  if (existing && kindRaw !== 'ambiente') {
    return jsonError(
      `Ya existe ${fileName} para ${typologyCode} (${kindRaw}).`,
      409,
      { code: 'duplicate', file_name: fileName },
    )
  }

  const pngBuffer = Buffer.from(await uploaded.arrayBuffer())
  let webpBuffer: Buffer
  let desktopBuffer: Buffer | null = null
  try {
    const image = sharp(pngBuffer, { limitInputPixels: 80_000_000 }).rotate().keepIccProfile()
    if (isPanoSlot) {
      const meta = await image.clone().metadata()
      const ratio = meta.width && meta.height ? meta.width / meta.height : 0
      if (!meta.width || !meta.height || Math.abs(ratio - 2) > 0.15) {
        return jsonError(
          'El 360 debe ser panorámico 2:1. Pedí 8192×4096 a producción.',
          422,
        )
      }
      if (meta.width < 2048) {
        return jsonError(
          'El 360 queda borroso en el celular si es chico. Pedí 8192×4096; el mínimo es 2048×1024.',
          422,
        )
      }
      const serviceWidth = Math.min(4096, meta.width)
      webpBuffer = await image
        .clone()
        .resize(serviceWidth, Math.round(serviceWidth / 2), { fit: 'fill' })
        .webp({ quality: 90, effort: 4 })
        .toBuffer()
      if (meta.width >= 8192) {
        desktopBuffer = await image
          .clone()
          .resize(8192, 4096, { fit: 'fill' })
          .webp({ quality: 88, effort: 4 })
          .toBuffer()
      }
    } else if (kindRaw === 'ambiente') {
      webpBuffer = await image.webp({ quality: 86, effort: 4 }).toBuffer()
    } else {
      webpBuffer = await image.webp({ lossless: true, quality: 100, alphaQuality: 100, effort: 6 }).toBuffer()
    }
  } catch {
    return jsonError('No se pudo convertir el PNG a WebP', 422)
  }

  const uploadedPaths: string[] = []
  const persistFile = async (name: string, buffer: Buffer) => {
    const path = typologyAssetStoragePath(typologyCode, persistKind, name)
    const { error: upErr } = await admin.storage.from(TYPOLOGY_ASSETS_BUCKET).upload(path, buffer, {
      upsert: kindRaw === 'ambiente',
      contentType: 'image/webp',
    })
    if (upErr) {
      if (/bucket not found/i.test(upErr.message)) {
        throw Object.assign(new Error('El bucket typology-assets no existe. Créalo en Supabase antes de subir.'), {
          status: 503,
        })
      }
      if (/already exists|duplicate|resource already/i.test(upErr.message)) {
        throw Object.assign(new Error(`Ya existe ${name} para ${typologyCode} (${kindRaw}).`), {
          status: 409,
          code: 'duplicate',
          file_name: name,
        })
      }
      throw Object.assign(new Error(upErr.message), { status: 500 })
    }
    uploadedPaths.push(path)
    const row = await findTypologyAssetByKey(admin, typologyCode, persistKind, name)
    if (row) return row
    return insertTypologyAsset(admin, {
      typology_code: typologyCode,
      kind: persistKind,
      file_name: name,
      storage_path: path,
    })
  }

  try {
    const asset = await persistFile(fileName, webpBuffer)
    if (isPanoSlot && desktopBuffer) {
      await persistFile(tourPanoFileName(8192), desktopBuffer)
    }
    if (isPanoSlot && !desktopBuffer) {
      const extra = await findTypologyAssetByKey(admin, typologyCode, persistKind, TOUR_PANO_FILE_8192)
      if (extra) await deleteTypologyAsset(admin, extra.id)
    }
    return NextResponse.json({ asset })
  } catch (err) {
    if (uploadedPaths.length > 0) {
      await admin.storage.from(TYPOLOGY_ASSETS_BUCKET).remove(uploadedPaths)
    }
    console.error('insert typology_assets', err)
    const status = err && typeof err === 'object' && 'status' in err ? Number(err.status) : 500
    const code = err && typeof err === 'object' && 'code' in err ? String(err.code) : undefined
    const file_name =
      err && typeof err === 'object' && 'file_name' in err ? String(err.file_name) : undefined
    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'object' && err && 'message' in err
          ? String((err as { message: unknown }).message)
          : 'No se pudo guardar la fila'
    if (code === 'duplicate' || /duplicate|unique|23505/i.test(message)) {
      return jsonError(message, 409, { code: 'duplicate', file_name: file_name ?? fileName })
    }
    return jsonError(message, status || 500)
  }
}
