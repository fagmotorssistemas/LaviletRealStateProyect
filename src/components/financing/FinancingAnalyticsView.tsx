'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRoleAccess } from '@/hooks/useRoleAccess'
import type { FinancingScenario } from '@/types/financingSimulator'
import { formatMoney, formatPercent } from '@/lib/financing/calculator'
import { Spinner } from '@/components/ui/Spinner'
import { PageHeader } from '@/components/inmobiliaria/shared/PageHeader'

export function FinancingAnalyticsView({
  embedded = false,
  scenarios: scenariosProp,
}: {
  embedded?: boolean
  /** Si viene del panel unificado, no vuelve a pedir al API. */
  scenarios?: FinancingScenario[]
}) {
  const { isAdmin, isLoading: roleLoading } = useRoleAccess()
  const router = useRouter()
  const [rows, setRows] = useState<FinancingScenario[]>(scenariosProp ?? [])
  const [loading, setLoading] = useState(scenariosProp == null)

  useEffect(() => {
    if (!embedded && !roleLoading && !isAdmin) router.replace('/inmobiliaria/financiamiento')
  }, [embedded, isAdmin, roleLoading, router])

  useEffect(() => {
    if (scenariosProp != null) {
      setRows(scenariosProp)
      setLoading(false)
    }
  }, [scenariosProp])

  const load = useCallback(async () => {
    if (scenariosProp != null) return
    setLoading(true)
    try {
      const res = await fetch('/api/financing/admin/overview', { credentials: 'same-origin' })
      const json = (await res.json()) as {
        scenarios?: FinancingScenario[]
        error?: string
      }
      if (!res.ok) throw new Error(json.error || 'No se pudieron cargar los escenarios')
      setRows(json.scenarios ?? [])
    } catch (error) {
      console.error(error)
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [scenariosProp])

  useEffect(() => {
    if (isAdmin && scenariosProp == null) void load()
  }, [isAdmin, load, scenariosProp])

  const byBank = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of rows) {
      const name = row.financing_partners?.partner_name ?? 'Sin banco'
      map.set(name, (map.get(name) ?? 0) + 1)
    }
    return [...map.entries()]
  }, [rows])

  function downloadCsv() {
    const header = ['fecha', 'unidad', 'banco', 'tasa', 'cuota', 'roi', 'lead']
    const lines = rows.map((row) =>
      [
        row.created_at ?? '',
        row.units?.unit_number ?? '',
        row.financing_partners?.partner_name ?? '',
        row.applied_interest_rate ?? '',
        row.monthly_payment ?? '',
        row.roi_percent ?? '',
        row.leads?.phone ?? '',
      ]
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(','),
    )
    const blob = new Blob([[header.join(','), ...lines].join('\n')], {
      type: 'text/csv;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'financing-scenarios.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  const csvButton = (
    <button
      type="button"
      onClick={downloadCsv}
      className="inline-flex h-9 items-center rounded-full bg-[#1a2744] px-3 text-[10px] font-semibold tracking-[0.14em] text-white uppercase sm:h-10 sm:px-4 sm:text-[11px]"
    >
      Descargar CSV
    </button>
  )

  if (roleLoading || !isAdmin || loading) {
    return (
      <div className={`flex items-center justify-center ${embedded ? 'min-h-[12vh]' : 'min-h-[40vh]'}`}>
        <Spinner size="lg" />
      </div>
    )
  }

  const body = (
    <div className="space-y-4">
      {byBank.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {byBank.map(([name, count]) => (
            <div key={name} className="rounded-xl border border-[#ece6dc] bg-[#faf7f2] px-4 py-3">
              <p className="truncate text-[10px] font-semibold tracking-[0.14em] text-[#8a8176] uppercase">
                {name}
              </p>
              <p className="mt-1 text-2xl font-semibold text-[#1f1a14]">{count}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-[#6b645c]">Todavía no hay escenarios guardados.</p>
      )}

      <div className="-mx-3 overflow-x-auto sm:mx-0">
        <table className="min-w-[640px] w-full text-sm sm:min-w-full">
          <thead className="bg-[#f7f3ee] text-left text-[10px] font-semibold tracking-[0.12em] text-[#6b645c] uppercase">
            <tr>
              <th className="px-3 py-2.5">Fecha</th>
              <th className="px-3 py-2.5">Lead</th>
              <th className="px-3 py-2.5">Unidad</th>
              <th className="px-3 py-2.5">Banco</th>
              <th className="px-3 py-2.5">Cuota</th>
              <th className="px-3 py-2.5">ROI</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-[#f0ebe3]">
                <td className="whitespace-nowrap px-3 py-2.5 text-[#6b645c]">
                  {row.created_at ? new Date(row.created_at).toLocaleString('es-EC') : '—'}
                </td>
                <td className="max-w-[140px] truncate px-3 py-2.5">
                  {row.leads?.phone ?? row.leads?.name ?? '—'}
                </td>
                <td className="px-3 py-2.5">{row.units?.unit_number ?? '—'}</td>
                <td className="max-w-[140px] truncate px-3 py-2.5">
                  {row.financing_partners?.partner_name ?? '—'}
                </td>
                <td className="px-3 py-2.5 tabular-nums">{formatMoney(row.monthly_payment)}</td>
                <td className="px-3 py-2.5 tabular-nums">{formatPercent(row.roi_percent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )

  if (embedded) {
    return (
      <section className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[#ece6dc] bg-white">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#ece6dc] bg-[#f7f3ee]/70 px-3 py-2.5 sm:px-4">
          <h2 className="text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
            Analytics
          </h2>
          {csvButton}
        </header>
        <div className="min-w-0 p-3 sm:p-4">{body}</div>
      </section>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Simulador · Analytics"
        description="Últimos escenarios guardados por todos los leads."
        actions={csvButton}
      />
      {body}
    </div>
  )
}
