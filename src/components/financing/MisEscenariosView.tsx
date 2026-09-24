'use client'

import { useTourLanguage } from '@/lib/tour/tourLocale'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { FinancingScenario } from '@/types/financingSimulator'
import { formatMoney, formatPercent } from '@/lib/financing/calculator'
import {
  getShowroomLeadId,
  getShowroomPhone,
  isShowroomIdentified,
} from '@/lib/tour/showroomIdentity'
import { Spinner } from '@/components/ui/Spinner'
import { assessScenarioFidelity } from '@/lib/financing/scenarioFidelity'
import { cn } from '@/lib/utils'

export function MisEscenariosView({
  embedded = false,
  onReopen,
}: {
  embedded?: boolean
  onReopen?: (scenario: FinancingScenario) => void
}) {
  const { t } = useTourLanguage()

  const [loading, setLoading] = useState(true)
  const [scenarios, setScenarios] = useState<FinancingScenario[]>([])
  const [identified, setIdentified] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const phone = getShowroomPhone()
      const leadId = getShowroomLeadId()
      const qs = new URLSearchParams()
      if (phone) qs.set('phone', phone)
      if (leadId) qs.set('lead_id', leadId)
      const response = await fetch(`/api/financing/scenarios?${qs.toString()}`)
      const json = (await response.json()) as {
        scenarios?: FinancingScenario[]
        identified?: boolean
        error?: string
      }
      if (!response.ok) throw new Error(json.error || 'No se pudieron cargar')
      setScenarios(json.scenarios ?? [])
      setIdentified(Boolean(json.identified || isShowroomIdentified()))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  async function removeScenario(id: string) {
    const phone = getShowroomPhone()
    const leadId = getShowroomLeadId()
    const qs = new URLSearchParams({ id })
    if (phone) qs.set('phone', phone)
    if (leadId) qs.set('lead_id', leadId)
    const response = await fetch(`/api/financing/scenarios?${qs.toString()}`, { method: 'DELETE' })
    if (response.ok) void load()
  }

  if (loading) {
    return (
      <div className="flex min-h-[30vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  if (!identified) {
    return (
      <div className="mx-auto max-w-xl space-y-4 rounded-3xl border border-[#ece6dc] bg-white p-6 text-center">
        {!embedded ? (
          <h1 className="font-serif text-3xl text-[#1f1a14]">{t("Cálculos guardados")}</h1>
        ) : (
          <h2 className="font-serif text-2xl text-[#1f1a14]">{t("Cálculos guardados")}</h2>
        )}
        <p className="text-sm text-[#6b645c]">
          {t(" Deje su celular en el showroom para guardar y recuperar sus simulaciones. ")}</p>
        <Link
          href="/tour"
          className="inline-flex h-11 items-center justify-center rounded-full bg-[#1a2744] px-5 text-[11px] font-semibold tracking-[0.14em] text-white uppercase no-underline"
        >
          {t(" Ir al showroom ")}</Link>
      </div>
    )
  }

  return (
    <div className={cn('space-y-4', !embedded && 'mx-auto max-w-5xl')}>
      {!embedded ? (
        <header className="space-y-1">
          <h1 className="font-serif text-3xl text-[#1f1a14]">{t("Cálculos guardados")}</h1>
          <p className="text-sm text-[#6b645c]">{t("Simulaciones asociadas a su celular.")}</p>
        </header>
      ) : null}

      {error ? <p className="text-sm text-rose-700">{t(error)}</p> : null}

      {scenarios.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#d9d0c3] px-4 py-8 text-center text-sm text-[#6b645c]">
          {t(" Aún no tiene cálculos guardados. Elija un departamento y guarde la simulación. ")}</div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[#ece6dc] bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-[#f7f3ee] text-left text-[10px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
              <tr>
                <th className="px-3 py-2.5">{t("Depto.")}</th>
                <th className="px-3 py-2.5">{t("Alquiler")}</th>
                <th className="px-3 py-2.5">{t("Flujo / año")}</th>
                <th className="px-3 py-2.5">{t("Retorno de caja")}</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {scenarios.map((row) => {
                const fidelity = assessScenarioFidelity(row)
                return (
                <tr key={row.id} className="border-t border-[#f0ebe3]">
                  <td className="px-3 py-2.5">
                    <span>{t(row.units?.unit_number ?? '—')}</span>
                    {fidelity.kind !== 'exact' ? (
                      <span className="mt-0.5 block text-[10px] text-amber-800">
                        {t(fidelity.kind === 'legacy' ? 'Histórico' : 'Versión desconocida')}
                      </span>
                    ) : null}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {t(formatMoney(row.estimated_monthly_rent))}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {t(formatMoney(row.annual_net_cash_flow))}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">{t(formatPercent(row.roi_percent))}</td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex justify-end gap-3">
                      {onReopen ? (
                        <button
                          type="button"
                          onClick={() => onReopen(row)}
                          className="text-[11px] font-semibold tracking-wide text-[#1a2744] uppercase"
                        >
                          {t(" Reabrir ")}</button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void removeScenario(row.id)}
                        className="text-[11px] font-semibold tracking-wide text-rose-700 uppercase"
                      >
                        {t(" Eliminar ")}</button>
                    </div>
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
