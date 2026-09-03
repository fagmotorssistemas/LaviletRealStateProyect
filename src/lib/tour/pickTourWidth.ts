export const TOUR_WIDTHS = [2048, 4096] as const
export type TourWidth = (typeof TOUR_WIDTHS)[number]

const SAFE_MAX = 4096
const SCREEN_FOR_HIGH = 1440

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
 * 4096 solo si la GPU lo admite y la pantalla (CSS × DPR) lo justifica.
 */
export function pickTourWidth(params?: { maxTextureSize?: number; screenPx?: number }): TourWidth {
  const maxTextureSize = params?.maxTextureSize ?? readMaxTextureSize()
  const screenPx = params?.screenPx ?? readScreenPx()
  const cap = Math.min(SAFE_MAX, maxTextureSize)
  if (cap < SAFE_MAX) return 2048
  if (screenPx < SCREEN_FOR_HIGH) return 2048
  return 4096
}
