/**
 * IP del visitante desde cabeceras de plataforma (Vercel).
 * En Vercel solo usa headers que la edge controla; no confía en X-Forwarded-For
 * arbitrario ni en loopback/privadas (IP del runtime).
 */

export function isPrivateIp(ip: string) {
  return /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.|::1$|::ffff:127\.|0\.0\.0\.0$)/i.test(
    ip,
  )
}

function first(value: string | null | undefined) {
  const text = String(value ?? '').trim()
  return text || null
}

function isPlausiblePublicIp(ip: string) {
  if (isPrivateIp(ip)) return false
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return true
  if (ip.includes(':')) return true
  return false
}

export function pickTrustedClientIp(
  getHeader: (name: string) => string | null | undefined,
  opts?: { onVercel?: boolean },
): string | null {
  const onVercel = opts?.onVercel ?? false
  const names = onVercel
    ? ['x-vercel-forwarded-for', 'x-real-ip']
    : ['x-vercel-forwarded-for', 'cf-connecting-ip', 'x-real-ip', 'x-forwarded-for']

  for (const name of names) {
    const raw = first(getHeader(name))
    if (!raw) continue
    const ip = raw.split(',')[0]?.trim()
    if (ip && isPlausiblePublicIp(ip)) return ip
  }
  return null
}
