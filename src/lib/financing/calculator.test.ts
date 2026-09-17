import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DOWN_PAYMENT_MAX_PCT,
  DOWN_PAYMENT_MIN_PCT,
  buildInvestmentPreview,
  calculateMonthlyPayment,
  clampDownPaymentPercent,
  suggestMonthlyRent,
} from './calculator'

/** Tolerancia monetaria a 2 decimales. */
function approx(actual: number, expected: number, eps = 0.02) {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `esperado ≈ ${expected}, obtuvo ${actual} (Δ=${Math.abs(actual - expected)})`,
  )
}

describe('calculateMonthlyPayment', () => {
  it('caso base 217000 @ 7.8% nominal 30 años ≈ 1562.12', () => {
    const pmt = calculateMonthlyPayment(217000, 7.8, 30, 'nominal_annual')
    approx(pmt, 1562.12, 0.05)
  })

  it('tasa cero reparte el principal', () => {
    const pmt = calculateMonthlyPayment(120000, 0, 10, 'nominal_annual')
    approx(pmt, 1000, 0.01)
  })
})

describe('buildInvestmentPreview — caso de aceptación', () => {
  const base = {
    unitPrice: 310000,
    estimatedMonthlyRent: 1200,
    vacancyRate: 0.05,
    annualOperatingExpenses: 4280,
    annualManagement: 0,
    acquisitionCosts: 0,
    annualOtherFinancialCosts: 0,
    monthlyExtraCharges: 0,
    downPaymentPercent: 30,
    financingYears: 30,
    interestRate: 7.8,
    rateType: 'nominal_annual' as const,
  }

  it('financiado: flujo, retorno de caja y cuota', () => {
    const p = buildInvestmentPreview({ ...base, mode: 'financed' })
    assert.equal(p.downPaymentAmount, 93000)
    assert.equal(p.financedAmount, 217000)
    approx(p.monthlyPayment, 1562.12, 0.05)
    assert.equal(p.annualPotentialRental, 14400)
    assert.equal(p.annualEffectiveRental, 13680)
    assert.equal(p.annualOperatingResult, 9400)
    approx(p.annualNetCashFlow, -9345.44, 0.1)
    approx(p.monthlyCashFlow, -778.79, 0.05)
    approx(p.cashOnCashReturn!, -10.05, 0.05)
    assert.equal(p.paybackLabel, 'No recuperable con el flujo actual')
    assert.ok(p.buyerTopUpMonthly > 0)
    assert.equal(p.assumptions.excludesAppreciationAndSale, true)
  })

  it('contado: cuota cero, flujo 9400, rendimiento sobre precio 3.03%', () => {
    const p = buildInvestmentPreview({ ...base, mode: 'cash' })
    assert.equal(p.monthlyPayment, 0)
    assert.equal(p.financedAmount, 0)
    assert.equal(p.annualNetCashFlow, 9400)
    approx(p.operatingYieldOnPrice!, 3.03, 0.02)
    approx(p.cashOnCashReturn!, 3.03, 0.02)
  })
})

describe('edge cases', () => {
  it('vacancia 0% y 100%', () => {
    const zero = buildInvestmentPreview({
      mode: 'cash',
      unitPrice: 100000,
      estimatedMonthlyRent: 1000,
      vacancyRate: 0,
      annualOperatingExpenses: 0,
    })
    assert.equal(zero.annualEffectiveRental, 12000)

    const full = buildInvestmentPreview({
      mode: 'cash',
      unitPrice: 100000,
      estimatedMonthlyRent: 1000,
      vacancyRate: 1,
      annualOperatingExpenses: 0,
    })
    assert.equal(full.annualEffectiveRental, 0)
    assert.equal(full.annualOperatingResult, 0)
  })

  it('entrada superior al 50% dentro del límite unificado', () => {
    const pct = clampDownPaymentPercent(65)
    assert.equal(pct, 65)
    assert.ok(pct <= DOWN_PAYMENT_MAX_PCT)
    assert.ok(pct >= DOWN_PAYMENT_MIN_PCT)
    const p = buildInvestmentPreview({
      mode: 'financed',
      unitPrice: 200000,
      downPaymentPercent: 65,
      financingYears: 20,
      interestRate: 8,
      estimatedMonthlyRent: 800,
      vacancyRate: 0.05,
      annualOperatingExpenses: 2000,
    })
    assert.equal(p.downPaymentPercent, 65)
    assert.equal(p.downPaymentAmount, 130000)
  })

  it('datos inválidos no producen NaN', () => {
    const p = buildInvestmentPreview({
      mode: 'financed',
      unitPrice: -10,
      downPaymentPercent: 999,
      financingYears: 0,
      interestRate: -5,
      estimatedMonthlyRent: -100,
      vacancyRate: 2,
      annualOperatingExpenses: -50,
    })
    assert.ok(Number.isFinite(p.monthlyPayment))
    assert.ok(Number.isFinite(p.annualNetCashFlow))
    assert.equal(p.unitPrice, 0)
  })

  it('local comercial no usa tabla residencial por dormitorios', () => {
    const config = {
      id: 'x',
      tenant_id: null,
      project_id: 'p',
      annual_property_tax: 0.1,
      annual_maintenance: 100,
      annual_insurance: 50,
      vacancy_rate: 0.05,
      avg_studio_rent: 500,
      avg_one_bed_rent: 1200,
      avg_two_bed_rent: 1800,
      avg_three_bed_rent: 2500,
      default_financing_partner_id: null,
      allow_custom_interest_rate: true,
      disclaimer_text: null,
    }
    const s = suggestMonthlyRent({
      config,
      unitPrice: 200000,
      bedrooms: 2,
      category: 'local comercial',
    })
    assert.equal(s.source, 'price_yield')
    assert.notEqual(s.amount, 1800)
  })
})
