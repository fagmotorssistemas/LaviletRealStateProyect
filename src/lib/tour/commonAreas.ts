/** Tipologías de áreas comunes. No son unidades en venta. */
export const COMMON_AREAS = [
  { code: 'PISCINA', es: 'Piscina', en: 'Pool' },
  { code: 'DESCANSO', es: 'Zona de descanso', en: 'Lounge area' },
  { code: 'SPA', es: 'Spa', en: 'Spa' },
  { code: 'GYM', es: 'Gym', en: 'Gym' },
  { code: 'LOBBY', es: 'Lobby', en: 'Lobby' },
] as const

export type CommonAreaCode = (typeof COMMON_AREAS)[number]['code']
export type CommonArea = (typeof COMMON_AREAS)[number]

export const COMMON_AREA_GROUP = 'Áreas comunes'
const ZONE_PREFIX = 'area:'

export function isCommonAreaCode(code: string | null | undefined): code is CommonAreaCode {
  const normalized = (code ?? '').trim().toUpperCase()
  return COMMON_AREAS.some((area) => area.code === normalized)
}

export function commonAreaByCode(code: string | null | undefined): CommonArea | null {
  const normalized = (code ?? '').trim().toUpperCase()
  return COMMON_AREAS.find((area) => area.code === normalized) ?? null
}

export function commonAreaZoneId(code: string): string {
  return `${ZONE_PREFIX}${code.trim().toUpperCase()}`
}

/** `area:GYM` o el código pelado `GYM` → el área. Cualquier otro id no es un área común. */
export function commonAreaFromZoneId(zoneId: string | null | undefined): CommonArea | null {
  const raw = (zoneId ?? '').trim()
  if (!raw) return null
  if (raw.toLowerCase().startsWith(ZONE_PREFIX)) return commonAreaByCode(raw.slice(ZONE_PREFIX.length))
  return commonAreaByCode(raw)
}

export function commonAreaLabel(area: CommonArea, locale: 'es' | 'en'): string {
  return locale === 'en' ? area.en : area.es
}
