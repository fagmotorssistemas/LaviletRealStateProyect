/**
 * Formato de specs de unidad para ficha / PDF (showroom).
 */
import type { TourUnitSummary } from '@/types/tour'

function plural(n: number, one: string, many: string) {
  return n === 1 ? one : many
}

/** Ej: "2 baños completos y 1 baño social" — nunca "2 + 1". */
export function formatBathroomsEs(
  full?: number | null,
  half?: number | null,
  total?: number | null,
): string {
  const f = full != null && full > 0 ? full : 0
  const h = half != null && half > 0 ? half : 0
  if (f === 0 && h === 0) {
    if (total != null && total > 0) {
      return `${total} ${plural(total, 'baño', 'baños')}`
    }
    return '—'
  }
  const parts: string[] = []
  if (f > 0) {
    parts.push(`${f} ${plural(f, 'baño completo', 'baños completos')}`)
  }
  if (h > 0) {
    parts.push(`${h} ${plural(h, 'baño social', 'baños sociales')}`)
  }
  if (parts.length === 1) return parts[0]
  return `${parts[0]} y ${parts[1]}`
}

export function formatAreaM2(value: number | null | undefined): string {
  if (value == null) return '—'
  return `${Number(value).toLocaleString('es-AR', { maximumFractionDigits: 2 })} m²`
}

export type FichaSpecRow = { label: string; value: string }

function computeTotalM2(unit: TourUnitSummary): number | null {
  if (unit.area_total_m2 != null) return unit.area_total_m2
  const parts = [
    unit.area_internal_m2,
    unit.area_exterior_m2,
    unit.area_terrace_covered_m2,
    unit.area_terrace_open_m2,
  ].filter((n): n is number => n != null && n > 0)
  if (parts.length === 0) return null
  return parts.reduce((a, b) => a + b, 0)
}

/** Filas de ficha: superficies + tipología + baños en texto claro. */
export function buildFichaSpecRows(unit: TourUnitSummary): FichaSpecRow[] {
  const internal = unit.area_internal_m2 ?? null
  const total = computeTotalM2(unit)
  const rows: FichaSpecRow[] = [
    { label: 'Superficie total', value: formatAreaM2(total) },
  ]
  if (internal != null) {
    rows.push({ label: 'Superficie cubierta', value: formatAreaM2(internal) })
  }
  if (unit.area_exterior_m2 != null) {
    rows.push({ label: 'Superficie exterior', value: formatAreaM2(unit.area_exterior_m2) })
  }
  if (unit.area_terrace_covered_m2 != null) {
    rows.push({ label: 'Superficie semi cub.', value: formatAreaM2(unit.area_terrace_covered_m2) })
  }
  if (unit.area_terrace_open_m2 != null) {
    rows.push({ label: 'Terraza descubierta', value: formatAreaM2(unit.area_terrace_open_m2) })
  }
  rows.push(
    {
      label: 'Dormitorios',
      value: unit.bedrooms != null ? String(unit.bedrooms) : '—',
    },
    {
      label: 'Baños',
      value: formatBathroomsEs(unit.bathrooms_full, unit.bathrooms_half, unit.bathrooms),
    },
    { label: 'Piso', value: unit.floor?.trim() || '—' },
  )
  if (unit.typology_code) {
    rows.push({ label: 'Tipología', value: unit.typology_code })
  }
  return rows
}
