/** Deep link / share limpio de unidad en el showroom. */

export const UNIT_QUERY_KEY = 'unidad'
export const UNIT_SHARE_PATH = '/inicio'

/** Solo origen + /inicio?unidad=208 — sin tracking ni otros params. */
export function buildUnitShareUrl(unitNumber: string, opts?: { origin?: string }) {
  const raw = (unitNumber || '').trim()
  const origin =
    opts?.origin ||
    (typeof window !== 'undefined' ? window.location.origin : 'https://lavilet.com')
  const url = new URL(UNIT_SHARE_PATH, origin)
  if (raw) url.searchParams.set(UNIT_QUERY_KEY, raw)
  return url.toString()
}

export function readUnitQueryParam(search?: string): string | null {
  const raw =
    search ??
    (typeof window !== 'undefined' ? window.location.search : '')
  const value = new URLSearchParams(raw).get(UNIT_QUERY_KEY)?.trim()
  return value || null
}

export function writeUnitQueryParam(unitNumber: string | null) {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  const raw = (unitNumber || '').trim()
  // Mantener path actual (inicio / tour / showroom) pero dejar solo `unidad` limpio.
  const next = new URL(url.pathname, url.origin)
  if (raw) next.searchParams.set(UNIT_QUERY_KEY, raw)
  window.history.replaceState(null, '', `${next.pathname}${next.search}`)
}

export function findUnitByNumber<T extends { unit_number: string }>(
  units: T[],
  unitNumber: string | null | undefined,
): T | null {
  const normalize = (value: string) =>
    value
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[_–—]/g, '-')
  const needle = normalize(unitNumber || '')
  if (!needle) return null
  return (
    units.find((item) => normalize(item.unit_number) === needle) ??
    units.find((item) => normalize(item.unit_number).startsWith(needle)) ??
    units.find((item) => needle.startsWith(normalize(item.unit_number))) ??
    null
  )
}
