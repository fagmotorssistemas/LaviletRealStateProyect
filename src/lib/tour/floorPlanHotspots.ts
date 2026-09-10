/**
 * Alcance de storage de planos por piso (edificio completo, no por tipología/suite).
 * Las zonas se relacionan al showroom por número de unidad.
 */
export const FLOOR_PLAN_SCOPE = 'edificio'

export type FloorPlanLevel = {
  /** Clave numérica estable (API / matching de unidades) */
  id: number
  /** Etiqueta CRM / accesibilidad */
  label: string
  /** Etiqueta corta en el selector del tour */
  shortLabel: string
  /** Sufijo en storage: floor-{storageKey}-plan.webp */
  storageKey: string
}

/**
 * Orden de planos del edificio:
 * Subsuelo 1 → Subsuelo 2 → Planta baja → Plantas 1–6 → Terraza
 */
export const FLOOR_PLAN_LEVELS: readonly FloorPlanLevel[] = [
  { id: -1, label: 'Subsuelo 1', shortLabel: 'S1', storageKey: 's1' },
  { id: -2, label: 'Subsuelo 2', shortLabel: 'S2', storageKey: 's2' },
  { id: 0, label: 'Planta baja', shortLabel: 'PB', storageKey: 'pb' },
  { id: 1, label: 'Primera planta alta', shortLabel: '1', storageKey: '1' },
  { id: 2, label: 'Segunda planta alta', shortLabel: '2', storageKey: '2' },
  { id: 3, label: 'Tercera planta alta', shortLabel: '3', storageKey: '3' },
  { id: 4, label: 'Cuarta planta alta', shortLabel: '4', storageKey: '4' },
  { id: 5, label: 'Quinta planta alta', shortLabel: '5', storageKey: '5' },
  { id: 6, label: 'Sexta planta alta', shortLabel: '6', storageKey: '6' },
  { id: 7, label: 'Terraza', shortLabel: 'T', storageKey: 'terraza' },
] as const

export const FLOOR_PLAN_FLOORS = FLOOR_PLAN_LEVELS.map((level) => level.id)

export const FLOOR_PLAN_DEFAULT_FLOOR = 0

export function isFloorPlanLevel(floor: number): boolean {
  return FLOOR_PLAN_LEVELS.some((level) => level.id === floor)
}

export function floorPlanLevelById(floor: number): FloorPlanLevel | null {
  return FLOOR_PLAN_LEVELS.find((level) => level.id === floor) ?? null
}

export function floorPlanLevelLabel(floor: number): string {
  return floorPlanLevelById(floor)?.label ?? `Piso ${floor}`
}

export function floorPlanLevelShort(floor: number): string {
  return floorPlanLevelById(floor)?.shortLabel ?? String(floor)
}

export function floorPlanStorageKey(floor: number): string {
  return floorPlanLevelById(floor)?.storageKey ?? String(floor)
}

function normalizeFloorText(raw: string) {
  return raw
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
}

export function parseFloorNumber(raw: string | null | undefined): number | null {
  if (!raw) return null
  const s = normalizeFloorText(String(raw))
  if (!s) return null

  if (/^(terraza|terrasa|t)$/.test(s) || s.includes('terraza')) return 7
  if (/^(planta\s*baja|pb|p\.?\s*b\.?|0)$/.test(s) || s.includes('planta baja')) return 0
  if (/subsuelo\s*2|s\.?\s*2|ss\s*2|^-2$/.test(s)) return -2
  if (/subsuelo\s*1|s\.?\s*1|ss\s*1|^-1$/.test(s)) return -1
  if (/subsuelo|sotano|sótano/.test(s)) {
    const sub = s.match(/(\d{1,2})/)
    if (sub) {
      const n = Number(sub[1])
      if (n === 1 || n === 2) return -n
    }
  }

  // "Primera Planta Alta", "2da planta alta", etc.
  const ordinal: Array<{ re: RegExp; floor: number }> = [
    { re: /\b(primera|1ra|1er|1ª|1°)\b/, floor: 1 },
    { re: /\b(segunda|2da|2do|2ª|2°)\b/, floor: 2 },
    { re: /\b(tercera|3ra|3er|3ª|3°)\b/, floor: 3 },
    { re: /\b(cuarta|4ta|4to|4ª|4°)\b/, floor: 4 },
    { re: /\b(quinta|5ta|5to|5ª|5°)\b/, floor: 5 },
    { re: /\b(sexta|6ta|6to|6ª|6°)\b/, floor: 6 },
  ]
  if (/planta\s*alta/.test(s) || (/planta/.test(s) && !/baja/.test(s))) {
    for (const item of ordinal) {
      if (item.re.test(s)) return item.floor
    }
  }

  const planta = s.match(/planta\s*(alta\s*)?(\d{1,2})/)
  if (planta) {
    const n = Number(planta[2])
    return Number.isFinite(n) && n >= 1 && n <= 6 ? n : null
  }

  const piso = s.match(/piso\s*(\d{1,2})/)
  if (piso) {
    const n = Number(piso[1])
    return Number.isFinite(n) && isFloorPlanLevel(n) ? n : null
  }

  if (/^-?\d{1,2}$/.test(s)) {
    const n = Number(s)
    return isFloorPlanLevel(n) ? n : null
  }

  const match = s.match(/(\d{1,2})/)
  if (!match) return null
  const n = Number(match[1])
  return Number.isFinite(n) && isFloorPlanLevel(n) ? n : null
}

/** Deriva nivel desde floor_number, "Primera Planta Alta", "PB", "301", etc. */
export function unitFloorNumber(unit: {
  floor?: string | null
  floor_number?: number | null
  unit_number?: string | null
}): number | null {
  if (unit.floor_number != null && Number.isFinite(unit.floor_number) && isFloorPlanLevel(unit.floor_number)) {
    return unit.floor_number
  }
  const fromFloor = parseFloorNumber(unit.floor)
  if (fromFloor != null) return fromFloor
  const code = unit.unit_number?.trim() ?? ''
  if (/^\d{3,}$/.test(code)) {
    const digits = code.length === 3 ? 1 : 2
    const n = Number(code.slice(0, digits))
    return Number.isFinite(n) && isFloorPlanLevel(n) ? n : null
  }
  return parseFloorNumber(code)
}
