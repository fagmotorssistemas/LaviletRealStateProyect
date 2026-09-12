'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useRoleAccess } from '@/hooks/useRoleAccess'
import type { FinancingCalculationLog } from '@/types/financingSimulator'
import { Spinner } from '@/components/ui/Spinner'
import { PageHeader } from '@/components/inmobiliaria/shared/PageHeader'

export function FinancingAuditLogView({ embedded = false }: { embedded?: boolean }) {
  const { supabase } = useAuth()
  const { isAdmin, isLoading: roleLoading } = useRoleAccess()
  const router = useRouter()
  const [rows, setRows] = useState<FinancingCalculationLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!embedded && !roleLoading && !isAdmin) router.replace('/inmobiliaria/financiamiento')
  }, [embedded, isAdmin, roleLoading, router])

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supabase
      .from('financing_calculations_log')
      .select('*')
      .order('calculated_at', { ascending: false })
      .limit(100)
    setRows((data ?? []) as FinancingCalculationLog[])
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    if (isAdmin) void load()
  }, [isAdmin, load])

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
          title="Simulador · Auditoría"
          description="Historial de cálculos generados por calculate_investment_analysis."
        />
      ) : null}
      <div className="overflow-x-auto rounded-2xl border border-[#ece6dc] bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-[#f7f3ee] text-left text-[10px] font-semibold tracking-[0.12em] text-[#6b645c] uppercase">
            <tr>
              <th className="px-3 py-2.5">Fecha</th>
              <th className="px-3 py-2.5">Scenario</th>
              <th className="px-3 py-2.5">Input</th>
              <th className="px-3 py-2.5">Output</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-[#f0ebe3] align-top">
                <td className="px-3 py-2.5 text-[#6b645c]">
                  {row.calculated_at ? new Date(row.calculated_at).toLocaleString('es-EC') : '—'}
                </td>
                <td className="px-3 py-2.5 font-mono text-xs">{row.scenario_id ?? '—'}</td>
                <td className="px-3 py-2.5 font-mono text-[11px] text-[#4a433c]">
                  {JSON.stringify(row.input_json ?? {})}
                </td>
                <td className="px-3 py-2.5 font-mono text-[11px] text-[#4a433c]">
                  {JSON.stringify(row.output_json ?? {})}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
