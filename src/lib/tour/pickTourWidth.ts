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

/** `?v=` de created_at. 0 si la URL no trae versión. */
export function publicAssetVersion(url: string | null | undefined): number {
  if (!url) return 0
  try {
    const value = new URL(url, 'https://local.invalid').searchParams.get('v')
    if (!value) return 0
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  } catch {
    return 0
  }
}

export function isPngAssetUrl(url: string | null | undefined) {
  if (!url) return false
  try {
    return /\.png$/i.test(new URL(url, 'https://local.invalid').pathname)
  } catch {
    return /\.png(?:$|\?)/i.test(url)
  }
}

function variantIsCurrent(url: string | undefined, baseUrl: string | undefined) {
  if (!url) return false
  const base = publicAssetVersion(baseUrl)
  const variant = publicAssetVersion(url)
  if (!base || !variant) return true
  return variant + 1500 >= base
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

function screenCap(): TourWidth {
  if (typeof window === 'undefined') return 8192
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false
  const small = Math.min(window.innerWidth, window.innerHeight) < 1024
  return coarse || small ? 4096 : 8192
}

/** Elige el mejor ancho disponible según GPU y pantalla. */
export function pickTourWidth(_params?: {
  maxTextureSize?: number
  screenPx?: number
  narrow?: boolean
  cap?: TourWidth
}): TourWidth {
  const max = _params?.maxTextureSize ?? readMaxTextureSize()
  let width: TourWidth = max >= 8192 ? 8192 : max >= 4096 ? 4096 : 2048
  const caps: TourWidth[] = [screenCap()]
  if (_params?.cap) caps.push(_params.cap)
  if (_params?.narrow) caps.push(4096)
  const cap = caps.reduce((lowest, item) => (item < lowest ? item : lowest))
  if (width > cap) width = cap
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
  const baseUrl = scene?.url ?? pano.url
  const versionBase = baseUrl && !isPngAssetUrl(baseUrl) ? baseUrl : undefined
  const take = (key: '2048' | '4096' | '8192') => {
    const raw = variants[key]
    if (!raw || isPngAssetUrl(raw) || !variantIsCurrent(raw, versionBase)) return null
    return tourDisplayUrl(raw)
  }
  const order: Array<'2048' | '4096' | '8192'> =
    width >= 8192 ? ['8192', '4096', '2048'] : width >= 4096 ? ['4096', '2048'] : ['2048', '4096']
  for (const key of order) {
    const url = take(key)
    if (url) return url
  }
  if (!baseUrl || isPngAssetUrl(baseUrl)) return null
  return tourDisplayUrl(baseUrl)
}
