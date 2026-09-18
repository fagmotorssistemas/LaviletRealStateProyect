import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  PROPERTY_DEFAULTS,
  buildSimpleInvestmentResult,
  detectPropertyType,
  estimateMonthlyRentFromDefaults,
} from './simpleInvestment'

describe('detectPropertyType', () => {
  it('mapea categorías conocidas', () => {
    assert.equal(detectPropertyType('local comercial'), 'local')
    assert.equal(detectPropertyType('suite'), 'suite')
    assert.equal(detectPropertyType('departamento'), 'depto')
    assert.equal(detectPropertyType('penthouse'), 'penthouse')
  })
})

describe('estimateMonthlyRentFromDefaults', () => {
  it('local / depto / penthouse residenciales', () => {
    assert.equal(estimateMonthlyRentFromDefaults('local').monthlyRent, 2500)
    assert.equal(estimateMonthlyRentFromDefaults('depto').monthlyRent, 1300)
    assert.equal(estimateMonthlyRentFromDefaults('penthouse').monthlyRent, 3500)
    assert.equal(estimateMonthlyRentFromDefaults('local').vacancyRate, 0.02)
  })

  it('suite airbnb: noche × 30 × ocupación × (1−comisión)', () => {
    const s = estimateMonthlyRentFromDefaults('suite')
    const expected =
      PROPERTY_DEFAULTS.suite.nightlyRate *
      30 *
      PROPERTY_DEFAULTS.suite.occupancy *
      (1 - PROPERTY_DEFAULTS.suite.commission)
    assert.equal(s.monthlyRent, Math.round(expected * 100) / 100)
    assert.equal(s.rentalKind, 'airbnb')
  })
})

describe('buildSimpleInvestmentResult', () => {
  it('sin alquiler: flujo 0 y ROI solo por apreciación', () => {
    const r = buildSimpleInvestmentResult({
      unitPrice: 200000,
      downPaymentPercent: 30,
      financingYears: 20,
      interestRate: 8,
      rents: false,
      propertyType: 'depto',
    })
    assert.equal(r.cashFlow10y, 0)
    assert.ok(r.monthlyPayment > 0)
    assert.ok(r.appreciationGain > 0)
    assert.equal(r.cashFlowNote, 'No genera flujo de alquiler')
    assert.ok(r.totalRoiPercent != null && r.totalRoiPercent > 0)
  })

  it('con alquiler: ROI = flujo 10y + apreciación sobre entrada', () => {
    const r = buildSimpleInvestmentResult({
      unitPrice: 200000,
      downPaymentPercent: 30,
      financingYears: 20,
      interestRate: 8,
      rents: true,
      propertyType: 'depto',
    })
    assert.ok(r.monthlyCashFlow != null)
    const expectedRoi =
      Math.round((((r.cashFlow10y + r.appreciationGain) / r.preview.initialCashOutlay) * 100) * 100) /
      100
    assert.equal(r.totalRoiPercent, expectedRoi)
    assert.equal(r.preview.annualPotentialRental, 1300 * 12)
  })
})
