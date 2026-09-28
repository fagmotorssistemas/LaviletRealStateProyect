import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionProfile } from '@/lib/auth/session'
import { canAccessPath, canWriteCrm } from '@/lib/inmobiliaria/roleAccess'
import { FLOOR_PLAN_FLOORS, isFloorPlanLevel } from '@/lib/tour/floorPlanHotspots'
import {
  cleanupOldFloorPlanMedia,
  deleteFloorPlanFloor,
  deleteFloorPlanImage,
  floorPlanVariantHasMedia,
  listFloorPlanFloorSummaries,
  loadFloorPlanZones,
  parseFloorPlanZonesDoc,
  saveFloorPlanZones,
  uploadFloorPlanImage,
  withFloorPlanVariants,
  type FloorPlanVariant,
  type FloorPlanZonesDoc,
} from '@/lib/tour/floorPlanZones'
import { invalidateFloorPlanHtmlMemory } from '@/lib/tour/floorPlanHtmlMemory'
import { convertFloorPlanToLosslessWebp } from '@/lib/tour/convertFloorPlanToLosslessWebp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const FLOOR_PLAN_IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|avif|tiff?|bmp)$/i

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
    invalidateFloorPlanHtmlMemory(typologyCode, floor)
    return NextResponse.json({ ok: true, floor, scope, variant })
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'No se pudo eliminar', 500)
  }
}

/** Sube imagen del plano (2D/3D). Se guarda siempre como WebP lossless. HTML ya no se acepta. */
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
  if (uploaded.size > maxBytes) return jsonError('El archivo supera el máximo de 40 MB', 413)

  const fileNameHint = uploaded instanceof File ? uploaded.name : 'plano.png'
  const mime = uploaded.type || ''
  const isHtml =
    mime === 'text/html' ||
    mime === 'application/xhtml+xml' ||
    /\.html?$/i.test(fileNameHint)
  if (isHtml) {
    return jsonError(
      'Los planos 3D ya no usan HTML. Subí una imagen (PNG, JPG, WebP, etc.); se convierte a WebP sin pérdida.',
      400,
    )
  }

  const isImage = mime.startsWith('image/') || FLOOR_PLAN_IMAGE_EXT_RE.test(fileNameHint)
  if (!isImage) {
    return jsonError(
      `Archivo no válido (${fileNameHint || mime || 'sin tipo'}). Usá una imagen (PNG, JPG, WebP, GIF, AVIF…).`,
      400,
    )
  }

  const sourceBuffer = Buffer.from(await uploaded.arrayBuffer())

  let outBuffer: Buffer
  let imageWidth = 1
  let imageHeight = 1
  try {
    const converted = await convertFloorPlanToLosslessWebp(sourceBuffer)
    outBuffer = converted.buffer
    imageWidth = converted.width
    imageHeight = converted.height
    console.info('[floor-plan-zones] webp lossless', {
      typologyCode,
      floor,
      variant,
      from: fileNameHint,
      bytesIn: converted.bytesIn,
      bytesOut: converted.bytesOut,
      width: imageWidth,
      height: imageHeight,
    })
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'No se pudo convertir la imagen a WebP'
    const status =
      error && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
        ? error.status
        : 500
    return jsonError(message, status)
  }

  try {
    const admin = createAdminClient()
    const uploadedImage = await uploadFloorPlanImage(
      admin,
      typologyCode,
      floor,
      outBuffer,
      'image/webp',
      'webp',
      variant,
      { cleanupOld: false },
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
            '2d': { imageUrl: null, htmlUrl: null, imageWidth: 1, imageHeight: 1 },
            '3d': { imageUrl: null, htmlUrl: null, imageWidth: 1, imageHeight: 1 },
          },
          zones: [],
          updatedAt: new Date().toISOString(),
        })

    const media = {
      imageUrl: uploadedImage.publicUrl,
      htmlUrl: null as string | null,
      imageWidth: imageWidth > 1 ? imageWidth : base.variants[variant].imageWidth || 1,
      imageHeight: imageHeight > 1 ? imageHeight : base.variants[variant].imageHeight || 1,
    }
    const variants = {
      ...base.variants,
      [variant]: media,
    }
    const preferred = floorPlanVariantHasMedia(variants['2d']) ? variants['2d'] : variants['3d']

    const doc = await saveFloorPlanZones(admin, {
      ...base,
      variants,
      imageUrl: preferred.imageUrl,
      imageWidth: preferred.imageWidth || 1,
      imageHeight: preferred.imageHeight || 1,
      zones: base.zones,
      updatedAt: new Date().toISOString(),
    })

    // Limpiar viejos (incl. HTML legado) recién después de apuntar el JSON al WebP nuevo.
    await cleanupOldFloorPlanMedia(admin, typologyCode, floor, variant, uploadedImage.path)
    invalidateFloorPlanHtmlMemory(typologyCode, floor)

    return NextResponse.json({
      imageUrl: uploadedImage.publicUrl,
      htmlUrl: null,
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
