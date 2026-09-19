import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { coverageBarSegments } from './CoberturaMensual'

describe('coverageBarSegments', () => {
  it('Unidad 002: neto 573.8 / cuota 1211.33 → ~47.37% / ~52.63%', () => {
    const b = coverageBarSegments(573.8, 1211.33)
    assert.equal(b.rentApplied, 573.8)
    assert.equal(b.buyerOnPayment, 637.53)
    assert.equal(b.rentPct, 47.37)
    assert.equal(b.buyerPct, 52.63)
    assert.equal(b.surplusOverPayment, 0)
  })

  it('excedente: cobertura al 100% y sobrante aparte', () => {
    const b = coverageBarSegments(1500, 1211.33)
    assert.equal(b.rentApplied, 1211.33)
    assert.equal(b.buyerOnPayment, 0)
    assert.equal(b.rentPct, 100)
    assert.equal(b.buyerPct, 0)
    assert.equal(b.surplusOverPayment, 288.67)
  })

  it('cuota cero: sin porcentajes inválidos', () => {
    const b = coverageBarSegments(573.8, 0)
    assert.equal(b.rentPct, null)
    assert.equal(b.buyerPct, null)
    assert.equal(b.surplusOverPayment, 573.8)
  })

  it('alquiler neto negativo: no aporta a la barra', () => {
    const b = coverageBarSegments(-100, 1211.33)
    assert.equal(b.rentApplied, 0)
    assert.equal(b.buyerOnPayment, 1211.33)
    assert.equal(b.rentPct, 0)
    assert.equal(b.buyerPct, 100)
    assert.equal(b.negativeNet, -100)
  })
})
