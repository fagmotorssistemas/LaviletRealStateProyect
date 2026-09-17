import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionProfile } from '@/lib/auth/session'
import { canAccessPath, canWriteCrm } from '@/lib/inmobiliaria/roleAccess'
import { TYPOLOGY_ASSETS_BUCKET } from '@/lib/typology-assets'
import { isTourRoomSlug, isVistaRoomSlug } from '@/lib/tour/tourRooms'
import type { TourLightMode } from '@/types/tour'
import {
  findTypologyAssetByKey,
  insertTypologyAsset,
} from '@/services/inmobiliaria.service'
import { isTypologyAssetKind, typologyAssetStoragePath } from '@/lib/typology-assets'
import { convertUploadedSceneToWebp } from '@/lib/typology-assets/convertToWebp'

export const runtime = 'nodejs'
export const maxDuration = 120

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status })
}

/**
 * Tras subir el archivo directo a Storage:
 * - ambientes 360 → WebP lossless (como antes)
 * - galería → WebP quality 90
 * - resto → registra el original
 */
export async function POST(request: Request) {
  try {
    const session = await getSessionProfile()
    if (!session) return jsonError('No autenticado', 401)
    const canManage = canAccessPath(
      session.profile.role,
      '/inmobiliaria/inventario',
      session.profile.crm_paths,
    )
    if (!canManage || !canWriteCrm(session.profile.role)) {
      return jsonError('No tienes permiso para subir imágenes', 403)
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const typologyCode = String(body.typology_code ?? '').trim()
    const kindRaw = String(body.kind ?? '').trim()
    const fileName = String(body.file_name ?? '').trim()
    const storagePathRaw = String(body.storage_path ?? '').trim()

    if (!typologyCode || !fileName) return jsonError('Faltan datos de la subida', 400)
    if (!isTypologyAssetKind(kindRaw)) {
      return jsonError('kind debe ser plano, render o ambiente', 400)
    }

    const persistKind = kindRaw === 'ambiente' ? 'render' : kindRaw
    const expectedPath = typologyAssetStoragePath(typologyCode, persistKind, fileName)
    const storagePath = storagePathRaw || expectedPath
    if (storagePath !== expectedPath) {
      return jsonError('Ruta de almacenamiento inválida', 400)
    }

    const room = String(body.room ?? '').trim()
    const finishRaw = String(body.finish ?? '').trim()
    const lightRaw = String(body.light ?? '').trim()
    const finish = finishRaw || null
    const light: TourLightMode | null = lightRaw === 'noche' || lightRaw === 'dia' ? lightRaw : null
    const isGalleryScene =
      kindRaw === 'render' && Boolean(room) && Boolean(light) && isVistaRoomSlug(room)
    const isAmbienteScene = kindRaw === 'ambiente' && Boolean(light) && isTourRoomSlug(room)
    const sceneKey =
      (isAmbienteScene || isGalleryScene) && light
        ? { room, finish, light }
        : null

    const admin = createAdminClient()

    const { error: existsErr } = await admin.storage
      .from(TYPOLOGY_ASSETS_BUCKET)
      .createSignedUrl(storagePath, 30)
    if (existsErr) {
      return jsonError('El archivo aún no está en Storage. Reintentá la subida.', 404)
    }

    if (sceneKey) {
      try {
        const asset = await convertUploadedSceneToWebp(admin, {
          typologyCode,
          persistKind,
          uploadedFileName: fileName,
          uploadedStoragePath: storagePath,
          sceneKey,
          mode: isAmbienteScene ? 'lossless' : 'quality',
        })
        return NextResponse.json({
          asset,
          converted: true,
          format: 'webp',
          lossless: isAmbienteScene,
        })
      } catch (error) {
        console.error('webp convert failed, keeping original', error)
        // Si sharp falla, igual registramos el original para no perder la subida.
      }
    }

    let asset = await findTypologyAssetByKey(admin, typologyCode, persistKind, fileName)
    if (asset) {
      const stamped = new Date().toISOString()
      await admin.from('typology_assets').update({ created_at: stamped }).eq('id', asset.id)
      asset = { ...asset, created_at: stamped }
    } else {
      asset = await insertTypologyAsset(admin, {
        typology_code: typologyCode,
        kind: persistKind,
        file_name: fileName,
        storage_path: storagePath,
      })
    }

    return NextResponse.json({ asset, converted: false })
  } catch (error) {
    console.error('POST /api/typology-assets/confirm-upload', error)
    const message = error instanceof Error ? error.message : 'No se pudo confirmar la subida'
    if (/duplicate|unique|23505/i.test(message)) {
      return jsonError(message, 409, { code: 'duplicate' })
    }
    return jsonError(message, 500)
  }
}
