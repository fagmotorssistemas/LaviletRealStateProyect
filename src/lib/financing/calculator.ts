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
import {
  TAX_PROFILE_OTHER_INCOME,
  annualIrrFromMonthlyCashFlows,
  buildingFeeForUnit,
  cuencaCapitalGainsTax,
  incrementalPersonalIncomeTax,
  isTaxProfile,
  maxLegalMonthlyRent,
  resolvedIncomeTaxBrackets,
  type IncomeTaxBracket,
  type TaxProfile,
} from '@/lib/financing/ecuadorTax'

/**
 * Versión de fórmulas; escenarios históricos deben conservar la suya.
 * v6: IR progresivo, avalúo por unidad y flujos anuales de Cuenca/Ecuador.
 */
export const CALCULATION_VERSION = 'investment-v6'

/** Modelo de gastos de propiedad admitido en simulaciones nuevas. */
export const PROPERTY_EXPENSE_MODEL = 'predial_and_building_fee'

/** Respaldo de la tarifa de sociedades cuando no hay configuración. */
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
  /** Gastos de la propiedad anuales (predial + alícuota en v5+), sin gestión ni IR. */
  annualOperatingExpenses: number
  /** @deprecated Prefer includePropertyManager; si se pasa con flag false se ignora. */
  annualManagement?: number
  /** @deprecated Prefer includeIncomeTax. */
  annualIncomeTaxEstimate?: number | null
  /** Default true: aplica IR incremental o societario a la base gravable del arriendo. */
  includeIncomeTax?: boolean
  /** Default true: aplica la comisión configurable del gestor sobre alquiler efectivo. */
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
  /** Patrimonio proyectado. */
  wealthHorizonYears?: number
  appreciationRateAnnual?: number
  saleCosts?: number
  taxProfile?: TaxProfile
  incomeTaxBrackets?: IncomeTaxBracket[] | null
  incomeTaxTableYear?: number
  companyIncomeTaxRate?: number
  cadastralValue?: number
  cadastralIsEstimated?: boolean
  category?: string | null
  rentalDepreciationEnabled?: boolean
  constructionSharePct?: number
  rentGrowthRate?: number
  saleCommissionPct?: number
  acquisitionCostBreakdown?: { percentage: number; fixed: number }
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

/**
 * Gastos de la propiedad desde configuración del proyecto (investment-v5+).
 * Solo predial + alícuota del edificio (`annual_maintenance`).
 * Seguro y «otros» quedan en 0: no se descuentan aunque existan valores históricos en config.
 * El campo DB `annual_maintenance` representa la alícuota (admin/mant. de áreas comunes),
 * no un mantenimiento particular independiente del inmueble.
 */
export type ExpenseUnit = {
  cadastral_value?: number | null
  monthly_building_fee?: number | null
  area_total_m2?: number | null
  area_internal_m2?: number | null
}

export function expenseBreakdownFromConfig(unitPrice: number, config: FinancingConfig, unit?: ExpenseUnit | null): ExpenseBreakdown {
  const cadastral = Number(unit?.cadastral_value) > 0 ? Number(unit?.cadastral_value) : Math.max(0, unitPrice)
  const propertyTax = roundMoney((cadastral * Number(config.annual_property_tax || 0)) / 100)
  const maintenance = roundMoney(buildingFeeForUnit(unit, config))
  return {
    propertyTax,
    maintenance,
    insurance: 0,
    other: 0,
    total: roundMoney(propertyTax + maintenance),
  }
}

export function defaultAnnualExpenses(unitPrice: number, config: FinancingConfig) {
  return expenseBreakdownFromConfig(unitPrice, config).total
}

/** Suma del modelo vigente (v5+): predial + alícuota. Ignora insurance/other. */
export function sumPropertyExpenses(b: Partial<ExpenseBreakdown> | null | undefined) {
  if (!b) return 0
  return roundMoney(Number(b.propertyTax || 0) + Number(b.maintenance || 0))
}

/**
 * Suma histórica completa (predial+alícuota+seguro+otros).
 * Solo para interpretar escenarios antiguos; no usar en simulaciones nuevas.
 */
export function sumExpenseBreakdownLegacy(b: Partial<ExpenseBreakdown> | null | undefined) {
  if (!b) return 0
  return roundMoney(
    Number(b.propertyTax || 0) +
      Number(b.maintenance || 0) +
      Number(b.insurance || 0) +
      Number(b.other || 0),
  )
}

/** Alias del modelo vigente. */
export function sumExpenseBreakdown(b: Partial<ExpenseBreakdown> | null | undefined) {
  return sumPropertyExpenses(b)
}

export type PropertyExpenseLine = {
  key: 'propertyTax' | 'maintenance'
  label: string
  description: string
  annual: number | null
  configured: boolean
}

/** Líneas legibles para UI; `null` si el dato de config no está definido. */
export function propertyExpenseLinesFromConfig(
  unitPrice: number,
  config: FinancingConfig | null | undefined,
  unit?: ExpenseUnit | null,
): { lines: PropertyExpenseLine[]; totalAnnual: number | null; totalMonthly: number | null } {
  if (!config) {
    return {
      lines: [
        {
          key: 'propertyTax',
          label: 'Impuesto predial',
          description: 'Pago único anual al Municipio por la propiedad',
          annual: null,
          configured: false,
        },
        {
          key: 'maintenance',
          label: 'Alícuota del edificio',
          description: 'Pago para administración y mantenimiento de áreas comunes',
          annual: null,
          configured: false,
        },
      ],
      totalAnnual: null,
      totalMonthly: null,
    }
  }

  const taxConfigured =
    config.annual_property_tax != null && Number.isFinite(Number(config.annual_property_tax))
  const feeConfigured = unit?.monthly_building_fee != null ||
    (config.building_fee_per_m2_monthly != null && (unit?.area_total_m2 != null || unit?.area_internal_m2 != null)) ||
    (config.annual_maintenance != null && Number.isFinite(Number(config.annual_maintenance)))

  const propertyTax = taxConfigured
    ? roundMoney(((Number(unit?.cadastral_value) > 0 ? Number(unit?.cadastral_value) : Math.max(0, unitPrice)) * Number(config.annual_property_tax)) / 100)
    : null
  const maintenance = feeConfigured ? roundMoney(buildingFeeForUnit(unit, config)) : null

  const lines: PropertyExpenseLine[] = [
    {
      key: 'propertyTax',
      label: 'Impuesto predial',
      description: 'Pago único anual al Municipio por la propiedad',
      annual: propertyTax,
      configured: taxConfigured,
    },
    {
      key: 'maintenance',
      label: 'Alícuota del edificio',
      description: 'Pago para administración y mantenimiento de áreas comunes',
      annual: maintenance,
      configured: feeConfigured,
    },
  ]

  const totalAnnual =
    propertyTax != null && maintenance != null ? roundMoney(propertyTax + maintenance) : null
  const totalMonthly = totalAnnual != null ? roundMoney(totalAnnual / 12) : null
  return { lines, totalAnnual, totalMonthly }
}

export function suggestedRentForBedrooms(config: FinancingConfig, bedrooms: number | null | undefined) {
  const beds = bedrooms ?? 1
  // Sin studio: 0 dormitorios usa la referencia de 1 dormitorio.
  if (beds <= 1) return Number(config.avg_one_bed_rent ?? 1200)
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
  source: 'unit' | 'bedrooms' | 'price_yield' | 'none'
  label: string
}

export function suggestMonthlyRent(input: {
  config: FinancingConfig | null
  unitPrice: number
  bedrooms?: number | null
  category?: string | null
  estimatedMonthlyRent?: number | null
}): RentSuggestion {
  if (input.estimatedMonthlyRent != null && Number(input.estimatedMonthlyRent) > 0) {
    return { amount: roundMoney(Number(input.estimatedMonthlyRent)), source: 'unit', label: 'Arriendo de referencia de esta unidad' }
  }
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

/** Cobertura alquiler bruto vs cuota (sin gastos). Status no afirma cobertura neta. */
export function buildMonthlyCoverage(monthlyRent: number, monthlyPayment: number): MonthlyCoverage {
  const rent = roundMoney(Math.max(0, Number(monthlyRent) || 0))
  const payment = roundMoney(Math.max(0, Number(monthlyPayment) || 0))
  const difference = roundMoney(rent - payment)
  let status: MonthlyCoverage['status']
  let statusLabel: string
  if (difference > 0) {
    status = 'covers_gross_only'
    statusLabel = 'Cubre la cuota antes de gastos'
  } else if (difference > -500) {
    status = 'borderline'
    statusLabel = 'Casi cubre la cuota (bruto)'
  } else {
    status = 'insufficient'
    statusLabel = 'No cubre la cuota (bruto)'
  }
  return { monthlyRent: rent, monthlyPayment: payment, difference, status, statusLabel }
}

/** Alquiler neto disponible para la cuota (tras vacancia, ops, gestor e IR). */
export function buildRentCoverageAnalysis(preview: InvestmentPreview): RentCoverageAnalysis {
  const annualNetRentAvailable = roundMoney(
    preview.annualEffectiveRental -
      preview.annualOperatingExpenses -
      preview.annualManagement -
      preview.annualIncomeTaxEstimate,
  )
  const monthlyNetRentAvailable = roundMoney(annualNetRentAvailable / 12)
  const monthlyPayment = preview.monthlyPayment
  const monthlyGrossRent = roundMoney(preview.annualPotentialRental / 12)
  const grossDifference = roundMoney(monthlyGrossRent - monthlyPayment)
  const monthlyTopUpOrSurplus = roundMoney(monthlyNetRentAvailable - monthlyPayment)
  return {
    monthlyGrossRent,
    monthlyPayment,
    grossDifference,
    monthlyNetRentAvailable,
    annualNetRentAvailable,
    monthlyTopUpOrSurplus,
    annualCashFlow: preview.annualNetCashFlow,
    coversGrossBeforeExpenses: grossDifference >= 0,
    coversNetAfterExpenses: monthlyTopUpOrSurplus >= 0,
  }
}

export type RentCoverageAnalysis = {
  monthlyGrossRent: number
  monthlyPayment: number
  grossDifference: number
  monthlyNetRentAvailable: number
  annualNetRentAvailable: number
  /** Positivo = excedente; negativo = aporte adicional requerido. */
  monthlyTopUpOrSurplus: number
  annualCashFlow: number
  coversGrossBeforeExpenses: boolean
  coversNetAfterExpenses: boolean
}

export function viabilityFromAnnualSaldo(saldoAnual: number): ViabilityLevel {
  if (saldoAnual >= 0) return 'viable'
  if (saldoAnual > -5000) return 'borderline'
  return 'critical'
}

/**
 * Saldo de capital tras `paidMonths` cuotas francesas.
 * B_k = P · ((1+i)^n − (1+i)^k) / ((1+i)^n − 1)
 */
export function remainingPrincipalAfterMonths(
  principal: number,
  annualRatePercent: number,
  totalYears: number,
  paidMonths: number,
  rateType: RateType = 'nominal_annual',
): number {
  const P = Math.max(0, Number(principal) || 0)
  if (!(P > 0)) return 0
  const n = Math.max(1, Math.round(totalYears * 12))
  const k = Math.max(0, Math.min(n, Math.round(paidMonths)))
  if (k >= n) return 0
  const i = monthlyRateFromAnnual(annualRatePercent, rateType)
  if (i === 0) {
    return roundMoney(P * (1 - k / n))
  }
  const powN = (1 + i) ** n
  const powK = (1 + i) ** k
  return roundMoney((P * (powN - powK)) / (powN - 1))
}

/** Interés y capital de una cuota en el mes `monthIndex` (1-based). */
export function paymentInterestAndPrincipal(
  principal: number,
  annualRatePercent: number,
  totalYears: number,
  monthIndex: number,
  rateType: RateType = 'nominal_annual',
): { interest: number; principalPaid: number; payment: number } {
  const payment = calculateMonthlyPayment(principal, annualRatePercent, totalYears, rateType)
  const balanceBefore = remainingPrincipalAfterMonths(
    principal,
    annualRatePercent,
    totalYears,
    monthIndex - 1,
    rateType,
  )
  const i = monthlyRateFromAnnual(annualRatePercent, rateType)
  const interest = roundMoney(balanceBefore * i)
  const principalPaid = roundMoney(Math.min(balanceBefore, Math.max(0, payment - interest)))
  return { interest, principalPaid, payment }
}

export type WealthProjectionInput = {
  preview: InvestmentPreview
  horizonYears?: number
  appreciationRateAnnual?: number
  saleCosts?: number
}

/**
 * Patrimonio proyectado al horizonte.
 * No multiplica el flujo del año 1 a ciegas si el crédito termina antes:
 * simula mes a mes el servicio de deuda hasta extinguirlo.
 */
export function buildWealthProjection(input: WealthProjectionInput): WealthProjection {
  const preview = input.preview
  const horizonYears = Math.max(1, Math.min(40, Math.round(Number(input.horizonYears) || 10)))
  const appreciationRateAnnual = Number(input.appreciationRateAnnual ?? 0.03)
  const saleCosts = roundMoney(Math.max(0, Number(input.saleCosts) || 0))
  const horizonMonths = horizonYears * 12

  const futurePropertyValue = roundMoney(
    preview.unitPrice * (1 + appreciationRateAnnual) ** horizonYears,
  )
  const futureNoApprec = roundMoney(preview.unitPrice)

  const loanMonths =
    preview.mode === 'cash' || !(preview.financedAmount > 0)
      ? 0
      : Math.max(1, Math.round(preview.financingYears * 12))

  let remainingDebt = 0
  if (loanMonths > 0) {
    remainingDebt = remainingPrincipalAfterMonths(
      preview.financedAmount,
      preview.interestRate,
      preview.financingYears,
      Math.min(horizonMonths, loanMonths),
      preview.rateType,
    )
  }

  const monthlyExtra = preview.monthlyExtraCharges
  const annualOtherMonthly = roundMoney(preview.annualOtherFinancialCosts / 12)
  let cumulativeTopUps = 0
  let cumulativeSurplus = 0
  const growthRate = Number(preview.assumptions.rentGrowthRate ?? 0.02)
  const taxProfile = preview.taxProfile
  const taxTable = resolvedIncomeTaxBrackets(preview.assumptions.incomeTaxBrackets).brackets
  const cadastral = preview.cadastralValue
  const depreciation = preview.assumptions.rentalDepreciationEnabled
    ? preview.unitPrice * Number(preview.assumptions.constructionSharePct ?? 80) / 100 * 0.05
    : 0
  const monthlyCashFlows = [-preview.initialCashOutlay]
  let firstYearMonthlyNetRent = 0
  for (let year = 0; year < horizonYears; year++) {
    const factor = (1 + growthRate) ** year
    const effectiveRent = roundMoney(preview.annualEffectiveRental * factor)
    const propertyExpenses = roundMoney(preview.annualOperatingExpenses * factor)
    const management = roundMoney(preview.annualManagement * factor)
    let interest = 0
    for (let monthInYear = 1; monthInYear <= 12; monthInYear++) {
      const month = year * 12 + monthInYear
      if (loanMonths > 0 && month <= loanMonths) {
        interest += paymentInterestAndPrincipal(preview.financedAmount, preview.interestRate, preview.financingYears, month, preview.rateType).interest
      }
    }
    // Deducibles según SRI 2026 para arriendos de persona natural; validar con contador.
    const taxable = taxProfile === 'company'
      ? Math.max(0, effectiveRent - propertyExpenses - management - interest - depreciation)
      : Math.max(0, effectiveRent - cadastral * 0.01 - interest - depreciation)
    const tax = !preview.includeIncomeTax ? 0 : roundMoney(taxProfile === 'company'
      ? taxable * preview.companyIncomeTaxRate
      : incrementalPersonalIncomeTax(TAX_PROFILE_OTHER_INCOME[taxProfile], taxable, taxTable))
    const monthlyNetRent = roundMoney((effectiveRent - propertyExpenses - management - tax) / 12)
    if (year === 0) firstYearMonthlyNetRent = monthlyNetRent
    for (let monthInYear = 1; monthInYear <= 12; monthInYear++) {
      const month = year * 12 + monthInYear
      const debtService = loanMonths > 0 && month <= loanMonths
        ? roundMoney(preview.monthlyPayment + monthlyExtra + annualOtherMonthly) : 0
      const monthCf = roundMoney(monthlyNetRent - debtService)
      monthlyCashFlows.push(monthCf)
      if (monthCf < 0) cumulativeTopUps = roundMoney(cumulativeTopUps + Math.abs(monthCf))
      else if (monthCf > 0) cumulativeSurplus = roundMoney(cumulativeSurplus + monthCf)
    }
  }

  const initialOutlay = preview.initialCashOutlay
  const totalCashInvested = roundMoney(initialOutlay + cumulativeTopUps)
  const capitalGainsTax = roundMoney(cuencaCapitalGainsTax(futurePropertyValue - preview.unitPrice, horizonYears))
  const saleCommission = roundMoney(futurePropertyValue * Number(preview.assumptions.saleCommissionPct ?? 0) / 100)
  const propertyAfterSaleCosts = roundMoney(futurePropertyValue - saleCosts - capitalGainsTax - saleCommission)
  const endingEquity = roundMoney(propertyAfterSaleCosts - remainingDebt)
  const flowsWithSale = [...monthlyCashFlows]
  flowsWithSale[horizonMonths] = roundMoney(flowsWithSale[horizonMonths] + endingEquity)
  const irrAnnualPercent = annualIrrFromMonthlyCashFlows(flowsWithSale)
  const projectedGainOrLoss = roundMoney(endingEquity + cumulativeSurplus - totalCashInvested)
  const cumulativeReturnOnCashPercent =
    totalCashInvested > 0
      ? roundMoney((projectedGainOrLoss / totalCashInvested) * 100)
      : null

  const annualCashFlowYieldPercent =
    initialOutlay > 0 ? roundMoney((preview.annualNetCashFlow / initialOutlay) * 100) : null

  const propertyAppreciation = roundMoney(futurePropertyValue - preview.unitPrice)
  const annualNetRentYieldPercent =
    preview.unitPrice > 0
      ? roundMoney(((firstYearMonthlyNetRent * 12) / preview.unitPrice) * 100)
      : null

  const zeroSaleCommission = roundMoney(futureNoApprec * Number(preview.assumptions.saleCommissionPct ?? 0) / 100)
  const zeroFv = roundMoney(futureNoApprec - saleCosts - zeroSaleCommission)
  const zeroEquity = roundMoney(zeroFv - remainingDebt)
  const zeroFlows = [...monthlyCashFlows]
  zeroFlows[horizonMonths] = roundMoney(zeroFlows[horizonMonths] + zeroEquity)
  const zeroIrrAnnualPercent = annualIrrFromMonthlyCashFlows(zeroFlows)
  const zeroGain = roundMoney(zeroEquity + cumulativeSurplus - totalCashInvested)
  const zeroReturn =
    totalCashInvested > 0 ? roundMoney((zeroGain / totalCashInvested) * 100) : null

  const notes: string[] = [
    'La plusvalía es una hipótesis editable; no es una previsión de mercado verificada.',
    'Ganancia total proyectada = (valor menos deuda) + alquileres/excedentes acumulados − dinero aportado. No es solo el aumento de valor.',
    'El aporte adicional no se convierte íntegramente en patrimonio: parte de la cuota cubre intereses y gastos.',
    'Montos redondeados a 2 decimales (centavos) en cada paso del motor.',
    saleCosts > 0
      ? `Costos de salida modelados: ${saleCosts}.`
      : 'Sin costo manual adicional de salida; impuestos y comisión configurada se calculan aparte.',
    'La TIR anual incorpora cada flujo mensual y el valor neto de venta; el retorno acumulado mide otra cosa.',
    `Venta neta: impuesto de plusvalía ${capitalGainsTax}, comisión ${saleCommission}.`,
    `El arriendo y los gastos de propiedad crecen ${roundMoney(growthRate * 100)}% por año en esta hipótesis.`,
  ]

  return {
    horizonYears,
    appreciationRateAnnual,
    futurePropertyValue,
    propertyAppreciation,
    remainingDebt,
    endingEquity,
    cumulativeTopUps,
    cumulativeSurplus,
    totalCashInvested,
    initialOutlay,
    projectedGainOrLoss,
    cumulativeReturnOnCashPercent,
    annualNetRentYieldPercent,
    saleCosts,
    capitalGainsTax,
    saleCommission,
    irrAnnualPercent,
    saleCostsIncluded: saleCosts > 0,
    annualCashFlowYieldPercent,
    monthlyNetRentAverageYear1: firstYearMonthlyNetRent,
    zeroAppreciation: {
      futurePropertyValue: futureNoApprec,
      endingEquity: zeroEquity,
      projectedGainOrLoss: zeroGain,
      cumulativeReturnOnCashPercent: zeroReturn,
      capitalGainsTax: 0,
      saleCommission: zeroSaleCommission,
      irrAnnualPercent: zeroIrrAnnualPercent,
    },
    notes,
  }
}

export type WealthProjection = {
  horizonYears: number
  appreciationRateAnnual: number
  futurePropertyValue: number
  /** FV − precio de compra (antes de costos de salida). */
  propertyAppreciation: number
  remainingDebt: number
  endingEquity: number
  cumulativeTopUps: number
  /** Excedentes mensuales positivos acumulados (alquiler neto − deuda) en el horizonte. */
  cumulativeSurplus: number
  totalCashInvested: number
  initialOutlay: number
  projectedGainOrLoss: number
  cumulativeReturnOnCashPercent: number | null
  /** (alquiler neto anual año 1) / precio × 100. No es TIR ni retorno del horizonte. */
  annualNetRentYieldPercent: number | null
  saleCosts: number
  capitalGainsTax: number
  saleCommission: number
  irrAnnualPercent: number | null
  saleCostsIncluded: boolean
  annualCashFlowYieldPercent: number | null
  /** Promedio mensual del alquiler neto disponible (año 1 / 12). */
  monthlyNetRentAverageYear1: number
  zeroAppreciation: {
    futurePropertyValue: number
    endingEquity: number
    projectedGainOrLoss: number
    cumulativeReturnOnCashPercent: number | null
    capitalGainsTax: number
    saleCommission: number
    irrAnnualPercent: number | null
  }
  notes: string[]
}

/** Compara contado vs financiado con los mismos supuestos de unidad, alquiler, gastos y horizonte. */
export function buildCashVsFinancedComparison(input: {
  shared: Omit<BuildInvestmentInput, 'mode' | 'downPaymentPercent'>
  downPaymentPercent: number
  horizonYears: number
  appreciationRateAnnual: number
  saleCosts?: number
}): {
  cash: { preview: InvestmentPreview; coverage: RentCoverageAnalysis; wealth: WealthProjection }
  financed: { preview: InvestmentPreview; coverage: RentCoverageAnalysis; wealth: WealthProjection }
} {
  const cashPreview = buildInvestmentPreview({
    ...input.shared,
    mode: 'cash',
    downPaymentPercent: 100,
  })
  const financedPreview = buildInvestmentPreview({
    ...input.shared,
    mode: 'financed',
    downPaymentPercent: input.downPaymentPercent,
  })
  const wealthOpts = {
    horizonYears: input.horizonYears,
    appreciationRateAnnual: input.appreciationRateAnnual,
    saleCosts: input.saleCosts,
  }
  return {
    cash: {
      preview: cashPreview,
      coverage: buildRentCoverageAnalysis(cashPreview),
      wealth: buildWealthProjection({ preview: cashPreview, ...wealthOpts }),
    },
    financed: {
      preview: financedPreview,
      coverage: buildRentCoverageAnalysis(financedPreview),
      wealth: buildWealthProjection({ preview: financedPreview, ...wealthOpts }),
    },
  }
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
  const companyIncomeTaxRate = clamp(Number(input.companyIncomeTaxRate ?? INCOME_TAX_RATE), 0, 1)
  const incomeTaxRate = companyIncomeTaxRate
  const managementFeeRate = clamp(Number(input.managementFeeRate ?? MANAGEMENT_FEE_RATE) || 0, 0, 1)
  const taxProfile = isTaxProfile(input.taxProfile) ? input.taxProfile : '45_80'
  const taxTable = resolvedIncomeTaxBrackets(input.incomeTaxBrackets)
  const incomeTaxTableYear = Number(input.incomeTaxTableYear) || 2026
  const cadastralValue = Math.max(0, Number(input.cadastralValue ?? unitPrice) || 0)
  const cadastralIsEstimated = input.cadastralIsEstimated !== false
  const legalMonthlyRent = roundMoney(maxLegalMonthlyRent(cadastralValue))
  const category = String(input.category || '').toLowerCase()
  const commercial = ['local', 'comercial', 'oficina', 'office', 'bodega'].some((word) => category.includes(word))
  const rentExceedsLegalCap = !commercial && !cadastralIsEstimated && Number(input.estimatedMonthlyRent) > legalMonthlyRent

  // Primero alquiler efectivo (sin gestión) para basar % IR / gestor.
  const vacancy = clamp(Number(input.vacancyRate) || 0, 0, 1)
  const monthlyRent = Math.max(0, Number(input.estimatedMonthlyRent) || 0)
  const annualPotentialRental = roundMoney(monthlyRent * 12)
  const annualVacancyCost = roundMoney(annualPotentialRental * vacancy)
  const annualEffectiveRental = roundMoney(annualPotentialRental - annualVacancyCost)

  const annualManagement = includePropertyManager
    ? roundMoney(annualEffectiveRental * managementFeeRate)
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

  let yearOneInterest = 0
  if (mode !== 'cash' && financedAmount > 0) {
    for (let month = 1; month <= 12; month++) {
      if (month <= financingYears * 12) {
        yearOneInterest += paymentInterestAndPrincipal(financedAmount, interestRate, financingYears, month, rateType).interest
      }
    }
  }
  const depreciation = input.rentalDepreciationEnabled
    ? unitPrice * clamp(Number(input.constructionSharePct ?? 80), 0, 100) / 100 * 0.05
    : 0
  // Deducibles según SRI 2026 para arriendos de persona natural; validar con contador.
  const rentalTaxableBase = Math.max(0, annualEffectiveRental - cadastralValue * 0.01 - yearOneInterest - depreciation)
  const companyTaxableBase = Math.max(0, annualEffectiveRental - ops.annualOperatingExpenses - annualManagement - yearOneInterest - depreciation)
  const annualIncomeTaxEstimate = !includeIncomeTax ? 0 : roundMoney(
    taxProfile === 'company'
      ? companyTaxableBase * companyIncomeTaxRate
      : incrementalPersonalIncomeTax(TAX_PROFILE_OTHER_INCOME[taxProfile], rentalTaxableBase, taxTable.brackets),
  )

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
    taxProfile,
    incomeTaxTableYear,
    companyIncomeTaxRate,
    incomeTaxTableFallback: taxTable.fallback,
    cadastralValue,
    cadastralIsEstimated,
    maxLegalMonthlyRent: legalMonthlyRent,
    rentExceedsLegalCap,
    isCommercial: commercial,
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
      excludesAppreciationAndSale: false,
      wealthHorizonYears: input.wealthHorizonYears ?? 10,
      appreciationRateAnnual: input.appreciationRateAnnual ?? 0.03,
      saleCosts: roundMoney(Math.max(0, Number(input.saleCosts) || 0)),
      propertyExpenseModel: PROPERTY_EXPENSE_MODEL,
      propertyExpensesExcludeInsuranceAndOther: true,
      annualOperatingExpensesSnapshot: ops.annualOperatingExpenses,
      taxProfile,
      incomeTaxTableYear,
      companyIncomeTaxRate,
      incomeTaxTableFallback: taxTable.fallback,
      incomeTaxBrackets: taxTable.brackets,
      cadastralValue,
      cadastralIsEstimated,
      acquisitionCostBreakdown: input.acquisitionCostBreakdown,
      rentGrowthRate: input.rentGrowthRate ?? 0.02,
      saleCommissionPct: input.saleCommissionPct ?? 0,
      rentalDepreciationEnabled: input.rentalDepreciationEnabled === true,
      constructionSharePct: input.constructionSharePct ?? 80,
      rentExceedsLegalCap,
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

/** Alternativas útiles: no sugerir lo que ya está aplicado; calcular delta de aporte. */
export function buildViabilityAlternatives(input: BuildInvestmentInput) {
  const base = buildInvestmentPreview(input)
  const baseCoverage = buildRentCoverageAnalysis(base)
  const currentDown = clampDownPaymentPercent(input.downPaymentPercent ?? 30)
  const currentYears = clampFinancingYears(input.financingYears ?? 20)
  const suggestions: {
    id: string
    label: string
    preview: InvestmentPreview
    topUpDeltaMonthly: number | null
  }[] = []

  const targetDown = Math.min(50, DOWN_PAYMENT_MAX_PCT)
  if (input.mode !== 'cash' && currentDown < targetDown - 0.01) {
    const altDown = buildInvestmentPreview({
      ...input,
      downPaymentPercent: targetDown,
    })
    const cov = buildRentCoverageAnalysis(altDown)
    suggestions.push({
      id: `down_${targetDown}`,
      label: `Aumentar entrada a ${targetDown}%`,
      preview: altDown,
      topUpDeltaMonthly: roundMoney(
        Math.abs(Math.min(0, cov.monthlyTopUpOrSurplus)) -
          Math.abs(Math.min(0, baseCoverage.monthlyTopUpOrSurplus)),
      ),
    })
  }

  if (input.mode !== 'cash' && currentYears < FINANCING_YEARS_MAX) {
    const targetYears = Math.min(FINANCING_YEARS_MAX, currentYears + 5)
    // No sugerir el mismo plazo (p. ej. ya en 20 → no proponer 20).
    if (targetYears > currentYears) {
      const altYears = buildInvestmentPreview({
        ...input,
        financingYears: targetYears,
      })
      const cov = buildRentCoverageAnalysis(altYears)
      suggestions.push({
        id: `years_${targetYears}`,
        label: `Extender plazo a ${targetYears} años`,
        preview: altYears,
        topUpDeltaMonthly: roundMoney(
          Math.abs(Math.min(0, cov.monthlyTopUpOrSurplus)) -
            Math.abs(Math.min(0, baseCoverage.monthlyTopUpOrSurplus)),
        ),
      })
    }
  }

  // IR progresivo: resolver el alquiler de equilibrio con el mismo motor.
  const surplusAt = (rent: number) => buildRentCoverageAnalysis(buildInvestmentPreview({
    ...input, estimatedMonthlyRent: rent,
  })).monthlyTopUpOrSurplus
  let low = 0
  let high = Math.max(1000, input.estimatedMonthlyRent * 2)
  while (surplusAt(high) < 0 && high < 1_000_000) high *= 2
  if (surplusAt(high) >= 0) {
    for (let i = 0; i < 50 && high - low > 0.01; i++) {
      const middle = (low + high) / 2
      if (surplusAt(middle) >= 0) high = middle
      else low = middle
    }
  }
  const breakEvenGrossRent = roundMoney(high)
  const altRent = buildInvestmentPreview({
    ...input,
    estimatedMonthlyRent: Math.max(breakEvenGrossRent, input.estimatedMonthlyRent),
  })

  const appreciationYears = Math.max(1, Math.round(Number(input.wealthHorizonYears) || 10))
  const appreciationRate = Number(input.appreciationRateAnnual ?? 0.03)
  const wealth = buildWealthProjection({
    preview: base,
    horizonYears: appreciationYears,
    appreciationRateAnnual: appreciationRate,
    saleCosts: input.saleCosts,
  })

  return {
    base,
    baseCoverage,
    suggestions,
    altDown50: suggestions.find((s) => s.id.startsWith('down_'))?.preview ?? base,
    altYears20: suggestions.find((s) => s.id.startsWith('years_'))?.preview ?? base,
    altRent,
    targetRent: breakEvenGrossRent,
    breakEvenGrossRent,
    breakEvenRentIsMathematical: true as const,
    appreciation: {
      years: appreciationYears,
      annualRate: appreciationRate,
      futureValue: wealth.futurePropertyValue,
      gain: roundMoney(wealth.futurePropertyValue - input.unitPrice),
    },
    wealth,
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
