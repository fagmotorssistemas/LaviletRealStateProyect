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
  unitPrice: number
  downPaymentPercent: number
  downPaymentAmount: number
  financedAmount: number
  interestRate: number
  financingYears: number
  monthlyPayment: number
  annualMortgagePaid: number
  annualExpenses: number
  annualGrossRental: number
  annualNetCashFlow: number
  roiPercent: number | null
  paybackYears: number | null
  breakevenMonth: number | null
  isProfitable: boolean
}

export const FINANCING_PROJECT_ID = 'b1b2c3d4-0001-4000-8000-000000000001'
export const FINANCING_TENANT_ID = 'a1b2c3d4-0001-4000-8000-000000000001'
