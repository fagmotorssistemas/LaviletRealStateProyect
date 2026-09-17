import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { buildInvestmentPreview } from './calculator'
import {
  priceFlagsAfterScenarioSave,
  resolveCalculatorUnitPrice,
} from './calculatorUnitPrice'

type PriceState = {
  initSource: 'empty' | 'bootstrap' | 'scenario' | 'user'
  useCurrentPublishedPrice: boolean
  scenarioUnitPrice: number | null
  hypotheticalPrice: number | null
  monthlyRent: number
  annualExpenses: number
  downPaymentPercent: number
  interestRate: number
}

function priceOf(state: PriceState, published: number) {
  return resolveCalculatorUnitPrice({
    useCurrentPublishedPrice: state.useCurrentPublishedPrice,
    scenarioUnitPrice: state.scenarioUnitPrice,
    publishedPrice: published,
    hypotheticalPrice: state.hypotheticalPrice,
  })
}

/** Simula patchState del hook: cualquier edición marca initSource=user sin tocar la fuente de precio. */
function editFields(state: PriceState, patch: Partial<PriceState>): PriceState {
  return {
    ...state,
    ...patch,
    initSource: 'user',
  }
}

describe('fuente de precio del hook (independiente de initSource)', () => {
  it('reopen → editar → guardar conserva 310k; solo Actualizar usa 350k', () => {
    // 1. Guardar con precio 310000
    let published = 310000
    let state: PriceState = {
      initSource: 'user',
      ...priceFlagsAfterScenarioSave(310000),
      hypotheticalPrice: null,
      monthlyRent: 1200,
      annualExpenses: 4280,
      downPaymentPercent: 30,
      interestRate: 7.8,
    }
    assert.equal(priceOf(state, published), 310000)

    // 2. Cambiar el publicado a 350000
    published = 350000

    // 3. Reabrir: debe mostrar 310000
    state = {
      ...state,
      initSource: 'scenario',
      scenarioUnitPrice: 310000,
      useCurrentPublishedPrice: false,
    }
    assert.equal(state.initSource, 'scenario')
    assert.equal(priceOf(state, published), 310000)

    // 4. Editar alquiler, gastos, entrada y tasa: debe seguir en 310000
    state = editFields(state, {
      monthlyRent: 1350,
      annualExpenses: 5100,
      downPaymentPercent: 25,
      interestRate: 8.5,
    })
    assert.equal(state.initSource, 'user')
    assert.equal(priceOf(state, published), 310000)

    // 5. Guardar y reabrir: sigue 310000 y conserva resultados
    const savedPreview = buildInvestmentPreview({
      mode: 'manual',
      unitPrice: priceOf(state, published),
      estimatedMonthlyRent: state.monthlyRent,
      vacancyRate: 0.05,
      annualOperatingExpenses: state.annualExpenses,
      downPaymentPercent: state.downPaymentPercent,
      financingYears: 20,
      interestRate: state.interestRate,
      rateType: 'nominal_annual',
    })
    assert.equal(savedPreview.unitPrice, 310000)

    state = {
      ...state,
      ...priceFlagsAfterScenarioSave(savedPreview.unitPrice),
      initSource: 'user',
    }
    assert.equal(state.useCurrentPublishedPrice, false)
    assert.equal(priceOf(state, published), 310000)

    state = {
      ...state,
      initSource: 'scenario',
      scenarioUnitPrice: 310000,
      useCurrentPublishedPrice: false,
      monthlyRent: 1350,
      annualExpenses: 5100,
      downPaymentPercent: 25,
      interestRate: 8.5,
    }
    const reopened = buildInvestmentPreview({
      mode: 'manual',
      unitPrice: priceOf(state, published),
      estimatedMonthlyRent: state.monthlyRent,
      vacancyRate: 0.05,
      annualOperatingExpenses: state.annualExpenses,
      downPaymentPercent: state.downPaymentPercent,
      financingYears: 20,
      interestRate: state.interestRate,
      rateType: 'nominal_annual',
    })
    assert.equal(reopened.unitPrice, 310000)
    assert.equal(state.monthlyRent, 1350)
    assert.equal(reopened.annualOperatingExpenses, 5100)
    assert.equal(reopened.annualNetCashFlow, savedPreview.annualNetCashFlow)
    assert.equal(reopened.cashOnCashReturn, savedPreview.cashOnCashReturn)
    assert.equal(reopened.monthlyPayment, savedPreview.monthlyPayment)

    // 6. Pulsar «Actualizar al precio publicado»: solo entonces 350000
    state = { ...state, useCurrentPublishedPrice: true }
    assert.equal(priceOf(state, published), 350000)
  })

  it('no usa initSource para elegir precio (regresión c406693)', () => {
    const published = 350000
    for (const initSource of ['scenario', 'user', 'bootstrap'] as const) {
      const locked = resolveCalculatorUnitPrice({
        useCurrentPublishedPrice: false,
        scenarioUnitPrice: 310000,
        publishedPrice: published,
        hypotheticalPrice: null,
      })
      assert.equal(locked, 310000, `histórico con initSource=${initSource}`)
      void initSource
    }
    assert.equal(
      resolveCalculatorUnitPrice({
        useCurrentPublishedPrice: true,
        scenarioUnitPrice: 310000,
        publishedPrice: published,
        hypotheticalPrice: null,
      }),
      350000,
    )
  })

  it('saveScenario deja useCurrentPublishedPrice=false', () => {
    const flags = priceFlagsAfterScenarioSave(310000)
    assert.equal(flags.useCurrentPublishedPrice, false)
    assert.equal(flags.scenarioUnitPrice, 310000)
  })
})
