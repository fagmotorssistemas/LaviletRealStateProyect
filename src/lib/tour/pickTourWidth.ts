export const TOUR_WIDTHS = [2048, 4096] as const
export type TourWidth = (typeof TOUR_WIDTHS)[number]

const SAFE_MAX = 4096

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
 * Ancho de pano a servir. Nunca 8192.
 * Si la GPU admite 4096, se usa también en celular: al hacer zoom hace falta.
 */
export function pickTourWidth(params?: { maxTextureSize?: number; screenPx?: number }): TourWidth {
  const maxTextureSize = params?.maxTextureSize ?? readMaxTextureSize()
  const cap = Math.min(SAFE_MAX, maxTextureSize)
  return cap < SAFE_MAX ? 2048 : 4096
}
