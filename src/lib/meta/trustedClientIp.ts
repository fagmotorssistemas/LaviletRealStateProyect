/**
 * IP del visitante desde cabeceras de plataforma (Vercel).
 * En Vercel solo usa headers que la edge controla; no confía en X-Forwarded-For
 * arbitrario ni en loopback/privadas (IP del runtime).
 */

type ParsedIp =
  | { kind: 'ipv4'; octets: [number, number, number, number] }
  | { kind: 'ipv6'; groups: number[]; mappedV4: [number, number, number, number] | null }

function parseIpv4Octets(ip: string): [number, number, number, number] | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  const octets: number[] = []
  for (const part of parts) {
    // Rechaza vacíos, no-dígitos y leading zeros (salvo "0")
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return null
    const n = Number(part)
    if (!Number.isInteger(n) || n < 0 || n > 255) return null
    octets.push(n)
  }
  return octets as [number, number, number, number]
}

function isNonPublicIpv4(octets: [number, number, number, number]): boolean {
  const [a, b] = octets
  if (a === 0 || a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true // link-local
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 100 && b >= 64 && b <= 127) return true // CGNAT
  if (a >= 224) return true // multicast / reserved
  return false
}

function parseIpv6Groups(raw: string): number[] | null {
  const bare = raw.trim().toLowerCase().split('%')[0]
  if (!bare || bare.includes(':::')) return null

  let addr = bare
  const v4Tail = /:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(addr)
  if (v4Tail) {
    const v4 = parseIpv4Octets(v4Tail[1])
    if (!v4) return null
    const hi = ((v4[0] << 8) | v4[1]).toString(16)
    const lo = ((v4[2] << 8) | v4[3]).toString(16)
    addr = `${addr.slice(0, -v4Tail[1].length)}${hi}:${lo}`
  }

  if (!addr.includes(':')) return null
  const sides = addr.split('::')
  if (sides.length > 2) return null

  const parseSide = (side: string): number[] | null => {
    if (!side) return []
    const parts = side.split(':')
    const out: number[] = []
    for (const part of parts) {
      if (!/^[0-9a-f]{1,4}$/.test(part)) return null
      out.push(parseInt(part, 16))
    }
    return out
  }

  if (sides.length === 1) {
    const groups = parseSide(sides[0])
    if (!groups || groups.length !== 8) return null
    return groups
  }

  const left = parseSide(sides[0])
  const right = parseSide(sides[1])
  if (!left || !right) return null
  const missing = 8 - left.length - right.length
  if (missing < 1) return null
  return [...left, ...Array(missing).fill(0), ...right]
}

function mappedIpv4FromGroups(
  groups: number[],
): [number, number, number, number] | null {
  // ::ffff:a.b.c.d → 0:0:0:0:0:ffff:XXXX:YYYY
  if (
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0xffff
  ) {
    const hi = groups[6]
    const lo = groups[7]
    return [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff]
  }
  return null
}

function parseIp(ip: string): ParsedIp | null {
  const text = String(ip ?? '').trim()
  if (!text) return null

  if (text.includes('.')) {
    // IPv4 o IPv4-mapped con notación decimal en cola
    if (text.includes(':')) {
      const groups = parseIpv6Groups(text)
      if (!groups) return null
      return {
        kind: 'ipv6',
        groups,
        mappedV4: mappedIpv4FromGroups(groups),
      }
    }
    const octets = parseIpv4Octets(text)
    if (!octets) return null
    return { kind: 'ipv4', octets }
  }

  if (text.includes(':')) {
    const groups = parseIpv6Groups(text)
    if (!groups) return null
    return {
      kind: 'ipv6',
      groups,
      mappedV4: mappedIpv4FromGroups(groups),
    }
  }

  return null
}

function isNonPublicIpv6(groups: number[]): boolean {
  const mapped = mappedIpv4FromGroups(groups)
  if (mapped) return isNonPublicIpv4(mapped)

  // :: / ::1
  const allZero = groups.every((g) => g === 0)
  if (allZero) return true
  if (
    groups[0] === 0 &&
    groups[1] === 0 &&
    groups[2] === 0 &&
    groups[3] === 0 &&
    groups[4] === 0 &&
    groups[5] === 0 &&
    groups[6] === 0 &&
    groups[7] === 1
  ) {
    return true
  }

  // fe80::/10 link-local
  if ((groups[0] & 0xffc0) === 0xfe80) return true
  // fc00::/7 unique local
  if ((groups[0] & 0xfe00) === 0xfc00) return true
  // ff00::/8 multicast
  if ((groups[0] & 0xff00) === 0xff00) return true

  return false
}

/** True si es una IP válida no enrutable / privada / loopback / link-local / ULA / mapped privada. */
export function isPrivateIp(ip: string): boolean {
  const parsed = parseIp(ip)
  if (!parsed) return false
  if (parsed.kind === 'ipv4') return isNonPublicIpv4(parsed.octets)
  return isNonPublicIpv6(parsed.groups)
}

/** True solo para IPv4/IPv6 sintácticamente válidas y públicamente enrutables. */
export function isPublicClientIp(ip: string): boolean {
  const parsed = parseIp(ip)
  if (!parsed) return false
  if (parsed.kind === 'ipv4') return !isNonPublicIpv4(parsed.octets)
  return !isNonPublicIpv6(parsed.groups)
}

function first(value: string | null | undefined) {
  const text = String(value ?? '').trim()
  return text || null
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
    if (ip && isPublicClientIp(ip)) return ip
  }
  return null
}
