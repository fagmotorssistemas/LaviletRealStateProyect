import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionProfile } from '@/lib/auth/session'
import { canAccessPath, canWriteCrm } from '@/lib/inmobiliaria/roleAccess'
import { convertSurroundingsPhotoToWebp } from '@/lib/tour/convertFloorPlanToLosslessWebp'
import {
  captureFloorPlanSurroundings,
  loadFloorPlanSurroundings,
  saveFloorPlanSurroundingsLayers,
  uploadFloorPlanSurroundingsOriginal,
  uploadFloorPlanSurroundingsPlan,
} from '@/lib/tour/floorPlanSurroundings'
import { floorPlanStorageKey, isFloorPlanLevel } from '@/lib/tour/floorPlanHotspots'
import { TYPOLOGY_ASSETS_BUCKET } from '@/lib/typology-assets'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|avif|tiff?|bmp)$/i

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

async function assertEditor() {
  const session = await getSessionProfile()
  if (!session) return jsonError('No autenticado', 401)
  const canEdit =
    canAccessPath(session.profile.role, '/inmobiliaria/inventario', session.profile.crm_paths) &&
    canWriteCrm(session.profile.role)
  if (!canEdit) return jsonError('No tienes permiso para editar los alrededores', 403)
  return null
}

export async function GET(request: Request) {
  const denied = await assertEditor()
  if (denied) return denied
  const url = new URL(request.url)
  const typologyCode = url.searchParams.get('typology_code')?.trim() ?? ''
  if (!typologyCode) return jsonError('Falta typology_code', 400)
  const doc = await loadFloorPlanSurroundings(createAdminClient(), typologyCode)
  if (url.searchParams.get('download') === 'capture') {
    if (!doc?.capturePath) return jsonError('Todavía no hay una captura', 404)
    const file = await createAdminClient().storage.from(TYPOLOGY_ASSETS_BUCKET).download(doc.capturePath)
    if (file.error || !file.data) return jsonError(file.error?.message || 'No se pudo leer la captura', 500)
    const name = doc.capturePath.split('/').pop() || 'alrededores-captura.webp'
    const bytes = new Uint8Array(await file.data.arrayBuffer())
    return new NextResponse(bytes, {
      headers: {
        'Content-Type': 'image/webp',
        'Content-Disposition': `attachment; filename="${name}"`,
      },
    })
  }
  return NextResponse.json({ doc })
}

/** Sube la foto original, o guarda una copia recortada de esa original. */
export async function POST(request: Request) {
  const denied = await assertEditor()
  if (denied) return denied

  const contentType = request.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    const body = (await request.json().catch(() => null)) as {
      typology_code?: string
      x?: number
      y?: number
      width?: number
      height?: number
      floor_key?: string
      plan?: {
        centerX?: number
        centerY?: number
        width?: number
        height?: number
        rotation?: number
      } | null
    } | null
    const typologyCode = body?.typology_code?.trim() ?? ''
    if (!typologyCode) return jsonError('Falta typology_code', 400)
    const crop = {
      x: Number(body?.x),
      y: Number(body?.y),
      width: Number(body?.width),
      height: Number(body?.height),
    }
    if (![crop.x, crop.y, crop.width, crop.height].every((value) => Number.isFinite(value))) {
      return jsonError('El recorte no es válido', 400)
    }
    if (crop.width < 2 || crop.height < 2) {
      return jsonError('El marco queda fuera de la foto o es demasiado chico', 400)
    }
    try {
      const result = await captureFloorPlanSurroundings(createAdminClient(), typologyCode, crop, {
        floorKey: body?.floor_key?.trim() || null,
        plan:
          body?.plan &&
          [body.plan.centerX, body.plan.centerY, body.plan.width, body.plan.height].every((value) =>
            Number.isFinite(Number(value)),
          )
            ? {
                centerX: Number(body.plan.centerX),
                centerY: Number(body.plan.centerY),
                width: Number(body.plan.width),
                height: Number(body.plan.height),
                rotation: Number.isFinite(Number(body.plan.rotation)) ? Number(body.plan.rotation) : 0,
              }
            : null,
      })
      const name = `alrededores-${(body?.floor_key || 'captura').replace(/[^a-z0-9-]/gi, '')}.webp`
      return new NextResponse(new Uint8Array(result.image), {
        headers: {
          'Content-Type': 'image/webp',
          'Content-Disposition': `attachment; filename="${name}"`,
        },
      })
    } catch (error) {
      const status =
        error && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
          ? error.status
          : 500
      return jsonError(error instanceof Error ? error.message : 'No se pudo guardar la copia', status)
    }
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (/body|size|exceed|large|limit/i.test(message)) {
      return jsonError('La foto supera el máximo de 150 MB', 413)
    }
    return jsonError('No se pudo leer la foto. Volvé a subirla.', 400)
  }
  const typologyCode = String(form.get('typology_code') ?? '').trim()
  const uploaded = form.get('file')
  if (!typologyCode) return jsonError('Falta typology_code', 400)
  if (!(uploaded instanceof Blob) || uploaded.size === 0) return jsonError('Falta el archivo', 400)
  if (uploaded.size > 150 * 1024 * 1024) return jsonError('La foto supera el máximo de 150 MB', 413)

  const fileName = uploaded instanceof File ? uploaded.name : 'alrededores.png'
  const mime = uploaded.type || ''
  if (mime === 'text/html' || /\.html?$/i.test(fileName)) {
    return jsonError('Subí una imagen de los alrededores, no un HTML.', 400)
  }
  if (!mime.startsWith('image/') && !IMAGE_EXT_RE.test(fileName)) {
    return jsonError('Usá una imagen (PNG, JPG, WebP, GIF, AVIF…).', 400)
  }

  try {
    const source = Buffer.from(await uploaded.arrayBuffer())
    const role = String(form.get('role') ?? 'background')
    const converted = await convertSurroundingsPhotoToWebp(source)
    console.info(
      '[floor-plan-surroundings] upload',
      role,
      source.byteLength,
      '->',
      converted.bytesOut,
      converted.width,
      converted.height,
    )
    if (role === 'plan') {
      const floor = Number(form.get('floor'))
      if (!isFloorPlanLevel(floor)) return jsonError('Elegí un piso para el plano', 400)
      const doc = await uploadFloorPlanSurroundingsPlan(
        createAdminClient(),
        typologyCode,
        floorPlanStorageKey(floor),
        converted.buffer,
        converted.width,
        converted.height,
      )
      return NextResponse.json({ doc })
    }
    const doc = await uploadFloorPlanSurroundingsOriginal(
      createAdminClient(),
      typologyCode,
      converted.buffer,
      converted.width,
      converted.height,
    )
    return NextResponse.json({ doc })
  } catch (error) {
    console.error('[floor-plan-surroundings]', error)
    const status =
      error && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
        ? error.status
        : 500
    return jsonError(error instanceof Error ? error.message : 'No se pudo subir la foto', status)
  }
}

export async function PUT(request: Request) {
  const denied = await assertEditor()
  if (denied) return denied
  const body = (await request.json().catch(() => null)) as {
    typology_code?: string
    background?: { x?: number; y?: number; scale?: number; rotation?: number }
    planLayer?: { x?: number; y?: number; scale?: number; rotation?: number }
  } | null
  const typologyCode = body?.typology_code?.trim() ?? ''
  if (!typologyCode || !body?.background || !body?.planLayer) {
    return jsonError('Falta la posición del fondo o del plano', 400)
  }
  try {
    const doc = await saveFloorPlanSurroundingsLayers(createAdminClient(), typologyCode, {
      background: {
        x: Number(body.background.x) || 0,
        y: Number(body.background.y) || 0,
        scale: Number(body.background.scale) || 1,
        rotation: Number.isFinite(Number(body.background.rotation)) ? Number(body.background.rotation) : 0,
      },
      planLayer: {
        x: Number(body.planLayer.x) || 0,
        y: Number(body.planLayer.y) || 0,
        scale: Number(body.planLayer.scale) || 1,
        rotation: Number.isFinite(Number(body.planLayer.rotation)) ? Number(body.planLayer.rotation) : 0,
      },
    })
    return NextResponse.json({ doc })
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : 'No se pudo guardar la posición', 500)
  }
}
