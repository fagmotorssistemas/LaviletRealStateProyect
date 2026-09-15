/** Cookies y click IDs del Pixel. */

export function readCookie(name: string): string {
  if (typeof document === 'undefined') return ''
  const row = document.cookie.split('; ').find((part) => part.startsWith(`${name}=`))
  return row ? decodeURIComponent(row.split('=').slice(1).join('=')) : ''
}

export function readFbclid(): string {
  if (typeof window === 'undefined') return ''
  return new URLSearchParams(window.location.search).get('fbclid')?.trim() || ''
}

export function readFbp(): string {
  return readCookie('_fbp')
}

export function readFbc(): string {
  return readCookie('_fbc')
}

/** Solo construye fbc desde fbclid real (formato Meta). */
export function buildFbcFromFbclid(fbclid: string, existingFbc = readFbc()): string {
  if (existingFbc && /^fb\.\d+\.\d+\./.test(existingFbc)) return existingFbc
  if (!fbclid) return ''
  return `fb.1.${Date.now()}.${fbclid}`
}

export function getMetaClickIds() {
  const fbclid = readFbclid()
  const fbp = readFbp()
  const fbc = buildFbcFromFbclid(fbclid)
  return { fbclid, fbp, fbc }
}
