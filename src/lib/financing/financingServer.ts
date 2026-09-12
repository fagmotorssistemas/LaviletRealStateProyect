import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { TOUR_PROJECT_ID, TOUR_TENANT_ID } from '@/lib/tour/trackingIds'
import { normalizeShowroomPhone } from '@/lib/tour/showroomIdentity'
import { buildCashInvestmentPreview, buildInvestmentPreview, clampYears } from '@/lib/financing/calculator'
import {
  FINANCING_PROJECT_ID,
  FINANCING_TENANT_ID,
  type FinancingConfig,
  type FinancingPartner,
  type FinancingScenario,
} from '@/types/financingSimulator'

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

export async function resolveLeadId(admin: SupabaseClient, input: {
  leadId?: string | null
  phone?: string | null
  visitorKey?: string | null
}) {
  const leadId = String(input.leadId ?? '').trim()
  if (leadId) {
    const { data } = await admin.from('leads').select('id').eq('id', leadId).maybeSingle()
    if (data?.id) return data.id as string
  }

  const phone = normalizeShowroomPhone(String(input.phone ?? ''))
  if (phone) {
    const digits = phone.replace(/\D/g, '')
    const { data: byNorm } = await admin
      .from('leads')
      .select('id')
      .eq('tenant_id', TOUR_TENANT_ID)
      .eq('phone_normalized', digits)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (byNorm?.id) return byNorm.id as string

    const { data: byPhone } = await admin
      .from('leads')
      .select('id')
      .eq('tenant_id', TOUR_TENANT_ID)
      .eq('phone', phone)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (byPhone?.id) return byPhone.id as string
  }

  const visitorKey = String(input.visitorKey ?? '').trim()
  if (visitorKey) {
    const { data: visitor } = await admin
      .from('tour_visitors')
      .select('lead_id')
      .eq('tenant_id', TOUR_TENANT_ID)
      .eq('visitor_key', visitorKey)
      .maybeSingle()
    if (visitor?.lead_id) return visitor.lead_id as string
  }

  return null
}

export async function createAndAnalyzeScenario(
  admin: SupabaseClient,
  input: {
    leadId: string
    unitId: string
    partnerId?: string | null
    projectId?: string
    mode?: 'cash' | 'financed'
    downPaymentPercent?: number
    financingYears?: number
    estimatedMonthlyRent: number
    annualExpenses?: number | null
    unitPrice: number
    ip?: string | null
    userAgent?: string | null
  },
) {
  const projectId = input.projectId || FINANCING_PROJECT_ID
  const mode = input.mode === 'cash' || !input.partnerId ? 'cash' : 'financed'

  const [unit, config] = await Promise.all([
    admin.from('units').select('id, project_id').eq('id', input.unitId).maybeSingle(),
    fetchFinancingConfig(admin, projectId),
  ])

  if (!unit.data?.id) throw new Error('La unidad no existe')
  if (!config) throw new Error('No hay configuración de financiamiento para el proyecto')

  if (mode === 'cash') {
    const preview = buildCashInvestmentPreview({
      unitPrice: input.unitPrice,
      estimatedMonthlyRent: input.estimatedMonthlyRent,
      annualExpenses: input.annualExpenses,
      config,
    })

    const { data: scenario, error: insertError } = await admin
      .from('financing_scenarios')
      .insert({
        tenant_id: FINANCING_TENANT_ID,
        lead_id: input.leadId,
        unit_id: input.unitId,
        financing_partner_id: null,
        project_id: projectId,
        down_payment_percent: 100,
        financing_years: null,
        estimated_monthly_rent: input.estimatedMonthlyRent,
        unit_price: preview.unitPrice,
        down_payment_amount: preview.downPaymentAmount,
        financed_amount: 0,
        applied_interest_rate: 0,
        monthly_payment: 0,
        annual_mortgage_paid: 0,
        annual_expenses: preview.annualExpenses,
        annual_gross_rental: preview.annualGrossRental,
        annual_net_cash_flow: preview.annualNetCashFlow,
        roi_percent: preview.roiPercent,
        payback_years: preview.paybackYears,
        breakeven_month: preview.breakevenMonth,
        is_profitable: preview.isProfitable,
        status: 'saved',
        ip_address: input.ip || null,
        user_agent: input.userAgent || null,
      })
      .select('*')
      .single()

    if (insertError || !scenario) throw insertError ?? new Error('No se pudo guardar el escenario')

    const { data: refreshed } = await admin
      .from('financing_scenarios')
      .select(
        '*, financing_partners(partner_name, annual_interest_rate), units(unit_number, published_commercial_price)',
      )
      .eq('id', scenario.id)
      .single()

    return {
      scenario: (refreshed ?? scenario) as FinancingScenario,
      analysis: preview,
      preview,
    }
  }

  const { data: partnerData } = await admin
    .from('financing_partners')
    .select('*')
    .eq('id', input.partnerId!)
    .eq('active', true)
    .maybeSingle()

  if (!partnerData?.id) throw new Error('El banco no es válido o está inactivo')

  const partnerRow = partnerData as FinancingPartner
  const years = clampYears(input.financingYears ?? 20, partnerRow)
  const preview = buildInvestmentPreview({
    unitPrice: input.unitPrice,
    downPaymentPercent: input.downPaymentPercent ?? 25,
    financingYears: years,
    estimatedMonthlyRent: input.estimatedMonthlyRent,
    interestRate: Number(partnerRow.annual_interest_rate),
    config,
  })

  const { data: scenario, error: insertError } = await admin
    .from('financing_scenarios')
    .insert({
      tenant_id: FINANCING_TENANT_ID,
      lead_id: input.leadId,
      unit_id: input.unitId,
      financing_partner_id: partnerRow.id,
      project_id: projectId,
      down_payment_percent: preview.downPaymentPercent,
      financing_years: preview.financingYears,
      estimated_monthly_rent: input.estimatedMonthlyRent,
      unit_price: preview.unitPrice,
      down_payment_amount: preview.downPaymentAmount,
      financed_amount: preview.financedAmount,
      applied_interest_rate: preview.interestRate,
      status: 'saved',
      ip_address: input.ip || null,
      user_agent: input.userAgent || null,
    })
    .select('*')
    .single()

  if (insertError || !scenario) throw insertError ?? new Error('No se pudo guardar el escenario')

  const { data: analysis, error: rpcError } = await admin.rpc('calculate_investment_analysis', {
    p_scenario_id: scenario.id,
  })
  if (rpcError) throw rpcError

  const { data: refreshed } = await admin
    .from('financing_scenarios')
    .select(
      '*, financing_partners(partner_name, annual_interest_rate), units(unit_number, published_commercial_price)',
    )
    .eq('id', scenario.id)
    .single()

  return {
    scenario: (refreshed ?? scenario) as FinancingScenario,
    analysis,
    preview,
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
