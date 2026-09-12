'use client'

import { useEffect, useMemo, useState } from 'react'
import type { FinancingConfig, InvestmentPreview } from '@/types/financingSimulator'
import {
  buildCashInvestmentPreview,
  defaultAnnualExpenses,
  suggestedRentForBedrooms,
  suggestedRentFromUnitPrice,
  suggestedUnitPrice,
} from '@/lib/financing/calculator'
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

export function useFinancingCalculator(unitParam: string) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [config, setConfig] = useState<FinancingConfig | null>(null)
  const [unit, setUnit] = useState<UnitRow | null>(null)
  const [monthlyRent, setMonthlyRent] = useState(1200)
  const [annualExpenses, setAnnualExpenses] = useState(0)
  const [unitPrice, setUnitPrice] = useState(120000)
  const [saving, setSaving] = useState(false)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [identified, setIdentified] = useState(false)

  useEffect(() => {
    setIdentified(isShowroomIdentified())
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError(null)
      try {
        const response = await fetch(`/api/financing/bootstrap?unit=${encodeURIComponent(unitParam)}`)
        const json = (await response.json()) as {
          config?: FinancingConfig | null
          unit?: UnitRow | null
          error?: string
        }
        if (!response.ok) throw new Error(json.error || 'No se pudo cargar')
        if (cancelled) return
        const nextConfig = json.config ?? null
        setConfig(nextConfig)
        setUnit(json.unit ?? null)
        const beds = json.unit?.bedrooms ?? 1
        const price = Number(json.unit?.published_commercial_price) || suggestedUnitPrice(beds)
        setUnitPrice(price)
        if (nextConfig) {
          const fromBeds = suggestedRentForBedrooms(nextConfig, beds)
          const fromPrice = suggestedRentFromUnitPrice(price)
          setMonthlyRent(fromBeds > 0 ? fromBeds : fromPrice)
          setAnnualExpenses(defaultAnnualExpenses(price, nextConfig))
        } else {
          setMonthlyRent(suggestedRentFromUnitPrice(price))
          setAnnualExpenses(0)
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Error de carga')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [unitParam])

  const suggestedRent = useMemo(() => {
    if (!config) return suggestedRentFromUnitPrice(unitPrice)
    const fromBeds = suggestedRentForBedrooms(config, unit?.bedrooms)
    const fromPrice = suggestedRentFromUnitPrice(unitPrice)
    return fromBeds > 0 ? fromBeds : fromPrice
  }, [config, unit?.bedrooms, unitPrice])

  const suggestedExpenses = useMemo(
    () => (config ? defaultAnnualExpenses(unitPrice, config) : 0),
    [config, unitPrice],
  )

  const preview: InvestmentPreview | null = useMemo(() => {
    if (!config) return null
    return buildCashInvestmentPreview({
      unitPrice,
      estimatedMonthlyRent: monthlyRent,
      annualExpenses,
      config,
    })
  }, [config, unitPrice, monthlyRent, annualExpenses])

  async function saveScenario() {
    if (!unit || !preview || !config) return
    setSaving(true)
    setSaveMessage(null)
    try {
      const response = await fetch('/api/financing/scenarios', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          unit_id: unit.id,
          mode: 'cash',
          estimated_monthly_rent: monthlyRent,
          annual_expenses: annualExpenses,
          unit_price: unitPrice,
          project_id: unit.project_id,
          phone: getShowroomPhone() || undefined,
          lead_id: getShowroomLeadId() || undefined,
        }),
      })
      const json = (await response.json()) as { error?: string; lead_id?: string }
      if (!response.ok) throw new Error(json.error || 'No se pudo guardar')
      setIdentified(true)
      setSaveMessage('Cálculo guardado')
    } catch (err) {
      setSaveMessage(err instanceof Error ? err.message : 'No se pudo guardar')
    } finally {
      setSaving(false)
    }
  }

  return {
    loading,
    error,
    config,
    unit,
    monthlyRent,
    setMonthlyRent,
    annualExpenses,
    setAnnualExpenses,
    suggestedRent,
    suggestedExpenses,
    unitPrice,
    setUnitPrice,
    preview,
    comparison: [] as const,
    identified,
    saving,
    saveMessage,
    saveScenario,
  }
}
