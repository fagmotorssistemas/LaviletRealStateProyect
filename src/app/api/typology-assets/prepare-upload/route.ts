import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionProfile } from '@/lib/auth/session'
import { canAccessPath, canWriteCrm } from '@/lib/inmobiliaria/roleAccess'
import { TYPOLOGY_ASSETS_BUCKET } from '@/lib/typology-assets'
import { resolveTypologyUploadMeta } from '@/lib/typology-assets/resolveUpload'
import { findTypologyAssetByKey } from '@/services/inmobiliaria.service'

export const runtime = 'nodejs'

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status })
}

/**
 * Firma una URL de subida directa a Supabase Storage.
 * Evita el límite de body de Vercel (~4.5–100 MB) al no pasar el archivo por Next.
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
    const meta = resolveTypologyUploadMeta({
      typology_code: String(body.typology_code ?? ''),
      kind: String(body.kind ?? ''),
      file_name: String(body.file_name ?? ''),
      mime: body.mime != null ? String(body.mime) : null,
      size: typeof body.size === 'number' ? body.size : Number(body.size),
      room: body.room != null ? String(body.room) : null,
      finish: body.finish != null ? String(body.finish) : null,
      light: body.light != null ? String(body.light) : null,
      plano_variant: body.plano_variant != null ? String(body.plano_variant) : null,
    })

    const admin = createAdminClient()
    const existing = await findTypologyAssetByKey(
      admin,
      meta.typologyCode,
      meta.persistKind,
      meta.fileName,
    )
    if (existing && !meta.upsertScene) {
      return jsonError(
        `Ya existe ${meta.fileName} para ${meta.typologyCode} (${meta.kind}).`,
        409,
        { code: 'duplicate', file_name: meta.fileName },
      )
    }

    const { data, error } = await admin.storage
      .from(TYPOLOGY_ASSETS_BUCKET)
      .createSignedUploadUrl(meta.storagePath, { upsert: meta.upsertScene })

    if (error || !data?.token || !data?.path) {
      const message = error?.message || 'No se pudo firmar la subida'
      if (/bucket not found/i.test(message)) {
        return jsonError(
          'El bucket typology-assets no existe. Créalo en Supabase antes de subir.',
          503,
        )
      }
      return jsonError(message, 500)
    }

    return NextResponse.json({
      bucket: TYPOLOGY_ASSETS_BUCKET,
      path: data.path,
      token: data.token,
      signedUrl: data.signedUrl ?? null,
      file_name: meta.fileName,
      storage_path: meta.storagePath,
      content_type: meta.contentType,
      typology_code: meta.typologyCode,
      kind: meta.kind,
      persist_kind: meta.persistKind,
      upsert: meta.upsertScene,
      scene_key: meta.sceneKey,
    })
  } catch (error) {
    console.error('POST /api/typology-assets/prepare-upload', error)
    const status =
      error && typeof error === 'object' && 'status' in error ? Number(error.status) : 500
    const message = error instanceof Error ? error.message : 'No se pudo preparar la subida'
    return jsonError(message, status || 500)
  }
}
