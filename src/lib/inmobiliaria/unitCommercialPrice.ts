export function calculateUnitCommercialPrice(costPerM2: number | null, areaM2: number | null): number | null {
  if (costPerM2 == null || areaM2 == null || !Number.isFinite(costPerM2) || !Number.isFinite(areaM2) || costPerM2 < 0 || areaM2 < 0) return null
  const price = costPerM2 * areaM2
  return Number.isFinite(price) ? Math.round((price + Number.EPSILON) * 100) / 100 : null
}
