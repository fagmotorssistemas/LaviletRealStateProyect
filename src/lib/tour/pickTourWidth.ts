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

/** Revisión `-r<timestamp>` del nombre. No usa el `?v=` de created_at. */
export function assetRevision(urlOrName: string | null | undefined): string | null {
  if (!urlOrName) return null
  let path = urlOrName
  try {
    path = new URL(urlOrName, 'https://local.invalid').pathname
  } catch {
    path = urlOrName.split('?')[0] ?? urlOrName
  }
  return path.match(/-r(\d+)(?:\.[^./]+)?$/i)?.[1] ?? null
}

/** La variante está al día cuando comparte la revisión del nombre con la base. */
export function variantIsCurrent(url: string | undefined, baseUrl: string | undefined) {
  if (!url) return false
  if (!baseUrl) return true
  const variantRev = assetRevision(url)
  const baseRev = assetRevision(baseUrl)
  if (!variantRev && !baseRev) return true
  return variantRev !== null && variantRev === baseRev
}

function assetPath(url: string) {
  try {
    return new URL(url, 'https://local.invalid').pathname
  } catch {
    return url.split('?')[0] ?? url
  }
}

function namedWidth(url: string): 2048 | 4096 | 8192 | null {
  const match = assetPath(url).match(/_(2048|4096|8192)(?:-r\d+)?\./i)
  return match ? (Number(match[1]) as 2048 | 4096 | 8192) : null
}

/** Master sin sufijo o archivo `_8192`: en el teléfono no se pide tal cual. */
function isEightKAsset(url: string) {
  const width = namedWidth(url)
  return width === null || width === 8192
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

/** Pide a Supabase un derivado más chico. Null si la URL no es de Storage. */
export function tourRenderUrl(publicUrl: string, width: 2048 | 4096): string | null {
  try {
    const parsed = new URL(publicUrl)
    const objectPath = '/storage/v1/object/public/'
    const renderPath = '/storage/v1/render/image/public/'
    if (!parsed.pathname.includes(objectPath) && !parsed.pathname.includes(renderPath)) return null
    parsed.pathname = parsed.pathname.replace(objectPath, renderPath)
    parsed.searchParams.set('width', String(width))
    parsed.searchParams.set('resize', 'contain')
    parsed.searchParams.delete('height')
    return parsed.toString()
  } catch {
    return null
  }
}

/** 2048 en celular. 4096 solo con memoria holgada o un iPhone de pantalla grande. */
export function coarseTourWidth(): 2048 | 4096 {
  if (typeof navigator === 'undefined' || typeof window === 'undefined') return 2048
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory
  if (typeof memory === 'number' && memory >= 6) return 4096
  const iphone = /iPhone/.test(navigator.userAgent || '')
  const shortSide = Math.min(window.screen.width, window.screen.height)
  if (iphone && shortSide >= 390 && (window.devicePixelRatio || 1) >= 3) return 4096
  return 2048
}

/** En táctil: 2048 por defecto. Si solo queda un 8K, se pide el ancho que el teléfono aguanta. */
export function tourCoarsePanoUrl(baseUrl: string | null | undefined, eightKUrl?: string | null): string | null {
  const source =
    baseUrl && !isPngAssetUrl(baseUrl) ? baseUrl : eightKUrl && !isPngAssetUrl(eightKUrl) ? eightKUrl : null
  if (!source) return null
  const cap = coarseTourWidth()
  const width = namedWidth(source)
  if (width === 2048) return tourDisplayUrl(source)
  if (width === 4096) {
    return cap === 4096 ? tourDisplayUrl(source) : tourRenderUrl(source, 2048) ?? tourDisplayUrl(source)
  }
  if (!isEightKAsset(source)) return null
  return tourRenderUrl(source, cap)
}

/** Siguiente variante más chica tras un fallo del visor (8192 → 4096 → 2048). */
export function smallerTourUrl(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url, 'https://local.invalid')
    const render = parsed.pathname.includes('/storage/v1/render/image/')
    const widthParam = parsed.searchParams.get('width')
    if (render && widthParam === '4096') {
      parsed.searchParams.set('width', '2048')
      return absoluteOrRelative(parsed)
    }
    if (render) return null
    if (/_8192(-r\d+)?\./i.test(parsed.pathname)) {
      parsed.pathname = parsed.pathname.replace(/_8192(-r\d+)?\./i, '_4096$1.')
      return absoluteOrRelative(parsed)
    }
    if (/_4096(-r\d+)?\./i.test(parsed.pathname)) {
      parsed.pathname = parsed.pathname.replace(/_4096(-r\d+)?\./i, '_2048$1.')
      return absoluteOrRelative(parsed)
    }
    const absolute = absoluteOrRelative(parsed)
    return absolute ? tourRenderUrl(absolute, 4096) : null
  } catch {
    return null
  }
}

function absoluteOrRelative(parsed: URL) {
  const next = parsed.toString()
  return next.startsWith('https://local.invalid') ? next.slice('https://local.invalid'.length) : next
}

export function pointerIsCoarse(override?: boolean) {
  if (override === true) return true
  return false
}

function screenCap(): TourWidth {
  if (typeof window === 'undefined') return 8192
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false
  const small = Math.min(window.innerWidth, window.innerHeight) < 1024
  if (coarse) return coarseTourWidth()
  return small ? 4096 : 8192
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
  options?: { coarse?: boolean },
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
  const coarse = pointerIsCoarse(options?.coarse)
  const phoneCap = coarse ? coarseTourWidth() : null
  const order: Array<'2048' | '4096' | '8192'> = coarse
    ? phoneCap === 4096
      ? ['4096', '2048']
      : ['2048', '4096']
    : width >= 8192
      ? ['8192', '4096', '2048']
      : width >= 4096
        ? ['4096', '2048']
        : ['2048', '4096']
  for (const key of order) {
    const url = take(key)
    if (url) return url
  }
  if (coarse) return tourCoarsePanoUrl(baseUrl, variants['8192'])
  if (!baseUrl || isPngAssetUrl(baseUrl)) return null
  return tourDisplayUrl(baseUrl)
}
