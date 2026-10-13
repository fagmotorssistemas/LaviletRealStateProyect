export type IncomeTaxBracket = { from: number; to: number | null; baseTax: number; rate: number }
export type TaxProfile = 'none_other' | 'lt12' | '12_25' | '25_45' | '45_80' | '80_120' | 'gt120' | 'company'

export const SRI_PERSONAL_INCOME_TAX_TABLE_2026: IncomeTaxBracket[] = [
  { from: 0, to: 12208, baseTax: 0, rate: 0 },
  { from: 12208, to: 15549, baseTax: 0, rate: 0.05 },
  { from: 15549, to: 20188, baseTax: 167, rate: 0.10 },
  { from: 20188, to: 26700, baseTax: 631, rate: 0.12 },
  { from: 26700, to: 35136, baseTax: 1412, rate: 0.15 },
  { from: 35136, to: 46575, baseTax: 2678, rate: 0.20 },
  { from: 46575, to: 62005, baseTax: 4965, rate: 0.25 },
  { from: 62005, to: 82679, baseTax: 8823, rate: 0.30 },
  { from: 82679, to: 109956, baseTax: 15025, rate: 0.35 },
  { from: 109956, to: null, baseTax: 24572, rate: 0.37 },
]

export const TAX_PROFILE_OTHER_INCOME: Record<Exclude<TaxProfile, 'company'>, number> = {
  none_other: 0,
  lt12: 6000,
  '12_25': 18500,
  '25_45': 35000,
  '45_80': 62500,
  '80_120': 100000,
  gt120: 150000,
}

export function isTaxProfile(value: unknown): value is TaxProfile {
  return value === 'company' || (typeof value === 'string' && value in TAX_PROFILE_OTHER_INCOME)
}

export function validIncomeTaxBrackets(value: unknown): value is IncomeTaxBracket[] {
  if (!Array.isArray(value) || !value.length) return false
  return value.every((row, index) => {
    if (!row || typeof row !== 'object') return false
    const { from, to, baseTax, rate } = row as IncomeTaxBracket
    return Number.isFinite(from) && from >= 0 && Number.isFinite(baseTax) && baseTax >= 0 &&
      Number.isFinite(rate) && rate >= 0 && rate <= 1 &&
      (to === null ? index === value.length - 1 : Number.isFinite(to) && to > from && index < value.length - 1 &&
        (value[index + 1] as IncomeTaxBracket)?.from === to) &&
      (index !== 0 || from === 0)
  })
}

export function resolvedIncomeTaxBrackets(value: unknown) {
  return validIncomeTaxBrackets(value)
    ? { brackets: value, fallback: false }
    : { brackets: SRI_PERSONAL_INCOME_TAX_TABLE_2026, fallback: true }
}

export function personalIncomeTax(base: number, brackets: IncomeTaxBracket[]): number {
  const taxable = Math.max(0, Number(base) || 0)
  const bracket = brackets.find((row) => taxable >= row.from && (row.to === null || taxable < row.to))
  return bracket ? Math.max(0, bracket.baseTax + (taxable - bracket.from) * bracket.rate) : 0
}

export function incrementalPersonalIncomeTax(otherAnnualIncome: number, rentalTaxableBase: number, brackets: IncomeTaxBracket[]): number {
  const other = Math.max(0, Number(otherAnnualIncome) || 0)
  return Math.max(0, personalIncomeTax(other + Math.max(0, rentalTaxableBase), brackets) - personalIncomeTax(other, brackets))
}

export function cadastralValueFor(unit: { cadastral_value?: number | null } | null | undefined, price: number) {
  const actual = Number(unit?.cadastral_value)
  return actual > 0 && Number.isFinite(actual)
    ? { value: actual, cadastralIsEstimated: false }
    : { value: Math.max(0, Number(price) || 0), cadastralIsEstimated: true }
}

export function maxLegalMonthlyRent(cadastral: number) {
  return Math.max(0, Number(cadastral) || 0) * 0.10 / 12
}

export function cuencaCapitalGainsTax(gain: number, yearsHeld: number) {
  return Math.max(0, Number(gain) || 0) * Math.max(0, 0.10 - 0.005 * Math.max(0, yearsHeld))
}

export function acquisitionCostsFor(price: number, percentage: number, fixed: number) {
  return Math.max(0, price) * Math.max(0, percentage) / 100 + Math.max(0, fixed)
}

export function buildingFeeForUnit(
  unit: { monthly_building_fee?: number | null; area_total_m2?: number | null; area_internal_m2?: number | null } | null | undefined,
  config: { building_fee_per_m2_monthly?: number | null; annual_maintenance: number },
) {
  if (unit?.monthly_building_fee != null && Number.isFinite(Number(unit.monthly_building_fee))) return Math.max(0, Number(unit.monthly_building_fee)) * 12
  const area = Number(unit?.area_total_m2 ?? unit?.area_internal_m2)
  if (config.building_fee_per_m2_monthly != null && Number.isFinite(area) && area > 0) {
    return Math.max(0, Number(config.building_fee_per_m2_monthly)) * area * 12
  }
  return Math.max(0, Number(config.annual_maintenance) || 0)
}

export function annualIrrFromMonthlyCashFlows(flows: number[]): number | null {
  if (flows.length < 2 || !flows.some((value) => value < 0) || !flows.some((value) => value > 0)) return null
  const npv = (rate: number) => flows.reduce((sum, amount, month) => sum + amount / (1 + rate) ** month, 0)
  let low = -0.5
  let high = 1
  if (npv(low) * npv(high) > 0) return null
  for (let i = 0; i < 160; i++) {
    const mid = (low + high) / 2
    if (npv(low) * npv(mid) <= 0) high = mid
    else low = mid
  }
  const rate = (low + high) / 2
  return Number.isFinite(rate) ? ((1 + rate) ** 12 - 1) * 100 : null
}
