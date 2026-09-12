/**
 * Zonas de departamentos por piso (polígonos manuales sobre el plano).
 * Persistidos por edificio (no por tipología); el showroom matchea zonas ↔ unidades por número.
 *
 * Las zonas se guardan en % (0–100) y se comparten entre variantes 2D y 3D del mismo piso.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { floorPlanStorageKey } from '@/lib/tour/floorPlanHotspots'
import { TYPOLOGY_ASSETS_BUCKET } from '@/lib/typology-assets'
import type { Apartment, Point } from '@/lib/floor-plan/types'
import { densifyPolygon, normalizeCurves } from '@/lib/floor-plan/geometry'

export type FloorPlanVariant = '2d' | '3d'

export type FloorPlanVariantMedia = {
  imageUrl: string | null
  /** HTML interactivo (reemplaza la imagen 3D cuando existe). */
  htmlUrl?: string | null
  imageWidth: number
  imageHeight: number
}

/** Ajuste fino del overlay de zonas por variante (p. ej. 3D con otro encuadre). */
export type FloorPlanOverlayAlign = {
  /** Desplazamiento horizontal en puntos porcentuales (−50…50). */
  offsetX: number
  /** Desplazamiento vertical en puntos porcentuales (−50…50). */
  offsetY: number
  /** Escala alrededor del centro (1 = sin cambio). */
  scale: number
}

export const DEFAULT_OVERLAY_ALIGN: FloorPlanOverlayAlign = {
  offsetX: 0,
  offsetY: 0,
  scale: 1,
}

export type FloorPlanZone = {
  id: string
  label: string
  order: number
  /** Polígono en px (de la variante con la que se editó por última vez; preferir pointsPercent). */
  polygon: Point[]
  /** Polígono 0–100 — fuente de verdad compartida 2D/3D. */
  pointsPercent: string
  /**
   * Controles de curva por arista en % (mismo orden que vértices).
   * Token `-` = lado recto. Ej: `- 42.1,10.5 -`.
   */
  curvesPercent?: string
  kind?: 'polygon' | 'circle'
}

export type FloorPlanZonesDoc = {
  floor: number
  typologyCode: string
  /** Compat / showroom: suele ser la 2D si existe. */
  imageUrl: string | null
  imageWidth: number
  imageHeight: number
  variants: Record<FloorPlanVariant, FloorPlanVariantMedia>
  /** Alineación del overlay por variante (no mueve la imagen, solo las zonas). */
  align?: Partial<Record<FloorPlanVariant, FloorPlanOverlayAlign>>
  zones: FloorPlanZone[]
  updatedAt: string
}

const EMPTY_MEDIA: FloorPlanVariantMedia = {
  imageUrl: null,
  htmlUrl: null,
  imageWidth: 1,
  imageHeight: 1,
}

/** ¿La variante tiene algo para mostrar (foto o HTML)? */
export function floorPlanVariantHasMedia(media: FloorPlanVariantMedia | null | undefined) {
  return Boolean(media?.imageUrl || media?.htmlUrl)
}

export function floorPlanZonesPath(typologyCode: string, floor: number) {
  return `${typologyCode}/floor-${floorPlanStorageKey(floor)}-zones.json`
}

export function floorPlanImagePath(
  typologyCode: string,
  floor: number,
  ext = 'webp',
  variant: FloorPlanVariant = '2d',
) {
  const key = floorPlanStorageKey(floor)
  const suffix = variant === '3d' ? 'plan-3d' : 'plan'
  return `${typologyCode}/floor-${key}-${suffix}.${ext}`
}

/** Ruta única por subida para romper caché de CDN/Storage (mismo nombre = mismo archivo viejo). */
export function floorPlanImagePathVersioned(
  typologyCode: string,
  floor: number,
  ext = 'webp',
  variant: FloorPlanVariant = '2d',
  version = Date.now(),
) {
  const key = floorPlanStorageKey(floor)
  const suffix = variant === '3d' ? 'plan-3d' : 'plan'
  return `${typologyCode}/floor-${key}-${suffix}-v${version}.${ext}`
}

export type FloorPlanFloorSummary = {
  floor: number
  imageUrl: string | null
  imageUrl2d: string | null
  imageUrl3d: string | null
  htmlUrl3d: string | null
  zoneCount: number
  updatedAt: string | null
}

const FLOOR_PLAN_IMAGE_EXTS = ['webp', 'jpg', 'jpeg', 'png', 'gif'] as const
const FLOOR_PLAN_MEDIA_EXTS = [...FLOOR_PLAN_IMAGE_EXTS, 'html'] as const

function publicFloorPlanUrl(supabase: SupabaseClient, path: string) {
  return supabase.storage.from(TYPOLOGY_ASSETS_BUCKET).getPublicUrl(path).data.publicUrl
}

function floorPlanMediaNameRegex(floor: number, variant: FloorPlanVariant) {
  const key = floorPlanStorageKey(floor)
  if (variant === '3d') {
    // floor-2-plan-3d.html | floor-2-plan-3d-v123.html | floor-2-plan-3d.webp | …
    return new RegExp(
      `^floor-${key}-plan-3d(?:-v\\d+)?\\.(?:html|webp|jpe?g|png|gif)$`,
      'i',
    )
  }
  return new RegExp(`^floor-${key}-plan(?:-v\\d+)?\\.(?:webp|jpe?g|png|gif)$`, 'i')
}

/** Lista paths de media de un piso/variante (canónico + versionados). */
export async function listFloorPlanMediaPaths(
  supabase: SupabaseClient,
  typologyCode: string,
  floor: number,
  variant?: FloorPlanVariant,
): Promise<string[]> {
  const { data: files } = await supabase.storage.from(TYPOLOGY_ASSETS_BUCKET).list(typologyCode, {
    limit: 200,
  })
  if (!files?.length) return []
  const variants: FloorPlanVariant[] = variant ? [variant] : ['2d', '3d']
  const paths: string[] = []
  for (const v of variants) {
    const re = floorPlanMediaNameRegex(floor, v)
    for (const file of files) {
      if (re.test(file.name)) paths.push(`${typologyCode}/${file.name}`)
    }
  }
  return paths
}

/**
 * Si el JSON no tiene una variante pero el archivo sí está en storage
 * (p. ej. subida 3D reciente / cache viejo), completa la URL.
 */
export async function discoverFloorPlanVariantUrls(
  supabase: SupabaseClient,
  typologyCode: string,
  floor: number,
): Promise<Record<FloorPlanVariant, string | null>> {
  const key = floorPlanStorageKey(floor)
  const found: Record<FloorPlanVariant, string | null> = { '2d': null, '3d': null }
  const { data: files } = await supabase.storage.from(TYPOLOGY_ASSETS_BUCKET).list(typologyCode, {
    limit: 200,
  })
  if (!files?.length) return found

  // Preferir el archivo versionado más reciente (mayor -vN).
  type Candidate = { name: string; stamp: number; html: boolean }
  let pick3d: Candidate | null = null
  let pick2d: Candidate | null = null

  const re3d = new RegExp(`^floor-${key}-plan-3d(?:-v(\\d+))?\\.(html|webp|jpe?g|png|gif)$`, 'i')
  const re2d = new RegExp(`^floor-${key}-plan(?:-v(\\d+))?\\.(webp|jpe?g|png|gif)$`, 'i')

  for (const file of files) {
    const name = file.name
    const m3 = name.match(re3d)
    if (m3) {
      const stamp = m3[1] ? Number(m3[1]) : 0
      const html = m3[2].toLowerCase() === 'html'
      const next = { name, stamp, html }
      if (
        !pick3d ||
        next.stamp > pick3d.stamp ||
        (next.stamp === pick3d.stamp && html && !pick3d.html)
      ) {
        pick3d = next
      }
      continue
    }
    const m2 = name.match(re2d)
    if (m2) {
      const stamp = m2[1] ? Number(m2[1]) : 0
      if (!pick2d || stamp > pick2d.stamp) {
        pick2d = { name, stamp, html: false }
      }
    }
  }

  if (pick3d) found['3d'] = publicFloorPlanUrl(supabase, `${typologyCode}/${pick3d.name}`)
  if (pick2d) found['2d'] = publicFloorPlanUrl(supabase, `${typologyCode}/${pick2d.name}`)
  return found
}

function mergeDiscoveredVariants(
  doc: FloorPlanZonesDoc,
  discovered: Record<FloorPlanVariant, string | null>,
): { doc: FloorPlanZonesDoc; changed: boolean } {
  const next = withFloorPlanVariants(doc)
  let changed = false
  for (const variant of ['2d', '3d'] as const) {
    const url = discovered[variant]
    if (!url) continue
    const current = next.variants[variant]
    const currentUrl = current?.htmlUrl || current?.imageUrl || null
    // Si ya hay URL pero discovery encontró una versión más nueva (-vN mayor), actualizar.
    const shouldReplace =
      !currentUrl ||
      (versionStampFromMediaUrl(url) > versionStampFromMediaUrl(currentUrl) &&
        url.split('?')[0] !== currentUrl.split('?')[0])
    if (!shouldReplace) continue
    const isHtml = /\.html(?:$|\?)/i.test(url)
    next.variants[variant] = {
      imageUrl: isHtml ? null : url,
      htmlUrl: isHtml ? url : null,
      imageWidth: current?.imageWidth || (isHtml ? 2048 : 1),
      imageHeight: current?.imageHeight || (isHtml ? 970 : 1),
    }
    changed = true
  }
  if (!changed) return { doc: next, changed: false }
  const preferred = floorPlanVariantHasMedia(next.variants['2d'])
    ? next.variants['2d']
    : next.variants['3d']
  return {
    changed: true,
    doc: {
      ...next,
      imageUrl: preferred.imageUrl,
      imageWidth: preferred.imageWidth || 1,
      imageHeight: preferred.imageHeight || 1,
    },
  }
}

function versionStampFromMediaUrl(url: string | null | undefined): number {
  if (!url) return 0
  const match = url.match(/-v(\d+)\.(?:html|webp|jpe?g|png|gif)(?:$|\?)/i)
  return match ? Number(match[1]) || 0 : 0
}

function parseMedia(value: unknown): FloorPlanVariantMedia {
  if (!value || typeof value !== 'object') return { ...EMPTY_MEDIA }
  const row = value as Partial<FloorPlanVariantMedia>
  return {
    imageUrl: typeof row.imageUrl === 'string' ? row.imageUrl : null,
    htmlUrl: typeof row.htmlUrl === 'string' ? row.htmlUrl : null,
    imageWidth: Number.isFinite(Number(row.imageWidth)) ? Number(row.imageWidth) : 1,
    imageHeight: Number.isFinite(Number(row.imageHeight)) ? Number(row.imageHeight) : 1,
  }
}

/** Normaliza docs viejos (una sola imagen) al formato con variantes 2D/3D. */
export function withFloorPlanVariants(doc: FloorPlanZonesDoc): FloorPlanZonesDoc {
  const legacy2d: FloorPlanVariantMedia = doc.imageUrl
    ? {
        imageUrl: doc.imageUrl,
        htmlUrl: null,
        imageWidth: doc.imageWidth || 1,
        imageHeight: doc.imageHeight || 1,
      }
    : { ...EMPTY_MEDIA }

  const raw2d = doc.variants?.['2d'] ? parseMedia(doc.variants['2d']) : { ...EMPTY_MEDIA }
  const raw3d = doc.variants?.['3d'] ? parseMedia(doc.variants['3d']) : { ...EMPTY_MEDIA }

  const variants: Record<FloorPlanVariant, FloorPlanVariantMedia> = {
    '2d': floorPlanVariantHasMedia(raw2d) ? raw2d : legacy2d,
    '3d': raw3d,
  }

  if (!floorPlanVariantHasMedia(variants['2d']) && legacy2d.imageUrl) variants['2d'] = legacy2d

  const preferred = floorPlanVariantHasMedia(variants['2d']) ? variants['2d'] : variants['3d']
  return {
    ...doc,
    variants,
    align: {
      '2d': parseOverlayAlign(doc.align?.['2d']),
      '3d': parseOverlayAlign(doc.align?.['3d']),
    },
    imageUrl: preferred.imageUrl,
    imageWidth: preferred.imageWidth || 1,
    imageHeight: preferred.imageHeight || 1,
  }
}

export function getFloorPlanVariantMedia(
  doc: FloorPlanZonesDoc | null | undefined,
  variant: FloorPlanVariant,
): FloorPlanVariantMedia {
  if (!doc) return { ...EMPTY_MEDIA }
  const normalized = withFloorPlanVariants(doc)
  return normalized.variants[variant] ?? { ...EMPTY_MEDIA }
}

export function parseOverlayAlign(value: unknown): FloorPlanOverlayAlign {
  if (!value || typeof value !== 'object') return { ...DEFAULT_OVERLAY_ALIGN }
  const row = value as Partial<FloorPlanOverlayAlign>
  const offsetX = Number(row.offsetX)
  const offsetY = Number(row.offsetY)
  const scale = Number(row.scale)
  return {
    offsetX: Number.isFinite(offsetX) ? Math.max(-20, Math.min(20, offsetX)) : 0,
    offsetY: Number.isFinite(offsetY) ? Math.max(-20, Math.min(20, offsetY)) : 0,
    scale: Number.isFinite(scale) ? Math.max(0.85, Math.min(1.15, scale)) : 1,
  }
}

export function getFloorPlanOverlayAlign(
  doc: FloorPlanZonesDoc | null | undefined,
  variant: FloorPlanVariant,
): FloorPlanOverlayAlign {
  if (!doc?.align?.[variant]) return { ...DEFAULT_OVERLAY_ALIGN }
  return parseOverlayAlign(doc.align[variant])
}

/** Aplica offset/escala a un polígono en % (para alinear 3D sin re-dibujar). */
export function applyOverlayAlign(
  pointsPercent: string,
  align?: FloorPlanOverlayAlign | null,
): string {
  if (!pointsPercent.trim()) return ''
  const a = parseOverlayAlign(align)
  const identity = a.offsetX === 0 && a.offsetY === 0 && a.scale === 1
  if (identity) return pointsPercent
  return pointsPercent
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [xRaw, yRaw] = pair.split(',').map(Number)
      if (!Number.isFinite(xRaw) || !Number.isFinite(yRaw)) return pair
      const x = 50 + (xRaw - 50) * a.scale + a.offsetX
      const y = 50 + (yRaw - 50) * a.scale + a.offsetY
      return `${Math.min(100, Math.max(0, x)).toFixed(2)},${Math.min(100, Math.max(0, y)).toFixed(2)}`
    })
    .join(' ')
}

/**
 * Invierte el transform visual de overlayAlign (coords de pantalla/SVG → coords guardadas).
 * Misma matemática que el `<g transform>` del FloorPlanViewer.
 */
export function invertOverlayAlignPoint(
  x: number,
  y: number,
  width: number,
  height: number,
  align?: FloorPlanOverlayAlign | null,
): { x: number; y: number } {
  const a = parseOverlayAlign(align)
  if (a.offsetX === 0 && a.offsetY === 0 && a.scale === 1) {
    return { x, y }
  }
  const ox = (a.offsetX / 100) * width
  const oy = (a.offsetY / 100) * height
  const cx = width / 2
  const cy = height / 2
  const s = a.scale || 1
  return {
    x: (x - ox - cx) / s + cx,
    y: (y - oy - cy) / s + cy,
  }
}

export async function uploadFloorPlanImage(
  supabase: SupabaseClient,
  typologyCode: string,
  floor: number,
  buffer: Buffer,
  contentType: string,
  ext = 'webp',
  variant: FloorPlanVariant = '2d',
  options?: { cleanupOld?: boolean },
): Promise<{ path: string; publicUrl: string }> {
  const version = Date.now()
  const path = floorPlanImagePathVersioned(typologyCode, floor, ext, variant, version)

  const { error } = await supabase.storage.from(TYPOLOGY_ASSETS_BUCKET).upload(path, buffer, {
    upsert: false,
    contentType,
    // Sin cache largo: la URL ya es única por versión.
    cacheControl: '0',
  })
  if (error) throw new Error(error.message || 'No se pudo subir el plano del piso')

  if (options?.cleanupOld !== false) {
    await cleanupOldFloorPlanMedia(supabase, typologyCode, floor, variant, path)
  }

  const { data } = supabase.storage.from(TYPOLOGY_ASSETS_BUCKET).getPublicUrl(path)
  return { path, publicUrl: data.publicUrl }
}

/** Borra media previa del piso/variante dejando solo `keepPath`. */
export async function cleanupOldFloorPlanMedia(
  supabase: SupabaseClient,
  typologyCode: string,
  floor: number,
  variant: FloorPlanVariant,
  keepPath: string,
): Promise<void> {
  const stale = (await listFloorPlanMediaPaths(supabase, typologyCode, floor, variant)).filter(
    (item) => item !== keepPath,
  )
  // Canónicos fijos (legado sin -vN).
  for (const ext of FLOOR_PLAN_MEDIA_EXTS) {
    const canonical = floorPlanImagePath(typologyCode, floor, ext, variant)
    if (canonical !== keepPath && !stale.includes(canonical)) stale.push(canonical)
  }
  if (stale.length > 0) {
    await supabase.storage.from(TYPOLOGY_ASSETS_BUCKET).remove(stale)
  }
}

export async function deleteFloorPlanImage(
  supabase: SupabaseClient,
  typologyCode: string,
  floor: number,
  variant: FloorPlanVariant = '2d',
): Promise<void> {
  const paths = await listFloorPlanMediaPaths(supabase, typologyCode, floor, variant)
  // Incluir canónicos fijos por si list falló parcialmente.
  const fallback = FLOOR_PLAN_MEDIA_EXTS.map((ext) =>
    floorPlanImagePath(typologyCode, floor, ext, variant),
  )
  const unique = [...new Set([...paths, ...fallback])]
  if (unique.length > 0) {
    await supabase.storage.from(TYPOLOGY_ASSETS_BUCKET).remove(unique)
  }
  const existing = await loadFloorPlanZones(supabase, typologyCode, floor)
  if (!existing) return
  const next = withFloorPlanVariants(existing)
  next.variants[variant] = { ...EMPTY_MEDIA }
  const preferred = floorPlanVariantHasMedia(next.variants['2d'])
    ? next.variants['2d']
    : next.variants['3d']
  await saveFloorPlanZones(supabase, {
    ...next,
    imageUrl: preferred.imageUrl,
    imageWidth: preferred.imageWidth || 1,
    imageHeight: preferred.imageHeight || 1,
  })
}

export async function deleteFloorPlanFloor(
  supabase: SupabaseClient,
  typologyCode: string,
  floor: number,
): Promise<void> {
  await deleteFloorPlanImage(supabase, typologyCode, floor, '2d')
  await deleteFloorPlanImage(supabase, typologyCode, floor, '3d')
  await supabase.storage.from(TYPOLOGY_ASSETS_BUCKET).remove([floorPlanZonesPath(typologyCode, floor)])
}

export async function listFloorPlanFloorSummaries(
  supabase: SupabaseClient,
  typologyCode: string,
  floors: readonly number[],
): Promise<FloorPlanFloorSummary[]> {
  const rows = await Promise.all(
    floors.map(async (floor) => {
      const doc = await loadFloorPlanZones(supabase, typologyCode, floor)
      const normalized = doc ? withFloorPlanVariants(doc) : null
      const imageUrl2d = normalized?.variants['2d'].imageUrl ?? null
      const imageUrl3d = normalized?.variants['3d'].imageUrl ?? null
      const htmlUrl3d = normalized?.variants['3d'].htmlUrl ?? null
      return {
        floor,
        imageUrl: imageUrl2d || imageUrl3d || htmlUrl3d,
        imageUrl2d,
        imageUrl3d: imageUrl3d || htmlUrl3d,
        htmlUrl3d,
        zoneCount: normalized?.zones.length ?? 0,
        updatedAt: normalized?.updatedAt ?? null,
      } satisfies FloorPlanFloorSummary
    }),
  )
  return rows
}

export function polygonToPercentPoints(
  polygon: Point[],
  width: number,
  height: number,
): string {
  if (!width || !height || polygon.length < 3) return ''
  return polygon
    .map(([x, y]) => {
      const px = Math.min(100, Math.max(0, (x / width) * 100))
      const py = Math.min(100, Math.max(0, (y / height) * 100))
      return `${px.toFixed(2)},${py.toFixed(2)}`
    })
    .join(' ')
}

export function percentPointsToPolygon(
  pointsPercent: string,
  width: number,
  height: number,
): Point[] {
  if (!width || !height || !pointsPercent.trim()) return []
  return pointsPercent
    .trim()
    .split(/\s+/)
    .map((pair) => {
      const [px, py] = pair.split(',').map(Number)
      if (!Number.isFinite(px) || !Number.isFinite(py)) return null
      return [
        Math.round((Math.min(100, Math.max(0, px)) / 100) * width),
        Math.round((Math.min(100, Math.max(0, py)) / 100) * height),
      ] as Point
    })
    .filter((p): p is Point => Boolean(p))
}

export function curvesToPercent(
  curves: (Point | null)[] | undefined,
  width: number,
  height: number,
): string {
  if (!curves?.length || !width || !height) return ''
  return curves
    .map((point) => {
      if (!point) return '-'
      const px = Math.min(100, Math.max(0, (point[0] / width) * 100))
      const py = Math.min(100, Math.max(0, (point[1] / height) * 100))
      return `${px.toFixed(2)},${py.toFixed(2)}`
    })
    .join(' ')
}

export function percentCurvesToPoints(
  curvesPercent: string | undefined,
  width: number,
  height: number,
  edgeCount: number,
): (Point | null)[] {
  const empty = Array.from({ length: edgeCount }, () => null as Point | null)
  if (!curvesPercent?.trim() || !width || !height || edgeCount < 1) return empty
  const tokens = curvesPercent.trim().split(/\s+/)
  return Array.from({ length: edgeCount }, (_, i) => {
    const token = tokens[i]
    if (!token || token === '-') return null
    const [px, py] = token.split(',').map(Number)
    if (!Number.isFinite(px) || !Number.isFinite(py)) return null
    return [
      Math.round((Math.min(100, Math.max(0, px)) / 100) * width),
      Math.round((Math.min(100, Math.max(0, py)) / 100) * height),
    ] as Point
  })
}

/** pointsPercent denso (con curvas muestreadas) para el showroom. */
export function zoneDisplayPointsPercent(zone: FloorPlanZone): string {
  if (!zone.curvesPercent?.trim() || !zone.curvesPercent.includes(',')) {
    return zone.pointsPercent
  }
  // Reconstruye en un espacio 0–100 y densifica.
  const verts = percentPointsToPolygon(zone.pointsPercent, 1000, 1000)
  if (verts.length < 3) return zone.pointsPercent
  const curves = percentCurvesToPoints(zone.curvesPercent, 1000, 1000, verts.length)
  if (!curves.some(Boolean)) return zone.pointsPercent
  return polygonToPercentPoints(densifyPolygon(verts, curves), 1000, 1000)
}

export function apartmentsToZones(
  apartments: Apartment[],
  width: number,
  height: number,
): FloorPlanZone[] {
  return apartments.map((item, index) => {
    const curves = normalizeCurves(item.polygon, item.curves)
    const hasCurves = curves.some(Boolean)
    return {
      id: item.id,
      label: item.id,
      order: index,
      polygon: item.polygon,
      pointsPercent: polygonToPercentPoints(item.polygon, width, height),
      curvesPercent: hasCurves ? curvesToPercent(curves, width, height) : undefined,
      kind: item.kind === 'circle' ? 'circle' : 'polygon',
    }
  })
}

/** Reconstruye zonas en px de la imagen actual a partir de % (sirve para pasar 2D ↔ 3D). */
export function zonesToApartments(
  zones: FloorPlanZone[],
  width?: number,
  height?: number,
): Apartment[] {
  return zones.map((zone) => {
    const w = width || 1000
    const h = height || 1000
    const polygon =
      width && height && zone.pointsPercent
        ? percentPointsToPolygon(zone.pointsPercent, width, height)
        : zone.polygon
    const usable = polygon.length >= 3 ? polygon : zone.polygon
    const curves = percentCurvesToPoints(zone.curvesPercent, w, h, usable.length)
    const dense = densifyPolygon(usable, curves)
    const xs = dense.map((p) => p[0])
    const ys = dense.map((p) => p[1])
    const x0 = Math.min(...xs)
    const y0 = Math.min(...ys)
    const x1 = Math.max(...xs)
    const y1 = Math.max(...ys)
    return {
      id: zone.id,
      kind: zone.kind === 'circle' ? 'circle' : 'polygon',
      polygon: usable,
      curves: curves.some(Boolean) ? curves : undefined,
      bbox: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
      center: [(x0 + x1) / 2, (y0 + y1) / 2],
      confidence: 1,
      needsReview: false,
    }
  })
}

export function parseFloorPlanZonesDoc(value: unknown): FloorPlanZonesDoc | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Partial<FloorPlanZonesDoc> & {
    variants?: Partial<Record<FloorPlanVariant, unknown>>
  }
  const floor = Number(row.floor)
  const typologyCode = typeof row.typologyCode === 'string' ? row.typologyCode.trim() : ''
  const imageWidth = Number(row.imageWidth)
  const imageHeight = Number(row.imageHeight)
  if (!typologyCode || !Number.isFinite(floor)) return null
  if (!Number.isFinite(imageWidth) || !Number.isFinite(imageHeight)) return null
  const zones: FloorPlanZone[] = []
  if (Array.isArray(row.zones)) {
    for (const item of row.zones) {
      if (!item || typeof item !== 'object') continue
      const z = item as Partial<FloorPlanZone>
      const id = typeof z.id === 'string' ? z.id.trim() : ''
      const polygon = Array.isArray(z.polygon)
        ? (z.polygon.filter(
            (p) =>
              Array.isArray(p) &&
              p.length >= 2 &&
              Number.isFinite(Number(p[0])) &&
              Number.isFinite(Number(p[1])),
          ) as Point[])
        : []
      const pointsPercent =
        typeof z.pointsPercent === 'string' && z.pointsPercent.trim()
          ? z.pointsPercent
          : polygonToPercentPoints(polygon, imageWidth, imageHeight)
      const curvesPercent =
        typeof z.curvesPercent === 'string' && z.curvesPercent.trim()
          ? z.curvesPercent.trim()
          : undefined
      if (!id) continue
      if (polygon.length < 3 && percentPointsToPolygon(pointsPercent, imageWidth || 100, imageHeight || 100).length < 3) {
        continue
      }
      zones.push({
        id,
        label: typeof z.label === 'string' && z.label.trim() ? z.label.trim() : id,
        order: Number.isFinite(Number(z.order)) ? Number(z.order) : zones.length,
        polygon:
          polygon.length >= 3
            ? polygon
            : percentPointsToPolygon(pointsPercent, imageWidth || 100, imageHeight || 100),
        kind: z.kind === 'circle' ? 'circle' : 'polygon',
        pointsPercent,
        curvesPercent,
      })
    }
  }

  const rawVariants = row.variants && typeof row.variants === 'object' ? row.variants : null
  const draft: FloorPlanZonesDoc = {
    floor,
    typologyCode,
    imageUrl: typeof row.imageUrl === 'string' ? row.imageUrl : null,
    imageWidth,
    imageHeight,
    variants: {
      '2d': parseMedia(rawVariants?.['2d']),
      '3d': parseMedia(rawVariants?.['3d']),
    },
    align: {
      '2d': parseOverlayAlign(
        row.align && typeof row.align === 'object'
          ? (row.align as Partial<Record<FloorPlanVariant, unknown>>)['2d']
          : null,
      ),
      '3d': parseOverlayAlign(
        row.align && typeof row.align === 'object'
          ? (row.align as Partial<Record<FloorPlanVariant, unknown>>)['3d']
          : null,
      ),
    },
    zones,
    updatedAt: typeof row.updatedAt === 'string' ? row.updatedAt : new Date().toISOString(),
  }
  return withFloorPlanVariants(draft)
}

export async function loadFloorPlanZones(
  supabase: SupabaseClient,
  typologyCode: string,
  floor: number,
): Promise<FloorPlanZonesDoc | null> {
  const path = floorPlanZonesPath(typologyCode, floor)
  const [{ data, error }, discovered] = await Promise.all([
    supabase.storage.from(TYPOLOGY_ASSETS_BUCKET).download(path),
    discoverFloorPlanVariantUrls(supabase, typologyCode, floor),
  ])

  let doc: FloorPlanZonesDoc | null = null
  if (!error && data) {
    try {
      doc = parseFloorPlanZonesDoc(JSON.parse(await data.text()))
    } catch {
      doc = null
    }
  }

  if (!doc) {
    if (!discovered['2d'] && !discovered['3d']) return null
    const d2 = discovered['2d']
    const d3 = discovered['3d']
    const d3Html = Boolean(d3 && /\.html(?:$|\?)/i.test(d3))
    const seed = withFloorPlanVariants({
      floor,
      typologyCode,
      imageUrl: d2 || (d3Html ? null : d3),
      imageWidth: d3Html && !d2 ? 2048 : 1,
      imageHeight: d3Html && !d2 ? 970 : 1,
      variants: {
        '2d': { imageUrl: d2, htmlUrl: null, imageWidth: 1, imageHeight: 1 },
        '3d': {
          imageUrl: d3Html ? null : d3,
          htmlUrl: d3Html ? d3 : null,
          imageWidth: d3Html ? 2048 : 1,
          imageHeight: d3Html ? 970 : 1,
        },
      },
      zones: [],
      updatedAt: new Date().toISOString(),
    })
    try {
      return await saveFloorPlanZones(supabase, seed)
    } catch {
      return seed
    }
  }

  const merged = mergeDiscoveredVariants(doc, discovered)
  if (!merged.changed) return merged.doc
  try {
    return await saveFloorPlanZones(supabase, merged.doc)
  } catch {
    return merged.doc
  }
}

export async function saveFloorPlanZones(
  supabase: SupabaseClient,
  doc: FloorPlanZonesDoc,
): Promise<FloorPlanZonesDoc> {
  const normalized = withFloorPlanVariants(doc)
  const next: FloorPlanZonesDoc = {
    ...normalized,
    zones: normalized.zones.map((zone, index) => ({
      ...zone,
      order: index,
      pointsPercent:
        zone.pointsPercent ||
        polygonToPercentPoints(zone.polygon, normalized.imageWidth, normalized.imageHeight),
    })),
    updatedAt: new Date().toISOString(),
  }
  const { error } = await supabase.storage.from(TYPOLOGY_ASSETS_BUCKET).upload(
    floorPlanZonesPath(doc.typologyCode, doc.floor),
    JSON.stringify(next),
    // El bucket typology-assets solo admite imágenes; mismo truco que hotspots.
    // cacheControl bajo: el JSON se reescribe en cada subida y no debe quedar pegado.
    { upsert: true, contentType: 'image/webp', cacheControl: '0' },
  )
  if (error) throw new Error(error.message || 'No se pudieron guardar las zonas del piso')
  return next
}
