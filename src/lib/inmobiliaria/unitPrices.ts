export type UnitPriceRow = {
  id: string; unit_number: string; category: string; floor_number: number | null; bedrooms: number | null
  area_internal_m2: number | null; published_commercial_price: number | null
  is_published: boolean; status: string; updated_at: string
}

export function parseCommercialPrice(input: string): number | null {
  if (typeof input !== 'string') throw new Error('Escriba el precio en USD o deje el campo vacío para retirarlo.')
  const value = input.trim()
  if (!value) return null
  let canonical = value
  if (/^\d+(?:[.,]\d{1,2})?$/.test(value)) canonical = value.replace(',', '.')
  else if (/^\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?$/.test(value)) canonical = value.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?$/.test(value)) canonical = value.replace(/,/g, '')
  else throw new Error('Escriba un precio válido en USD, por ejemplo 200000 o 200.000,50.')
  const number = Number(canonical)
  if (!Number.isFinite(number) || number <= 0 || number > 999_999_999.99) throw new Error('El precio debe ser mayor que cero y menor que mil millones. Para quitarlo, deje el campo vacío.')
  return Math.round(number * 100) / 100
}

export function botPriceStatus(unit: Pick<UnitPriceRow, 'is_published' | 'status' | 'published_commercial_price'>, mode: string) {
  if (!unit.published_commercial_price) return 'Sin precio'
  if (!unit.is_published) return 'Unidad sin publicar'
  if (unit.status !== 'disponible') return 'Unidad no disponible'
  if (mode !== 'preventa') return 'Oculto al bot en lanzamiento'
  return 'El bot puede informarlo'
}
