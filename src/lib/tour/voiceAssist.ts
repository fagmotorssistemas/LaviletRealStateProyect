import type { TourUnitSummary } from '@/types/tour'
import { unitFloorNumber } from '@/lib/tour/floorPlanHotspots'

/** Filtros que extrae el modelo a partir de lo que dijo el visitante. */
export type VoiceAssistFilters = {
  bedrooms: number | null
  bathrooms: number | null
  floor_min: number | null
  floor_max: number | null
  /** Preferencia vaga cuando no hay número de piso. */
  floor_pref: 'bajo' | 'medio' | 'alto' | null
  price_min: number | null
  price_max: number | null
  typology_code: string | null
  only_available: boolean
  area_min_m2: number | null
}

export type VoiceAssistUnitCard = {
  id: string
  unit_number: string
  floor: string | null
  floor_number: number | null
  bedrooms: number | null
  bathrooms: number | null
  area_total_m2: number | null
  price: number | null
  status: string
  typology_code: string | null
  blurb: string
}

export type VoiceAssistResult = {
  transcript: string
  speak: string
  filters: VoiceAssistFilters
  matches: VoiceAssistUnitCard[]
  follow_up: string | null
}

export type VoiceAssistCatalogUnit = {
  id: string
  unit_number: string
  floor: string | null
  floor_number: number | null
  bedrooms: number | null
  bathrooms: number | null
  area_total_m2: number | null
  price: number | null
  status: string
  typology_code: string | null
}

export const EMPTY_VOICE_FILTERS: VoiceAssistFilters = {
  bedrooms: null,
  bathrooms: null,
  floor_min: null,
  floor_max: null,
  floor_pref: null,
  price_min: null,
  price_max: null,
  typology_code: null,
  only_available: true,
  area_min_m2: null,
}

const OFFERABLE = new Set(['disponible', 'en_preventa'])

export function toVoiceCatalog(units: TourUnitSummary[]): VoiceAssistCatalogUnit[] {
  return units.map((u) => ({
    id: u.id,
    unit_number: u.unit_number,
    floor: u.floor,
    floor_number: unitFloorNumber(u),
    bedrooms: u.bedrooms,
    bathrooms: u.bathrooms,
    area_total_m2: u.area_total_m2,
    price: u.published_commercial_price,
    status: String(u.status ?? ''),
    typology_code: u.typology_code ?? null,
  }))
}

function formatPriceShort(value: number | null) {
  if (value == null || !Number.isFinite(value)) return null
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2).replace(/\.00$/, '')}M`
  if (value >= 1000) return `$${Math.round(value / 1000)}k`
  return `$${Math.round(value)}`
}

function unitBlurb(u: VoiceAssistCatalogUnit) {
  const bits: string[] = []
  if (u.bedrooms != null) bits.push(`${u.bedrooms} dorm.`)
  if (u.bathrooms != null) bits.push(`${u.bathrooms} baños`)
  if (u.floor) bits.push(`piso ${u.floor}`)
  else if (u.floor_number != null) bits.push(`piso ${u.floor_number}`)
  const price = formatPriceShort(u.price)
  if (price) bits.push(price)
  return bits.join(' · ') || 'Ver ficha'
}

function floorPrefRange(pref: VoiceAssistFilters['floor_pref']): { min: number; max: number } | null {
  if (pref === 'bajo') return { min: 0, max: 2 }
  if (pref === 'medio') return { min: 2, max: 4 }
  if (pref === 'alto') return { min: 4, max: 99 }
  return null
}

function scoreUnit(u: VoiceAssistCatalogUnit, f: VoiceAssistFilters): number | null {
  if (f.only_available !== false && !OFFERABLE.has(u.status)) return null

  let score = 0

  if (f.bedrooms != null) {
    if (u.bedrooms == null) return null
    if (u.bedrooms !== f.bedrooms) return null
    score += 8
  }

  if (f.bathrooms != null) {
    if (u.bathrooms == null) score -= 1
    else if (u.bathrooms >= f.bathrooms) score += 4
    else return null
  }

  if (f.typology_code) {
    if ((u.typology_code || '').toUpperCase() === f.typology_code.toUpperCase()) score += 6
    else return null
  }

  if (f.price_max != null && u.price != null) {
    if (u.price > f.price_max) return null
    score += 3
  }
  if (f.price_min != null && u.price != null) {
    if (u.price < f.price_min) return null
    score += 2
  }

  if (f.area_min_m2 != null && u.area_total_m2 != null) {
    if (u.area_total_m2 < f.area_min_m2) return null
    score += 2
  }

  const floor = u.floor_number
  if (f.floor_min != null || f.floor_max != null) {
    if (floor == null) score -= 1
    else {
      if (f.floor_min != null && floor < f.floor_min) return null
      if (f.floor_max != null && floor > f.floor_max) return null
      score += 4
    }
  } else if (f.floor_pref) {
    const range = floorPrefRange(f.floor_pref)
    if (range && floor != null) {
      if (floor < range.min || floor > range.max) score -= 3
      else score += 4
    }
  }

  if (OFFERABLE.has(u.status)) score += 1
  return score
}

export function matchVoiceUnits(
  catalog: VoiceAssistCatalogUnit[],
  filters: VoiceAssistFilters,
  limit = 3,
): VoiceAssistUnitCard[] {
  const ranked = catalog
    .map((u) => ({ u, score: scoreUnit(u, filters) }))
    .filter((row): row is { u: VoiceAssistCatalogUnit; score: number } => row.score != null)
    .sort((a, b) => b.score - a.score || a.u.unit_number.localeCompare(b.u.unit_number, 'es', { numeric: true }))
    .slice(0, limit)

  return ranked.map(({ u }) => ({
    id: u.id,
    unit_number: u.unit_number,
    floor: u.floor,
    floor_number: u.floor_number,
    bedrooms: u.bedrooms,
    bathrooms: u.bathrooms,
    area_total_m2: u.area_total_m2,
    price: u.price,
    status: u.status,
    typology_code: u.typology_code,
    blurb: unitBlurb(u),
  }))
}

export function buildSpeakLine(matches: VoiceAssistUnitCard[], filters: VoiceAssistFilters): {
  speak: string
  follow_up: string | null
} {
  if (matches.length === 0) {
    return {
      speak:
        'Con eso no encontré opciones ahora. ¿Probamos cambiando dormitorios, el piso o el presupuesto? Estoy para ayudarte.',
      follow_up: 'Dime otra idea y busco de nuevo con gusto.',
    }
  }

  const nums = matches.map((m) => m.unit_number).join(', ')
  const bits: string[] = []
  if (filters.bedrooms != null) bits.push(`${filters.bedrooms} dormitorios`)
  if (filters.floor_pref) bits.push(`piso ${filters.floor_pref}`)
  if (filters.price_max != null) bits.push(`hasta ${formatPriceShort(filters.price_max)}`)

  const need = bits.length ? ` con ${bits.join(', ')}` : ''
  if (matches.length === 1) {
    return {
      speak: `¡Perfecto! Encontré la unidad ${nums}${need}. ${matches[0].blurb}. ¿La vemos juntos?`,
      follow_up: 'Toca la opción o pídeme otra búsqueda cuando quieras.',
    }
  }
  return {
    speak: `¡Qué bien! Tengo ${matches.length} opciones${need}: ${nums}. ¿Cuál te gustaría ver primero?`,
    follow_up: 'Toca una unidad o pídeme otro filtro, sin problema.',
  }
}

export function normalizeFilters(raw: Partial<VoiceAssistFilters> | null | undefined): VoiceAssistFilters {
  const n = (v: unknown) => {
    if (v == null || v === '') return null
    const num = typeof v === 'number' ? v : Number(v)
    return Number.isFinite(num) ? num : null
  }
  const pref = raw?.floor_pref
  return {
    bedrooms: n(raw?.bedrooms),
    bathrooms: n(raw?.bathrooms),
    floor_min: n(raw?.floor_min),
    floor_max: n(raw?.floor_max),
    floor_pref: pref === 'bajo' || pref === 'medio' || pref === 'alto' ? pref : null,
    price_min: n(raw?.price_min),
    price_max: n(raw?.price_max),
    typology_code: raw?.typology_code ? String(raw.typology_code).trim() || null : null,
    only_available: raw?.only_available !== false,
    area_min_m2: n(raw?.area_min_m2),
  }
}

const WORD_NUM: Record<string, number> = {
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
}

function parseNumberToken(raw: string): number | null {
  const t = raw.trim().toLowerCase()
  if (WORD_NUM[t] != null) return WORD_NUM[t]
  const n = Number(t.replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function parseMoney(raw: string): number | null {
  const t = raw.toLowerCase().replace(/\s+/g, ' ').trim()
  const mill = t.match(/(\d+(?:[.,]\d+)?)\s*(millones|millon|millón|m)\b/)
  if (mill) {
    const n = Number(mill[1].replace(',', '.'))
    return Number.isFinite(n) ? Math.round(n * 1_000_000) : null
  }
  const mil = t.match(/(\d+(?:[.,]\d+)?)\s*(mil|k)\b/)
  if (mil) {
    const n = Number(mil[1].replace(',', '.'))
    return Number.isFinite(n) ? Math.round(n * 1000) : null
  }
  const plain = t.match(/\$?\s*(\d{2,3}(?:[.,]\d{3})+|\d{4,7})\b/)
  if (plain) {
    const n = Number(plain[1].replace(/\./g, '').replace(',', ''))
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Parser local: alcanza para “2 dormitorios / piso alto / hasta 180 mil” sin gastar cuota OpenAI. */
export function parseVoiceFiltersLocal(transcript: string): VoiceAssistFilters {
  const t = transcript
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()

  const filters = { ...EMPTY_VOICE_FILTERS }

  const bed =
    t.match(/(\d+|un|uno|una|dos|tres|cuatro|cinco|seis)\s*(dormitorios?|habitaciones?|cuartos?)/) ||
    t.match(/(dormitorios?|habitaciones?|cuartos?)\s*(de\s*)?(\d+|un|uno|una|dos|tres|cuatro|cinco|seis)/)
  if (bed) {
    const token = bed[3] || bed[1]
    filters.bedrooms = parseNumberToken(token)
  }

  const bath =
    t.match(/(\d+|un|uno|una|dos|tres|cuatro)\s*ba[nñ]os?/) ||
    t.match(/ba[nñ]os?\s*(de\s*)?(\d+|un|uno|una|dos|tres|cuatro)/)
  if (bath) {
    const token = bath[3] || bath[2] || bath[1]
    filters.bathrooms = parseNumberToken(token)
  }

  const floorNum = t.match(/piso(?:s)?\s*(\d{1,2})\b/) || t.match(/\bplanta\s*(\d{1,2})\b/)
  if (floorNum) {
    const n = Number(floorNum[1])
    if (Number.isFinite(n)) {
      filters.floor_min = n
      filters.floor_max = n
    }
  } else if (
    /\b(piso|planta)\s+(alto|altos|alta|altas)\b/.test(t) ||
    /\b(ultima|ultimo|azotea)\b/.test(t) ||
    (/\balto\b/.test(t) && /\bpiso\b/.test(t))
  ) {
    filters.floor_pref = 'alto'
  } else if (
    /\b(piso|planta)\s+(bajo|bajos|baja|bajas)\b/.test(t) ||
    /\bplanta baja\b/.test(t) ||
    (/\bbajo\b/.test(t) && /\bpiso\b/.test(t))
  ) {
    filters.floor_pref = 'bajo'
  } else if (/\b(piso|planta)\s+(medio|intermedio)\b/.test(t)) {
    filters.floor_pref = 'medio'
  }

  const until = t.match(/(hasta|maximo|m[aá]ximo|menos de|por debajo de|no mas de|no m[aá]s de)\s+([^,.]+)/)
  if (until) {
    const money = parseMoney(until[2])
    if (money != null) filters.price_max = money
  } else {
    const money = parseMoney(t)
    if (money != null && /(presupuesto|plata|dolares|d[oó]lares|usd|\$|mil|millon)/.test(t)) {
      filters.price_max = money
    }
  }

  if (/\b(disponible|disponibles|libres|en venta|preventa)\b/.test(t)) {
    filters.only_available = true
  }

  return normalizeFilters(filters)
}

export function filtersHaveSignal(filters: VoiceAssistFilters): boolean {
  return (
    filters.bedrooms != null ||
    filters.bathrooms != null ||
    filters.floor_min != null ||
    filters.floor_max != null ||
    filters.floor_pref != null ||
    filters.price_min != null ||
    filters.price_max != null ||
    Boolean(filters.typology_code) ||
    filters.area_min_m2 != null
  )
}
