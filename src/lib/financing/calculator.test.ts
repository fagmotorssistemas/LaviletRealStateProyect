import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { maxLegalMonthlyRent } from './ecuadorTax'
import {
  DOWN_PAYMENT_MAX_PCT,
  DOWN_PAYMENT_MIN_PCT,
  buildInvestmentPreview,
  buildWealthProjection,
  buildCashVsFinancedComparison,
  buildMonthlyCoverage,
  buildRentCoverageAnalysis,
  calculateMonthlyPayment,
  clampDownPaymentPercent,
  expenseBreakdownFromConfig,
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
  it('cubre bruto / borderline / insuficiente', () => {
    assert.equal(buildMonthlyCoverage(1600, 1200).status, 'covers_gross_only')
    assert.equal(buildMonthlyCoverage(1200, 1400).status, 'borderline')
    assert.equal(buildMonthlyCoverage(1200, 1800).status, 'insufficient')
    assert.match(buildMonthlyCoverage(1600, 1200).statusLabel, /antes de gastos/i)
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

  it('con IR incremental y gestor 8%: intereses reducen la base imponible', () => {
    const p = buildInvestmentPreview({
      ...base,
      mode: 'financed',
      includeIncomeTax: true,
      includePropertyManager: true,
    })
    assert.equal(p.annualManagement, 1094.4)
    assert.equal(p.annualIncomeTaxEstimate, 0)
    approx(p.annualNetCashFlow, -10439.84, 0.15)
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
    assert.equal(p.annualIncomeTaxEstimate, 0)
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
    approx(p.annualNetCashFlow, 5131.6, 0.1)
    approx(p.roiOnTotalPrice!, 5131.6 / 310000 * 100, 0.02)
    approx(p.cashOnCashReturn!, 5131.6 / 310000 * 100, 0.02)
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

describe('expenseBreakdownFromConfig — investment-v5', () => {
  it('excluye seguro y otros aunque existan en config', () => {
    const b = expenseBreakdownFromConfig(310000, {
      id: 'cfg',
      tenant_id: null,
      project_id: 'p',
      annual_property_tax: 0.5419354839, // ≈ 1680 on 310k
      annual_maintenance: 600,
      annual_insurance: 1200,
      vacancy_rate: 0.05,
      avg_studio_rent: null,
      avg_one_bed_rent: null,
      avg_two_bed_rent: null,
      avg_three_bed_rent: null,
      default_financing_partner_id: null,
      allow_custom_interest_rate: null,
      disclaimer_text: null,
    })
    assert.equal(b.insurance, 0)
    assert.equal(b.other, 0)
    assert.ok(Math.abs(b.propertyTax - 1680) < 1)
    assert.equal(b.maintenance, 600)
    assert.ok(Math.abs(b.total - 2280) < 1)
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

describe('reglas tributarias y datos por unidad', () => {
  it('compara financiado a 7,8% también desde la vista de contado de la Unidad 001', () => {
    const cashPreview = buildInvestmentPreview({
      mode: 'cash', unitPrice: 160000, estimatedMonthlyRent: 1200,
      vacancyRate: 0.05, annualOperatingExpenses: 1880,
      taxProfile: '45_80', includeIncomeTax: true,
      includePropertyManager: true, managementFeeRate: 0.08,
      interestRate: 7.8,
    })
    assert.equal(cashPreview.interestRate, 0)

    const comparison = buildCashVsFinancedComparison({
      shared: {
        unitPrice: 160000, estimatedMonthlyRent: 1200,
        vacancyRate: 0.05, annualOperatingExpenses: 1880,
        taxProfile: '45_80', includeIncomeTax: true,
        includePropertyManager: true, managementFeeRate: 0.08,
        interestRate: 7.8, financingYears: 20, rateType: 'nominal_annual',
        acquisitionCosts: 2580, rentGrowthRate: 0.02, saleCommissionPct: 0,
      },
      downPaymentPercent: 30,
      horizonYears: 10,
      appreciationRateAnnual: 0.03,
    })
    assert.equal(comparison.financed.preview.interestRate, 7.8)
    approx(comparison.financed.preview.monthlyCashFlow, -116.52)
    approx(comparison.financed.wealth.irrAnnualPercent!, 8.81, 0.01)
    approx(comparison.financed.wealth.projectedGainOrLoss, 73941.31, 0.02)
  })
  it('mantiene una TIR negativa y finita cuando no hay apreciación', () => {
    const preview = buildInvestmentPreview({
      mode: 'financed',
      unitPrice: 310000,
      estimatedMonthlyRent: 1200,
      vacancyRate: 0.05,
      annualOperatingExpenses: 0,
      downPaymentPercent: 30,
      interestRate: 7.8,
      financingYears: 20,
    })
    const wealth = buildWealthProjection({ preview, horizonYears: 10, appreciationRateAnnual: 0 })
    assert.ok(wealth.irrAnnualPercent != null && Number.isFinite(wealth.irrAnnualPercent))
    assert.ok(wealth.irrAnnualPercent < 0 && wealth.irrAnnualPercent < 100)
  })
  it('Unidad 001: concilia IR y flujo con los datos reales de referencia', () => {
    const shared = {
      unitPrice: 160000,
      cadastralValue: 160000,
      estimatedMonthlyRent: 1200,
      vacancyRate: 0.05,
      annualOperatingExpenses: 160000 * 0.008 + 600,
      includeIncomeTax: true,
      includePropertyManager: true,
      managementFeeRate: 0.08,
      taxProfile: '45_80' as const,
    }
    const cash = buildInvestmentPreview({ ...shared, mode: 'cash' })
    approx(cash.annualIncomeTaxEstimate, 3624, 0.02)
    approx(cash.monthlyCashFlow, 590.13, 0.02)

    const financed = buildInvestmentPreview({
      ...shared,
      mode: 'financed',
      downPaymentPercent: 30,
      financingYears: 20,
      interestRate: 7.8,
      rateType: 'nominal_annual',
    })
    approx(financed.monthlyPayment, 922.92, 0.02)
    approx(financed.annualIncomeTaxEstimate, 1028.84, 1)
    approx(financed.monthlyCashFlow, -116.52, 1)

    const noOtherIncome = { ...shared, taxProfile: 'none_other' as const }
    const cashWithoutOtherIncome = buildInvestmentPreview({ ...noOtherIncome, mode: 'cash' })
    const financedWithoutOtherIncome = buildInvestmentPreview({
      ...noOtherIncome,
      mode: 'financed',
      downPaymentPercent: 30,
      financingYears: 20,
      interestRate: 7.8,
      rateType: 'nominal_annual',
    })
    assert.equal(cashWithoutOtherIncome.annualIncomeTaxEstimate, 0)
    approx(cashWithoutOtherIncome.monthlyCashFlow, 892.13, 0.02)
    approx(financedWithoutOtherIncome.monthlyCashFlow, -30.79, 1)
  })
  it('contado 160k, catastral 160k: renta 1200 y vacancia 5% dejan base 12080 sin IR', () => {
    const p = buildInvestmentPreview({ mode: 'cash', unitPrice: 160000, cadastralValue: 160000, cadastralIsEstimated: false, estimatedMonthlyRent: 1200, vacancyRate: 0.05, annualOperatingExpenses: 0, taxProfile: 'none_other', includeIncomeTax: true, includePropertyManager: false })
    assert.equal(p.annualEffectiveRental, 13680)
    assert.equal(p.annualIncomeTaxEstimate, 0)
    assert.equal(p.annualNetCashFlow, 13680)
  })
  it('respeta la comisión del gestor configurada en 10%', () => {
    const preview = buildInvestmentPreview({
      mode: 'cash', unitPrice: 160000, estimatedMonthlyRent: 1200,
      vacancyRate: 0.05, annualOperatingExpenses: 0,
      includeIncomeTax: false, includePropertyManager: true, managementFeeRate: 0.1,
    })
    assert.equal(preview.annualManagement, 1368)
  })
  it('tabla configurable distinta cambia IR y sin tabla marca respaldo', () => {
    const base = { mode: 'cash' as const, unitPrice: 160000, cadastralValue: 160000, estimatedMonthlyRent: 1200, vacancyRate: 0, annualOperatingExpenses: 0, taxProfile: 'none_other' as const, includeIncomeTax: true, includePropertyManager: false }
    const configured = buildInvestmentPreview({ ...base, incomeTaxBrackets: [{ from: 0, to: null, baseTax: 0, rate: 0.1 }] })
    const fallback = buildInvestmentPreview({ ...base, incomeTaxBrackets: [] })
    assert.ok(configured.annualIncomeTaxEstimate > fallback.annualIncomeTaxEstimate)
    assert.equal(configured.incomeTaxTableFallback, false)
    assert.equal(fallback.incomeTaxTableFallback, true)
  })
  it('intereses del primer año reducen el IR del financiado', () => {
    const shared = { unitPrice: 160000, cadastralValue: 160000, estimatedMonthlyRent: 1800, vacancyRate: 0.05, annualOperatingExpenses: 1000, taxProfile: '45_80' as const, includeIncomeTax: true, includePropertyManager: false }
    const cash = buildInvestmentPreview({ ...shared, mode: 'cash' })
    const financed = buildInvestmentPreview({ ...shared, mode: 'financed', downPaymentPercent: 30, financingYears: 20, interestRate: 8, rateType: 'nominal_annual' })
    assert.ok(financed.annualIncomeTaxEstimate < cash.annualIncomeTaxEstimate)
  })
  it('dos unidades toman predial, alícuota, arriendo y tope propios', () => {
    const config = { annual_property_tax: 0.3, annual_maintenance: 500, building_fee_per_m2_monthly: 2 } as Parameters<typeof expenseBreakdownFromConfig>[1]
    const a = { cadastral_value: 144000, area_total_m2: 80, monthly_building_fee: null, estimated_monthly_rent: 1000 }
    const b = { cadastral_value: 240000, area_total_m2: 120, monthly_building_fee: 300, estimated_monthly_rent: 1600 }
    const expensesA = expenseBreakdownFromConfig(160000, config, a)
    const expensesB = expenseBreakdownFromConfig(260000, config, b)
    assert.equal(expensesA.propertyTax, 432)
    assert.equal(expensesB.propertyTax, 720)
    assert.equal(expensesA.maintenance, 1920)
    assert.equal(expensesB.maintenance, 3600)
    assert.equal(suggestMonthlyRent({ config, unitPrice: 160000, estimatedMonthlyRent: a.estimated_monthly_rent }).amount, 1000)
    assert.equal(suggestMonthlyRent({ config, unitPrice: 260000, estimatedMonthlyRent: b.estimated_monthly_rent }).amount, 1600)
    assert.equal(maxLegalMonthlyRent(a.cadastral_value), 1200)
    assert.equal(maxLegalMonthlyRent(b.cadastral_value), 2000)
  })
  it('contado vs financiado conserva la misma tabla y perfil tributario', () => {
    const shared = { unitPrice: 160000, estimatedMonthlyRent: 1200, vacancyRate: 0, annualOperatingExpenses: 1000, taxProfile: 'company' as const, companyIncomeTaxRate: 0.3, incomeTaxBrackets: [{ from: 0, to: null, baseTax: 0, rate: 0.1 }], financingYears: 20, interestRate: 8, rateType: 'nominal_annual' as const }
    const comparison = buildCashVsFinancedComparison({ shared, downPaymentPercent: 30, horizonYears: 10, appreciationRateAnnual: 0.03 })
    assert.equal(comparison.cash.preview.taxProfile, 'company')
    assert.equal(comparison.financed.preview.companyIncomeTaxRate, 0.3)
    assert.ok(comparison.financed.preview.annualIncomeTaxEstimate < comparison.cash.preview.annualIncomeTaxEstimate)
  })
})

/** Unidad 002 (suite 1D, $210k): reconciliación de aporte con IR+gestor activos. */
describe('Unidad 002 — aporte mensual', () => {
  const unit002 = {
    mode: 'financed' as const,
    unitPrice: 210000,
    estimatedMonthlyRent: 1200,
    vacancyRate: 0.05,
    annualOperatingExpenses: 2280, // predial 0.8% + alícuota 600
    includeIncomeTax: true,
    includePropertyManager: true,
    incomeTaxRate: 0.25,
    managementFeeRate: 0.08,
    downPaymentPercent: 30,
    financingYears: 20,
    interestRate: 7.8,
    rateType: 'nominal_annual' as const,
  }

  it('con gestor y el IR incremental, el aporte refleja el interés deducible', () => {
    const p = buildInvestmentPreview(unit002)
    const c = buildRentCoverageAnalysis(p)
    assert.equal(p.financedAmount, 147000)
    approx(p.monthlyPayment, 1211.33, 0.02)
    approx(c.monthlyNetRentAvailable, 853.15, 0.02)
    approx(c.monthlyTopUpOrSurplus, -358.18, 0.02)
  })

  it('sin admin ni IR: déficit ≈ $261,33 (solo si se desactivan)', () => {
    const p = buildInvestmentPreview({
      ...unit002,
      includeIncomeTax: false,
      includePropertyManager: false,
    })
    const c = buildRentCoverageAnalysis(p)
    approx(c.monthlyTopUpOrSurplus, -261.33, 0.02)
  })
})
