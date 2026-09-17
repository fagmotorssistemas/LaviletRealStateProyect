export type FinancingPartner = {
  id: string
  tenant_id: string | null
  partner_name: string
  partner_type: string | null
  annual_interest_rate: number
  min_financing_years: number | null
  max_financing_years: number | null
  processing_days: number | null
  contact_phone: string | null
  contact_email: string | null
  contact_person: string | null
  notes: string | null
  active: boolean | null
  is_recommended: boolean | null
}

export type FinancingConfig = {
  id: string
  tenant_id: string | null
  project_id: string
  annual_property_tax: number
  annual_maintenance: number
  annual_insurance: number
  vacancy_rate: number
  avg_studio_rent: number | null
  avg_one_bed_rent: number | null
  avg_two_bed_rent: number | null
  avg_three_bed_rent: number | null
  default_financing_partner_id: string | null
  allow_custom_interest_rate: boolean | null
  disclaimer_text: string | null
}

export type SimulationMode = 'cash' | 'financed' | 'manual'
export type RateType = 'nominal_annual' | 'effective_annual'

export type ExpenseBreakdown = {
  propertyTax: number
  maintenance: number
  insurance: number
  other: number
  total: number
}

export type FinancingScenario = {
  id: string
  tenant_id: string | null
  lead_id: string | null
  unit_id: string | null
  financing_partner_id: string | null
  project_id: string | null
  down_payment_percent: number | null
  financing_years: number | null
  estimated_monthly_rent: number | null
  unit_price: number | null
  down_payment_amount: number | null
  financed_amount: number | null
  applied_interest_rate: number | null
  monthly_payment: number | null
  annual_mortgage_paid: number | null
  annual_expenses: number | null
  annual_gross_rental: number | null
  annual_net_cash_flow: number | null
  roi_percent: number | null
  payback_years: number | null
  breakeven_month: number | null
  is_profitable: boolean | null
  status: string | null
  created_at: string | null
  updated_at: string | null
  /** Columnas nuevas (migración pendiente). */
  simulation_mode?: SimulationMode | null
  vacancy_rate_snapshot?: number | null
  annual_management?: number | null
  annual_income_tax_estimate?: number | null
  expense_breakdown?: ExpenseBreakdown | null
  assumptions_json?: Record<string, unknown> | null
  calculation_version?: string | null
  rate_type?: RateType | null
  annual_other_financial?: number | null
  acquisition_costs?: number | null
  monthly_extra_charges?: number | null
  financing_partners?: Pick<FinancingPartner, 'partner_name' | 'annual_interest_rate'> | null
  units?: { unit_number: string; published_commercial_price: number | null } | null
  leads?: { phone: string | null; name: string | null } | null
}

export type FinancingCalculationLog = {
  id: string
  tenant_id: string | null
  scenario_id: string | null
  input_json: Record<string, unknown> | null
  output_json: Record<string, unknown> | null
  calculation_method: string | null
  processing_time_ms: number | null
  calculated_at: string | null
  calculated_by: string | null
}

export type InvestmentPreview = {
  calculationVersion: string
  mode: SimulationMode
  rateType: RateType
  unitPrice: number
  downPaymentPercent: number
  downPaymentAmount: number
  financedAmount: number
  interestRate: number
  financingYears: number
  monthlyPayment: number
  monthlyExtraCharges: number
  monthlyDebtService: number
  annualMortgagePaid: number
  annualExtraCharges: number
  annualOtherFinancialCosts: number
  annualDebtService: number
  acquisitionCosts: number
  initialCashOutlay: number
  vacancyRate: number
  annualPotentialRental: number
  annualEffectiveRental: number
  /** Alias de annualEffectiveRental (compat con UI/RPC antiguos). */
  annualGrossRental: number
  annualOperatingExpenses: number
  annualManagement: number
  annualExpenses: number
  annualOperatingResult: number
  annualCashFlowBeforeTax: number
  annualIncomeTaxEstimate: number
  annualCashFlowAfterTax: number
  annualNetCashFlow: number
  monthlyCashFlow: number
  buyerTopUpMonthly: number
  /** Resultado operativo / precio. */
  operatingYieldOnPrice: number | null
  /** Flujo anual / efectivo inicial aportado. */
  cashOnCashReturn: number | null
  /** Alias de cashOnCashReturn (compat). */
  roiPercent: number | null
  debtCoverageRatio: number | null
  paybackYears: number | null
  paybackLabel: string | null
  breakevenMonth: number | null
  isProfitable: boolean
  assumptions: {
    vacancyAppliedOnce: boolean
    incomeTaxIncluded: boolean
    rateType: RateType
    rateIsBankOffer: boolean
    recoveryMethod: string
    excludesAppreciationAndSale: boolean
  }
}

export const FINANCING_PROJECT_ID = 'b1b2c3d4-0001-4000-8000-000000000001'
export const FINANCING_TENANT_ID = 'a1b2c3d4-0001-4000-8000-000000000001'
