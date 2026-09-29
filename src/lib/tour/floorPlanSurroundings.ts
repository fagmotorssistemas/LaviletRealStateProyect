/**
 * Foto real de los alrededores del edificio.
 * La original se conserva. Cada captura es una copia recortada en WebP sin pérdida.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { TYPOLOGY_ASSETS_BUCKET } from '@/lib/typology-assets'
import {
  DEFAULT_SURROUNDINGS_LAYER,
  type FloorPlanSurroundingsDoc,
  type SurroundingsCrop,
  type SurroundingsLayer,
  type SurroundingsPlanFile,
  type SurroundingsPlanPlacement,
} from '@/lib/tour/floorPlanSurroundingsShared'

export type {
  FloorPlanSurroundingsDoc,
  SurroundingsCrop,
  SurroundingsLayer,
  SurroundingsPlanFile,
}
export { DEFAULT_SURROUNDINGS_LAYER }

const ORIGINAL_NAME_RE = /^floor-surroundings-v\d+\.webp$/i
const CAPTURE_NAME_RE = /^floor-surroundings-capture-v\d+\.webp$/i
const PLAN_NAME_RE = /^floor-surroundings-plan-([a-z0-9]+)-v\d+\.webp$/i

function layerOf(value: unknown): SurroundingsLayer {
  const row = value && typeof value === 'object' ? (value as Partial<SurroundingsLayer>) : {}
  const scale = Number(row.scale)
  return {
    x: Number.isFinite(Number(row.x)) ? Number(row.x) : 0,
    y: Number.isFinite(Number(row.y)) ? Number(row.y) : 0,
    scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
    rotation: Number.isFinite(Number(row.rotation)) ? Number(row.rotation) : 0,
  }
}

function plansOf(value: unknown): Record<string, SurroundingsPlanFile> {
  if (!value || typeof value !== 'object') return {}
  const out: Record<string, SurroundingsPlanFile> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue
    const row = raw as Partial<SurroundingsPlanFile>
    if (typeof row.url !== 'string' || typeof row.path !== 'string') continue
    out[key] = {
      path: row.path,
      url: row.url,
      width: Number(row.width) > 1 ? Number(row.width) : 1,
      height: Number(row.height) > 1 ? Number(row.height) : 1,
    }
  }
  return out
}

export function emptyFloorPlanSurroundings(typologyCode: string): FloorPlanSurroundingsDoc {
  return {
    typologyCode,
    originalPath: null,
    originalUrl: null,
    originalWidth: 1,
    originalHeight: 1,
    capturePath: null,
    captureUrl: null,
    captureWidth: 1,
    captureHeight: 1,
    background: { ...DEFAULT_SURROUNDINGS_LAYER },
    planLayer: { ...DEFAULT_SURROUNDINGS_LAYER },
    plans: {},
    updatedAt: new Date().toISOString(),
  }
}

export function floorPlanSurroundingsPath(typologyCode: string) {
  return `${typologyCode}/floor-surroundings.json`
}

function publicUrl(supabase: SupabaseClient, path: string) {
  return supabase.storage.from(TYPOLOGY_ASSETS_BUCKET).getPublicUrl(path).data.publicUrl
}

function parseDoc(raw: unknown, typologyCode: string): FloorPlanSurroundingsDoc | null {
  if (!raw || typeof raw !== 'object') return null
  const row = raw as Partial<FloorPlanSurroundingsDoc>
  return {
    ...emptyFloorPlanSurroundings(typologyCode),
    ...row,
    typologyCode,
    originalPath: typeof row.originalPath === 'string' ? row.originalPath : null,
    originalUrl: typeof row.originalUrl === 'string' ? row.originalUrl : null,
    originalWidth: Number(row.originalWidth) > 1 ? Number(row.originalWidth) : 1,
    originalHeight: Number(row.originalHeight) > 1 ? Number(row.originalHeight) : 1,
    capturePath: typeof row.capturePath === 'string' ? row.capturePath : null,
    captureUrl: typeof row.captureUrl === 'string' ? row.captureUrl : null,
    captureWidth: Number(row.captureWidth) > 1 ? Number(row.captureWidth) : 1,
    captureHeight: Number(row.captureHeight) > 1 ? Number(row.captureHeight) : 1,
    background: layerOf(row.background),
    planLayer: layerOf(row.planLayer),
    plans: plansOf(row.plans),
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : new Date().toISOString(),
  }
}

export async function loadFloorPlanSurroundings(
  supabase: SupabaseClient,
  typologyCode: string,
): Promise<FloorPlanSurroundingsDoc | null> {
  const { data, error } = await supabase.storage
    .from(TYPOLOGY_ASSETS_BUCKET)
    .download(floorPlanSurroundingsPath(typologyCode))
  if (error || !data) return null
  try {
    return parseDoc(JSON.parse(await data.text()), typologyCode)
  } catch {
    return null
  }
}

async function saveFloorPlanSurroundings(
  supabase: SupabaseClient,
  doc: FloorPlanSurroundingsDoc,
): Promise<FloorPlanSurroundingsDoc> {
  const next = { ...doc, updatedAt: new Date().toISOString() }
  const { error } = await supabase.storage.from(TYPOLOGY_ASSETS_BUCKET).upload(
    floorPlanSurroundingsPath(doc.typologyCode),
    JSON.stringify(next),
    { upsert: true, contentType: 'image/webp', cacheControl: '0' },
  )
  if (error) throw new Error(error.message || 'No se pudo guardar la foto de alrededores')
  return next
}

async function listNames(supabase: SupabaseClient, typologyCode: string) {
  const { data } = await supabase.storage.from(TYPOLOGY_ASSETS_BUCKET).list(typologyCode, {
    limit: 1000,
  })
  return (data ?? []).map((item) => item.name).filter(Boolean)
}

async function removeNamed(
  supabase: SupabaseClient,
  typologyCode: string,
  names: string[],
  keepPath: string | null,
) {
  const paths = names
    .map((name) => `${typologyCode}/${name}`)
    .filter((path) => path !== keepPath)
  if (paths.length > 0) {
    await supabase.storage.from(TYPOLOGY_ASSETS_BUCKET).remove(paths)
  }
}

export async function uploadFloorPlanSurroundingsOriginal(
  supabase: SupabaseClient,
  typologyCode: string,
  buffer: Buffer,
  width: number,
  height: number,
): Promise<FloorPlanSurroundingsDoc> {
  const path = `${typologyCode}/floor-surroundings-v${Date.now()}.webp`
  let lastError = 'No se pudo subir la foto de alrededores'
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { error } = await supabase.storage.from(TYPOLOGY_ASSETS_BUCKET).upload(path, buffer, {
      upsert: attempt > 0,
      contentType: 'image/webp',
      cacheControl: '0',
    })
    if (!error) {
      lastError = ''
      break
    }
    lastError = error.message || lastError
    await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)))
  }
  if (lastError) throw new Error(lastError)

  const names = await listNames(supabase, typologyCode)
  await removeNamed(
    supabase,
    typologyCode,
    names.filter((name) => ORIGINAL_NAME_RE.test(name) || CAPTURE_NAME_RE.test(name)),
    path,
  )

  const prev = (await loadFloorPlanSurroundings(supabase, typologyCode)) ?? emptyFloorPlanSurroundings(typologyCode)
  return saveFloorPlanSurroundings(supabase, {
    ...prev,
    typologyCode,
    originalPath: path,
    originalUrl: publicUrl(supabase, path),
    originalWidth: width,
    originalHeight: height,
    capturePath: null,
    captureUrl: null,
    captureWidth: 1,
    captureHeight: 1,
  })
}

function clampCrop(crop: SurroundingsCrop, imageWidth: number, imageHeight: number) {
  const left = Math.max(0, Math.min(imageWidth - 2, Math.round(crop.x)))
  const top = Math.max(0, Math.min(imageHeight - 2, Math.round(crop.y)))
  const width = Math.max(2, Math.min(imageWidth - left, Math.round(crop.width)))
  const height = Math.max(2, Math.min(imageHeight - top, Math.round(crop.height)))
  return { left, top, width, height }
}

async function clippedLayer(
  input: Buffer,
  left: number,
  top: number,
  canvasW: number,
  canvasH: number,
) {
  const sharpMod = await import('sharp')
  const sharp = sharpMod.default
  const meta = await sharp(input, { failOn: 'none' }).metadata()
  const width = meta.width || 0
  const height = meta.height || 0
  const srcLeft = Math.max(0, -left)
  const srcTop = Math.max(0, -top)
  const destLeft = Math.max(0, left)
  const destTop = Math.max(0, top)
  const destWidth = Math.min(width - srcLeft, canvasW - destLeft)
  const destHeight = Math.min(height - srcTop, canvasH - destTop)
  if (destWidth < 1 || destHeight < 1) return null
  const extracted = await sharp(input, { failOn: 'none' })
    .extract({
      left: Math.round(srcLeft),
      top: Math.round(srcTop),
      width: Math.max(1, Math.floor(destWidth)),
      height: Math.max(1, Math.floor(destHeight)),
    })
    .png()
    .toBuffer()
  return { input: extracted, left: destLeft, top: destTop }
}

/** Recorta la foto original y, si hay plano, lo compone encima. La copia no pisa el original. */
export async function captureFloorPlanSurroundings(
  supabase: SupabaseClient,
  typologyCode: string,
  crop: SurroundingsCrop,
  placement?: { floorKey?: string | null; plan?: SurroundingsPlanPlacement | null },
): Promise<{ doc: FloorPlanSurroundingsDoc; image: Buffer }> {
  const doc = await loadFloorPlanSurroundings(supabase, typologyCode)
  if (!doc?.originalPath) {
    throw Object.assign(new Error('Subí primero la foto de los alrededores'), { status: 400 })
  }

  const downloaded = await supabase.storage.from(TYPOLOGY_ASSETS_BUCKET).download(doc.originalPath)
  if (downloaded.error || !downloaded.data) {
    throw new Error(downloaded.error?.message || 'No se pudo leer la foto original')
  }

  const source = Buffer.from(await downloaded.data.arrayBuffer())
  const sharpMod = await import('sharp')
  const sharp = sharpMod.default
  const meta = await sharp(source, { failOn: 'none' }).metadata()
  const imageWidth = meta.width || 0
  const imageHeight = meta.height || 0
  if (imageWidth < 2 || imageHeight < 2) {
    throw Object.assign(new Error('La foto original no tiene un tamaño válido'), { status: 400 })
  }

  if (!placement?.plan || placement.plan.width < 2 || placement.plan.height < 2) {
    throw Object.assign(new Error('La captura tiene que incluir el piso y el fondo'), { status: 400 })
  }
  const planFile = placement.floorKey ? doc.plans[placement.floorKey] : null
  if (!planFile) {
    throw Object.assign(new Error('Guardá el plano de este piso antes de capturar'), { status: 400 })
  }

  const downloadedPlan = await supabase.storage.from(TYPOLOGY_ASSETS_BUCKET).download(planFile.path)
  if (downloadedPlan.error || !downloadedPlan.data) {
    throw new Error(downloadedPlan.error?.message || 'No se pudo leer el plano')
  }

  const cropW = Math.max(2, crop.width)
  const cropH = Math.max(2, crop.height)
  const fit = Math.min(1, 4096 / Math.max(cropW, cropH))
  const canvasW = Math.max(2, Math.round(cropW * fit))
  const canvasH = Math.max(2, Math.round(cropH * fit))
  const toOutX = (sourceX: number) => ((sourceX - crop.x) / cropW) * canvasW
  const toOutY = (sourceY: number) => ((sourceY - crop.y) / cropH) * canvasH

  const bgBuffer = await sharp(source, { failOn: 'none' })
    .resize(Math.max(2, Math.round((imageWidth / cropW) * canvasW)), Math.max(2, Math.round((imageHeight / cropH) * canvasH)), {
      fit: 'fill',
    })
    .png()
    .toBuffer()

  const plan = placement.plan
  const rotatedPlan = await sharp(Buffer.from(await downloadedPlan.data.arrayBuffer()), { failOn: 'none' })
    .resize(Math.max(2, Math.round((plan.width / cropW) * canvasW)), Math.max(2, Math.round((plan.height / cropH) * canvasH)), {
      fit: 'fill',
    })
    .rotate(Number.isFinite(plan.rotation) ? plan.rotation : 0, {
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer()
  const rotatedMeta = await sharp(rotatedPlan, { failOn: 'none' }).metadata()
  const rotatedW = rotatedMeta.width || 2
  const rotatedH = rotatedMeta.height || 2

  const bgLayer = await clippedLayer(bgBuffer, Math.round(toOutX(0)), Math.round(toOutY(0)), canvasW, canvasH)
  const planLayer = await clippedLayer(
    rotatedPlan,
    Math.round(toOutX(plan.centerX) - rotatedW / 2),
    Math.round(toOutY(plan.centerY) - rotatedH / 2),
    canvasW,
    canvasH,
  )
  if (!bgLayer) {
    throw Object.assign(new Error('El fondo queda fuera de la captura'), { status: 400 })
  }
  if (!planLayer) {
    throw Object.assign(new Error('El piso queda fuera de la captura. Acomodalo sobre el fondo.'), { status: 400 })
  }

  const image = await sharp({
    create: {
      width: canvasW,
      height: canvasH,
      channels: 4,
      background: { r: 20, g: 17, b: 14, alpha: 1 },
    },
  })
    .composite([bgLayer, planLayer])
    .webp({ quality: 90, effort: 2 })
    .toBuffer()

  let saved = doc
  const path = `${typologyCode}/floor-surroundings-capture-v${Date.now()}.webp`
  try {
    const { error } = await supabase.storage.from(TYPOLOGY_ASSETS_BUCKET).upload(path, image, {
      upsert: false,
      contentType: 'image/webp',
      cacheControl: '0',
    })
    if (!error) {
      const names = await listNames(supabase, typologyCode)
      await removeNamed(
        supabase,
        typologyCode,
        names.filter((name) => CAPTURE_NAME_RE.test(name)),
        path,
      )
      saved = await saveFloorPlanSurroundings(supabase, {
        ...doc,
        capturePath: path,
        captureUrl: publicUrl(supabase, path),
        captureWidth: canvasW,
        captureHeight: canvasH,
      })
    }
  } catch {
    saved = doc
  }

  return { doc: saved, image }
}

export async function uploadFloorPlanSurroundingsPlan(
  supabase: SupabaseClient,
  typologyCode: string,
  floorKey: string,
  buffer: Buffer,
  width: number,
  height: number,
): Promise<FloorPlanSurroundingsDoc> {
  const safeKey = floorKey.replace(/[^a-z0-9-]/gi, '')
  if (!safeKey) throw Object.assign(new Error('Piso inválido'), { status: 400 })
  const path = `${typologyCode}/floor-surroundings-plan-${safeKey}-v${Date.now()}.webp`
  let lastError = 'No se pudo subir el plano'
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { error } = await supabase.storage.from(TYPOLOGY_ASSETS_BUCKET).upload(path, buffer, {
      upsert: attempt > 0,
      contentType: 'image/webp',
      cacheControl: '0',
    })
    if (!error) {
      lastError = ''
      break
    }
    lastError = error.message || lastError
    await new Promise((resolve) => setTimeout(resolve, 1200 * (attempt + 1)))
  }
  if (lastError) throw new Error(lastError)

  const names = await listNames(supabase, typologyCode)
  await removeNamed(
    supabase,
    typologyCode,
    names.filter((name) => {
      const match = name.match(PLAN_NAME_RE)
      return match?.[1] === safeKey && `${typologyCode}/${name}` !== path
    }),
    path,
  )

  const prev = (await loadFloorPlanSurroundings(supabase, typologyCode)) ?? emptyFloorPlanSurroundings(typologyCode)
  return saveFloorPlanSurroundings(supabase, {
    ...prev,
    plans: {
      ...prev.plans,
      [safeKey]: { path, url: publicUrl(supabase, path), width, height },
    },
  })
}

export async function saveFloorPlanSurroundingsLayers(
  supabase: SupabaseClient,
  typologyCode: string,
  layers: { background: SurroundingsLayer; planLayer: SurroundingsLayer },
): Promise<FloorPlanSurroundingsDoc> {
  const prev = (await loadFloorPlanSurroundings(supabase, typologyCode)) ?? emptyFloorPlanSurroundings(typologyCode)
  return saveFloorPlanSurroundings(supabase, {
    ...prev,
    typologyCode,
    background: layerOf(layers.background),
    planLayer: layerOf(layers.planLayer),
  })
}
