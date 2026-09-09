import { GENERATED_FLOOR_PLAN_SLOTS } from '@/lib/tour/floorPlanSlots.generated'

/** Plano típico del showroom: zonas en % del ancho/alto de la imagen. */
export const FLOOR_PLAN_IMAGE = '/plano-piso.jpg'
export const FLOOR_PLAN_FLOORS = [1, 2, 3, 4, 5, 6, 7] as const

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

export function parseFloorNumber(raw: string | null | undefined): number | null {
  if (!raw) return null
  const match = String(raw).match(/(\d{1,2})/)
  if (!match) return null
  const n = Number(match[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Deriva piso desde "Piso 3", "3", "301", "3A", etc. */
export function unitFloorNumber(unit: {
  floor?: string | null
  unit_number?: string | null
}): number | null {
  const fromFloor = parseFloorNumber(unit.floor)
  if (fromFloor != null) return fromFloor
  const code = unit.unit_number?.trim() ?? ''
  if (/^\d{3,}$/.test(code)) return Number(code.slice(0, code.length === 3 ? 1 : 2)) || null
  return parseFloorNumber(code)
}
