import type { FinancingConfig, FinancingPartner, InvestmentPreview } from '@/types/financingSimulator'

/** Misma fórmula que RPC calculate_monthly_payment. */
export function calculateMonthlyPayment(principal: number, annualRatePercent: number, years: number) {
  const months = Math.max(1, Math.round(years * 12))
  const monthlyRate = annualRatePercent / 100 / 12
  if (monthlyRate === 0) return round2(principal / months)
  const factor = (1 + monthlyRate) ** months
  return round2((principal * (monthlyRate * factor)) / (factor - 1))
}

export function suggestedRentForBedrooms(config: FinancingConfig, bedrooms: number | null | undefined) {
  const beds = bedrooms ?? 1
  if (beds <= 0) return Number(config.avg_studio_rent ?? 800)
  if (beds === 1) return Number(config.avg_one_bed_rent ?? 1200)
  if (beds === 2) return Number(config.avg_two_bed_rent ?? 1800)
  return Number(config.avg_three_bed_rent ?? 2500)
}

export function suggestedUnitPrice(bedrooms: number | null | undefined) {
  const beds = bedrooms ?? 1
  if (beds <= 0) return 85000
  if (beds === 1) return 120000
  if (beds === 2) return 165000
  return 210000
}

export function defaultAnnualExpenses(unitPrice: number, config: FinancingConfig) {
  return round2(
    (Math.max(0, unitPrice) * Number(config.annual_property_tax || 0)) / 100 +
      Number(config.annual_maintenance || 0) +
      Number(config.annual_insurance || 0),
  )
}

/** Alquiler mensual estimado ≈ yield anual del precio / 12 (p. ej. 6% anual). */
export function suggestedRentFromUnitPrice(unitPrice: number, annualYieldPct = 6) {
  const price = Math.max(0, Number(unitPrice) || 0)
  const yieldPct = Math.max(0, Number(annualYieldPct) || 0)
  return round2((price * (yieldPct / 100)) / 12)
}

/** Inversión al contado: alquiler − gastos / precio (sin crédito). */
export function buildCashInvestmentPreview(input: {
  unitPrice: number
  estimatedMonthlyRent: number
  annualExpenses?: number | null
  config: FinancingConfig
}): InvestmentPreview {
  const unitPrice = Math.max(0, Number(input.unitPrice) || 0)
  const estimatedMonthlyRent = Math.max(0, Number(input.estimatedMonthlyRent) || 0)
  const annualExpenses =
    input.annualExpenses != null && Number.isFinite(Number(input.annualExpenses))
      ? round2(Math.max(0, Number(input.annualExpenses)))
      : defaultAnnualExpenses(unitPrice, input.config)
  const annualGrossRental = round2(
    estimatedMonthlyRent * 12 * (1 - Number(input.config.vacancy_rate || 0)),
  )
  const annualNetCashFlow = round2(annualGrossRental - annualExpenses)
  const roiPercent = unitPrice > 0 ? round2((annualNetCashFlow / unitPrice) * 100) : null
  const paybackYears = annualNetCashFlow > 0 ? round2(unitPrice / annualNetCashFlow) : null
  const breakevenMonth =
    annualNetCashFlow > 0 ? Math.ceil((unitPrice * 12) / annualNetCashFlow) : null

  return {
    unitPrice,
    downPaymentPercent: 100,
    downPaymentAmount: unitPrice,
    financedAmount: 0,
    interestRate: 0,
    financingYears: 0,
    monthlyPayment: 0,
    annualMortgagePaid: 0,
    annualExpenses,
    annualGrossRental,
    annualNetCashFlow,
    roiPercent,
    paybackYears,
    breakevenMonth,
    isProfitable: annualNetCashFlow > 0,
  }
}

export function buildInvestmentPreview(input: {
  unitPrice: number
  downPaymentPercent: number
  financingYears: number
  estimatedMonthlyRent: number
  interestRate: number
  config: FinancingConfig
}): InvestmentPreview {
  const unitPrice = Math.max(0, Number(input.unitPrice) || 0)
  const downPaymentPercent = clamp(Number(input.downPaymentPercent) || 0, 10, 50)
  const financingYears = Math.max(1, Math.round(Number(input.financingYears) || 1))
  const estimatedMonthlyRent = Math.max(0, Number(input.estimatedMonthlyRent) || 0)
  const interestRate = Number(input.interestRate) || 0
  const downPaymentAmount = round2((unitPrice * downPaymentPercent) / 100)
  const financedAmount = round2(Math.max(0, unitPrice - downPaymentAmount))
  const monthlyPayment = calculateMonthlyPayment(financedAmount, interestRate, financingYears)
  const annualMortgagePaid = round2(monthlyPayment * 12)
  const annualExpenses = defaultAnnualExpenses(unitPrice, input.config)
  const annualGrossRental = round2(
    estimatedMonthlyRent * 12 * (1 - Number(input.config.vacancy_rate || 0)),
  )
  const annualNetCashFlow = round2(annualGrossRental - annualMortgagePaid - annualExpenses)
  const roiPercent =
    downPaymentAmount > 0 ? round2((annualNetCashFlow / downPaymentAmount) * 100) : null
  const paybackYears =
    annualNetCashFlow > 0 ? round2(downPaymentAmount / annualNetCashFlow) : null
  const breakevenMonth =
    annualNetCashFlow > 0 ? Math.ceil((downPaymentAmount * 12) / annualNetCashFlow) : null

  return {
    unitPrice,
    downPaymentPercent,
    downPaymentAmount,
    financedAmount,
    interestRate,
    financingYears,
    monthlyPayment,
    annualMortgagePaid,
    annualExpenses,
    annualGrossRental,
    annualNetCashFlow,
    roiPercent,
    paybackYears,
    breakevenMonth,
    isProfitable: annualNetCashFlow > 0,
  }
}

export function comparePartners(input: {
  unitPrice: number
  downPaymentPercent: number
  financingYears: number
  estimatedMonthlyRent: number
  partners: FinancingPartner[]
  config: FinancingConfig
}) {
  return input.partners.map((partner) => {
    const years = clampYears(input.financingYears, partner)
    return {
      partner,
      preview: buildInvestmentPreview({
        ...input,
        financingYears: years,
        interestRate: Number(partner.annual_interest_rate),
      }),
    }
  })
}

export function clampYears(years: number, partner: FinancingPartner) {
  const min = partner.min_financing_years ?? 5
  const max = partner.max_financing_years ?? 30
  return clamp(Math.round(years), min, max)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function formatMoney(value: number | null | undefined, currency = 'USD') {
  const amount = Number(value) || 0
  return new Intl.NumberFormat('es-EC', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount)
}

export function formatPercent(value: number | null | undefined, digits = 1) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return `${Number(value).toFixed(digits)}%`
}
