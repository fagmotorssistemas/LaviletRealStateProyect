import { GENERATED_FLOOR_PLAN_SLOTS } from '@/lib/tour/floorPlanSlots.generated'

/** Plano típico del showroom: zonas en % del ancho/alto de la imagen. */
export const FLOOR_PLAN_IMAGE = '/plano-piso.jpg'

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
 * Subsuelo 1 → Subsuelo 2 → Planta baja → Plantas 1–5 → Terraza
 */
export const FLOOR_PLAN_LEVELS: readonly FloorPlanLevel[] = [
  { id: -1, label: 'Subsuelo 1', shortLabel: 'S1', storageKey: 's1' },
  { id: -2, label: 'Subsuelo 2', shortLabel: 'S2', storageKey: 's2' },
  { id: 0, label: 'Planta baja', shortLabel: 'PB', storageKey: 'pb' },
  { id: 1, label: 'Planta 1', shortLabel: '1', storageKey: '1' },
  { id: 2, label: 'Planta 2', shortLabel: '2', storageKey: '2' },
  { id: 3, label: 'Planta 3', shortLabel: '3', storageKey: '3' },
  { id: 4, label: 'Planta 4', shortLabel: '4', storageKey: '4' },
  { id: 5, label: 'Planta 5', shortLabel: '5', storageKey: '5' },
  { id: 6, label: 'Terraza', shortLabel: 'T', storageKey: 'terraza' },
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

export type FloorPlanSlot = {
  id: string
  /** Etiqueta corta sobre el plano */
  label: string
  /** Orden de mapeo a unidades del piso (0-based) */
  order: number
  /** Polígono en coordenadas 0–100 (viewBox porcentual) */
  points: string
}

/**
 * Contornos generados por `npm run tour:segment-floor`
 * (medianeras del plano + flood-fill hasta el muro real de cada depto).
 */
export const FLOOR_PLAN_SLOTS: FloorPlanSlot[] = GENERATED_FLOOR_PLAN_SLOTS.map((slot) => ({
  id: slot.id,
  label: slot.label,
  order: slot.order,
  points: slot.points,
}))

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

  if (/^(terraza|terrasa|t)$/.test(s) || s.includes('terraza')) return 6
  if (/^(planta\s*baja|pb|p\.?\s*b\.?|0)$/.test(s)) return 0
  if (/subsuelo\s*2|s\.?\s*2|ss\s*2|^-2$/.test(s)) return -2
  if (/subsuelo\s*1|s\.?\s*1|ss\s*1|^-1$/.test(s)) return -1
  if (/subsuelo|sotano|sótano/.test(s)) {
    const sub = s.match(/(\d{1,2})/)
    if (sub) {
      const n = Number(sub[1])
      if (n === 1 || n === 2) return -n
    }
  }

  const planta = s.match(/planta\s*(\d{1,2})/)
  if (planta) {
    const n = Number(planta[1])
    return Number.isFinite(n) && n >= 1 && n <= 5 ? n : null
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

/** Deriva nivel desde "Planta 3", "Subsuelo 1", "PB", "301", etc. */
export function unitFloorNumber(unit: {
  floor?: string | null
  unit_number?: string | null
}): number | null {
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
