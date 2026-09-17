import type {
  ExpenseBreakdown,
  FinancingConfig,
  FinancingPartner,
  InvestmentPreview,
  MonthlyCoverage,
  RateType,
  SimulationMode,
  ViabilityLevel,
} from '@/types/financingSimulator'

/** Versión de fórmulas; escenarios históricos deben conservar la suya. */
export const CALCULATION_VERSION = 'investment-v3'

/** IR sobre alquiler efectivo (tras vacancia). */
export const INCOME_TAX_RATE = 0.25
/** Comisión gestor sobre alquiler efectivo. */
export const MANAGEMENT_FEE_RATE = 0.08

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
  /** Gastos operativos anuales (predial + mant. + seguro + otros), sin gestión ni IR. */
  annualOperatingExpenses: number
  /** @deprecated Prefer includePropertyManager; si se pasa con flag false se ignora. */
  annualManagement?: number
  /** @deprecated Prefer includeIncomeTax. */
  annualIncomeTaxEstimate?: number | null
  /** Default true: aplica 25% sobre alquiler efectivo. */
  includeIncomeTax?: boolean
  /** Default true: aplica 8% sobre alquiler efectivo. */
  includePropertyManager?: boolean
  incomeTaxRate?: number
  managementFeeRate?: number
  acquisitionCosts?: number
  annualOtherFinancialCosts?: number
  downPaymentPercent?: number
  financingYears?: number
  interestRate?: number
  rateType?: RateType
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

export function suggestedRentForBedrooms(config: FinancingConfig, bedrooms: number | null | undefined) {
  const beds = bedrooms ?? 1
  if (beds <= 0) return Number(config.avg_studio_rent ?? 800)
  if (beds === 1) return Number(config.avg_one_bed_rent ?? 1200)
  if (beds === 2) return Number(config.avg_two_bed_rent ?? 1800)
  return Number(config.avg_three_bed_rent ?? 2500)
}

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
  const annualVacancyCost = roundMoney(annualPotentialRental * vacancy)
  const annualEffectiveRental = roundMoney(annualPotentialRental - annualVacancyCost)
  const annualOperatingExpenses = roundMoney(Math.max(0, Number(input.annualOperatingExpenses) || 0))
  const annualManagement = roundMoney(Math.max(0, Number(input.annualManagement) || 0))
  const annualOperatingResult = roundMoney(
    annualEffectiveRental - annualOperatingExpenses - annualManagement,
  )
  return {
    vacancyRate: vacancy,
    annualPotentialRental,
    annualVacancyCost,
    annualEffectiveRental,
    annualOperatingExpenses,
    annualManagement,
    annualOperatingResult,
  }
}

/** Cobertura alquiler bruto vs cuota (sin gastos). */
export function buildMonthlyCoverage(monthlyRent: number, monthlyPayment: number): MonthlyCoverage {
  const rent = roundMoney(Math.max(0, Number(monthlyRent) || 0))
  const payment = roundMoney(Math.max(0, Number(monthlyPayment) || 0))
  const difference = roundMoney(rent - payment)
  let status: MonthlyCoverage['status']
  if (difference > 0) status = 'covers'
  else if (difference > -500) status = 'borderline'
  else status = 'insufficient'
  return { monthlyRent: rent, monthlyPayment: payment, difference, status }
}

export function viabilityFromAnnualSaldo(saldoAnual: number): ViabilityLevel {
  if (saldoAnual >= 0) return 'viable'
  if (saldoAnual > -5000) return 'borderline'
  return 'critical'
}

/**
 * Preview unificado contado / financiado / manual (v3).
 * Saldo anual = alquiler efectivo − gastos op. − gestión − IR − servicio de deuda.
 * ROI entrada = saldo / efectivo inicial; ROI precio = saldo / precio.
 */
export function buildInvestmentPreview(input: BuildInvestmentInput): InvestmentPreview {
  const unitPrice = Math.max(0, Number(input.unitPrice) || 0)
  const mode: SimulationMode = input.mode === 'financed' || input.mode === 'manual' ? input.mode : 'cash'
  const rateType: RateType = input.rateType ?? 'nominal_annual'
  const acquisitionCosts = roundMoney(Math.max(0, Number(input.acquisitionCosts) || 0))
  const annualOtherFinancialCosts = roundMoney(Math.max(0, Number(input.annualOtherFinancialCosts) || 0))
  const monthlyExtraCharges = roundMoney(Math.max(0, Number(input.monthlyExtraCharges) || 0))

  const includeIncomeTax = input.includeIncomeTax !== false
  const includePropertyManager = input.includePropertyManager !== false
  const incomeTaxRate = clamp(Number(input.incomeTaxRate ?? INCOME_TAX_RATE) || 0, 0, 1)
  const managementFeeRate = clamp(Number(input.managementFeeRate ?? MANAGEMENT_FEE_RATE) || 0, 0, 1)

  // Primero alquiler efectivo (sin gestión) para basar % IR / gestor.
  const vacancy = clamp(Number(input.vacancyRate) || 0, 0, 1)
  const monthlyRent = Math.max(0, Number(input.estimatedMonthlyRent) || 0)
  const annualPotentialRental = roundMoney(monthlyRent * 12)
  const annualVacancyCost = roundMoney(annualPotentialRental * vacancy)
  const annualEffectiveRental = roundMoney(annualPotentialRental - annualVacancyCost)

  const annualManagement = includePropertyManager
    ? roundMoney(annualEffectiveRental * managementFeeRate)
    : 0
  const annualIncomeTaxEstimate = includeIncomeTax
    ? roundMoney(annualEffectiveRental * incomeTaxRate)
    : 0

  const ops = buildOperatingMetrics({
    estimatedMonthlyRent: input.estimatedMonthlyRent,
    vacancyRate: input.vacancyRate,
    annualOperatingExpenses: input.annualOperatingExpenses,
    annualManagement,
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
  // Resultado operativo ya resta gestión; IR se resta después.
  const annualCashFlowBeforeTax = roundMoney(ops.annualOperatingResult - annualDebtService)
  const annualCashFlowAfterTax = roundMoney(annualCashFlowBeforeTax - annualIncomeTaxEstimate)
  /** Saldo anual real (incluye IR y gestor). */
  const annualNetCashFlow = annualCashFlowAfterTax
  const monthlyCashFlow = roundMoney(annualNetCashFlow / 12)
  const buyerTopUpMonthly =
    monthlyCashFlow < 0 ? roundMoney(Math.abs(monthlyCashFlow)) : 0

  const totalAnnualCosts = roundMoney(
    ops.annualOperatingExpenses + annualManagement + annualIncomeTaxEstimate + annualDebtService,
  )

  const cashOnCashReturn =
    initialCashOutlay > 0 ? roundMoney((annualNetCashFlow / initialCashOutlay) * 100) : null
  const roiOnTotalPrice =
    unitPrice > 0 ? roundMoney((annualNetCashFlow / unitPrice) * 100) : null
  /** Compat: rendimiento operativo sin deuda/IR (solo ops). */
  const operatingYieldOnPrice =
    unitPrice > 0 ? roundMoney((ops.annualOperatingResult / unitPrice) * 100) : null

  const debtCoverageRatio =
    annualDebtService > 0 ? roundMoney(ops.annualOperatingResult / annualDebtService) : null

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

  const rawBreakevenMonth =
    annualNetCashFlow > 0 && initialCashOutlay > 0
      ? Math.ceil((initialCashOutlay * 12) / annualNetCashFlow)
      : null
  const maxMonths = mode === 'cash' ? Number.POSITIVE_INFINITY : financingYears * 12
  const breakevenMonth =
    rawBreakevenMonth != null && rawBreakevenMonth <= maxMonths ? rawBreakevenMonth : null

  const monthlyCoverage = buildMonthlyCoverage(monthlyRent, monthlyPayment)
  const viabilityLevel = viabilityFromAnnualSaldo(annualNetCashFlow)
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
    annualVacancyCost: ops.annualVacancyCost,
    annualEffectiveRental: ops.annualEffectiveRental,
    annualGrossRental: ops.annualEffectiveRental,
    annualOperatingExpenses: ops.annualOperatingExpenses,
    annualManagement: ops.annualManagement,
    annualExpenses: ops.annualOperatingExpenses,
    annualOperatingResult: ops.annualOperatingResult,
    annualCashFlowBeforeTax,
    annualIncomeTaxEstimate,
    annualCashFlowAfterTax,
    annualNetCashFlow,
    monthlyCashFlow,
    buyerTopUpMonthly,
    totalAnnualCosts,
    operatingYieldOnPrice,
    cashOnCashReturn,
    roiOnTotalPrice,
    roiPercent,
    debtCoverageRatio,
    paybackYears,
    paybackLabel,
    breakevenMonth,
    isProfitable: annualNetCashFlow > 0,
    monthlyCoverage,
    viabilityLevel,
    includeIncomeTax,
    includePropertyManager,
    incomeTaxRate,
    managementFeeRate,
    assumptions: {
      vacancyAppliedOnce: true,
      incomeTaxIncluded: includeIncomeTax && annualIncomeTaxEstimate > 0,
      incomeTaxRate,
      managementFeeRate,
      includeIncomeTax,
      includePropertyManager,
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
  includeIncomeTax?: boolean
  includePropertyManager?: boolean
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
    includeIncomeTax: input.includeIncomeTax,
    includePropertyManager: input.includePropertyManager,
  })
}

export function comparePartners(input: {
  unitPrice: number
  downPaymentPercent: number
  financingYears: number
  estimatedMonthlyRent: number
  vacancyRate: number
  annualOperatingExpenses: number
  includeIncomeTax?: boolean
  includePropertyManager?: boolean
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
        includeIncomeTax: input.includeIncomeTax,
        includePropertyManager: input.includePropertyManager,
        interestRate: Number(partner.annual_interest_rate),
        rateType: input.rateType ?? 'nominal_annual',
      }),
    }
  })
}

/** Escenarios alternativos para alerta de viabilidad. */
export function buildViabilityAlternatives(input: BuildInvestmentInput) {
  const base = buildInvestmentPreview(input)
  const altDown50 = buildInvestmentPreview({
    ...input,
    mode: input.mode === 'cash' ? 'financed' : input.mode,
    downPaymentPercent: 50,
  })
  const altYears20 = buildInvestmentPreview({
    ...input,
    mode: input.mode === 'cash' ? 'financed' : input.mode,
    financingYears: 20,
  })
  const targetRent = roundMoney(Math.max(input.estimatedMonthlyRent * 1.333, input.estimatedMonthlyRent + 400))
  const altRent = buildInvestmentPreview({
    ...input,
    estimatedMonthlyRent: targetRent,
  })
  const appreciationYears = 10
  const appreciationRate = 0.05
  const futureValue = roundMoney(input.unitPrice * (1 + appreciationRate) ** appreciationYears)
  const appreciationGain = roundMoney(futureValue - input.unitPrice)

  return {
    base,
    altDown50,
    altYears20,
    altRent,
    targetRent,
    appreciation: {
      years: appreciationYears,
      annualRate: appreciationRate,
      futureValue,
      gain: appreciationGain,
    },
  }
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
