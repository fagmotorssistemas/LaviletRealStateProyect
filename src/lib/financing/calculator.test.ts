import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DOWN_PAYMENT_MAX_PCT,
  DOWN_PAYMENT_MIN_PCT,
  buildInvestmentPreview,
  buildMonthlyCoverage,
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
  it('217000 @ 7.8% nominal 30 años ≈ 1562.12', () => {
    const pmt = calculateMonthlyPayment(217000, 7.8, 30, 'nominal_annual')
    approx(pmt, 1562.12, 0.05)
  })

  it('250k entrada 30% → principal 175k ≈ 1259.77 (no 1562)', () => {
    const pmt = calculateMonthlyPayment(175000, 7.8, 30, 'nominal_annual')
    approx(pmt, 1259.77, 0.05)
  })

  it('tasa cero reparte el principal', () => {
    const pmt = calculateMonthlyPayment(120000, 0, 10, 'nominal_annual')
    approx(pmt, 1000, 0.01)
  })
})

describe('buildMonthlyCoverage', () => {
  it('cubre / borderline / insuficiente', () => {
    assert.equal(buildMonthlyCoverage(1600, 1200).status, 'covers')
    assert.equal(buildMonthlyCoverage(1200, 1400).status, 'borderline')
    assert.equal(buildMonthlyCoverage(1200, 1800).status, 'insufficient')
  })
})

describe('buildInvestmentPreview — v3 con IR y gestor', () => {
  const base = {
    unitPrice: 310000,
    estimatedMonthlyRent: 1200,
    vacancyRate: 0.05,
    annualOperatingExpenses: 4280,
    acquisitionCosts: 0,
    annualOtherFinancialCosts: 0,
    monthlyExtraCharges: 0,
    downPaymentPercent: 30,
    financingYears: 30,
    interestRate: 7.8,
    rateType: 'nominal_annual' as const,
  }

  it('sin IR ni gestor: conserva flujo legacy', () => {
    const p = buildInvestmentPreview({
      ...base,
      mode: 'financed',
      includeIncomeTax: false,
      includePropertyManager: false,
    })
    assert.equal(p.downPaymentAmount, 93000)
    assert.equal(p.financedAmount, 217000)
    approx(p.monthlyPayment, 1562.12, 0.05)
    assert.equal(p.annualPotentialRental, 14400)
    assert.equal(p.annualEffectiveRental, 13680)
    assert.equal(p.annualOperatingResult, 9400)
    approx(p.annualNetCashFlow, -9345.44, 0.1)
    approx(p.cashOnCashReturn!, -10.05, 0.05)
    assert.equal(p.monthlyCoverage.status, 'borderline')
  })

  it('con IR 25% y gestor 8% sobre efectivo: saldo más negativo', () => {
    const p = buildInvestmentPreview({
      ...base,
      mode: 'financed',
      includeIncomeTax: true,
      includePropertyManager: true,
    })
    assert.equal(p.annualManagement, 1094.4)
    assert.equal(p.annualIncomeTaxEstimate, 3420)
    // 13680 - 4280 - 1094.4 - 18745.44 - 3420
    approx(p.annualNetCashFlow, -13859.84, 0.15)
    assert.equal(p.viabilityLevel, 'critical')
    assert.ok((p.roiOnTotalPrice ?? 0) < 0)
    assert.ok((p.cashOnCashReturn ?? 0) < 0)
  })

  it('ejemplo CAMBIO 4: 250k, ops 3600, IR+gestor', () => {
    const p = buildInvestmentPreview({
      mode: 'financed',
      unitPrice: 250000,
      estimatedMonthlyRent: 1200,
      vacancyRate: 0.05,
      annualOperatingExpenses: 3600,
      includeIncomeTax: true,
      includePropertyManager: true,
      downPaymentPercent: 30,
      financingYears: 15,
      interestRate: 7.8,
      rateType: 'nominal_annual',
    })
    assert.equal(p.annualEffectiveRental, 13680)
    assert.equal(p.annualVacancyCost, 720)
    assert.equal(p.annualIncomeTaxEstimate, 3420)
    assert.equal(p.annualManagement, 1094.4)
    // Cuota sobre 175k @ 7.8% 15 años (no 30): no asumir 9880 del ejemplo sin plazo.
    assert.ok(p.annualNetCashFlow < 0)
    assert.equal(p.viabilityLevel, 'critical')
  })

  it('contado con IR+gestor: ROI precio = saldo/precio', () => {
    const p = buildInvestmentPreview({
      ...base,
      mode: 'cash',
      includeIncomeTax: true,
      includePropertyManager: true,
    })
    // 13680 - 4280 - 1094.4 - 3420 = 4885.6
    approx(p.annualNetCashFlow, 4885.6, 0.1)
    approx(p.roiOnTotalPrice!, 1.58, 0.02)
    approx(p.cashOnCashReturn!, 1.58, 0.02)
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
      includeIncomeTax: false,
      includePropertyManager: false,
    })
    assert.equal(zero.annualEffectiveRental, 12000)

    const full = buildInvestmentPreview({
      mode: 'cash',
      unitPrice: 100000,
      estimatedMonthlyRent: 1000,
      vacancyRate: 1,
      annualOperatingExpenses: 0,
      includeIncomeTax: false,
      includePropertyManager: false,
    })
    assert.equal(full.annualEffectiveRental, 0)
    assert.equal(full.annualOperatingResult, 0)
  })

  it('entrada superior al 50% dentro del límite unificado', () => {
    const pct = clampDownPaymentPercent(65)
    assert.equal(pct, 65)
    assert.ok(pct <= DOWN_PAYMENT_MAX_PCT)
    assert.ok(pct >= DOWN_PAYMENT_MIN_PCT)
  })
})

describe('suggestMonthlyRent', () => {
  it('comercial usa yield de precio', () => {
    const s = suggestMonthlyRent({
      config: null,
      unitPrice: 200000,
      category: 'local comercial',
    })
    assert.equal(s.source, 'price_yield')
    assert.ok(s.amount > 0)
  })
})
