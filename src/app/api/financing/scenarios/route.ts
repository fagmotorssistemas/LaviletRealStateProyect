import { cookies, headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import { LV_VID_COOKIE } from '@/lib/tour/trackingIds'
import {
  DOWN_PAYMENT_MAX_PCT,
  DOWN_PAYMENT_MIN_PCT,
  FINANCING_YEARS_MAX,
  FINANCING_YEARS_MIN,
} from '@/lib/financing/calculator'
import {
  createAndAnalyzeScenario,
  listScenariosForLead,
  resolveAuthorizedLeadId,
  resolveUnitByParam,
} from '@/lib/financing/financingServer'
import { FINANCING_PROJECT_ID, type ExpenseBreakdown, type RateType, type SimulationMode } from '@/types/financingSimulator'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
    if (!leadId) {
      return NextResponse.json({ scenarios: [], identified: false })
    }

    const scenarios = await listScenariosForLead(admin, leadId)
    return NextResponse.json({ scenarios, identified: true, lead_id: leadId })
  } catch (error) {
    console.error('GET /api/financing/scenarios', error)
    return NextResponse.json({ error: 'No se pudieron cargar los escenarios' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const admin = tryCreateAdminClient()
    if (!admin) {
      return NextResponse.json({ error: 'Falta SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 })
    }

    let body: {
      unit_id?: string
      unit_param?: string
      financing_partner_id?: string | null
      mode?: SimulationMode
      down_payment_percent?: number
      financing_years?: number
      estimated_monthly_rent?: number
      vacancy_rate?: number
      annual_expenses?: number
      annual_management?: number
      annual_income_tax_estimate?: number | null
      expense_breakdown?: ExpenseBreakdown
      applied_interest_rate?: number
      rate_type?: RateType
      acquisition_costs?: number
      annual_other_financial?: number
      monthly_extra_charges?: number
      unit_price?: number
      project_id?: string
      calculation_version?: string
      assumptions_json?: Record<string, unknown>
      phone?: string
      lead_id?: string
    }
    try {
      body = (await request.json()) as typeof body
    } catch {
      return NextResponse.json({ error: 'Cuerpo inválido' }, { status: 400 })
    }

    const jar = await cookies()
    const visitorKey = jar.get(LV_VID_COOKIE)?.value?.trim() || null
    const leadId = await resolveAuthorizedLeadId(admin, {
      leadId: body.lead_id,
      phone: body.phone,
      visitorKey,
    })
    if (!leadId) {
      return NextResponse.json(
        { error: 'Identificate en el showroom con tu celular para guardar escenarios' },
        { status: 401 },
      )
    }

    const unitParam = String(body.unit_id || body.unit_param || '').trim()
    const unit = await resolveUnitByParam(admin, unitParam)
    if (!unit?.id) {
      return NextResponse.json({ error: 'Unidad no válida' }, { status: 400 })
    }

    const rawMode = body.mode
    let mode: SimulationMode
    if (rawMode === 'cash') mode = 'cash'
    else if (rawMode === 'manual') mode = 'manual'
    else if (rawMode === 'financed') mode = 'financed'
    else if (body.financing_partner_id) mode = 'financed'
    else if (body.applied_interest_rate != null) mode = 'manual'
    else mode = 'cash'

    if (mode === 'financed' && !body.financing_partner_id) {
      return NextResponse.json(
        { error: 'Modo financiado requiere institución; use mode:manual para tasa propia' },
        { status: 400 },
      )
    }

    const estimatedMonthlyRent = Number(body.estimated_monthly_rent)
    const unitPrice = Number(body.unit_price)
    if (!(estimatedMonthlyRent >= 0 && estimatedMonthlyRent <= 20000)) {
      return NextResponse.json({ error: 'Alquiler fuera de rango' }, { status: 400 })
    }
    if (!(unitPrice > 0)) {
      return NextResponse.json({ error: 'Indica un precio de unidad válido' }, { status: 400 })
    }

    const hdrs = await headers()
    const common = {
      leadId,
      unitId: unit.id,
      projectId: body.project_id || unit.project_id || FINANCING_PROJECT_ID,
      estimatedMonthlyRent,
      vacancyRate: body.vacancy_rate != null ? Number(body.vacancy_rate) : undefined,
      annualExpenses: body.annual_expenses != null ? Number(body.annual_expenses) : null,
      annualManagement: body.annual_management != null ? Number(body.annual_management) : null,
      annualIncomeTaxEstimate:
        body.annual_income_tax_estimate != null ? Number(body.annual_income_tax_estimate) : null,
      expenseBreakdown: body.expense_breakdown ?? null,
      appliedInterestRate:
        body.applied_interest_rate != null ? Number(body.applied_interest_rate) : null,
      rateType: body.rate_type ?? 'nominal_annual',
      acquisitionCosts: body.acquisition_costs != null ? Number(body.acquisition_costs) : null,
      annualOtherFinancial:
        body.annual_other_financial != null ? Number(body.annual_other_financial) : null,
      monthlyExtraCharges:
        body.monthly_extra_charges != null ? Number(body.monthly_extra_charges) : null,
      unitPrice,
      calculationVersion: body.calculation_version,
      assumptionsJson: body.assumptions_json ?? null,
      ip: hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
      userAgent: hdrs.get('user-agent'),
    }

    if (mode === 'cash') {
      const result = await createAndAnalyzeScenario(admin, { ...common, mode: 'cash' })
      return NextResponse.json({
        scenario: result.scenario,
        analysis: result.analysis,
        preview: result.preview,
        lead_id: leadId,
      })
    }

    const downPaymentPercent = Number(body.down_payment_percent)
    const financingYears = Number(body.financing_years)
    if (
      !(
        downPaymentPercent >= DOWN_PAYMENT_MIN_PCT &&
        downPaymentPercent <= DOWN_PAYMENT_MAX_PCT
      )
    ) {
      return NextResponse.json(
        { error: `La entrada debe estar entre ${DOWN_PAYMENT_MIN_PCT}% y ${DOWN_PAYMENT_MAX_PCT}%` },
        { status: 400 },
      )
    }
    if (!(financingYears >= FINANCING_YEARS_MIN && financingYears <= FINANCING_YEARS_MAX)) {
      return NextResponse.json(
        { error: `El plazo debe estar entre ${FINANCING_YEARS_MIN} y ${FINANCING_YEARS_MAX} años` },
        { status: 400 },
      )
    }
    if (mode === 'manual' && !(Number(body.applied_interest_rate) >= 0)) {
      return NextResponse.json({ error: 'Indica una tasa para la simulación manual' }, { status: 400 })
    }

    const result = await createAndAnalyzeScenario(admin, {
      ...common,
      mode,
      partnerId: mode === 'financed' ? String(body.financing_partner_id) : null,
      downPaymentPercent,
      financingYears,
    })

    return NextResponse.json({
      scenario: result.scenario,
      analysis: result.analysis,
      preview: result.preview,
      lead_id: leadId,
    })
  } catch (error) {
    console.error('POST /api/financing/scenarios', error)
    const message = error instanceof Error ? error.message : 'No se pudo guardar el escenario'
    return NextResponse.json({ error: message }, { status: 500 })
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
    if (!leadId) {
      return NextResponse.json({ error: 'No identificado' }, { status: 401 })
    }

    const { data: row } = await admin
      .from('financing_scenarios')
      .select('id, lead_id')
      .eq('id', scenarioId)
      .maybeSingle()
    if (!row || row.lead_id !== leadId) {
      return NextResponse.json({ error: 'Escenario no encontrado' }, { status: 404 })
    }

    const { error } = await admin.from('financing_scenarios').delete().eq('id', scenarioId)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('DELETE /api/financing/scenarios', error)
    return NextResponse.json({ error: 'No se pudo eliminar' }, { status: 500 })
  }
}
