/**
 * Modo conservador Core Setup (Preview / configuración básica).
 * - event_source_url = origen real únicamente
 * - Sin custom_data hacia CAPI (content_*)
 *
 * Nota: sanear nuestra URL de negocio NO altera lo que fbevents.js pueda
 * capturar del document.location; por eso el Preview usa Pixel en simulación.
 */

export function isMetaCoreSetupConservative(): boolean {
  const raw = (
    process.env.NEXT_PUBLIC_META_CORE_SETUP_CONSERVATIVE ||
    process.env.META_CORE_SETUP_CONSERVATIVE ||
    'true'
  )
    .trim()
    .toLowerCase()
  if (!raw) return true
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on'
}

const FINANCING_PATH_RE = /^\/simulador(?:\/|$)/i

export function isMetaFinancingPath(pathname: string): boolean {
  return FINANCING_PATH_RE.test(pathname || '')
}

/** Solo scheme://host[:port]. null si inválida o ruta de financiamiento. */
export function sanitizeMetaEventSourceUrl(raw?: string | null): string | null {
  if (!raw || typeof raw !== 'string') return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (isMetaFinancingPath(url.pathname)) return null
    if (isMetaCoreSetupConservative()) return url.origin
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

export function currentMetaEventSourceUrl(): string | undefined {
  if (typeof window === 'undefined') return undefined
  return sanitizeMetaEventSourceUrl(window.location.href) || undefined
}
