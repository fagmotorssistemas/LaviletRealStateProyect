'use client'

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
import { cn } from '@/lib/utils'

export function MisEscenariosView({ embedded = false }: { embedded?: boolean }) {
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
          <h1 className="font-serif text-3xl text-[#1f1a14]">Cálculos guardados</h1>
        ) : (
          <h2 className="font-serif text-2xl text-[#1f1a14]">Cálculos guardados</h2>
        )}
        <p className="text-sm text-[#6b645c]">
          Deje su celular en el showroom para guardar y recuperar sus simulaciones.
        </p>
        <Link
          href="/tour"
          className="inline-flex h-11 items-center justify-center rounded-full bg-[#1a2744] px-5 text-[11px] font-semibold tracking-[0.14em] text-white uppercase no-underline"
        >
          Ir al showroom
        </Link>
      </div>
    )
  }

  return (
    <div className={cn('space-y-4', !embedded && 'mx-auto max-w-5xl')}>
      {!embedded ? (
        <header className="space-y-1">
          <h1 className="font-serif text-3xl text-[#1f1a14]">Cálculos guardados</h1>
          <p className="text-sm text-[#6b645c]">Simulaciones asociadas a su celular.</p>
        </header>
      ) : null}

      {error ? <p className="text-sm text-rose-700">{error}</p> : null}

      {scenarios.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#d9d0c3] px-4 py-8 text-center text-sm text-[#6b645c]">
          Aún no tiene cálculos guardados. Elija un departamento y guarde la simulación.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-[#ece6dc] bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-[#f7f3ee] text-left text-[10px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
              <tr>
                <th className="px-3 py-2.5">Depto.</th>
                <th className="px-3 py-2.5">Alquiler</th>
                <th className="px-3 py-2.5">Saldo / año</th>
                <th className="px-3 py-2.5">Retorno</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {scenarios.map((row) => (
                <tr key={row.id} className="border-t border-[#f0ebe3]">
                  <td className="px-3 py-2.5">{row.units?.unit_number ?? '—'}</td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {formatMoney(row.estimated_monthly_rent)}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">
                    {formatMoney(row.annual_net_cash_flow)}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">{formatPercent(row.roi_percent)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      type="button"
                      onClick={() => void removeScenario(row.id)}
                      className="text-[11px] font-semibold tracking-wide text-rose-700 uppercase"
                    >
                      Eliminar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
