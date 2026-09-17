import type {
  ExpenseBreakdown,
  FinancingConfig,
  FinancingPartner,
  InvestmentPreview,
  RateType,
  SimulationMode,
} from '@/types/financingSimulator'

/** Versión de fórmulas; escenarios históricos deben conservar la suya. */
export const CALCULATION_VERSION = 'investment-v2'

/** Entrada unificada (UI + API). */
export const DOWN_PAYMENT_MIN_PCT = 10
export const DOWN_PAYMENT_MAX_PCT = 70
export const FINANCING_YEARS_MIN = 5
export const FINANCING_YEARS_MAX = 30

export type BuildInvestmentInput = {
  unitPrice: number
  mode: SimulationMode
  estimatedMonthlyRent: number
  vacancyRate: number
  /** Gastos operativos anuales (predial + mant. + seguro + otros), sin gestión. */
  annualOperatingExpenses: number
  annualManagement?: number
  /** Estimación anual manual de IR; null/0 = antes de IR. */
  annualIncomeTaxEstimate?: number | null
  /** Costos de adquisición/adecuación con recursos propios. */
  acquisitionCosts?: number
  /** Otros costos financieros recurrentes anuales (seguros de crédito, etc.). */
  annualOtherFinancialCosts?: number
  downPaymentPercent?: number
  financingYears?: number
  /** Tasa en % según rateType. */
  interestRate?: number
  rateType?: RateType
  /** Cuota de seguros/cargos adicionales al servicio de deuda (mensual). */
  monthlyExtraCharges?: number
}

/** Redondeo a 2 decimales (política de dinero). */
export function round2(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function roundMoney(value: number) {
  return round2(value)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

export function clampDownPaymentPercent(value: number) {
  return clamp(Math.round((Number(value) || 0) * 100) / 100, DOWN_PAYMENT_MIN_PCT, DOWN_PAYMENT_MAX_PCT)
}

export function clampFinancingYears(years: number, partner?: FinancingPartner | null) {
  const min = partner?.min_financing_years ?? FINANCING_YEARS_MIN
  const max = partner?.max_financing_years ?? FINANCING_YEARS_MAX
  return clamp(Math.round(Number(years) || FINANCING_YEARS_MIN), min, max)
}

/** @deprecated Prefer clampFinancingYears */
export function clampYears(years: number, partner: FinancingPartner) {
  return clampFinancingYears(years, partner)
}

/**
 * Tasa mensual a partir de tasa anual.
 * - nominal_annual: i/12 (convención francesa habitual en cotizadores).
 * - effective_annual: (1+ea)^(1/12)-1.
 */
export function monthlyRateFromAnnual(annualRatePercent: number, rateType: RateType = 'nominal_annual') {
  const annual = Number(annualRatePercent) || 0
  if (annual === 0) return 0
  if (rateType === 'effective_annual') {
    return (1 + annual / 100) ** (1 / 12) - 1
  }
  return annual / 100 / 12
}

/** Cuota francesa; misma base que RPC calculate_monthly_payment cuando rateType=nominal. */
export function calculateMonthlyPayment(
  principal: number,
  annualRatePercent: number,
  years: number,
  rateType: RateType = 'nominal_annual',
) {
  const months = Math.max(1, Math.round(years * 12))
  const monthlyRate = monthlyRateFromAnnual(annualRatePercent, rateType)
  if (!(principal > 0)) return 0
  if (monthlyRate === 0) return roundMoney(principal / months)
  const factor = (1 + monthlyRate) ** months
  return roundMoney((principal * (monthlyRate * factor)) / (factor - 1))
}

export function expenseBreakdownFromConfig(unitPrice: number, config: FinancingConfig): ExpenseBreakdown {
  const propertyTax = roundMoney((Math.max(0, unitPrice) * Number(config.annual_property_tax || 0)) / 100)
  const maintenance = roundMoney(Number(config.annual_maintenance || 0))
  const insurance = roundMoney(Number(config.annual_insurance || 0))
  return {
    propertyTax,
    maintenance,
    insurance,
    other: 0,
    total: roundMoney(propertyTax + maintenance + insurance),
  }
}

export function defaultAnnualExpenses(unitPrice: number, config: FinancingConfig) {
  return expenseBreakdownFromConfig(unitPrice, config).total
}

export function sumExpenseBreakdown(b: Partial<ExpenseBreakdown> | null | undefined) {
  if (!b) return 0
  return roundMoney(
    Number(b.propertyTax || 0) +
      Number(b.maintenance || 0) +
      Number(b.insurance || 0) +
      Number(b.other || 0),
  )
}

/** Alquiler sugerido por dormitorios (solo residencial). */
export function suggestedRentForBedrooms(config: FinancingConfig, bedrooms: number | null | undefined) {
  const beds = bedrooms ?? 1
  if (beds <= 0) return Number(config.avg_studio_rent ?? 800)
  if (beds === 1) return Number(config.avg_one_bed_rent ?? 1200)
  if (beds === 2) return Number(config.avg_two_bed_rent ?? 1800)
  return Number(config.avg_three_bed_rent ?? 2500)
}

/** Estimación por yield anual del precio (no es oferta de mercado verificada). */
export function suggestedRentFromUnitPrice(unitPrice: number, annualYieldPct = 6) {
  const price = Math.max(0, Number(unitPrice) || 0)
  const yieldPct = Math.max(0, Number(annualYieldPct) || 0)
  return roundMoney((price * (yieldPct / 100)) / 12)
}

export type RentSuggestion = {
  amount: number
  source: 'bedrooms' | 'price_yield' | 'none'
  label: string
}

/**
 * Sugiere alquiler según categoría.
 * Local/comercial: no aplica tabla residencial por dormitorios.
 */
export function suggestMonthlyRent(input: {
  config: FinancingConfig | null
  unitPrice: number
  bedrooms?: number | null
  category?: string | null
}): RentSuggestion {
  const cat = String(input.category ?? '').toLowerCase()
  const isCommercial =
    cat.includes('local') ||
    cat.includes('comercial') ||
    cat.includes('office') ||
    cat.includes('oficina') ||
    cat.includes('bodega')

  if (isCommercial) {
    if (input.unitPrice > 0) {
      return {
        amount: suggestedRentFromUnitPrice(input.unitPrice, 6),
        source: 'price_yield',
        label: 'Estimación orientativa (~6% anual del precio; no es cotización de mercado)',
      }
    }
    return { amount: 0, source: 'none', label: 'Sin estimación residencial para esta categoría' }
  }

  if (input.config) {
    const fromBeds = suggestedRentForBedrooms(input.config, input.bedrooms)
    if (fromBeds > 0) {
      return {
        amount: fromBeds,
        source: 'bedrooms',
        label: 'Estimación por dormitorios (promedios del proyecto)',
      }
    }
  }

  if (input.unitPrice > 0) {
    return {
      amount: suggestedRentFromUnitPrice(input.unitPrice, 6),
      source: 'price_yield',
      label: 'Estimación orientativa (~6% anual del precio)',
    }
  }

  return { amount: 0, source: 'none', label: 'Sin precio ni referencia de alquiler' }
}

/** @deprecated No sustituir precio publicado; usar null / hipotético explícito. */
export function suggestedUnitPrice(_bedrooms?: number | null) {
  return 0
}

export function buildOperatingMetrics(input: {
  estimatedMonthlyRent: number
  vacancyRate: number
  annualOperatingExpenses: number
  annualManagement?: number
}) {
  const monthlyRent = Math.max(0, Number(input.estimatedMonthlyRent) || 0)
  const vacancy = clamp(Number(input.vacancyRate) || 0, 0, 1)
  const annualPotentialRental = roundMoney(monthlyRent * 12)
  // Vacancia una sola vez sobre el potencial.
  const annualEffectiveRental = roundMoney(annualPotentialRental * (1 - vacancy))
  const annualOperatingExpenses = roundMoney(Math.max(0, Number(input.annualOperatingExpenses) || 0))
  const annualManagement = roundMoney(Math.max(0, Number(input.annualManagement) || 0))
  const annualOperatingResult = roundMoney(
    annualEffectiveRental - annualOperatingExpenses - annualManagement,
  )
  return {
    vacancyRate: vacancy,
    annualPotentialRental,
    annualEffectiveRental,
    annualOperatingExpenses,
    annualManagement,
    annualOperatingResult,
  }
}

/**
 * Preview unificado contado / financiado / manual.
 * - Rendimiento operativo = resultado operativo / precio.
 * - Retorno de caja = flujo anual / efectivo inicial aportado (no “rentabilidad total”).
 */
export function buildInvestmentPreview(input: BuildInvestmentInput): InvestmentPreview {
  const unitPrice = Math.max(0, Number(input.unitPrice) || 0)
  const mode: SimulationMode = input.mode === 'financed' || input.mode === 'manual' ? input.mode : 'cash'
  const rateType: RateType = input.rateType ?? 'nominal_annual'
  const acquisitionCosts = roundMoney(Math.max(0, Number(input.acquisitionCosts) || 0))
  const annualOtherFinancialCosts = roundMoney(Math.max(0, Number(input.annualOtherFinancialCosts) || 0))
  const monthlyExtraCharges = roundMoney(Math.max(0, Number(input.monthlyExtraCharges) || 0))
  const annualIncomeTaxEstimate =
    input.annualIncomeTaxEstimate != null && Number(input.annualIncomeTaxEstimate) > 0
      ? roundMoney(Number(input.annualIncomeTaxEstimate))
      : 0

  const ops = buildOperatingMetrics({
    estimatedMonthlyRent: input.estimatedMonthlyRent,
    vacancyRate: input.vacancyRate,
    annualOperatingExpenses: input.annualOperatingExpenses,
    annualManagement: input.annualManagement,
  })

  let downPaymentPercent = 100
  let downPaymentAmount = unitPrice
  let financedAmount = 0
  let interestRate = 0
  let financingYears = 0
  let monthlyPayment = 0
  let monthlyDebtService = 0
  let annualMortgagePaid = 0
  let annualExtraCharges = 0

  if (mode !== 'cash') {
    downPaymentPercent = clampDownPaymentPercent(input.downPaymentPercent ?? 30)
    downPaymentAmount = roundMoney((unitPrice * downPaymentPercent) / 100)
    financedAmount = roundMoney(Math.max(0, unitPrice - downPaymentAmount))
    interestRate = Math.max(0, Number(input.interestRate) || 0)
    financingYears = clampFinancingYears(input.financingYears ?? 20)
    monthlyPayment = calculateMonthlyPayment(financedAmount, interestRate, financingYears, rateType)
    annualExtraCharges = roundMoney(monthlyExtraCharges * 12)
    monthlyDebtService = roundMoney(monthlyPayment + monthlyExtraCharges)
    annualMortgagePaid = roundMoney(monthlyPayment * 12)
  }

  const initialCashOutlay = roundMoney(
    (mode === 'cash' ? unitPrice : downPaymentAmount) + acquisitionCosts,
  )

  const annualDebtService = roundMoney(annualMortgagePaid + annualExtraCharges + annualOtherFinancialCosts)
  const annualCashFlowBeforeTax = roundMoney(ops.annualOperatingResult - annualDebtService)
  const annualCashFlowAfterTax = roundMoney(annualCashFlowBeforeTax - annualIncomeTaxEstimate)
  const annualNetCashFlow = annualCashFlowBeforeTax
  const monthlyCashFlow = roundMoney(annualNetCashFlow / 12)
  const buyerTopUpMonthly =
    monthlyCashFlow < 0 ? roundMoney(Math.abs(monthlyCashFlow)) : 0

  const operatingYieldOnPrice =
    unitPrice > 0 ? roundMoney((ops.annualOperatingResult / unitPrice) * 100) : null
  const cashOnCashReturn =
    initialCashOutlay > 0 ? roundMoney((annualNetCashFlow / initialCashOutlay) * 100) : null

  // Cobertura: ingreso operativo neto vs servicio de deuda (no alquiler bruto).
  const debtCoverageRatio =
    annualDebtService > 0 ? roundMoney(ops.annualOperatingResult / annualDebtService) : null

  // Recuperación simple: solo si flujo > 0; no extrapola cuotas más allá del plazo.
  let paybackYears: number | null = null
  let paybackLabel: string | null = null
  if (annualNetCashFlow > 0 && initialCashOutlay > 0) {
    const years = roundMoney(initialCashOutlay / annualNetCashFlow)
    const maxHorizon = mode === 'cash' ? Infinity : financingYears
    if (years <= maxHorizon) {
      paybackYears = years
      paybackLabel = `${years.toFixed(1)} años (flujo constante; sin apreciación)`
    } else {
      paybackYears = null
      paybackLabel =
        'No recuperable con el flujo actual dentro del plazo del crédito (supuesto: flujo constante; sin venta ni valorización)'
    }
  } else if (annualNetCashFlow <= 0) {
    paybackLabel = 'No recuperable con el flujo actual'
  }

  const breakevenMonth =
    annualNetCashFlow > 0 && initialCashOutlay > 0
      ? Math.ceil((initialCashOutlay * 12) / annualNetCashFlow)
      : null

  // Compat: roiPercent = retorno de caja (no llamar “rentabilidad total” en UI).
  const roiPercent = cashOnCashReturn

  return {
    calculationVersion: CALCULATION_VERSION,
    mode,
    rateType,
    unitPrice,
    downPaymentPercent,
    downPaymentAmount,
    financedAmount,
    interestRate,
    financingYears,
    monthlyPayment,
    monthlyExtraCharges,
    monthlyDebtService,
    annualMortgagePaid,
    annualExtraCharges,
    annualOtherFinancialCosts,
    annualDebtService,
    acquisitionCosts,
    initialCashOutlay,
    vacancyRate: ops.vacancyRate,
    annualPotentialRental: ops.annualPotentialRental,
    annualEffectiveRental: ops.annualEffectiveRental,
    /** @deprecated alias de annualEffectiveRental (compat). */
    annualGrossRental: ops.annualEffectiveRental,
    annualOperatingExpenses: ops.annualOperatingExpenses,
    annualManagement: ops.annualManagement,
    /** Compat: gastos operativos sin gestión (el desglose UI muestra gestión aparte). */
    annualExpenses: ops.annualOperatingExpenses,
    annualOperatingResult: ops.annualOperatingResult,
    annualCashFlowBeforeTax,
    annualIncomeTaxEstimate,
    annualCashFlowAfterTax,
    annualNetCashFlow,
    monthlyCashFlow,
    buyerTopUpMonthly,
    operatingYieldOnPrice,
    cashOnCashReturn,
    roiPercent,
    debtCoverageRatio,
    paybackYears,
    paybackLabel,
    breakevenMonth,
    isProfitable: annualNetCashFlow > 0,
    assumptions: {
      vacancyAppliedOnce: true,
      incomeTaxIncluded: annualIncomeTaxEstimate > 0,
      rateType,
      rateIsBankOffer: false,
      recoveryMethod: 'simple_constant_cashflow',
      excludesAppreciationAndSale: true,
    },
  }
}

/** Contado = modo cash del preview unificado. */
export function buildCashInvestmentPreview(input: {
  unitPrice: number
  estimatedMonthlyRent: number
  annualExpenses?: number | null
  vacancyRate?: number
  annualManagement?: number
  config: FinancingConfig
}): InvestmentPreview {
  const annualOperatingExpenses =
    input.annualExpenses != null && Number.isFinite(Number(input.annualExpenses))
      ? roundMoney(Math.max(0, Number(input.annualExpenses)))
      : defaultAnnualExpenses(input.unitPrice, input.config)
  return buildInvestmentPreview({
    mode: 'cash',
    unitPrice: input.unitPrice,
    estimatedMonthlyRent: input.estimatedMonthlyRent,
    vacancyRate:
      input.vacancyRate != null ? Number(input.vacancyRate) : Number(input.config.vacancy_rate || 0),
    annualOperatingExpenses,
    annualManagement: input.annualManagement,
  })
}

export function comparePartners(input: {
  unitPrice: number
  downPaymentPercent: number
  financingYears: number
  estimatedMonthlyRent: number
  vacancyRate: number
  annualOperatingExpenses: number
  annualManagement?: number
  partners: FinancingPartner[]
  config: FinancingConfig
  rateType?: RateType
}) {
  return input.partners.map((partner) => {
    const years = clampFinancingYears(input.financingYears, partner)
    return {
      partner,
      preview: buildInvestmentPreview({
        mode: 'financed',
        unitPrice: input.unitPrice,
        downPaymentPercent: input.downPaymentPercent,
        financingYears: years,
        estimatedMonthlyRent: input.estimatedMonthlyRent,
        vacancyRate: input.vacancyRate,
        annualOperatingExpenses: input.annualOperatingExpenses,
        annualManagement: input.annualManagement,
        interestRate: Number(partner.annual_interest_rate),
        rateType: input.rateType ?? 'nominal_annual',
      }),
    }
  })
}

export function formatMoney(value: number | null | undefined, currency = 'USD') {
  const amount = Number(value) || 0
  return new Intl.NumberFormat('es-EC', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount)
}

export function formatMoneyExact(value: number | null | undefined, currency = 'USD') {
  const amount = Number(value) || 0
  return new Intl.NumberFormat('es-EC', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

export function formatPercent(value: number | null | undefined, digits = 2) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return `${Number(value).toFixed(digits)}%`
}
