export const TOUR_WIDTHS = [2048, 4096, 8192] as const
export type TourWidth = (typeof TOUR_WIDTHS)[number]

const SAFE_MAX = 8192

export function readMaxTextureSize(): number {
  if (typeof document === 'undefined') return 2048

  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
  if (!gl) return 2048

  const size = gl.getParameter(gl.MAX_TEXTURE_SIZE)
  gl.getExtension('WEBGL_lose_context')?.loseContext()
  return typeof size === 'number' && size > 0 ? size : 2048
}

export function readScreenPx(): number {
  if (typeof window === 'undefined') return 0
  const css = Math.max(window.innerWidth, window.innerHeight)
  return css * (window.devicePixelRatio || 1)
}

/** Devuelve el archivo subido, sin recorte ni recompresión de Supabase. */
export function tourDisplayUrl(publicUrl: string, _width?: TourWidth): string {
  try {
    const parsed = new URL(publicUrl)
    const objectPath = '/storage/v1/object/public/'
    const renderPath = '/storage/v1/render/image/public/'
    if (parsed.pathname.includes(renderPath)) {
      parsed.pathname = parsed.pathname.replace(renderPath, objectPath)
      parsed.searchParams.delete('width')
      parsed.searchParams.delete('height')
      parsed.searchParams.delete('resize')
      parsed.searchParams.delete('quality')
    }
    return parsed.toString()
  } catch {
    return publicUrl
  }
}

/** Elige el mejor ancho disponible según GPU; por defecto prioriza nitidez. */
export function pickTourWidth(_params?: {
  maxTextureSize?: number
  screenPx?: number
  narrow?: boolean
  cap?: TourWidth
}): TourWidth {
  const max = _params?.maxTextureSize ?? readMaxTextureSize()
  const cap = _params?.cap
  let width: TourWidth = max >= 8192 ? 8192 : max >= 4096 ? 4096 : 2048
  if (cap && width > cap) width = cap
  return width
}

export function pickCatalogPanoUrl(
  pano:
    | {
        url: string
        variants?: Partial<Record<string, string>>
        scenes?: Array<{
          finish: string | null
          light: string
          url: string
          widths?: Partial<Record<string, string>>
        }>
      }
    | null
    | undefined,
  width: TourWidth,
  finish?: string | null,
  light?: string,
): string | null {
  if (!pano) return null
  const wantedFinish = finish || null
  const wantedLight = light || 'dia'
  const scene =
    pano.scenes?.find((item) => item.finish === wantedFinish && item.light === wantedLight) ??
    pano.scenes?.find(
      (item) =>
        (item.finish === wantedFinish ||
          (wantedFinish === 'nogal' && item.finish === 'acabado-1') ||
          (wantedFinish === 'acabado-1' && item.finish === 'nogal') ||
          (wantedFinish === 'roble' && item.finish === 'acabado-2') ||
          (wantedFinish === 'acabado-2' && item.finish === 'roble')) &&
        item.light === wantedLight,
    ) ??
    pano.scenes?.find((item) => item.finish == null && item.light === wantedLight) ??
    pano.scenes?.find((item) => item.finish === wantedFinish && item.light === 'dia') ??
    pano.scenes?.[0]
  const variants = scene?.widths ?? pano.variants ?? {}
  if (width >= 8192 && variants['8192']) return tourDisplayUrl(variants['8192'])
  if (width >= 4096 && variants['4096']) return tourDisplayUrl(variants['4096'])
  if (variants['8192']) return tourDisplayUrl(variants['8192'])
  if (variants['4096']) return tourDisplayUrl(variants['4096'])
  if (variants['2048']) return tourDisplayUrl(variants['2048'])
  const fallback = scene?.url ?? pano.url
  return fallback ? tourDisplayUrl(fallback) : null
}
