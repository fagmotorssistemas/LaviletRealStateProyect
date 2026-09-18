import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ScenarioValidationError,
  parseExpenseBreakdown,
  parseSimulationMode,
  parseRateType,
  resolveOperatingExpenses,
} from '@/lib/financing/scenarioValidate'
import { assessScenarioFidelity } from '@/lib/financing/scenarioFidelity'
import { CALCULATION_VERSION } from '@/lib/financing/calculator'

describe('scenarioValidate', () => {
  it('rechaza mode inválido sin coerción', () => {
    assert.throws(() => parseSimulationMode('contado'), ScenarioValidationError)
    assert.throws(() => parseSimulationMode(undefined), ScenarioValidationError)
    assert.equal(parseSimulationMode('cash'), 'cash')
  })

  it('rechaza rate_type inválido', () => {
    assert.throws(() => parseRateType('tir', true), ScenarioValidationError)
    assert.equal(parseRateType('nominal_annual', true), 'nominal_annual')
  })

  it('detecta breakdown inconsistente con annual_expenses', () => {
    const breakdown = parseExpenseBreakdown({
      propertyTax: 100,
      maintenance: 100,
      insurance: 0,
      other: 0,
      total: 200,
    })
    assert.throws(
      () => resolveOperatingExpenses({ annualExpenses: 5000, breakdown }),
      ScenarioValidationError,
    )
  })

  it('acepta cero en breakdown', () => {
    const breakdown = parseExpenseBreakdown({
      propertyTax: 0,
      maintenance: 0,
      insurance: 0,
      other: 0,
      total: 0,
    })
    assert.equal(breakdown?.total, 0)
  })

  it('normaliza breakdown legacy con seguro/otros al modelo predial+alícuota', () => {
    const breakdown = parseExpenseBreakdown({
      propertyTax: 1680,
      maintenance: 600,
      insurance: 800,
      other: 400,
      total: 3480,
    })
    assert.equal(breakdown?.insurance, 0)
    assert.equal(breakdown?.other, 0)
    assert.equal(breakdown?.total, 2280)
  })
})

describe('scenarioFidelity', () => {
  it('marca exacto solo la versión actual de cálculo', () => {
    const exact = assessScenarioFidelity({
      calculation_version: CALCULATION_VERSION,
      simulation_mode: 'cash',
      vacancy_rate_snapshot: 0.05,
      expense_breakdown: { propertyTax: 0, maintenance: 0, insurance: 0, other: 0, total: 0 },
      rate_type: 'nominal_annual',
      assumptions_json: {},
      annual_net_cash_flow: 1,
      roi_percent: 1,
      monthly_payment: 0,
      unit_price: 1,
    })
    assert.equal(exact.kind, 'exact')
  })

  it('marca legacy y lista supuestos faltantes', () => {
    const legacy = assessScenarioFidelity({
      calculation_version: null,
      simulation_mode: null,
      vacancy_rate_snapshot: null,
      expense_breakdown: null,
      rate_type: null,
      assumptions_json: null,
      annual_net_cash_flow: 9400,
      roi_percent: 3.03,
      monthly_payment: 0,
      unit_price: 310000,
    })
    assert.equal(legacy.kind, 'legacy')
    if (legacy.kind !== 'legacy') throw new Error('expected legacy')
    assert.ok(legacy.missingAssumptions.includes('vacancy_rate_snapshot'))
  })
})
