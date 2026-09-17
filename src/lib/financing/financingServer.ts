import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { TOUR_PROJECT_ID, TOUR_TENANT_ID } from '@/lib/tour/trackingIds'
import { normalizeShowroomPhone } from '@/lib/tour/showroomIdentity'
import {
  CALCULATION_VERSION,
  FINANCING_YEARS_MAX,
  FINANCING_YEARS_MIN,
  buildInvestmentPreview,
  clampDownPaymentPercent,
  clampFinancingYears,
  defaultAnnualExpenses,
  roundMoney,
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
import { ScenarioValidationError } from '@/lib/financing/scenarioValidate'

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
  const selectCols =
    'id, tenant_id, project_id, unit_number, published_commercial_price, bedrooms, category, status, is_published'
  const byId = await admin.from('units').select(selectCols).eq('id', id).maybeSingle()
  if (byId.data) return byId.data
  const byNumber = await admin
    .from('units')
    .select(selectCols)
    .eq('unit_number', id)
    .eq('project_id', TOUR_PROJECT_ID)
    .limit(1)
    .maybeSingle()
  return byNumber.data ?? null
}

export function assertUnitAccessibleForTour(
  unit: {
    id: string
    project_id: string | null
    tenant_id?: string | null
    is_published?: boolean | null
    status?: string | null
  } | null,
) {
  if (!unit?.id) throw new ScenarioValidationError('Unidad no válida')
  if (unit.project_id && unit.project_id !== TOUR_PROJECT_ID && unit.project_id !== FINANCING_PROJECT_ID) {
    throw new ScenarioValidationError('Unidad fuera del proyecto autorizado')
  }
  if (unit.tenant_id && unit.tenant_id !== TOUR_TENANT_ID && unit.tenant_id !== FINANCING_TENANT_ID) {
    throw new ScenarioValidationError('Unidad fuera del tenant autorizado')
  }
  if (unit.is_published === false) {
    throw new ScenarioValidationError('Unidad no publicada')
  }
  const status = String(unit.status || '').toLowerCase()
  if (status && !['available', 'disponible', 'reserved', 'reservado', 'published'].includes(status)) {
    // Permitimos available/reserved típicos del tour; bloqueamos vendido/cancelado.
    if (['sold', 'vendido', 'blocked', 'bloqueado', 'withdrawn'].includes(status)) {
      throw new ScenarioValidationError('Unidad no disponible para simular')
    }
  }
  return unit
}

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
  visitorKey: string
  unitId: string
  partnerId?: string | null
  /** Ignorado si difiere de unit.project_id; se fuerza desde la unidad. */
  projectId?: string
  mode: SimulationMode
  downPaymentPercent?: number
  financingYears?: number
  estimatedMonthlyRent: number
  vacancyRate: number
  annualOperatingExpenses: number
  annualManagement: number
  annualIncomeTaxEstimate?: number | null
  expenseBreakdown?: ExpenseBreakdown | null
  appliedInterestRate?: number | null
  rateType: RateType
  acquisitionCosts: number
  annualOtherFinancial: number
  monthlyExtraCharges: number
  unitPrice: number
  ip?: string | null
  userAgent?: string | null
}

function scenarioInsertFromPreview(
  input: CreateScenarioInput,
  preview: ReturnType<typeof buildInvestmentPreview>,
  partnerId: string | null,
  projectId: string,
) {
  return {
    tenant_id: FINANCING_TENANT_ID,
    lead_id: input.leadId,
    unit_id: input.unitId,
    financing_partner_id: partnerId,
    project_id: projectId,
    created_by_visitor_key: input.visitorKey,
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
    simulation_mode: preview.mode,
    vacancy_rate_snapshot: preview.vacancyRate,
    annual_management: preview.annualManagement,
    annual_income_tax_estimate: preview.annualIncomeTaxEstimate || null,
    expense_breakdown: input.expenseBreakdown ?? null,
    // Solo servidor: snapshot de la fórmula ejecutada.
    assumptions_json: preview.assumptions,
    calculation_version: CALCULATION_VERSION,
    rate_type: preview.rateType,
    annual_other_financial: preview.annualOtherFinancialCosts,
    acquisition_costs: preview.acquisitionCosts,
    monthly_extra_charges: preview.monthlyExtraCharges,
  }
}

export async function createAndAnalyzeScenario(admin: SupabaseClient, input: CreateScenarioInput) {
  if (!input.visitorKey?.trim()) {
    throw new ScenarioValidationError('Falta identidad de visitante')
  }

  const { data: unitRow, error: unitError } = await admin
    .from('units')
    .select('id, project_id, tenant_id, is_published, status')
    .eq('id', input.unitId)
    .maybeSingle()
  if (unitError) throw unitError
  const unit = assertUnitAccessibleForTour(unitRow)
  const projectId = String(unit.project_id || FINANCING_PROJECT_ID)

  const config = await fetchFinancingConfig(admin, projectId)
  if (!config) throw new Error('No hay configuración de financiamiento para el proyecto')

  let mode: SimulationMode = input.mode
  let partner: FinancingPartner | null = null

  if (mode === 'financed') {
    if (!input.partnerId) {
      throw new ScenarioValidationError('Modo financiado requiere institución, o use simulación manual')
    }
    const { data: partnerData } = await admin
      .from('financing_partners')
      .select('*')
      .eq('id', input.partnerId)
      .eq('active', true)
      .maybeSingle()
    if (!partnerData?.id) throw new ScenarioValidationError('El banco no es válido o está inactivo')
    if (
      partnerData.tenant_id &&
      partnerData.tenant_id !== FINANCING_TENANT_ID &&
      partnerData.tenant_id !== TOUR_TENANT_ID
    ) {
      throw new ScenarioValidationError('Institución fuera del ámbito autorizado')
    }
    partner = partnerData as FinancingPartner
  } else if (mode === 'manual') {
    if (!(Number(input.appliedInterestRate) >= 0) || !Number.isFinite(Number(input.appliedInterestRate))) {
      throw new ScenarioValidationError('Simulación manual requiere tasa de interés')
    }
  } else if (mode !== 'cash') {
    throw new ScenarioValidationError('mode inválido')
  }

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

  if (mode !== 'cash' && partner) {
    const minY = partner.min_financing_years ?? FINANCING_YEARS_MIN
    const maxY = partner.max_financing_years ?? FINANCING_YEARS_MAX
    if (financingYears < minY || financingYears > maxY) {
      throw new ScenarioValidationError(`El plazo debe estar entre ${minY} y ${maxY} años para esta institución`)
    }
  }

  const previewFinal = buildInvestmentPreview({
    mode,
    unitPrice: input.unitPrice,
    estimatedMonthlyRent: input.estimatedMonthlyRent,
    vacancyRate: input.vacancyRate,
    annualOperatingExpenses: input.annualOperatingExpenses,
    annualManagement: input.annualManagement,
    annualIncomeTaxEstimate: input.annualIncomeTaxEstimate,
    acquisitionCosts: input.acquisitionCosts,
    annualOtherFinancialCosts: input.annualOtherFinancial,
    monthlyExtraCharges: input.monthlyExtraCharges,
    downPaymentPercent: clampDownPaymentPercent(input.downPaymentPercent ?? 30),
    financingYears,
    interestRate,
    rateType: input.rateType,
  })

  const fullRow = scenarioInsertFromPreview(input, previewFinal, partner?.id ?? null, projectId)

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

/**
 * Lista escenarios del lead **y** del visitante actual.
 * Deduplicar lead por teléfono no concede acceso a escenarios de otro visitor_key.
 * Filas legacy sin created_by_visitor_key no se exponen por la API pública.
 */
export async function listScenariosForVisitor(
  admin: SupabaseClient,
  leadId: string,
  visitorKey: string,
) {
  const key = visitorKey.trim()
  if (!key) return [] as FinancingScenario[]
  // Select plano (sin embeds) + filtro visitor en memoria.
  // Los embeds pueden fallar por relaciones/caché y el wrapper antiguo
  // convertía cualquier "column … does not exist" en falso 503 de migración.
  const { data, error } = await admin
    .from('financing_scenarios')
    .select('*')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
  if (error) {
    console.error('listScenariosForVisitor', {
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    })
    if (isMissingInvestmentV2SchemaError(error)) {
      throw migrationRequiredError()
    }
    throw error
  }
  return ((data ?? []) as FinancingScenario[]).filter(
    (row) => String(row.created_by_visitor_key || '') === key,
  )
}

/** @deprecated Preferir listScenariosForVisitor. */
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

export async function deleteScenarioForVisitor(
  admin: SupabaseClient,
  input: { scenarioId: string; leadId: string; visitorKey: string },
) {
  const { data: row } = await admin
    .from('financing_scenarios')
    .select('id, lead_id, created_by_visitor_key')
    .eq('id', input.scenarioId)
    .maybeSingle()
  if (
    !row ||
    row.lead_id !== input.leadId ||
    String(row.created_by_visitor_key || '') !== input.visitorKey.trim()
  ) {
    return { ok: false as const, status: 404 as const }
  }
  const { error } = await admin.from('financing_scenarios').delete().eq('id', input.scenarioId)
  if (error) throw error
  return { ok: true as const }
}

export function operatingExpensesOrDefault(
  unitPrice: number,
  config: FinancingConfig,
  annualOperatingExpenses: number | undefined,
  breakdown: ExpenseBreakdown | null,
) {
  if (annualOperatingExpenses != null) return roundMoney(annualOperatingExpenses)
  if (breakdown) return breakdown.total
  return defaultAnnualExpenses(unitPrice, config)
}
