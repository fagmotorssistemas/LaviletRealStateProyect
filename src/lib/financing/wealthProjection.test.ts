import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildInvestmentPreview,
  buildRentCoverageAnalysis,
  buildWealthProjection,
  buildCashVsFinancedComparison,
  calculateMonthlyPayment,
  remainingPrincipalAfterMonths,
  roundMoney,
} from './calculator'

/** Caso de referencia La Vilet (spec). */
const REF = {
  unitPrice: 310000,
  mode: 'financed' as const,
  estimatedMonthlyRent: 1800,
  vacancyRate: 0.05,
  annualOperatingExpenses: 4280,
  downPaymentPercent: 30,
  financingYears: 20,
  interestRate: 7.8,
  rateType: 'nominal_annual' as const,
  includeIncomeTax: true,
  includePropertyManager: true,
  incomeTaxRate: 0.25,
  managementFeeRate: 0.08,
}

function approx(actual: number, expected: number, eps = 0.5) {
  assert.ok(
    Math.abs(actual - expected) <= eps,
    `esperado ≈ ${expected}, obtuvo ${actual} (Δ=${Math.abs(actual - expected)})`,
  )
}

describe('caso de referencia 310k / 20a / 7.8%', () => {
  it('cuota ≈ 1788.16', () => {
    approx(calculateMonthlyPayment(217000, 7.8, 20, 'nominal_annual'), 1788.16, 0.02)
  })

  it('cobertura bruta/neta y aporte', () => {
    const p = buildInvestmentPreview(REF)
    approx(p.monthlyPayment, 1788.16, 0.02)
    approx(p.annualNetCashFlow, -11989.52, 0.05)
    approx(p.monthlyCashFlow, -999.13, 0.05)
    approx(p.buyerTopUpMonthly, 999.13, 0.05)

    const c = buildRentCoverageAnalysis(p)
    approx(c.grossDifference, 11.84, 0.05)
    approx(c.annualNetRentAvailable, 9468.4, 0.05)
    approx(c.monthlyNetRentAvailable, 789.03, 0.05)
    approx(c.monthlyTopUpOrSurplus, -999.13, 0.05)
    assert.equal(c.coversGrossBeforeExpenses, true)
    assert.equal(c.coversNetAfterExpenses, false)
  })

  it('patrimonio 10 años @ 5% plusvalía', () => {
    const p = buildInvestmentPreview(REF)
    const debt = remainingPrincipalAfterMonths(217000, 7.8, 20, 120, 'nominal_annual')
    approx(debt, 148674.48, 1)

    const w = buildWealthProjection({
      preview: p,
      horizonYears: 10,
      appreciationRateAnnual: 0.05,
      saleCosts: 0,
    })
    approx(w.futurePropertyValue, 504957.33, 1)
    approx(w.remainingDebt, 148674.48, 1)
    approx(w.endingEquity, 356283, 2)
    approx(w.cumulativeTopUps, 119895, 2)
    approx(w.totalCashInvested, 212895, 2)
    approx(w.projectedGainOrLoss, 143388, 3)
    approx(w.cumulativeReturnOnCashPercent!, 67.35, 0.05)
    approx(w.propertyAppreciation, w.futurePropertyValue - REF.unitPrice, 0.01)
    assert.ok(w.initialOutlay > 0)

    // Rendimiento anual de flujo = saldo / entrada (≠ ROI precio ≈ −3,87%).
    assert.ok((w.annualCashFlowYieldPercent ?? 0) < 0)
    approx(w.annualCashFlowYieldPercent!, -12.89, 0.05)
    approx(p.roiOnTotalPrice!, -3.87, 0.05)
    assert.ok(p.roiOnTotalPrice! < 0)
  })

  it('referencia 270k: ganancia total = plusvalía + alquileres (no solo plusvalía)', () => {
    const expenses = {
      propertyTax: 2160,
      maintenance: 600,
      insurance: 0,
      other: 0,
      total: 2760,
    }
    const shared = {
      unitPrice: 270000,
      estimatedMonthlyRent: 1200,
      vacancyRate: 0.05,
      annualOperatingExpenses: expenses.total,
      financingYears: 20,
      interestRate: 7.8,
      rateType: 'nominal_annual' as const,
      includeIncomeTax: true,
      includePropertyManager: true,
    }
    const cmp = buildCashVsFinancedComparison({
      shared,
      downPaymentPercent: 30,
      horizonYears: 10,
      appreciationRateAnnual: 0.05,
      saleCosts: 0,
    })

    approx(cmp.cash.coverage.monthlyNetRentAvailable, 533.8, 0.05)
    approx(cmp.cash.wealth.futurePropertyValue, 439801.55, 1)
    approx(cmp.cash.wealth.propertyAppreciation, 169801.55, 1)
    approx(cmp.cash.wealth.cumulativeSurplus, 64056, 1)
    approx(cmp.cash.wealth.projectedGainOrLoss, 233857.55, 1)
    approx(cmp.cash.wealth.cumulativeReturnOnCashPercent!, 86.61, 0.05)
    approx(
      cmp.cash.wealth.propertyAppreciation + cmp.cash.wealth.cumulativeSurplus,
      cmp.cash.wealth.projectedGainOrLoss,
      1,
    )

    approx(cmp.financed.preview.monthlyPayment, 1557.43, 0.05)
    approx(cmp.financed.coverage.monthlyTopUpOrSurplus, -1023.63, 0.05)
    approx(cmp.financed.wealth.remainingDebt, 129490.68, 1)
    approx(cmp.financed.wealth.endingEquity, 310310.87, 2)
    approx(cmp.financed.wealth.totalCashInvested, 203835.6, 2)
    approx(cmp.financed.wealth.projectedGainOrLoss, 106475.27, 2)
    assert.equal(expenses.insurance, 0)
  })

  it('horizonte mayor al plazo: deuda 0 y no multiplica cuota ciega', () => {
    const p = buildInvestmentPreview({ ...REF, financingYears: 10 })
    const w = buildWealthProjection({
      preview: p,
      horizonYears: 15,
      appreciationRateAnnual: 0,
    })
    assert.equal(w.remainingDebt, 0)
    // Tras fin del crédito el flujo mensual mejora (solo ops); aportes < 15y * top-up inicial
    const naive = Math.abs(Math.min(0, p.monthlyCashFlow)) * 12 * 15
    assert.ok(w.cumulativeTopUps < naive - 1000)
  })

  it('contado, tasa 0, sin alquiler y plusvalía negativa', () => {
    const cash = buildInvestmentPreview({
      ...REF,
      mode: 'cash',
      estimatedMonthlyRent: 0,
      includeIncomeTax: false,
      includePropertyManager: false,
    })
    assert.equal(cash.monthlyPayment, 0)
    assert.ok(cash.annualNetCashFlow < 0)

    const zeroRate = buildInvestmentPreview({
      ...REF,
      interestRate: 0,
    })
    approx(zeroRate.monthlyPayment, 217000 / (20 * 12), 0.02)

    const wNeg = buildWealthProjection({
      preview: buildInvestmentPreview(REF),
      horizonYears: 10,
      appreciationRateAnnual: -0.02,
    })
    assert.ok(wNeg.futurePropertyValue < 310000)
  })
})
