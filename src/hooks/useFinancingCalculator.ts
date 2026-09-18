'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  ExpenseBreakdown,
  FinancingConfig,
  FinancingPartner,
  FinancingScenario,
  InvestmentPreview,
  RateType,
  SimulationMode,
} from '@/types/financingSimulator'
import {
  CALCULATION_VERSION,
  DOWN_PAYMENT_MAX_PCT,
  DOWN_PAYMENT_MIN_PCT,
  FINANCING_YEARS_MAX,
  FINANCING_YEARS_MIN,
  INCOME_TAX_RATE,
  MANAGEMENT_FEE_RATE,
  buildInvestmentPreview,
  buildRentCoverageAnalysis,
  clampDownPaymentPercent,
  clampFinancingYears,
  expenseBreakdownFromConfig,
  suggestMonthlyRent,
  sumExpenseBreakdown,
} from '@/lib/financing/calculator'
import {
  priceFlagsAfterScenarioSave,
  resolveCalculatorUnitPrice,
} from '@/lib/financing/calculatorUnitPrice'
import { resolveSimulationMode } from '@/lib/financing/scenarioPersist'
import { assessScenarioFidelity, finiteOr, finiteOrNull } from '@/lib/financing/scenarioFidelity'
import {
  getShowroomLeadId,
  getShowroomPhone,
  isShowroomIdentified,
} from '@/lib/tour/showroomIdentity'

type UnitRow = {
  id: string
  unit_number: string
  published_commercial_price: number | null
  bedrooms: number | null
  project_id: string
  category?: string | null
  area_internal_m2?: number | null
}

export type UnitCalcState = {
  /** empty = aún no bootstrap; bootstrap = defaults de catálogo; scenario = reopen; user = edits */
  initSource: 'empty' | 'bootstrap' | 'scenario' | 'user'
  monthlyRent: number
  vacancyRate: number
  expenses: ExpenseBreakdown
  /** Incluye IR sobre alquiler efectivo. */
  includeIncomeTax: boolean
  /** Incluye comisión gestor sobre alquiler efectivo. */
  includePropertyManager: boolean
  incomeTaxRate: number
  managementFeeRate: number
  acquisitionCosts: number
  annualOtherFinancialCosts: number
  monthlyExtraCharges: number
  wealthHorizonYears: number
  appreciationRateAnnual: number
  saleCosts: number
  mode: SimulationMode
  partnerId: string | null
  downPaymentPercent: number
  financingYears: number
  interestRate: number
  rateType: RateType
  hypotheticalPrice: number | null
  /** Precio del escenario guardado (histórico). */
  scenarioUnitPrice: number | null
  /** false = usar scenarioUnitPrice; true = precio publicado/hipotético actual. */
  useCurrentPublishedPrice: boolean
  fidelityMessage: string | null
  savedResults: {
    annualNetCashFlow: number | null
    cashOnCashReturn: number | null
    monthlyPayment: number | null
  } | null
}

const defaultUnitState = (): UnitCalcState => ({
  initSource: 'empty',
  monthlyRent: 0,
  vacancyRate: 0.05,
  expenses: { propertyTax: 0, maintenance: 0, insurance: 0, other: 0, total: 0 },
  includeIncomeTax: true,
  includePropertyManager: true,
  incomeTaxRate: INCOME_TAX_RATE,
  managementFeeRate: MANAGEMENT_FEE_RATE,
  acquisitionCosts: 0,
  annualOtherFinancialCosts: 0,
  monthlyExtraCharges: 0,
  wealthHorizonYears: 10,
  appreciationRateAnnual: 0.05,
  saleCosts: 0,
  mode: 'cash',
  partnerId: null,
  downPaymentPercent: 30,
  financingYears: 20,
  interestRate: 0,
  rateType: 'nominal_annual',
  hypotheticalPrice: null,
  scenarioUnitPrice: null,
  useCurrentPublishedPrice: true,
  fidelityMessage: null,
  savedResults: null,
})

export function useFinancingCalculator(
  unitParam: string,
  opts?: { initialMode?: SimulationMode; initialSection?: 'financing' | 'rent' | null },
) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [config, setConfig] = useState<FinancingConfig | null>(null)
  const [partners, setPartners] = useState<FinancingPartner[]>([])
  const [unit, setUnit] = useState<UnitRow | null>(null)
  const [byUnit, setByUnit] = useState<Record<string, UnitCalcState>>({})
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [identified, setIdentified] = useState(false)
  const [focusSection, setFocusSection] = useState<'financing' | 'rent' | null>(
    opts?.initialSection ?? null,
  )
  const bootstrapGen = useRef(0)

  const unitKey = unitParam.trim() || '_none'

  useEffect(() => {
    setIdentified(isShowroomIdentified())
  }, [])

  useEffect(() => {
    if (opts?.initialMode || opts?.initialSection) {
      setByUnit((prev) => {
        const cur = prev[unitKey] ?? defaultUnitState()
        if (cur.initSource === 'scenario' || cur.initSource === 'user') {
          return {
            ...prev,
            [unitKey]: {
              ...cur,
              mode:
                opts.initialMode === 'financed' || opts.initialMode === 'manual'
                  ? opts.initialMode
                  : cur.mode,
            },
          }
        }
        return {
          ...prev,
          [unitKey]: {
            ...cur,
            mode: opts.initialMode === 'financed' || opts.initialMode === 'manual' ? opts.initialMode : cur.mode,
          },
        }
      })
      if (opts.initialSection) setFocusSection(opts.initialSection)
    }
  }, [opts?.initialMode, opts?.initialSection, unitKey])

  useEffect(() => {
    let cancelled = false
    const gen = ++bootstrapGen.current
    ;(async () => {
      setLoading(true)
      setError(null)
      setSaveMessage(null)
      try {
        const response = await fetch(`/api/financing/bootstrap?unit=${encodeURIComponent(unitParam)}`)
        const json = (await response.json()) as {
          config?: FinancingConfig | null
          unit?: UnitRow | null
          partners?: FinancingPartner[]
          error?: string
        }
        if (!response.ok) throw new Error(json.error || 'No se pudo cargar')
        if (cancelled || gen !== bootstrapGen.current) return
        const nextConfig = json.config ?? null
        const nextUnit = json.unit ?? null
        const nextPartners = json.partners ?? []
        setConfig(nextConfig)
        setUnit(nextUnit)
        setPartners(nextPartners)

        // Key canónica: siempre unit_number del bootstrap o el param tipado como número.
        const key = (nextUnit?.unit_number || unitParam).trim() || '_none'
        setByUnit((prev) => {
          const existing = prev[key] ?? prev[unitKey]
          // Solo completar si aún no hay inicialización explícita.
          if (existing && existing.initSource !== 'empty') {
            // Migrar key si hacía falta
            if (!prev[key] && existing) {
              const { [unitKey]: _, ...rest } = prev
              return { ...rest, [key]: existing }
            }
            return prev
          }
          const published = Number(nextUnit?.published_commercial_price)
          const hasPrice = Number.isFinite(published) && published > 0
          const price = hasPrice ? published : 0
          const expenses = nextConfig
            ? expenseBreakdownFromConfig(price || 0, nextConfig)
            : { propertyTax: 0, maintenance: 0, insurance: 0, other: 0, total: 0 }
          const rent = suggestMonthlyRent({
            config: nextConfig,
            unitPrice: price,
            bedrooms: nextUnit?.bedrooms,
            category: nextUnit?.category,
          })
          const recommended = nextPartners.find((p) => p.is_recommended) ?? nextPartners[0] ?? null
          const base = existing ?? defaultUnitState()
          return {
            ...prev,
            [key]: {
              ...base,
              initSource: 'bootstrap',
              monthlyRent: rent.amount,
              vacancyRate: Number(nextConfig?.vacancy_rate ?? 0.05),
              expenses,
              mode:
                opts?.initialMode === 'financed'
                  ? 'financed'
                  : 'cash',
              partnerId: recommended?.id ?? null,
              interestRate: recommended ? Number(recommended.annual_interest_rate) : 0,
              financingYears: recommended
                ? clampFinancingYears(20, recommended)
                : 20,
              downPaymentPercent: 30,
              hypotheticalPrice: hasPrice ? null : null,
              scenarioUnitPrice: null,
              useCurrentPublishedPrice: true,
              fidelityMessage: null,
              savedResults: null,
            },
          }
        })
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Error de carga')
      } finally {
        if (!cancelled && gen === bootstrapGen.current) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [unitParam, opts?.initialMode])

  const state = byUnit[unitKey] ?? byUnit[unit?.unit_number ?? ''] ?? defaultUnitState()

  const patchState = (partial: Partial<UnitCalcState>, markUser = true) => {
    setByUnit((prev) => {
      const cur = prev[unitKey] ?? defaultUnitState()
      return {
        ...prev,
        [unitKey]: {
          ...cur,
          ...partial,
          initSource: markUser
            ? cur.initSource === 'empty'
              ? 'user'
              : cur.initSource === 'bootstrap'
                ? 'user'
                : cur.initSource === 'scenario'
                  ? 'user'
                  : 'user'
            : (partial.initSource ?? cur.initSource),
        },
      }
    })
  }

  const publishedPrice = Number(unit?.published_commercial_price)
  const hasPublishedPrice = Number.isFinite(publishedPrice) && publishedPrice > 0

  /** Fuente de precio explícita: no depende de initSource (editar no debe saltar al publicado). */
  const unitPrice = resolveCalculatorUnitPrice({
    useCurrentPublishedPrice: state.useCurrentPublishedPrice,
    scenarioUnitPrice: state.scenarioUnitPrice,
    publishedPrice: hasPublishedPrice ? publishedPrice : null,
    hypotheticalPrice: state.hypotheticalPrice,
  })

  const priceMissing = unitPrice <= 0
  const priceDiffersFromPublished =
    hasPublishedPrice &&
    state.scenarioUnitPrice != null &&
    Math.abs(state.scenarioUnitPrice - publishedPrice) > 0.01 &&
    !state.useCurrentPublishedPrice

  const rentSuggestion = useMemo(
    () =>
      suggestMonthlyRent({
        config,
        unitPrice,
        bedrooms: unit?.bedrooms,
        category: unit?.category,
      }),
    [config, unitPrice, unit?.bedrooms, unit?.category],
  )

  const selectedPartner = useMemo(
    () => partners.find((p) => p.id === state.partnerId) ?? null,
    [partners, state.partnerId],
  )

  const effectiveInterestRate = useMemo(() => {
    if (state.mode === 'cash') return 0
    if (selectedPartner) return Number(selectedPartner.annual_interest_rate)
    return state.interestRate
  }, [state.mode, state.interestRate, selectedPartner])

  // Siempre modelo v5 (predial + alícuota) cuando hay config; no reintroducir seguro/otros del estado.
  const annualOperatingExpenses = useMemo(() => {
    if (config && unitPrice > 0) {
      return expenseBreakdownFromConfig(unitPrice, config).total
    }
    return sumExpenseBreakdown(state.expenses)
  }, [config, unitPrice, state.expenses])

  const livePreview: InvestmentPreview | null = useMemo(() => {
    if (!config) return null
    if (unitPrice <= 0) return null
    const mode: SimulationMode =
      state.mode === 'cash'
        ? 'cash'
        : state.mode === 'manual' || !state.partnerId
          ? 'manual'
          : 'financed'
    return buildInvestmentPreview({
      mode,
      unitPrice,
      estimatedMonthlyRent: state.monthlyRent,
      vacancyRate: state.vacancyRate,
      annualOperatingExpenses,
      includeIncomeTax: state.includeIncomeTax,
      includePropertyManager: state.includePropertyManager,
      incomeTaxRate: state.incomeTaxRate,
      managementFeeRate: state.managementFeeRate,
      acquisitionCosts: state.acquisitionCosts,
      annualOtherFinancialCosts: state.annualOtherFinancialCosts,
      monthlyExtraCharges: state.monthlyExtraCharges,
      downPaymentPercent: state.downPaymentPercent,
      financingYears: state.financingYears,
      interestRate: effectiveInterestRate,
      rateType: state.rateType,
      wealthHorizonYears: state.wealthHorizonYears,
      appreciationRateAnnual: state.appreciationRateAnnual,
      saleCosts: state.saleCosts,
    })
  }, [
    config,
    unitPrice,
    state.mode,
    state.partnerId,
    state.monthlyRent,
    state.vacancyRate,
    annualOperatingExpenses,
    state.includeIncomeTax,
    state.includePropertyManager,
    state.incomeTaxRate,
    state.managementFeeRate,
    state.acquisitionCosts,
    state.annualOtherFinancialCosts,
    state.monthlyExtraCharges,
    state.downPaymentPercent,
    state.financingYears,
    effectiveInterestRate,
    state.rateType,
    state.wealthHorizonYears,
    state.appreciationRateAnnual,
    state.saleCosts,
  ])

  /** Legacy/unknown: preferir resultados guardados para métricas principales. */
  const preview: InvestmentPreview | null = useMemo(() => {
    if (!livePreview) return null
    if (state.initSource === 'scenario' && state.savedResults && state.fidelityMessage) {
      return {
        ...livePreview,
        annualNetCashFlow: finiteOr(state.savedResults.annualNetCashFlow, livePreview.annualNetCashFlow),
        monthlyCashFlow: roundDiv12(finiteOr(state.savedResults.annualNetCashFlow, livePreview.annualNetCashFlow)),
        cashOnCashReturn: finiteOrNull(state.savedResults.cashOnCashReturn) ?? livePreview.cashOnCashReturn,
        roiPercent: finiteOrNull(state.savedResults.cashOnCashReturn) ?? livePreview.roiPercent,
        monthlyPayment: finiteOr(state.savedResults.monthlyPayment, livePreview.monthlyPayment),
      }
    }
    return livePreview
  }, [livePreview, state.initSource, state.savedResults, state.fidelityMessage])

  const rentCoverage = useMemo(
    () => (preview ? buildRentCoverageAnalysis(preview) : null),
    [preview],
  )

  function setPartnerId(id: string | null) {
    const partner = partners.find((p) => p.id === id) ?? null
    if (!id || !partner) return
    patchState({
      partnerId: id,
      mode: 'financed',
      interestRate: Number(partner.annual_interest_rate),
      financingYears: clampFinancingYears(
        state.financingYears > 0 ? state.financingYears : 20,
        partner,
      ),
      savedResults: null,
      fidelityMessage: null,
    })
  }

  function setMode(mode: SimulationMode) {
    if (mode === 'cash') {
      patchState({ mode: 'cash', savedResults: null, fidelityMessage: null })
      return
    }
    // Tour público: solo instituciones administradas (no tasa manual).
    const partner = selectedPartner ?? partners[0] ?? null
    if (!partner) {
      patchState({ mode: 'cash', partnerId: null, interestRate: 0, savedResults: null, fidelityMessage: null })
      return
    }
    patchState({
      mode: 'financed',
      partnerId: partner.id,
      interestRate: Number(partner.annual_interest_rate),
      financingYears: clampFinancingYears(
        state.financingYears > 0 ? state.financingYears : 20,
        partner,
      ),
      savedResults: null,
      fidelityMessage: null,
    })
  }

  function setExpenses(partial: Partial<ExpenseBreakdown>) {
    const next = { ...state.expenses, ...partial }
    next.total = sumExpenseBreakdown(next)
    patchState({ expenses: next, savedResults: null, fidelityMessage: null })
  }

  function useSuggestedExpenses() {
    if (!config) return
    const next = expenseBreakdownFromConfig(unitPrice, config)
    patchState({ expenses: next, savedResults: null, fidelityMessage: null })
  }

  function applyCurrentPublishedPrice() {
    patchState({
      useCurrentPublishedPrice: true,
      savedResults: null,
      fidelityMessage: null,
    })
  }

  async function saveScenario() {
    if (!unit || !livePreview || !config) return
    if (priceMissing || unitPrice <= 0) {
      setSaveMessage('Indica un precio hipotético para guardar')
      return
    }
    setSaving(true)
    setSaveMessage(null)
    try {
      const saveMode: SimulationMode =
        state.mode === 'cash' ? 'cash' : state.partnerId && state.mode === 'financed' ? 'financed' : 'manual'
      const response = await fetch('/api/financing/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unit_id: unit.id,
          mode: saveMode,
          financing_partner_id: saveMode === 'financed' ? state.partnerId : null,
          down_payment_percent: livePreview.downPaymentPercent,
          financing_years: livePreview.financingYears || null,
          estimated_monthly_rent: state.monthlyRent,
          vacancy_rate: state.vacancyRate,
          annual_expenses: annualOperatingExpenses,
          annual_management: livePreview.annualManagement,
          annual_income_tax_estimate: livePreview.annualIncomeTaxEstimate || null,
          expense_breakdown: state.expenses,
          applied_interest_rate: livePreview.interestRate,
          rate_type: state.rateType,
          acquisition_costs: state.acquisitionCosts,
          annual_other_financial: state.annualOtherFinancialCosts,
          monthly_extra_charges: state.monthlyExtraCharges,
          unit_price: unitPrice,
          assumptions_json: {
            ...livePreview.assumptions,
            includeIncomeTax: state.includeIncomeTax,
            includePropertyManager: state.includePropertyManager,
            incomeTaxRate: state.incomeTaxRate,
            managementFeeRate: state.managementFeeRate,
            wealthHorizonYears: state.wealthHorizonYears,
            appreciationRateAnnual: state.appreciationRateAnnual,
            saleCosts: state.saleCosts,
          },
          include_income_tax: state.includeIncomeTax,
          include_property_manager: state.includePropertyManager,
          income_tax_rate: state.incomeTaxRate,
          management_fee_rate: state.managementFeeRate,
          wealth_horizon_years: state.wealthHorizonYears,
          appreciation_rate_annual: state.appreciationRateAnnual,
          sale_costs: state.saleCosts,
          phone: getShowroomPhone() || undefined,
          lead_id: getShowroomLeadId() || undefined,
        }),
      })
      const json = (await response.json()) as { error?: string; lead_id?: string }
      if (!response.ok) throw new Error(json.error || 'No se pudo guardar')
      setIdentified(true)
      setSaveMessage('Escenario guardado')
      patchState(
        {
          ...priceFlagsAfterScenarioSave(unitPrice),
          fidelityMessage: null,
          savedResults: null,
          initSource: 'user',
        },
        false,
      )
    } catch (err) {
      setSaveMessage(err instanceof Error ? err.message : 'No se pudo guardar')
    } finally {
      setSaving(false)
    }
  }

  function loadFromScenario(row: FinancingScenario | Record<string, unknown>) {
    const scenario = row as FinancingScenario
    const mode = resolveSimulationMode(scenario)
    const rent = finiteOrNull(scenario.estimated_monthly_rent)
    const vacancy = finiteOrNull(scenario.vacancy_rate_snapshot)
    const rate = finiteOrNull(scenario.applied_interest_rate)
    const years = finiteOrNull(scenario.financing_years)
    const down = finiteOrNull(scenario.down_payment_percent)
    const savedPrice = finiteOrNull(scenario.unit_price)
    const management = finiteOrNull(scenario.annual_management)
    const tax = finiteOrNull(scenario.annual_income_tax_estimate)
    const acquisition = finiteOrNull(scenario.acquisition_costs)
    const otherFin = finiteOrNull(scenario.annual_other_financial)
    const extra = finiteOrNull(scenario.monthly_extra_charges)
    const assumptions = (scenario.assumptions_json ?? {}) as Record<string, unknown>
    const includeIncomeTax =
      typeof assumptions.includeIncomeTax === 'boolean'
        ? assumptions.includeIncomeTax
        : tax != null && tax > 0
    const includePropertyManager =
      typeof assumptions.includePropertyManager === 'boolean'
        ? assumptions.includePropertyManager
        : management != null && management > 0
    const incomeTaxRate =
      typeof assumptions.incomeTaxRate === 'number' ? assumptions.incomeTaxRate : INCOME_TAX_RATE
    const managementFeeRate =
      typeof assumptions.managementFeeRate === 'number'
        ? assumptions.managementFeeRate
        : MANAGEMENT_FEE_RATE
    const wealthHorizonYears =
      typeof assumptions.wealthHorizonYears === 'number' ? assumptions.wealthHorizonYears : 10
    const appreciationRateAnnual =
      typeof assumptions.appreciationRateAnnual === 'number'
        ? assumptions.appreciationRateAnnual
        : 0.05
    const saleCosts = typeof assumptions.saleCosts === 'number' ? assumptions.saleCosts : 0

    const expenses: ExpenseBreakdown =
      scenario.expense_breakdown ??
      (scenario.annual_expenses != null
        ? {
            propertyTax: 0,
            maintenance: 0,
            insurance: 0,
            other: finiteOr(scenario.annual_expenses, 0),
            total: finiteOr(scenario.annual_expenses, 0),
          }
        : state.expenses)

    const fidelity = assessScenarioFidelity(scenario)
    const isExact = fidelity.kind === 'exact'

    patchState(
      {
        initSource: 'scenario',
        monthlyRent: rent ?? state.monthlyRent,
        vacancyRate: vacancy ?? state.vacancyRate,
        expenses,
        includeIncomeTax,
        includePropertyManager,
        incomeTaxRate,
        managementFeeRate,
        acquisitionCosts: acquisition ?? 0,
        annualOtherFinancialCosts: otherFin ?? 0,
        monthlyExtraCharges: extra ?? 0,
        wealthHorizonYears,
        appreciationRateAnnual,
        saleCosts,
        mode,
        partnerId: scenario.financing_partner_id ?? null,
        downPaymentPercent: down != null ? clampDownPaymentPercent(down) : state.downPaymentPercent,
        financingYears: years != null ? years : state.financingYears,
        interestRate: rate ?? 0,
        rateType:
          scenario.rate_type === 'effective_annual' || scenario.rate_type === 'nominal_annual'
            ? scenario.rate_type
            : 'nominal_annual',
        scenarioUnitPrice: savedPrice,
        useCurrentPublishedPrice: false,
        hypotheticalPrice: !hasPublishedPrice && savedPrice != null ? savedPrice : state.hypotheticalPrice,
        fidelityMessage: isExact ? null : fidelity.message,
        savedResults: isExact
          ? null
          : {
              annualNetCashFlow: finiteOrNull(scenario.annual_net_cash_flow),
              cashOnCashReturn: finiteOrNull(scenario.roi_percent),
              monthlyPayment: finiteOrNull(scenario.monthly_payment),
            },
      },
      false,
    )
  }

  return {
    loading,
    error,
    config,
    unit,
    partners,
    selectedPartner,
    state,
    patchState,
    setMode,
    setPartnerId,
    setExpenses,
    useSuggestedExpenses,
    monthlyRent: state.monthlyRent,
    setMonthlyRent: (v: number) =>
      patchState({ monthlyRent: Math.max(0, v), savedResults: null, fidelityMessage: null }),
    vacancyRate: state.vacancyRate,
    setVacancyRate: (v: number) =>
      patchState({
        vacancyRate: Math.min(1, Math.max(0, v)),
        savedResults: null,
        fidelityMessage: null,
      }),
    annualExpenses: annualOperatingExpenses,
    setAnnualExpenses: (total: number) =>
      setExpenses({
        propertyTax: 0,
        maintenance: 0,
        insurance: 0,
        other: Math.max(0, total),
        total: Math.max(0, total),
      }),
    suggestedRent: rentSuggestion.amount,
    rentSuggestion,
    suggestedExpenses: config ? expenseBreakdownFromConfig(unitPrice, config).total : 0,
    unitPrice,
    setUnitPrice: (value: number) => {
      if (hasPublishedPrice && state.useCurrentPublishedPrice) return
      const price = Math.max(0, value)
      if (config) {
        patchState({
          hypotheticalPrice: price,
          scenarioUnitPrice: price,
          useCurrentPublishedPrice: false,
          expenses: expenseBreakdownFromConfig(price, config),
          savedResults: null,
          fidelityMessage: null,
        })
      } else {
        patchState({
          hypotheticalPrice: price,
          scenarioUnitPrice: price,
          useCurrentPublishedPrice: false,
          savedResults: null,
          fidelityMessage: null,
        })
      }
    },
    priceMissing,
    hasPublishedPrice,
    priceDiffersFromPublished,
    scenarioUnitPrice: state.scenarioUnitPrice,
    useCurrentPublishedPrice: state.useCurrentPublishedPrice,
    applyCurrentPublishedPrice,
    fidelityMessage: state.fidelityMessage,
    calculationVersion: CALCULATION_VERSION,
    /** Acción explícita: deja de anclar resultados históricos y aplica fórmulas/gastos actuales. */
    applyCurrentFormulas: () => {
      const nextExpenses = config
        ? expenseBreakdownFromConfig(unitPrice, config)
        : { propertyTax: 0, maintenance: 0, insurance: 0, other: 0, total: 0 }
      patchState({
        expenses: nextExpenses,
        savedResults: null,
        fidelityMessage: null,
        initSource: 'user',
      })
    },
    downPaymentPercent: state.downPaymentPercent,
    setDownPaymentPercent: (v: number) =>
      patchState({
        downPaymentPercent: clampDownPaymentPercent(v),
        savedResults: null,
        fidelityMessage: null,
      }),
    financingYears: state.financingYears,
    setFinancingYears: (v: number) =>
      patchState({
        financingYears: clampFinancingYears(v, selectedPartner),
        savedResults: null,
        fidelityMessage: null,
      }),
    interestRate: state.interestRate,
    setInterestRate: (v: number) =>
      patchState({
        interestRate: Math.max(0, v),
        mode:
          state.partnerId && Math.abs(v - Number(selectedPartner?.annual_interest_rate || 0)) > 0.001
            ? 'manual'
            : state.mode === 'cash'
              ? 'cash'
              : state.mode,
        savedResults: null,
        fidelityMessage: null,
      }),
    rateType: state.rateType,
    setRateType: (v: RateType) => patchState({ rateType: v, savedResults: null, fidelityMessage: null }),
    mode: state.mode === 'cash' ? 'cash' : 'financed',
    preview,
    rentCoverage,
    wealthHorizonYears: state.wealthHorizonYears,
    setWealthHorizonYears: (v: number) =>
      patchState({
        wealthHorizonYears: Math.max(1, Math.min(40, Math.round(v) || 10)),
        savedResults: null,
        fidelityMessage: null,
      }),
    appreciationRateAnnual: state.appreciationRateAnnual,
    setAppreciationRateAnnual: (v: number) =>
      patchState({
        appreciationRateAnnual: v,
        savedResults: null,
        fidelityMessage: null,
      }),
    incomeTaxRate: state.incomeTaxRate,
    setIncomeTaxRate: (v: number) =>
      patchState({
        incomeTaxRate: Math.min(1, Math.max(0, v)),
        savedResults: null,
        fidelityMessage: null,
      }),
    managementFeeRate: state.managementFeeRate,
    setManagementFeeRate: (v: number) =>
      patchState({
        managementFeeRate: Math.min(1, Math.max(0, v)),
        savedResults: null,
        fidelityMessage: null,
      }),
    comparison: [] as const,
    identified,
    saving,
    saveMessage,
    saveScenario,
    loadFromScenario,
    focusSection,
    setFocusSection,
    limits: {
      downPaymentMin: DOWN_PAYMENT_MIN_PCT,
      downPaymentMax: DOWN_PAYMENT_MAX_PCT,
      yearsMin: selectedPartner?.min_financing_years ?? FINANCING_YEARS_MIN,
      yearsMax: selectedPartner?.max_financing_years ?? FINANCING_YEARS_MAX,
    },
  }
}

function roundDiv12(annual: number) {
  return Math.round((annual / 12 + Number.EPSILON) * 100) / 100
}
