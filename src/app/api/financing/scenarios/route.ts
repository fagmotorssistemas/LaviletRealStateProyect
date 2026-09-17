import { cookies, headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import { LV_VID_COOKIE } from '@/lib/tour/trackingIds'
import { defaultAnnualExpenses } from '@/lib/financing/calculator'
import {
  assertUnitAccessibleForTour,
  createAndAnalyzeScenario,
  deleteScenarioForVisitor,
  fetchFinancingConfig,
  fetchFinancingPartners,
  listScenariosForVisitor,
  resolveAuthorizedLeadId,
  resolveUnitByParam,
} from '@/lib/financing/financingServer'
import {
  ScenarioValidationError,
  parseExpenseBreakdown,
  parseOptionalFinite,
  parseRateType,
  parseRequiredFinite,
  parseSimulationMode,
  resolveOperatingExpenses,
  validateDownPaymentAndYears,
} from '@/lib/financing/scenarioValidate'
import type { RateType } from '@/types/financingSimulator'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function validationResponse(error: unknown) {
  if (error instanceof ScenarioValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  return null
}

export async function GET(request: Request) {
  try {
    const admin = tryCreateAdminClient()
    if (!admin) {
      return NextResponse.json({ error: 'Falta SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })
    }

    const url = new URL(request.url)
    const phone = url.searchParams.get('phone')
    const leadParam = url.searchParams.get('lead_id')
    const jar = await cookies()
    const visitorKey = jar.get(LV_VID_COOKIE)?.value?.trim() || null

    const leadId = await resolveAuthorizedLeadId(admin, {
      leadId: leadParam,
      phone,
      visitorKey,
    })
    if (!leadId || !visitorKey) {
      return NextResponse.json({ scenarios: [], identified: false })
    }

    const scenarios = await listScenariosForVisitor(admin, leadId, visitorKey)
    return NextResponse.json({ scenarios, identified: true, lead_id: leadId })
  } catch (error) {
    console.error('GET /api/financing/scenarios', error)
    const message = error instanceof Error ? error.message : 'No se pudieron cargar los escenarios'
    if (/migración|migration|column/i.test(message)) {
      return NextResponse.json({ error: message }, { status: 503 })
    }
    return NextResponse.json({ error: 'No se pudieron cargar los escenarios' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const admin = tryCreateAdminClient()
    if (!admin) {
      return NextResponse.json({ error: 'Falta SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })
    }

    let body: Record<string, unknown>
    try {
      body = (await request.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
    }

    const jar = await cookies()
    const visitorKey = jar.get(LV_VID_COOKIE)?.value?.trim() || null
    const leadId = await resolveAuthorizedLeadId(admin, {
      leadId: typeof body.lead_id === 'string' ? body.lead_id : null,
      phone: typeof body.phone === 'string' ? body.phone : null,
      visitorKey,
    })
    if (!leadId || !visitorKey) {
      return NextResponse.json(
        { error: 'Identificate en el showroom con tu celular para guardar escenarios' },
        { status: 401 },
      )
    }

    const unitParam = String(body.unit_id || body.unit_param || '').trim()
    const unitRaw = await resolveUnitByParam(admin, unitParam)
    let unit
    try {
      unit = assertUnitAccessibleForTour(unitRaw)
    } catch (error) {
      const res = validationResponse(error)
      if (res) return res
      throw error
    }

    // No confiar en body.project_id
    const projectId = String(unit.project_id)
    const config = await fetchFinancingConfig(admin, projectId)
    if (!config) {
      return NextResponse.json({ error: 'No hay configuración de financiamiento' }, { status: 400 })
    }

    let mode
    try {
      mode = parseSimulationMode(body.mode)
    } catch (error) {
      const res = validationResponse(error)
      if (res) return res
      throw error
    }

    if (mode === 'financed' && !body.financing_partner_id) {
      return NextResponse.json(
        { error: 'Modo financiado requiere institución; use mode:manual para tasa propia' },
        { status: 400 },
      )
    }

    let estimatedMonthlyRent: number
    let unitPrice: number
    let vacancyRate: number
    let rateType: RateType
    let expenseBreakdown
    let annualOperatingExpenses: number
    let annualManagement: number
    let acquisitionCosts: number
    let annualOtherFinancial: number
    let monthlyExtraCharges: number
    let annualIncomeTaxEstimate: number | null
    let appliedInterestRate: number | null
    let downPaymentPercent: number | undefined
    let financingYears: number | undefined

    try {
      estimatedMonthlyRent = parseRequiredFinite(body.estimated_monthly_rent, 'estimated_monthly_rent', {
        min: 0,
        max: 20000,
      })
      unitPrice = parseRequiredFinite(body.unit_price, 'unit_price', { min: 0.01 })
      vacancyRate =
        parseOptionalFinite(body, 'vacancy_rate', { min: 0, max: 1 }) ?? Number(config.vacancy_rate || 0)
      if (!(vacancyRate >= 0 && vacancyRate <= 1)) {
        throw new ScenarioValidationError('vacancy_rate fuera de rango (0–1)')
      }
      rateType =
        parseRateType(body.rate_type, false) ?? 'nominal_annual'
      if (mode !== 'cash' && (body.rate_type === undefined || body.rate_type === null || body.rate_type === '')) {
        throw new ScenarioValidationError('Falta rate_type')
      }

      expenseBreakdown = parseExpenseBreakdown(body.expense_breakdown)
      const annualExpensesOpt = parseOptionalFinite(body, 'annual_expenses', { min: 0 })
      if (annualExpensesOpt === undefined && !expenseBreakdown) {
        // Opcional: default desde config solo si ambos ausentes (no si enviaron 0).
        annualOperatingExpenses = defaultAnnualExpenses(unitPrice, config)
      } else {
        const resolved = resolveOperatingExpenses({
          annualExpenses: annualExpensesOpt,
          breakdown: expenseBreakdown,
        })
        annualOperatingExpenses = resolved.annualOperatingExpenses
        expenseBreakdown = resolved.breakdown
      }

      annualManagement = parseOptionalFinite(body, 'annual_management', { min: 0 }) ?? 0
      acquisitionCosts = parseOptionalFinite(body, 'acquisition_costs', { min: 0 }) ?? 0
      annualOtherFinancial = parseOptionalFinite(body, 'annual_other_financial', { min: 0 }) ?? 0
      monthlyExtraCharges = parseOptionalFinite(body, 'monthly_extra_charges', { min: 0 }) ?? 0
      const taxOpt = parseOptionalFinite(body, 'annual_income_tax_estimate', { min: 0 })
      annualIncomeTaxEstimate = taxOpt === undefined ? null : taxOpt
      appliedInterestRate =
        parseOptionalFinite(body, 'applied_interest_rate', { min: 0, max: 100 }) ?? null

      if (mode !== 'cash') {
        downPaymentPercent = parseRequiredFinite(body.down_payment_percent, 'down_payment_percent')
        financingYears = parseRequiredFinite(body.financing_years, 'financing_years', { integer: true })
      }

      let partnerMin: number | null = null
      let partnerMax: number | null = null
      if (mode === 'financed') {
        const partners = await fetchFinancingPartners(admin)
        const partner = partners.find((p) => p.id === String(body.financing_partner_id))
        if (!partner) throw new ScenarioValidationError('El banco no es válido o está inactivo')
        partnerMin = partner.min_financing_years
        partnerMax = partner.max_financing_years
      }

      validateDownPaymentAndYears({
        mode,
        downPaymentPercent,
        financingYears,
        partnerMinYears: partnerMin,
        partnerMaxYears: partnerMax,
      })

      if (mode === 'manual' && appliedInterestRate == null) {
        throw new ScenarioValidationError('Indica una tasa para la simulación manual')
      }
    } catch (error) {
      const res = validationResponse(error)
      if (res) return res
      throw error
    }

    // Ignorar calculation_version / assumptions_json / project_id del cliente.
    const hdrs = await headers()
    const result = await createAndAnalyzeScenario(admin, {
      leadId,
      visitorKey,
      unitId: unit.id,
      projectId,
      mode,
      partnerId: mode === 'financed' ? String(body.financing_partner_id) : null,
      downPaymentPercent,
      financingYears,
      estimatedMonthlyRent,
      vacancyRate,
      annualOperatingExpenses,
      annualManagement,
      annualIncomeTaxEstimate,
      expenseBreakdown,
      appliedInterestRate,
      rateType,
      acquisitionCosts,
      annualOtherFinancial,
      monthlyExtraCharges,
      unitPrice,
      ip: hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
      userAgent: hdrs.get('user-agent'),
    })

    return NextResponse.json({
      scenario: result.scenario,
      analysis: result.analysis,
      preview: result.preview,
      lead_id: leadId,
    })
  } catch (error) {
    console.error('POST /api/financing/scenarios', error)
    const res = validationResponse(error)
    if (res) return res
    const message = error instanceof Error ? error.message : 'No se pudo guardar el escenario'
    const status = /migración|migration|column/i.test(message) ? 503 : 500
    return NextResponse.json({ error: message }, { status })
  }
}

export async function DELETE(request: Request) {
  try {
    const admin = tryCreateAdminClient()
    if (!admin) {
      return NextResponse.json({ error: 'Falta SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })
    }

    const url = new URL(request.url)
    const scenarioId = url.searchParams.get('id')
    const phone = url.searchParams.get('phone')
    const leadParam = url.searchParams.get('lead_id')
    if (!scenarioId) {
      return NextResponse.json({ error: 'Falta id' }, { status: 400 })
    }

    const jar = await cookies()
    const visitorKey = jar.get(LV_VID_COOKIE)?.value?.trim() || null
    const leadId = await resolveAuthorizedLeadId(admin, {
      leadId: leadParam,
      phone,
      visitorKey,
    })
    if (!leadId || !visitorKey) {
      return NextResponse.json({ error: 'No identificado' }, { status: 401 })
    }

    const result = await deleteScenarioForVisitor(admin, {
      scenarioId,
      leadId,
      visitorKey,
    })
    if (!result.ok) {
      return NextResponse.json({ error: 'Escenario no encontrado' }, { status: 404 })
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('DELETE /api/financing/scenarios', error)
    return NextResponse.json({ error: 'No se pudo eliminar' }, { status: 500 })
  }
}
