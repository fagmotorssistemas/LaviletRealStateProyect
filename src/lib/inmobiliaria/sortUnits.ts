import type { Unit } from '@/types/inmobiliaria'

const unitNumberCollator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' })

/** Orden natural por número de unidad (1, 2, 10 antes que 2 en texto; 201, 301 por valor numérico). */
export function compareUnitsByUnitNumber(a: Unit, b: Unit): number {
  const cmp = unitNumberCollator.compare(a.unit_number ?? '', b.unit_number ?? '')
  if (cmp !== 0) return cmp
  return a.id.localeCompare(b.id)
}
