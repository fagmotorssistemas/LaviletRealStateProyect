import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CALCULATION_VERSION, buildInvestmentPreview } from './calculator'
import { previewFromSavedScenario } from './scenarioPersist'
import {
  isMissingInvestmentV2SchemaError,
  migrationRequiredError,
  resolveAuthorizedLeadId,
  type AuthAdminClient,
  type AuthQueryBuilder,
} from './financingAuth'
import { normalizeShowroomPhone } from '../tour/showroomIdentity'

const TENANT = 'a1b2c3d4-0001-4000-8000-000000000001'

function assertPreviewMatch(
  saved: ReturnType<typeof buildInvestmentPreview>,
  reopened: ReturnType<typeof buildInvestmentPreview>,
) {
  assert.equal(reopened.mode, saved.mode)
  assert.equal(reopened.interestRate, saved.interestRate)
  assert.equal(reopened.vacancyRate, saved.vacancyRate)
  assert.equal(reopened.annualOperatingExpenses, saved.annualOperatingExpenses)
  assert.equal(reopened.monthlyPayment, saved.monthlyPayment)
  assert.equal(reopened.annualNetCashFlow, saved.annualNetCashFlow)
  assert.equal(reopened.cashOnCashReturn, saved.cashOnCashReturn)
  assert.equal(reopened.calculationVersion, CALCULATION_VERSION)
}

describe('persistencia lógica save→reopen (mock / sin DB remota)', () => {
  it('contado conserva supuestos y coincide con preview', () => {
    const preview = buildInvestmentPreview({
      mode: 'cash',
      unitPrice: 310000,
      estimatedMonthlyRent: 1200,
      vacancyRate: 0.05,
      annualOperatingExpenses: 4280,
    })
    assertPreviewMatch(
      preview,
      previewFromSavedScenario({
        simulation_mode: 'cash',
        unit_price: preview.unitPrice,
        estimated_monthly_rent: 1200,
        vacancy_rate_snapshot: preview.vacancyRate,
        annual_expenses: preview.annualOperatingExpenses,
        annual_management: preview.annualManagement,
        annual_income_tax_estimate: preview.annualIncomeTaxEstimate,
        applied_interest_rate: 0,
        down_payment_percent: 100,
      }),
    )
  })

  it('financiado conserva tasa y gastos editados', () => {
    const preview = buildInvestmentPreview({
      mode: 'financed',
      unitPrice: 310000,
      estimatedMonthlyRent: 1200,
      vacancyRate: 0.05,
      annualOperatingExpenses: 4280,
      downPaymentPercent: 30,
      financingYears: 30,
      interestRate: 7.8,
    })
    assertPreviewMatch(
      preview,
      previewFromSavedScenario({
        simulation_mode: 'financed',
        financing_partner_id: 'partner-1',
        unit_price: 310000,
        estimated_monthly_rent: 1200,
        vacancy_rate_snapshot: 0.05,
        annual_expenses: 4280,
        annual_management: preview.annualManagement,
        annual_income_tax_estimate: preview.annualIncomeTaxEstimate,
        applied_interest_rate: 7.8,
        rate_type: 'nominal_annual',
        down_payment_percent: 30,
        financing_years: 30,
      }),
    )
  })

  it('tasa manual sin partner conserva tasa y modo', () => {
    const preview = buildInvestmentPreview({
      mode: 'manual',
      unitPrice: 310000,
      estimatedMonthlyRent: 1200,
      vacancyRate: 0.08,
      annualOperatingExpenses: 5000,
      downPaymentPercent: 40,
      financingYears: 25,
      interestRate: 9.25,
      rateType: 'effective_annual',
    })
    const reopened = previewFromSavedScenario({
      simulation_mode: 'manual',
      financing_partner_id: null,
      unit_price: 310000,
      estimated_monthly_rent: 1200,
      vacancy_rate_snapshot: 0.08,
      annual_expenses: 5000,
      annual_management: preview.annualManagement,
      annual_income_tax_estimate: preview.annualIncomeTaxEstimate,
      applied_interest_rate: 9.25,
      rate_type: 'effective_annual',
      down_payment_percent: 40,
      financing_years: 25,
    })
    assert.equal(reopened.mode, 'manual')
    assertPreviewMatch(preview, reopened)
  })

  it('fila legacy sin vacancy_rate_snapshot diverge (no reinterpretación fiel)', () => {
    const original = buildInvestmentPreview({
      mode: 'cash',
      unitPrice: 310000,
      estimatedMonthlyRent: 1200,
      vacancyRate: 0.05,
      annualOperatingExpenses: 4280,
    })
    const legacy = previewFromSavedScenario({
      unit_price: 310000,
      estimated_monthly_rent: 1200,
      annual_expenses: 4280,
    })
    assert.notEqual(legacy.annualEffectiveRental, original.annualEffectiveRental)
  })
})

describe('fallback legacy no confirma guardado incompleto (mock)', () => {
  it('detecta error de columna ausente', () => {
    assert.equal(isMissingInvestmentV2SchemaError({ code: 'PGRST204', message: 'column' }), true)
    assert.equal(
      isMissingInvestmentV2SchemaError({
        code: '42703',
        message: 'column "simulation_mode" does not exist',
      }),
      true,
    )
    assert.equal(isMissingInvestmentV2SchemaError({ code: '23505', message: 'duplicate' }), false)
  })

  it('mensaje exige migración explícitamente', () => {
    const err = migrationRequiredError()
    assert.match(err.message, /20260917120000_investment_simulator_assumptions/)
    assert.match(err.message, /No se confirmó un guardado incompleto/)
  })
})

describe('auth escenarios cruzados (mock admin)', () => {
  function mockAdmin(visitorLeadId: string | null, leadPhoneDigits = '593999111222'): AuthAdminClient {
    const builder = (table: string): AuthQueryBuilder => {
      const state: { eqs: Record<string, string> } = { eqs: {} }
      const api: AuthQueryBuilder = {
        select: () => api,
        eq: (col, val) => {
          state.eqs[col] = val
          return api
        },
        maybeSingle: async () => {
          if (table === 'tour_visitors') {
            return { data: visitorLeadId ? { lead_id: visitorLeadId } : { lead_id: null } }
          }
          if (table === 'leads') {
            if (!visitorLeadId || state.eqs.id !== visitorLeadId) return { data: null }
            return {
              data: {
                id: visitorLeadId,
                phone: '+593999111222',
                phone_normalized: leadPhoneDigits,
              },
            }
          }
          return { data: null }
        },
      }
      return api
    }
    return { from: (table) => builder(table) }
  }

  const opts = { tenantId: TENANT, normalizePhone: normalizeShowroomPhone }

  it('sin cookie visitante → null', async () => {
    const id = await resolveAuthorizedLeadId(mockAdmin('lead-a'), {
      leadId: 'lead-a',
      phone: '0999111222',
      visitorKey: null,
      ...opts,
    })
    assert.equal(id, null)
  })

  it('lead_id ajeno al visitante → null', async () => {
    const id = await resolveAuthorizedLeadId(mockAdmin('lead-a'), {
      leadId: 'lead-b',
      visitorKey: 'vid-1',
      ...opts,
    })
    assert.equal(id, null)
  })

  it('visitante autorizado solo su lead', async () => {
    const id = await resolveAuthorizedLeadId(mockAdmin('lead-a'), {
      leadId: 'lead-a',
      visitorKey: 'vid-1',
      ...opts,
    })
    assert.equal(id, 'lead-a')
  })

  it('teléfono que no coincide con el lead del visitante → null', async () => {
    const id = await resolveAuthorizedLeadId(mockAdmin('lead-a', '593999111222'), {
      leadId: 'lead-a',
      phone: '0999000000',
      visitorKey: 'vid-1',
      ...opts,
    })
    assert.equal(id, null)
  })
})
