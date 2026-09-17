/** Validación estricta del contrato POST de escenarios (sin coerción silenciosa). */

import {
  DOWN_PAYMENT_MAX_PCT,
  DOWN_PAYMENT_MIN_PCT,
  FINANCING_YEARS_MAX,
  FINANCING_YEARS_MIN,
  roundMoney,
  sumExpenseBreakdown,
} from '@/lib/financing/calculator'
import type { ExpenseBreakdown, RateType, SimulationMode } from '@/types/financingSimulator'

export const SIMULATION_MODES = ['cash', 'financed', 'manual'] as const satisfies readonly SimulationMode[]
export const RATE_TYPES = ['nominal_annual', 'effective_annual'] as const satisfies readonly RateType[]

export class ScenarioValidationError extends Error {
  status = 400 as const
  constructor(message: string) {
    super(message)
    this.name = 'ScenarioValidationError'
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** Distingue ausente (undefined) de null/cero. */
export function hasOwn(body: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(body, key)
}

export function parseRequiredFinite(
  value: unknown,
  field: string,
  opts?: { min?: number; max?: number; integer?: boolean },
): number {
  if (value === undefined || value === null || value === '') {
    throw new ScenarioValidationError(`Falta ${field}`)
  }
  if (typeof value !== 'number' && typeof value !== 'string') {
    throw new ScenarioValidationError(`${field} debe ser numérico`)
  }
  const n = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isFinite(n)) {
    throw new ScenarioValidationError(`${field} no es un número válido`)
  }
  if (opts?.integer && !Number.isInteger(n)) {
    throw new ScenarioValidationError(`${field} debe ser un entero`)
  }
  if (opts?.min != null && n < opts.min) {
    throw new ScenarioValidationError(`${field} fuera de rango`)
  }
  if (opts?.max != null && n > opts.max) {
    throw new ScenarioValidationError(`${field} fuera de rango`)
  }
  return n
}

export function parseOptionalFinite(
  body: Record<string, unknown>,
  key: string,
  opts?: { min?: number; max?: number; integer?: boolean },
): number | undefined {
  if (!hasOwn(body, key) || body[key] === undefined) return undefined
  if (body[key] === null) return undefined
  return parseRequiredFinite(body[key], key, opts)
}

export function parseSimulationMode(raw: unknown): SimulationMode {
  if (raw === undefined || raw === null || raw === '') {
    throw new ScenarioValidationError('Falta mode (cash | financed | manual)')
  }
  if (typeof raw !== 'string' || !(SIMULATION_MODES as readonly string[]).includes(raw)) {
    throw new ScenarioValidationError('mode inválido; use cash, financed o manual')
  }
  return raw as SimulationMode
}

export function parseRateType(raw: unknown, required: boolean): RateType | undefined {
  if (raw === undefined || raw === null || raw === '') {
    if (required) throw new ScenarioValidationError('Falta rate_type')
    return undefined
  }
  if (typeof raw !== 'string' || !(RATE_TYPES as readonly string[]).includes(raw)) {
    throw new ScenarioValidationError('rate_type inválido; use nominal_annual o effective_annual')
  }
  return raw as RateType
}

export function parseExpenseBreakdown(raw: unknown): ExpenseBreakdown | null {
  if (raw === undefined || raw === null) return null
  if (!isPlainObject(raw)) {
    throw new ScenarioValidationError('expense_breakdown inválido')
  }
  const propertyTax = parseRequiredFinite(raw.propertyTax ?? raw.property_tax, 'expense_breakdown.propertyTax', {
    min: 0,
  })
  const maintenance = parseRequiredFinite(raw.maintenance, 'expense_breakdown.maintenance', { min: 0 })
  const insurance = parseRequiredFinite(raw.insurance, 'expense_breakdown.insurance', { min: 0 })
  const other = parseRequiredFinite(raw.other, 'expense_breakdown.other', { min: 0 })
  const computed = roundMoney(sumExpenseBreakdown({ propertyTax, maintenance, insurance, other, total: 0 }))
  const declared =
    raw.total !== undefined && raw.total !== null
      ? parseRequiredFinite(raw.total, 'expense_breakdown.total', { min: 0 })
      : computed
  if (Math.abs(declared - computed) > 0.02) {
    throw new ScenarioValidationError(
      'expense_breakdown.total no coincide con la suma de predial, mantenimiento, seguros y otros',
    )
  }
  return { propertyTax, maintenance, insurance, other, total: computed }
}

/**
 * Si llegan desglose y total anual, deben coincidir (tras redondeo a 2 decimales).
 * Si solo llega uno, se usa ese.
 */
export function resolveOperatingExpenses(input: {
  annualExpenses?: number | undefined
  breakdown: ExpenseBreakdown | null
}): { annualOperatingExpenses: number; breakdown: ExpenseBreakdown | null } {
  const breakdown = input.breakdown
  if (input.annualExpenses !== undefined && breakdown) {
    if (Math.abs(roundMoney(input.annualExpenses) - breakdown.total) > 0.02) {
      throw new ScenarioValidationError(
        'annual_expenses no coincide con expense_breakdown.total',
      )
    }
    return { annualOperatingExpenses: breakdown.total, breakdown }
  }
  if (breakdown) {
    return { annualOperatingExpenses: breakdown.total, breakdown }
  }
  if (input.annualExpenses !== undefined) {
    return { annualOperatingExpenses: roundMoney(input.annualExpenses), breakdown: null }
  }
  throw new ScenarioValidationError('Indique annual_expenses o expense_breakdown')
}

export function validateDownPaymentAndYears(input: {
  mode: SimulationMode
  downPaymentPercent?: number
  financingYears?: number
  partnerMinYears?: number | null
  partnerMaxYears?: number | null
}) {
  if (input.mode === 'cash') return
  const down = input.downPaymentPercent
  const years = input.financingYears
  if (down === undefined) {
    throw new ScenarioValidationError('Falta down_payment_percent')
  }
  if (years === undefined) {
    throw new ScenarioValidationError('Falta financing_years')
  }
  if (!(down >= DOWN_PAYMENT_MIN_PCT && down <= DOWN_PAYMENT_MAX_PCT)) {
    throw new ScenarioValidationError(
      `La entrada debe estar entre ${DOWN_PAYMENT_MIN_PCT}% y ${DOWN_PAYMENT_MAX_PCT}%`,
    )
  }
  const minY = Math.max(
    FINANCING_YEARS_MIN,
    input.partnerMinYears != null && Number.isFinite(Number(input.partnerMinYears))
      ? Number(input.partnerMinYears)
      : FINANCING_YEARS_MIN,
  )
  const maxY = Math.min(
    FINANCING_YEARS_MAX,
    input.partnerMaxYears != null && Number.isFinite(Number(input.partnerMaxYears))
      ? Number(input.partnerMaxYears)
      : FINANCING_YEARS_MAX,
  )
  if (!(years >= minY && years <= maxY)) {
    throw new ScenarioValidationError(`El plazo debe estar entre ${minY} y ${maxY} años`)
  }
  if (!Number.isInteger(years)) {
    throw new ScenarioValidationError('financing_years debe ser un entero')
  }
}
