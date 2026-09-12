'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useRoleAccess } from '@/hooks/useRoleAccess'
import type { FinancingScenario } from '@/types/financingSimulator'
import { formatMoney, formatPercent } from '@/lib/financing/calculator'
import { Spinner } from '@/components/ui/Spinner'
import { PageHeader } from '@/components/inmobiliaria/shared/PageHeader'

export function FinancingAnalyticsView({ embedded = false }: { embedded?: boolean }) {
  const { supabase } = useAuth()
  const { isAdmin, isLoading: roleLoading } = useRoleAccess()
  const router = useRouter()
  const [rows, setRows] = useState<FinancingScenario[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!embedded && !roleLoading && !isAdmin) router.replace('/inmobiliaria/financiamiento')
  }, [embedded, isAdmin, roleLoading, router])

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('financing_scenarios')
      .select(
        '*, financing_partners(partner_name, annual_interest_rate), units(unit_number), leads(phone, name)',
      )
      .order('created_at', { ascending: false })
      .limit(50)
    setRows((data ?? []) as FinancingScenario[])
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    if (isAdmin) void load()
  }, [isAdmin, load])

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

  if (roleLoading || !isAdmin || loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <Spinner size="lg" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {!embedded ? (
        <PageHeader
          title="Simulador · Analytics"
          description="Últimos escenarios guardados por todos los leads."
          actions={
            <button
              type="button"
              onClick={downloadCsv}
              className="inline-flex h-10 items-center rounded-full bg-[#1a2744] px-4 text-[11px] font-semibold tracking-[0.14em] text-white uppercase"
            >
              Descargar CSV
            </button>
          }
        />
      ) : (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={downloadCsv}
            className="inline-flex h-10 items-center rounded-full bg-[#1a2744] px-4 text-[11px] font-semibold tracking-[0.14em] text-white uppercase"
          >
            Descargar CSV
          </button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        {byBank.map(([name, count]) => (
          <div key={name} className="rounded-2xl border border-[#ece6dc] bg-white px-4 py-3">
            <p className="text-[10px] font-semibold tracking-[0.14em] text-[#8a8176] uppercase">{name}</p>
            <p className="mt-1 text-2xl font-semibold text-[#1f1a14]">{count}</p>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[#ece6dc] bg-white">
        <table className="min-w-full text-sm">
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
                <td className="px-3 py-2.5 text-[#6b645c]">
                  {row.created_at ? new Date(row.created_at).toLocaleString('es-EC') : '—'}
                </td>
                <td className="px-3 py-2.5">{row.leads?.phone ?? row.leads?.name ?? '—'}</td>
                <td className="px-3 py-2.5">{row.units?.unit_number ?? '—'}</td>
                <td className="px-3 py-2.5">{row.financing_partners?.partner_name ?? '—'}</td>
                <td className="px-3 py-2.5 tabular-nums">{formatMoney(row.monthly_payment)}</td>
                <td className="px-3 py-2.5 tabular-nums">{formatPercent(row.roi_percent)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
