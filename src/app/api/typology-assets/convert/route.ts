import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionProfile } from '@/lib/auth/session'
import { canAccessPath, canWriteCrm } from '@/lib/inmobiliaria/roleAccess'
import { TYPOLOGY_ASSETS_BUCKET, isTypologyAssetKind, typologyAssetStoragePath } from '@/lib/typology-assets'
import { isTourRoomSlug, isVistaRoomSlug } from '@/lib/tour/tourRooms'
import type { TourLightMode } from '@/types/tour'
import { convertUploadedSceneToWebp } from '@/lib/typology-assets/convertToWebp'

export const runtime = 'nodejs'
/** Conversión WebP de panoramas grandes; se corre en request aparte para no tumbar el confirm. */
export const maxDuration = 300

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status })
}

/**
 * Convierte un ambiente/galería ya subido a WebP (lossless en 360).
 * Pensado para llamarse en segundo plano tras confirm-upload.
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
      return jsonError('No tienes permiso para convertir imágenes', 403)
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const typologyCode = String(body.typology_code ?? '').trim()
    const kindRaw = String(body.kind ?? '').trim()
    const fileName = String(body.file_name ?? '').trim()
    const storagePathRaw = String(body.storage_path ?? '').trim()

    if (!typologyCode || !fileName) return jsonError('Faltan datos de conversión', 400)
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
    if (!light || (!isAmbienteScene && !isGalleryScene)) {
      return jsonError('Solo se convierten escenas de ambiente o galería', 400)
    }

    const admin = createAdminClient()
    const { error: existsErr } = await admin.storage
      .from(TYPOLOGY_ASSETS_BUCKET)
      .createSignedUrl(storagePath, 30)
    if (existsErr) {
      return jsonError('El archivo no está en Storage para convertir.', 404)
    }

    const asset = await convertUploadedSceneToWebp(admin, {
      typologyCode,
      persistKind,
      uploadedFileName: fileName,
      uploadedStoragePath: storagePath,
      sceneKey: { room, finish, light },
      mode: isAmbienteScene ? 'lossless' : 'quality',
    })

    return NextResponse.json({
      asset,
      converted: true,
      format: 'webp',
      lossless: isAmbienteScene,
    })
  } catch (error) {
    console.error('POST /api/typology-assets/convert', error)
    const message = error instanceof Error ? error.message : 'No se pudo convertir la imagen'
    return jsonError(message, 500)
  }
}
