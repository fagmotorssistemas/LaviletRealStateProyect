import { cookies, headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { tryCreateAdminClient } from '@/lib/supabase/admin'
import { LV_VID_COOKIE } from '@/lib/tour/trackingIds'
import {
  createAndAnalyzeScenario,
  listScenariosForLead,
  resolveLeadId,
  resolveUnitByParam,
} from '@/lib/financing/financingServer'
import { FINANCING_PROJECT_ID } from '@/types/financingSimulator'

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

    const leadId = await resolveLeadId(admin, {
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
      financing_partner_id?: string
      mode?: 'cash' | 'financed'
      down_payment_percent?: number
      financing_years?: number
      estimated_monthly_rent?: number
      annual_expenses?: number
      unit_price?: number
      project_id?: string
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
    const leadId = await resolveLeadId(admin, {
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

    const mode = body.mode === 'cash' || !body.financing_partner_id ? 'cash' : 'financed'
    const estimatedMonthlyRent = Number(body.estimated_monthly_rent)
    const unitPrice = Number(body.unit_price)
    if (!(estimatedMonthlyRent >= 0 && estimatedMonthlyRent <= 20000)) {
      return NextResponse.json({ error: 'Alquiler fuera de rango' }, { status: 400 })
    }
    if (!(unitPrice > 0)) {
      return NextResponse.json({ error: 'Indica un precio de unidad válido' }, { status: 400 })
    }

    const hdrs = await headers()

    if (mode === 'cash') {
      const result = await createAndAnalyzeScenario(admin, {
        leadId,
        unitId: unit.id,
        mode: 'cash',
        estimatedMonthlyRent,
        annualExpenses:
          body.annual_expenses != null ? Number(body.annual_expenses) : null,
        unitPrice,
        projectId: body.project_id || unit.project_id || FINANCING_PROJECT_ID,
        ip: hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
        userAgent: hdrs.get('user-agent'),
      })
      return NextResponse.json({
        scenario: result.scenario,
        analysis: result.analysis,
        lead_id: leadId,
      })
    }

    const downPaymentPercent = Number(body.down_payment_percent)
    const financingYears = Number(body.financing_years)
    if (!(downPaymentPercent >= 10 && downPaymentPercent <= 50)) {
      return NextResponse.json({ error: 'La entrada debe estar entre 10% y 50%' }, { status: 400 })
    }
    if (!(financingYears >= 5 && financingYears <= 30)) {
      return NextResponse.json({ error: 'El plazo debe estar entre 5 y 30 años' }, { status: 400 })
    }

    const result = await createAndAnalyzeScenario(admin, {
      leadId,
      unitId: unit.id,
      partnerId: String(body.financing_partner_id ?? ''),
      projectId: body.project_id || unit.project_id || FINANCING_PROJECT_ID,
      downPaymentPercent,
      financingYears,
      estimatedMonthlyRent,
      unitPrice,
      ip: hdrs.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
      userAgent: hdrs.get('user-agent'),
    })

    return NextResponse.json({
      scenario: result.scenario,
      analysis: result.analysis,
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
    const leadId = await resolveLeadId(admin, {
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
