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

/**
 * Ancho de pano a servir.
 * Celular: 4096 (casi ninguna GPU móvil texturiza 8192 bien).
 * PC: 8192 si la GPU lo admite.
 */
export function pickTourWidth(params?: {
  maxTextureSize?: number
  screenPx?: number
  narrow?: boolean
  cap?: TourWidth
}): TourWidth {
  const maxTextureSize = params?.maxTextureSize ?? readMaxTextureSize()
  const narrow = params?.narrow ?? (typeof window !== 'undefined' && window.innerWidth < 768)
  const cap = params?.cap ?? SAFE_MAX

  let width: TourWidth = 2048
  if (maxTextureSize >= 4096) width = 4096
  if (maxTextureSize >= 8192 && !narrow) width = 8192

  if (width > cap) {
    if (cap >= 8192) return 8192
    if (cap >= 4096) return 4096
    return 2048
  }
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
  const scene =
    pano.scenes?.find((item) => item.finish === (finish || null) && item.light === light) ??
    pano.scenes?.find((item) => item.finish == null && item.light === light) ??
    pano.scenes?.find((item) => item.finish === (finish || null) && item.light === 'dia') ??
    pano.scenes?.[0]
  const variants = scene?.widths ?? pano.variants ?? {}
  const fallback = scene?.url ?? pano.url
  if (width >= 8192 && variants['8192']) return variants['8192']
  if (variants['4096']) return variants['4096']
  if (variants['2048']) return variants['2048']
  return fallback
}
