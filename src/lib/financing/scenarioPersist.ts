import {
  buildInvestmentPreview,
  type BuildInvestmentInput,
} from './calculator'
import type { RateType, SimulationMode } from '../../types/financingSimulator'

export type SavedScenarioLike = {
  unit_price?: number | null
  estimated_monthly_rent?: number | null
  down_payment_percent?: number | null
  financing_years?: number | null
  applied_interest_rate?: number | null
  financing_partner_id?: string | null
  simulation_mode?: SimulationMode | null
  vacancy_rate_snapshot?: number | null
  annual_expenses?: number | null
  annual_management?: number | null
  annual_income_tax_estimate?: number | null
  rate_type?: RateType | null
  acquisition_costs?: number | null
  annual_other_financial?: number | null
  monthly_extra_charges?: number | null
  expense_breakdown?: {
    propertyTax?: number
    maintenance?: number
    insurance?: number
    other?: number
    total?: number
  } | null
}

export function resolveSimulationMode(row: SavedScenarioLike): SimulationMode {
  if (row.simulation_mode === 'cash' || row.simulation_mode === 'financed' || row.simulation_mode === 'manual') {
    return row.simulation_mode
  }
  if (row.financing_partner_id) return 'financed'
  if (row.applied_interest_rate != null && Number(row.applied_interest_rate) > 0) return 'manual'
  return 'cash'
}

/** Reconstruye el preview investment-v2 desde una fila guardada (reabrir). */
export function previewFromSavedScenario(row: SavedScenarioLike) {
  const mode = resolveSimulationMode(row)
  const input: BuildInvestmentInput = {
    mode,
    unitPrice: Number(row.unit_price) || 0,
    estimatedMonthlyRent: Number(row.estimated_monthly_rent) || 0,
    vacancyRate: row.vacancy_rate_snapshot != null ? Number(row.vacancy_rate_snapshot) : 0,
    annualOperatingExpenses:
      row.annual_expenses != null
        ? Number(row.annual_expenses)
        : Number(row.expense_breakdown?.total) || 0,
    annualManagement: Number(row.annual_management) || 0,
    annualIncomeTaxEstimate: row.annual_income_tax_estimate,
    acquisitionCosts: Number(row.acquisition_costs) || 0,
    annualOtherFinancialCosts: Number(row.annual_other_financial) || 0,
    monthlyExtraCharges: Number(row.monthly_extra_charges) || 0,
    downPaymentPercent: Number(row.down_payment_percent) || 30,
    financingYears: Number(row.financing_years) || 20,
    interestRate: Number(row.applied_interest_rate) || 0,
    rateType: row.rate_type ?? 'nominal_annual',
  }
  return buildInvestmentPreview(input)
}
