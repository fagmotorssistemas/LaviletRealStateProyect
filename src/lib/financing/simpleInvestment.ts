/**
 * Simulador único: defaults por tipo + resumen simple (cuota, flujo, apreciación, ROI).
 * Se apoya en buildInvestmentPreview (investment-v3) sin duplicar la cuota francesa.
 */

import {
  buildInvestmentPreview,
  roundMoney,
  type BuildInvestmentInput,
} from '@/lib/financing/calculator'
import type { InvestmentPreview, ViabilityLevel } from '@/types/financingSimulator'

export type PropertyType = 'local' | 'suite' | 'depto' | 'penthouse'
export type RentalKind = 'residential' | 'airbnb'

export type PropertyDefaults = {
  label: string
  rentalKind: RentalKind
  /** Alquiler mensual (residencial). */
  monthlyRent: number
  /** Gastos operativos mensuales (predial/mant/etc. simplificados). */
  monthlyExpenses: number
  /** Ocupación 0–1. */
  occupancy: number
  /** Solo suite/Airbnb: tarifa noche. */
  nightlyRate: number
  /** Solo Airbnb: comisión plataforma 0–1. */
  commission: number
}

export const PROPERTY_DEFAULTS: Record<PropertyType, PropertyDefaults> = {
  local: {
    label: 'Local',
    rentalKind: 'residential',
    monthlyRent: 2500,
    monthlyExpenses: 500,
    occupancy: 0.98,
    nightlyRate: 0,
    commission: 0,
  },
  suite: {
    label: 'Suite',
    rentalKind: 'airbnb',
    monthlyRent: 0,
    monthlyExpenses: 200,
    occupancy: 0.6,
    nightlyRate: 65,
    commission: 0.13,
  },
  depto: {
    label: 'Departamento',
    rentalKind: 'residential',
    monthlyRent: 1300,
    monthlyExpenses: 300,
    occupancy: 0.95,
    nightlyRate: 0,
    commission: 0,
  },
  penthouse: {
    label: 'Penthouse',
    rentalKind: 'residential',
    monthlyRent: 3500,
    monthlyExpenses: 400,
    occupancy: 0.7,
    nightlyRate: 0,
    commission: 0,
  },
}

export const APPRECIATION_YEARS = 10
export const APPRECIATION_ANNUAL_RATE = 0.05

export function detectPropertyType(category?: string | null, bedrooms?: number | null): PropertyType {
  const c = String(category || '').toLowerCase().trim()
  if (c.includes('local') || c.includes('comercial')) return 'local'
  if (c.includes('suite') || c.includes('studio') || c.includes('estudio')) return 'suite'
  if (c.includes('pent') || c.includes('atico') || c.includes('ático')) return 'penthouse'
  if (c.includes('depto') || c.includes('departamento') || c.includes('apt')) return 'depto'
  if (bedrooms != null && bedrooms >= 4) return 'penthouse'
  if (bedrooms != null && bedrooms <= 0) return 'suite'
  return 'depto'
}

/** Alquiler mensual bruto estimado según tipo (antes de vacancia explícita). */
export function estimateMonthlyRentFromDefaults(
  type: PropertyType,
  overrides?: Partial<PropertyDefaults>,
): { monthlyRent: number; vacancyRate: number; annualExpenses: number; rentalKind: RentalKind } {
  const clean: Partial<PropertyDefaults> = {}
  if (overrides) {
    for (const [k, v] of Object.entries(overrides) as [keyof PropertyDefaults, unknown][]) {
      if (v !== undefined) (clean as Record<string, unknown>)[k] = v
    }
  }
  const d = { ...PROPERTY_DEFAULTS[type], ...clean }
  if (d.rentalKind === 'airbnb') {
    const night = Math.max(0, d.nightlyRate)
    const occ = Math.min(1, Math.max(0, d.occupancy))
    const commission = Math.min(1, Math.max(0, d.commission))
    const monthlyRent = roundMoney(night * 30 * occ * (1 - commission))
    return {
      monthlyRent,
      vacancyRate: 0,
      annualExpenses: roundMoney(d.monthlyExpenses * 12),
      rentalKind: 'airbnb',
    }
  }
  return {
    monthlyRent: Math.max(0, d.monthlyRent),
    vacancyRate: roundMoney(1 - Math.min(1, Math.max(0, d.occupancy))),
    annualExpenses: roundMoney(d.monthlyExpenses * 12),
    rentalKind: 'residential',
  }
}

export type SimpleInvestmentResult = {
  preview: InvestmentPreview
  rents: boolean
  rentalKind: RentalKind | null
  monthlyPayment: number
  monthlyDebtCost: number
  monthlyCashFlow: number | null
  cashFlowNote: string
  appreciationYears: number
  appreciationRate: number
  appreciationGain: number
  futureValue: number
  /** Flujo acumulado a 10 años (0 si no alquila). */
  cashFlow10y: number
  /** (flujo10y + apreciación) / entrada × 100 */
  totalRoiPercent: number | null
  totalRoiLabel: string
  badge: 'viable' | 'revisar'
  badgeLabel: string
  viabilityLevel: ViabilityLevel
}

export function buildSimpleInvestmentResult(input: {
  unitPrice: number
  downPaymentPercent: number
  financingYears: number
  interestRate: number
  rents: boolean
  propertyType: PropertyType
  /** Overrides opcionales tras editar en UI. */
  monthlyRent?: number
  vacancyRate?: number
  annualOperatingExpenses?: number
  rentalKind?: RentalKind
  nightlyRate?: number
  occupancy?: number
  commission?: number
  includeIncomeTax?: boolean
  includePropertyManager?: boolean
}): SimpleInvestmentResult {
  const defaults = estimateMonthlyRentFromDefaults(input.propertyType, {
    monthlyRent: input.monthlyRent,
    monthlyExpenses:
      input.annualOperatingExpenses != null
        ? input.annualOperatingExpenses / 12
        : undefined,
    occupancy:
      input.occupancy ??
      (input.vacancyRate != null ? 1 - input.vacancyRate : undefined),
    nightlyRate: input.nightlyRate,
    commission: input.commission,
    rentalKind: input.rentalKind,
  })

  const rents = Boolean(input.rents)
  const monthlyRent = rents
    ? input.monthlyRent != null
      ? Math.max(0, input.monthlyRent)
      : defaults.monthlyRent
    : 0
  const vacancyRate = rents
    ? input.vacancyRate != null
      ? input.vacancyRate
      : defaults.vacancyRate
    : 0
  const annualOperatingExpenses = rents
    ? input.annualOperatingExpenses != null
      ? input.annualOperatingExpenses
      : defaults.annualExpenses
    : 0

  const previewInput: BuildInvestmentInput = {
    unitPrice: input.unitPrice,
    mode: 'financed',
    estimatedMonthlyRent: monthlyRent,
    vacancyRate,
    annualOperatingExpenses,
    downPaymentPercent: input.downPaymentPercent,
    financingYears: input.financingYears,
    interestRate: input.interestRate,
    rateType: 'nominal_annual',
    includeIncomeTax: rents ? input.includeIncomeTax !== false : false,
    includePropertyManager: rents ? input.includePropertyManager !== false : false,
  }

  const preview = buildInvestmentPreview(previewInput)

  const futureValue = roundMoney(
    input.unitPrice * (1 + APPRECIATION_ANNUAL_RATE) ** APPRECIATION_YEARS,
  )
  const appreciationGain = roundMoney(futureValue - input.unitPrice)
  const cashFlow10y = rents ? roundMoney(preview.annualNetCashFlow * APPRECIATION_YEARS) : 0
  const totalGain = roundMoney(cashFlow10y + appreciationGain)
  const totalRoiPercent =
    preview.initialCashOutlay > 0
      ? roundMoney((totalGain / preview.initialCashOutlay) * 100)
      : null

  let badge: 'viable' | 'revisar' = 'viable'
  let badgeLabel = 'VIABLE'
  if (rents) {
    if (preview.annualNetCashFlow < 0 || preview.monthlyCoverage.status === 'insufficient') {
      badge = 'revisar'
      badgeLabel = 'REVISAR'
    }
  } else if (preview.monthlyPayment <= 0 && input.unitPrice <= 0) {
    badge = 'revisar'
    badgeLabel = 'REVISAR'
  }

  return {
    preview,
    rents,
    rentalKind: rents ? input.rentalKind ?? defaults.rentalKind : null,
    monthlyPayment: preview.monthlyPayment,
    monthlyDebtCost: preview.monthlyDebtService,
    monthlyCashFlow: rents ? preview.monthlyCashFlow : null,
    cashFlowNote: rents
      ? preview.monthlyCashFlow >= 0
        ? 'Flujo mensual positivo estimado'
        : 'Flujo mensual negativo: requiere aporte'
      : 'No genera flujo de alquiler',
    appreciationYears: APPRECIATION_YEARS,
    appreciationRate: APPRECIATION_ANNUAL_RATE,
    appreciationGain,
    futureValue,
    cashFlow10y,
    totalRoiPercent,
    totalRoiLabel: rents
      ? 'ROI total = flujo 10 años + apreciación'
      : 'ROI total = apreciación (sin alquiler)',
    badge,
    badgeLabel,
    viabilityLevel: rents ? preview.viabilityLevel : 'viable',
  }
}
