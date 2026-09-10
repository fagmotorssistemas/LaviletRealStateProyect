import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionProfile } from '@/lib/auth/session'
import { canAccessPath, canWriteCrm } from '@/lib/inmobiliaria/roleAccess'
import { FLOOR_PLAN_FLOORS, isFloorPlanLevel } from '@/lib/tour/floorPlanHotspots'
import {
  deleteFloorPlanFloor,
  deleteFloorPlanImage,
  listFloorPlanFloorSummaries,
  loadFloorPlanZones,
  parseFloorPlanZonesDoc,
  saveFloorPlanZones,
  uploadFloorPlanImage,
  withFloorPlanVariants,
  type FloorPlanVariant,
  type FloorPlanZonesDoc,
} from '@/lib/tour/floorPlanZones'

export const runtime = 'nodejs'
export const maxDuration = 120

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

async function assertEditor() {
  const session = await getSessionProfile()
  if (!session) return jsonError('No autenticado', 401)
  const canEdit =
    canAccessPath(session.profile.role, '/inmobiliaria/inventario', session.profile.crm_paths) &&
    canWriteCrm(session.profile.role)
  if (!canEdit) return jsonError('No tienes permiso para editar zonas de piso', 403)
  return null
}

export async function GET(request: Request) {
  const denied = await assertEditor()
  if (denied) return denied
  const url = new URL(request.url)
  const typologyCode = url.searchParams.get('typology_code')?.trim() ?? ''
  if (!typologyCode) return jsonError('Falta typology_code', 400)

  if (url.searchParams.get('list') === '1') {
    const floors = await listFloorPlanFloorSummaries(
      createAdminClient(),
      typologyCode,
      FLOOR_PLAN_FLOORS,
    )
    return NextResponse.json({ floors })
  }

  const floor = Number(url.searchParams.get('floor') ?? '')
  if (!isFloorPlanLevel(floor)) return jsonError('Falta floor válido', 400)
  const doc = await loadFloorPlanZones(createAdminClient(), typologyCode, floor)
  return NextResponse.json({ doc })
}

export async function PUT(request: Request) {
  const denied = await assertEditor()
  if (denied) return denied
  const body = (await request.json().catch(() => null)) as { doc?: unknown } | null
  const parsed = parseFloorPlanZonesDoc(body?.doc)
  if (!parsed) return jsonError('Documento de zonas inválido', 400)
  try {
    const doc = await saveFloorPlanZones(createAdminClient(), parsed as FloorPlanZonesDoc)
    return NextResponse.json({ doc })
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'No se pudo guardar', 500)
  }
}

export async function DELETE(request: Request) {
  const denied = await assertEditor()
  if (denied) return denied
  const url = new URL(request.url)
  const typologyCode = url.searchParams.get('typology_code')?.trim() ?? ''
  const floor = Number(url.searchParams.get('floor') ?? '')
  const scope = url.searchParams.get('scope')?.trim() || 'image'
  const variantRaw = url.searchParams.get('variant')?.trim() || '2d'
  const variant: FloorPlanVariant = variantRaw === '3d' ? '3d' : '2d'
  if (!typologyCode) return jsonError('Falta typology_code', 400)
  if (!isFloorPlanLevel(floor)) return jsonError('Falta floor válido', 400)

  try {
    const admin = createAdminClient()
    if (scope === 'all') {
      await deleteFloorPlanFloor(admin, typologyCode, floor)
    } else {
      await deleteFloorPlanImage(admin, typologyCode, floor, variant)
    }
    return NextResponse.json({ ok: true, floor, scope, variant })
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'No se pudo eliminar', 500)
  }
}

/** Sube la imagen del plano de un piso (reemplaza la anterior de ese piso). */
export async function POST(request: Request) {
  const denied = await assertEditor()
  if (denied) return denied

  const form = await request.formData().catch(() => null)
  if (!form) return jsonError('Formulario inválido', 400)

  const typologyCode = String(form.get('typology_code') ?? '').trim()
  const floor = Number(form.get('floor') ?? '')
  const variantRaw = String(form.get('variant') ?? '2d').trim()
  const variant: FloorPlanVariant = variantRaw === '3d' ? '3d' : '2d'
  const uploaded = form.get('file')

  if (!typologyCode) return jsonError('Falta typology_code', 400)
  if (!isFloorPlanLevel(floor)) return jsonError('Falta floor válido', 400)
  if (!(uploaded instanceof Blob) || uploaded.size === 0) return jsonError('Falta el archivo', 400)

  const maxBytes = 40 * 1024 * 1024
  if (uploaded.size > maxBytes) return jsonError('La imagen supera el máximo de 40 MB', 413)

  const fileNameHint = uploaded instanceof File ? uploaded.name : 'plano.png'
  const mime = uploaded.type || ''
  const isImage =
    mime.startsWith('image/') || /\.(png|jpe?g|webp|gif)$/i.test(fileNameHint)
  if (!isImage) {
    return jsonError(`El archivo no es una imagen (${fileNameHint || mime || 'sin tipo'})`, 400)
  }

  const sourceBuffer = Buffer.from(await uploaded.arrayBuffer())
  let outBuffer: Buffer = sourceBuffer
  let contentType = mime.startsWith('image/') ? mime : 'image/jpeg'
  let ext = 'jpg'
  let imageWidth = 1
  let imageHeight = 1

  try {
    const sharpMod = await import('sharp')
    const sharp = sharpMod.default
    if (typeof sharp === 'function') {
      const sharpOpts = {
        limitInputPixels: 268_402_689,
        sequentialRead: true,
        failOn: 'none' as const,
      }
      const meta = await sharp(sourceBuffer, sharpOpts).rotate().metadata()
      imageWidth = meta.width || 1
      imageHeight = meta.height || 1
      outBuffer = await sharp(sourceBuffer, sharpOpts).rotate().webp({ quality: 90, effort: 3 }).toBuffer()
      contentType = 'image/webp'
      ext = 'webp'
    }
  } catch (error) {
    console.error('floor-plan-zones image sharp skipped', error)
    const hintExt = (fileNameHint.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase()
    ext = (hintExt === 'jpeg' ? 'jpg' : hintExt) || 'jpg'
  }

  try {
    const admin = createAdminClient()
    const uploadedImage = await uploadFloorPlanImage(
      admin,
      typologyCode,
      floor,
      outBuffer,
      contentType,
      ext,
      variant,
    )

    const existing = await loadFloorPlanZones(admin, typologyCode, floor)
    const base = existing
      ? withFloorPlanVariants(existing)
      : withFloorPlanVariants({
          floor,
          typologyCode,
          imageUrl: null,
          imageWidth: 1,
          imageHeight: 1,
          variants: {
            '2d': { imageUrl: null, imageWidth: 1, imageHeight: 1 },
            '3d': { imageUrl: null, imageWidth: 1, imageHeight: 1 },
          },
          zones: [],
          updatedAt: new Date().toISOString(),
        })

    const media = {
      imageUrl: uploadedImage.publicUrl,
      imageWidth: imageWidth > 1 ? imageWidth : base.variants[variant].imageWidth || 1,
      imageHeight: imageHeight > 1 ? imageHeight : base.variants[variant].imageHeight || 1,
    }
    const variants = {
      ...base.variants,
      [variant]: media,
    }
    const preferred = variants['2d'].imageUrl ? variants['2d'] : variants['3d']

    const doc = await saveFloorPlanZones(admin, {
      ...base,
      variants,
      imageUrl: preferred.imageUrl,
      imageWidth: preferred.imageWidth || 1,
      imageHeight: preferred.imageHeight || 1,
      zones: base.zones,
      updatedAt: new Date().toISOString(),
    })

    return NextResponse.json({
      imageUrl: uploadedImage.publicUrl,
      path: uploadedImage.path,
      floor,
      typologyCode,
      variant,
      doc,
    })
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'No se pudo subir el plano', 500)
  }
}
