import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { TOUR_PROJECT_ID, TOUR_TENANT_ID } from '@/lib/tour/trackingIds'
import { normalizeShowroomPhone } from '@/lib/tour/showroomIdentity'
import {
  CALCULATION_VERSION,
  buildInvestmentPreview,
  clampDownPaymentPercent,
  clampFinancingYears,
  defaultAnnualExpenses,
} from '@/lib/financing/calculator'
import {
  FINANCING_PROJECT_ID,
  FINANCING_TENANT_ID,
  type ExpenseBreakdown,
  type FinancingConfig,
  type FinancingPartner,
  type FinancingScenario,
  type RateType,
  type SimulationMode,
} from '@/types/financingSimulator'
import {
  isMissingInvestmentV2SchemaError,
  migrationRequiredError,
  resolveAuthorizedLeadId as resolveAuthorizedLeadIdCore,
} from '@/lib/financing/financingAuth'

export {
  isMissingInvestmentV2SchemaError,
  migrationRequiredError,
  INVESTMENT_V2_REQUIRED_COLUMNS,
} from '@/lib/financing/financingAuth'

export async function fetchFinancingPartners(admin: SupabaseClient, opts?: { activeOnly?: boolean }) {
  let query = admin
    .from('financing_partners')
    .select('*')
    .order('annual_interest_rate', { ascending: true })
  if (opts?.activeOnly !== false) query = query.eq('active', true)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as FinancingPartner[]
}

export async function fetchFinancingConfig(
  admin: SupabaseClient,
  projectId = FINANCING_PROJECT_ID,
) {
  const { data, error } = await admin
    .from('financing_config')
    .select('*')
    .eq('project_id', projectId)
    .maybeSingle()
  if (error) throw error
  return data as FinancingConfig | null
}

export async function resolveUnitByParam(admin: SupabaseClient, rawId: string) {
  const id = String(rawId ?? '').trim()
  if (!id) return null
  const byId = await admin
    .from('units')
    .select(
      'id, tenant_id, project_id, unit_number, published_commercial_price, bedrooms, category, status, is_published',
    )
    .eq('id', id)
    .maybeSingle()
  if (byId.data) return byId.data
  const byNumber = await admin
    .from('units')
    .select(
      'id, tenant_id, project_id, unit_number, published_commercial_price, bedrooms, category, status, is_published',
    )
    .eq('unit_number', id)
    .eq('project_id', TOUR_PROJECT_ID)
    .limit(1)
    .maybeSingle()
  return byNumber.data ?? null
}

/**
 * Autoriza escenarios solo con identidad de servidor confiable:
 * cookie lv_vid → tour_visitors.lead_id.
 * lead_id/teléfono del cliente no bastan por sí solos.
 */
export async function resolveAuthorizedLeadId(
  admin: SupabaseClient,
  input: {
    leadId?: string | null
    phone?: string | null
    visitorKey?: string | null
  },
) {
  return resolveAuthorizedLeadIdCore(admin as never, {
    ...input,
    tenantId: TOUR_TENANT_ID,
    normalizePhone: normalizeShowroomPhone,
  })
}

/** @deprecated Usar resolveAuthorizedLeadId. */
export async function resolveLeadId(
  admin: SupabaseClient,
  input: {
    leadId?: string | null
    phone?: string | null
    visitorKey?: string | null
  },
) {
  return resolveAuthorizedLeadId(admin, input)
}

export type CreateScenarioInput = {
  leadId: string
  unitId: string
  partnerId?: string | null
  projectId?: string
  mode: SimulationMode
  downPaymentPercent?: number
  financingYears?: number
  estimatedMonthlyRent: number
  vacancyRate?: number
  annualExpenses?: number | null
  annualManagement?: number | null
  annualIncomeTaxEstimate?: number | null
  expenseBreakdown?: ExpenseBreakdown | null
  appliedInterestRate?: number | null
  rateType?: RateType
  acquisitionCosts?: number | null
  annualOtherFinancial?: number | null
  monthlyExtraCharges?: number | null
  unitPrice: number
  calculationVersion?: string
  assumptionsJson?: Record<string, unknown> | null
  ip?: string | null
  userAgent?: string | null
}

function scenarioInsertFromPreview(
  input: CreateScenarioInput,
  preview: ReturnType<typeof buildInvestmentPreview>,
  partnerId: string | null,
) {
  return {
    tenant_id: FINANCING_TENANT_ID,
    lead_id: input.leadId,
    unit_id: input.unitId,
    financing_partner_id: partnerId,
    project_id: input.projectId || FINANCING_PROJECT_ID,
    down_payment_percent: preview.downPaymentPercent,
    financing_years: preview.mode === 'cash' ? null : preview.financingYears,
    estimated_monthly_rent: input.estimatedMonthlyRent,
    unit_price: preview.unitPrice,
    down_payment_amount: preview.downPaymentAmount,
    financed_amount: preview.financedAmount,
    applied_interest_rate: preview.interestRate,
    monthly_payment: preview.monthlyPayment,
    annual_mortgage_paid: preview.annualMortgagePaid,
    annual_expenses: preview.annualOperatingExpenses,
    annual_gross_rental: preview.annualEffectiveRental,
    annual_net_cash_flow: preview.annualNetCashFlow,
    roi_percent: preview.cashOnCashReturn,
    payback_years: preview.paybackYears,
    breakeven_month: preview.breakevenMonth,
    is_profitable: preview.isProfitable,
    status: 'saved',
    ip_address: input.ip || null,
    user_agent: input.userAgent || null,
    // Columnas v2 (migración requerida). Si faltan, el insert falla con mensaje explícito.
    simulation_mode: preview.mode,
    vacancy_rate_snapshot: preview.vacancyRate,
    annual_management: preview.annualManagement,
    annual_income_tax_estimate: preview.annualIncomeTaxEstimate || null,
    expense_breakdown: input.expenseBreakdown ?? null,
    assumptions_json: input.assumptionsJson ?? preview.assumptions,
    calculation_version: input.calculationVersion || CALCULATION_VERSION,
    rate_type: preview.rateType,
    annual_other_financial: preview.annualOtherFinancialCosts,
    acquisition_costs: preview.acquisitionCosts,
    monthly_extra_charges: preview.monthlyExtraCharges,
  }
}

export async function createAndAnalyzeScenario(admin: SupabaseClient, input: CreateScenarioInput) {
  const projectId = input.projectId || FINANCING_PROJECT_ID

  const [unit, config] = await Promise.all([
    admin.from('units').select('id, project_id').eq('id', input.unitId).maybeSingle(),
    fetchFinancingConfig(admin, projectId),
  ])

  if (!unit.data?.id) throw new Error('La unidad no existe')
  if (!config) throw new Error('No hay configuración de financiamiento para el proyecto')

  let mode: SimulationMode = input.mode
  let partner: FinancingPartner | null = null

  if (mode === 'financed') {
    if (!input.partnerId) {
      throw new Error('Modo financiado requiere institución, o use simulación manual')
    }
    const { data: partnerData } = await admin
      .from('financing_partners')
      .select('*')
      .eq('id', input.partnerId)
      .eq('active', true)
      .maybeSingle()
    if (!partnerData?.id) throw new Error('El banco no es válido o está inactivo')
    partner = partnerData as FinancingPartner
  } else if (mode === 'manual') {
    if (!(Number(input.appliedInterestRate) >= 0)) {
      throw new Error('Simulación manual requiere tasa de interés')
    }
  } else {
    mode = 'cash'
  }

  const vacancyRate =
    input.vacancyRate != null ? Number(input.vacancyRate) : Number(config.vacancy_rate || 0)
  const annualOperatingExpenses =
    input.annualExpenses != null && Number.isFinite(Number(input.annualExpenses))
      ? Math.max(0, Number(input.annualExpenses))
      : input.expenseBreakdown != null
        ? Math.max(0, Number(input.expenseBreakdown.total) || 0)
        : defaultAnnualExpenses(input.unitPrice, config)

  const interestRate =
    mode === 'cash'
      ? 0
      : mode === 'manual'
        ? Number(input.appliedInterestRate)
        : input.appliedInterestRate != null && Number.isFinite(Number(input.appliedInterestRate))
          ? Number(input.appliedInterestRate)
          : Number(partner!.annual_interest_rate)

  const financingYears =
    mode === 'cash' ? 0 : clampFinancingYears(input.financingYears ?? 20, partner)

  const previewFinal = buildInvestmentPreview({
    mode,
    unitPrice: input.unitPrice,
    estimatedMonthlyRent: input.estimatedMonthlyRent,
    vacancyRate,
    annualOperatingExpenses,
    annualManagement: input.annualManagement ?? 0,
    annualIncomeTaxEstimate: input.annualIncomeTaxEstimate,
    acquisitionCosts: input.acquisitionCosts ?? 0,
    annualOtherFinancialCosts: input.annualOtherFinancial ?? 0,
    monthlyExtraCharges: input.monthlyExtraCharges ?? 0,
    downPaymentPercent: clampDownPaymentPercent(input.downPaymentPercent ?? 30),
    financingYears,
    interestRate,
    rateType: input.rateType ?? 'nominal_annual',
  })

  const fullRow = scenarioInsertFromPreview(input, previewFinal, partner?.id ?? null)

  const { data: scenario, error: insertError } = await admin
    .from('financing_scenarios')
    .insert(fullRow)
    .select('*')
    .single()

  if (insertError || !scenario) {
    if (isMissingInvestmentV2SchemaError(insertError)) {
      throw migrationRequiredError()
    }
    throw insertError ?? new Error('No se pudo guardar el escenario')
  }

  // No reinterpretar con RPC remoto: el preview TypeScript es la fuente de verdad v2.
  // Si existe calculate_investment_analysis, no lo usamos para sobreescribir valores guardados.

  const { data: refreshed } = await admin
    .from('financing_scenarios')
    .select(
      '*, financing_partners(partner_name, annual_interest_rate), units(unit_number, published_commercial_price)',
    )
    .eq('id', scenario.id)
    .single()

  return {
    scenario: (refreshed ?? scenario) as FinancingScenario,
    analysis: previewFinal,
    preview: previewFinal,
  }
}

export async function listScenariosForLead(admin: SupabaseClient, leadId: string) {
  const { data, error } = await admin
    .from('financing_scenarios')
    .select(
      '*, financing_partners(partner_name, annual_interest_rate), units(unit_number, published_commercial_price)',
    )
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as FinancingScenario[]
}
