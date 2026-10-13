import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  SRI_PERSONAL_INCOME_TAX_TABLE_2026 as table,
  acquisitionCostsFor, annualIrrFromMonthlyCashFlows, buildingFeeForUnit,
  cuencaCapitalGainsTax, incrementalPersonalIncomeTax, maxLegalMonthlyRent,
  resolvedIncomeTaxBrackets, validIncomeTaxBrackets,
} from './ecuadorTax'

const near = (actual: number, expected: number, tolerance = 0.02) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected}`)

describe('Ecuador y Cuenca 2026', () => {
  it('calcula el IR incremental con otros ingresos', () => {
    near(incrementalPersonalIncomeTax(40000, 12080, table), 2690.45)
    near(incrementalPersonalIncomeTax(0, 12080, table), 0)
    near(incrementalPersonalIncomeTax(60000, 12080, table), 3524.25)
  })
  it('aplica plusvalía municipal, tope del arriendo y costos de compra', () => {
    near(cuencaCapitalGainsTax(100623.16, 10), 5031.16)
    assert.equal(cuencaCapitalGainsTax(100623.16, 20), 0)
    assert.equal(cuencaCapitalGainsTax(-100, 10), 0)
    assert.equal(maxLegalMonthlyRent(144000), 1200)
    assert.equal(acquisitionCostsFor(160000, 1.3, 500), 2580)
  })
  it('anualiza la TIR mensual', () => {
    near(annualIrrFromMonthlyCashFlows([-100, ...Array(11).fill(0), 110])!, 10, 0.01)
    const negativeIrr = annualIrrFromMonthlyCashFlows([
      -48000,
      ...Array(119).fill(-315.79),
      -315.79 + 83264.78,
    ])
    assert.ok(negativeIrr != null && Number.isFinite(negativeIrr))
    near(negativeIrr, -0.40, 0.01)
    assert.equal(annualIrrFromMonthlyCashFlows([-100, -10]), null)
  })
  it('usa alícuota por m² cuando la unidad no tiene monto propio', () => {
    assert.equal(buildingFeeForUnit({ monthly_building_fee: null, area_total_m2: 80 }, { building_fee_per_m2_monthly: 2, annual_maintenance: 500 }), 1920)
  })
  it('rechaza tramos discontinuos y usa la tabla configurada', () => {
    assert.equal(validIncomeTaxBrackets(table), true)
    assert.equal(validIncomeTaxBrackets([{ from: 0, to: 100, baseTax: 0, rate: 0 }, { from: 101, to: null, baseTax: 0, rate: 0.1 }]), false)
    assert.equal(validIncomeTaxBrackets([{ from: 100, to: 200, baseTax: 0, rate: 0.1 }, { from: 0, to: null, baseTax: 0, rate: 0 }]), false)
    assert.equal(validIncomeTaxBrackets([{ from: 0, to: null, baseTax: 0, rate: 0 }, { from: 100, to: null, baseTax: 0, rate: 0.1 }]), false)
    assert.equal(resolvedIncomeTaxBrackets([]).fallback, true)
    assert.equal(resolvedIncomeTaxBrackets([{ from: 0, to: null, baseTax: 0, rate: 0.1 }]).fallback, false)
  })
})
