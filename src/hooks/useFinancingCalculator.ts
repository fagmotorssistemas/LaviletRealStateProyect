'use client'

import { useEffect, useMemo, useState } from 'react'
import type {
  ExpenseBreakdown,
  FinancingConfig,
  FinancingPartner,
  InvestmentPreview,
  RateType,
  SimulationMode,
} from '@/types/financingSimulator'
import {
  DOWN_PAYMENT_MAX_PCT,
  DOWN_PAYMENT_MIN_PCT,
  FINANCING_YEARS_MAX,
  FINANCING_YEARS_MIN,
  buildInvestmentPreview,
  clampDownPaymentPercent,
  clampFinancingYears,
  expenseBreakdownFromConfig,
  suggestMonthlyRent,
  sumExpenseBreakdown,
} from '@/lib/financing/calculator'
import { resolveSimulationMode } from '@/lib/financing/scenarioPersist'
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
}

export type UnitCalcState = {
  monthlyRent: number
  vacancyRate: number
  expenses: ExpenseBreakdown
  annualManagement: number
  annualIncomeTaxEstimate: number
  acquisitionCosts: number
  annualOtherFinancialCosts: number
  monthlyExtraCharges: number
  mode: SimulationMode
  partnerId: string | null
  downPaymentPercent: number
  financingYears: number
  interestRate: number
  rateType: RateType
  hypotheticalPrice: number | null
}

const defaultUnitState = (): UnitCalcState => ({
  monthlyRent: 0,
  vacancyRate: 0.05,
  expenses: { propertyTax: 0, maintenance: 0, insurance: 0, other: 0, total: 0 },
  annualManagement: 0,
  annualIncomeTaxEstimate: 0,
  acquisitionCosts: 0,
  annualOtherFinancialCosts: 0,
  monthlyExtraCharges: 0,
  mode: 'cash',
  partnerId: null,
  downPaymentPercent: 30,
  financingYears: 20,
  interestRate: 0,
  rateType: 'nominal_annual',
  hypotheticalPrice: null,
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
  /** Estado por unidad para no mezclar al cambiar. */
  const [byUnit, setByUnit] = useState<Record<string, UnitCalcState>>({})
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [identified, setIdentified] = useState(false)
  const [focusSection, setFocusSection] = useState<'financing' | 'rent' | null>(
    opts?.initialSection ?? null,
  )

  const unitKey = unitParam.trim() || '_none'

  useEffect(() => {
    setIdentified(isShowroomIdentified())
  }, [])

  useEffect(() => {
    if (opts?.initialMode || opts?.initialSection) {
      setByUnit((prev) => {
        const cur = prev[unitKey] ?? defaultUnitState()
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
        if (cancelled) return
        const nextConfig = json.config ?? null
        const nextUnit = json.unit ?? null
        const nextPartners = json.partners ?? []
        setConfig(nextConfig)
        setUnit(nextUnit)
        setPartners(nextPartners)

        const key = (nextUnit?.unit_number || unitParam).trim() || '_none'
        setByUnit((prev) => {
          const existing = prev[key]
          // Si solo hay placeholder (p.ej. initialMode antes del bootstrap), completar datos.
          const isPlaceholder =
            !existing ||
            (existing.monthlyRent === 0 &&
              existing.expenses.total === 0 &&
              existing.hypotheticalPrice == null &&
              !(Number(nextUnit?.published_commercial_price) > 0 && existing.monthlyRent > 0))
          if (existing && !isPlaceholder) return prev
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
              monthlyRent: rent.amount || base.monthlyRent,
              vacancyRate: Number(nextConfig?.vacancy_rate ?? base.vacancyRate ?? 0.05),
              expenses: expenses.total > 0 ? expenses : base.expenses,
              mode:
                opts?.initialMode === 'financed' || opts?.initialMode === 'manual'
                  ? opts.initialMode
                  : base.mode === 'cash'
                    ? 'cash'
                    : base.mode,
              partnerId: base.partnerId ?? recommended?.id ?? null,
              interestRate:
                base.interestRate > 0
                  ? base.interestRate
                  : recommended
                    ? Number(recommended.annual_interest_rate)
                    : 0,
              financingYears: recommended
                ? clampFinancingYears(base.financingYears || 20, recommended)
                : base.financingYears || 20,
              downPaymentPercent: base.downPaymentPercent || 30,
              hypotheticalPrice: hasPrice ? null : base.hypotheticalPrice,
            },
          }
        })
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Error de carga')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [unitParam, opts?.initialMode])

  const state = byUnit[unitKey] ?? defaultUnitState()

  const patchState = (partial: Partial<UnitCalcState>) => {
    setByUnit((prev) => ({
      ...prev,
      [unitKey]: { ...(prev[unitKey] ?? defaultUnitState()), ...partial },
    }))
  }

  const publishedPrice = Number(unit?.published_commercial_price)
  const hasPublishedPrice = Number.isFinite(publishedPrice) && publishedPrice > 0
  const unitPrice = hasPublishedPrice
    ? publishedPrice
    : state.hypotheticalPrice != null && state.hypotheticalPrice > 0
      ? state.hypotheticalPrice
      : 0
  const priceMissing = !hasPublishedPrice && !(state.hypotheticalPrice != null && state.hypotheticalPrice > 0)

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
    if (state.mode === 'manual') return state.interestRate
    if (state.mode === 'financed' && selectedPartner) {
      // Si el usuario editó la tasa respecto a la institución, se trata como manual implícito al guardar.
      return state.interestRate
    }
    return state.interestRate
  }, [state.mode, state.interestRate, selectedPartner])

  const annualOperatingExpenses = sumExpenseBreakdown(state.expenses)

  const preview: InvestmentPreview | null = useMemo(() => {
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
      annualManagement: state.annualManagement,
      annualIncomeTaxEstimate: state.annualIncomeTaxEstimate || null,
      acquisitionCosts: state.acquisitionCosts,
      annualOtherFinancialCosts: state.annualOtherFinancialCosts,
      monthlyExtraCharges: state.monthlyExtraCharges,
      downPaymentPercent: state.downPaymentPercent,
      financingYears: state.financingYears,
      interestRate: effectiveInterestRate,
      rateType: state.rateType,
    })
  }, [
    config,
    unitPrice,
    state.mode,
    state.partnerId,
    state.monthlyRent,
    state.vacancyRate,
    annualOperatingExpenses,
    state.annualManagement,
    state.annualIncomeTaxEstimate,
    state.acquisitionCosts,
    state.annualOtherFinancialCosts,
    state.monthlyExtraCharges,
    state.downPaymentPercent,
    state.financingYears,
    effectiveInterestRate,
    state.rateType,
  ])

  function setPartnerId(id: string | null) {
    const partner = partners.find((p) => p.id === id) ?? null
    patchState({
      partnerId: id,
      mode: id ? (state.mode === 'cash' ? 'financed' : state.mode === 'manual' ? 'manual' : 'financed') : state.mode === 'cash' ? 'cash' : 'manual',
      interestRate: partner ? Number(partner.annual_interest_rate) : state.interestRate,
      financingYears: partner ? clampFinancingYears(state.financingYears, partner) : state.financingYears,
    })
  }

  function setMode(mode: SimulationMode) {
    if (mode === 'cash') {
      patchState({ mode: 'cash' })
      return
    }
    if (mode === 'manual') {
      patchState({ mode: 'manual', partnerId: null })
      return
    }
    // financed
    const partner = selectedPartner ?? partners[0] ?? null
    patchState({
      mode: partner ? 'financed' : 'manual',
      partnerId: partner?.id ?? null,
      interestRate: partner ? Number(partner.annual_interest_rate) : state.interestRate || 7.8,
      financingYears: partner ? clampFinancingYears(state.financingYears || 20, partner) : state.financingYears || 20,
    })
  }

  function setExpenses(partial: Partial<ExpenseBreakdown>) {
    const next = { ...state.expenses, ...partial }
    next.total = sumExpenseBreakdown(next)
    patchState({ expenses: next })
  }

  function useSuggestedExpenses() {
    if (!config) return
    const next = expenseBreakdownFromConfig(unitPrice, config)
    patchState({ expenses: next })
  }

  async function saveScenario() {
    if (!unit || !preview || !config) return
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
          down_payment_percent: preview.downPaymentPercent,
          financing_years: preview.financingYears || null,
          estimated_monthly_rent: state.monthlyRent,
          vacancy_rate: state.vacancyRate,
          annual_expenses: annualOperatingExpenses,
          annual_management: state.annualManagement,
          annual_income_tax_estimate: state.annualIncomeTaxEstimate || null,
          expense_breakdown: state.expenses,
          applied_interest_rate: preview.interestRate,
          rate_type: state.rateType,
          acquisition_costs: state.acquisitionCosts,
          annual_other_financial: state.annualOtherFinancialCosts,
          monthly_extra_charges: state.monthlyExtraCharges,
          unit_price: unitPrice,
          project_id: unit.project_id,
          calculation_version: preview.calculationVersion,
          assumptions_json: preview.assumptions,
          phone: getShowroomPhone() || undefined,
          lead_id: getShowroomLeadId() || undefined,
        }),
      })
      const json = (await response.json()) as { error?: string; lead_id?: string }
      if (!response.ok) throw new Error(json.error || 'No se pudo guardar')
      setIdentified(true)
      setSaveMessage('Escenario guardado')
    } catch (err) {
      setSaveMessage(err instanceof Error ? err.message : 'No se pudo guardar')
    } finally {
      setSaving(false)
    }
  }

  function loadFromScenario(row: {
    estimated_monthly_rent?: number | null
    unit_price?: number | null
    down_payment_percent?: number | null
    financing_years?: number | null
    applied_interest_rate?: number | null
    financing_partner_id?: string | null
    simulation_mode?: SimulationMode | null
    vacancy_rate_snapshot?: number | null
    annual_expenses?: number | null
    annual_management?: number | null
    annual_income_tax_estimate?: number | null
    expense_breakdown?: ExpenseBreakdown | null
    rate_type?: RateType | null
    acquisition_costs?: number | null
    annual_other_financial?: number | null
    monthly_extra_charges?: number | null
  }) {
    const mode = resolveSimulationMode(row)
    const expenses =
      row.expense_breakdown ??
      (row.annual_expenses != null
        ? {
            propertyTax: 0,
            maintenance: 0,
            insurance: 0,
            other: Number(row.annual_expenses) || 0,
            total: Number(row.annual_expenses) || 0,
          }
        : state.expenses)
    patchState({
      monthlyRent: Number(row.estimated_monthly_rent) || state.monthlyRent,
      vacancyRate: row.vacancy_rate_snapshot != null ? Number(row.vacancy_rate_snapshot) : state.vacancyRate,
      expenses,
      annualManagement: Number(row.annual_management) || 0,
      annualIncomeTaxEstimate: Number(row.annual_income_tax_estimate) || 0,
      acquisitionCosts: Number(row.acquisition_costs) || 0,
      annualOtherFinancialCosts: Number(row.annual_other_financial) || 0,
      monthlyExtraCharges: Number(row.monthly_extra_charges) || 0,
      mode,
      partnerId: row.financing_partner_id ?? null,
      downPaymentPercent: clampDownPaymentPercent(Number(row.down_payment_percent) || 30),
      financingYears: Number(row.financing_years) || 20,
      interestRate: Number(row.applied_interest_rate) || 0,
      rateType: row.rate_type ?? 'nominal_annual',
      hypotheticalPrice:
        !hasPublishedPrice && row.unit_price != null ? Number(row.unit_price) : state.hypotheticalPrice,
    })
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
    setMonthlyRent: (v: number) => patchState({ monthlyRent: Math.max(0, v) }),
    vacancyRate: state.vacancyRate,
    setVacancyRate: (v: number) => patchState({ vacancyRate: Math.min(1, Math.max(0, v)) }),
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
      if (hasPublishedPrice) return
      const price = Math.max(0, value)
      if (config) {
        patchState({ hypotheticalPrice: price, expenses: expenseBreakdownFromConfig(price, config) })
      } else {
        patchState({ hypotheticalPrice: price })
      }
    },
    priceMissing,
    hasPublishedPrice,
    downPaymentPercent: state.downPaymentPercent,
    setDownPaymentPercent: (v: number) => patchState({ downPaymentPercent: clampDownPaymentPercent(v) }),
    financingYears: state.financingYears,
    setFinancingYears: (v: number) =>
      patchState({ financingYears: clampFinancingYears(v, selectedPartner) }),
    interestRate: state.interestRate,
    setInterestRate: (v: number) =>
      patchState({
        interestRate: Math.max(0, v),
        mode: state.partnerId && Math.abs(v - Number(selectedPartner?.annual_interest_rate || 0)) > 0.001 ? 'manual' : state.mode === 'cash' ? 'cash' : state.mode,
      }),
    rateType: state.rateType,
    setRateType: (v: RateType) => patchState({ rateType: v }),
    mode: state.mode === 'cash' ? 'cash' : state.mode === 'manual' || !state.partnerId ? 'manual' : 'financed',
    preview,
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
      yearsMin: FINANCING_YEARS_MIN,
      yearsMax: FINANCING_YEARS_MAX,
    },
  }
}
