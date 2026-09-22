'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useRoleAccess } from '@/hooks/useRoleAccess'
import type { FinancingCalculationLog } from '@/types/financingSimulator'
import { Spinner } from '@/components/ui/Spinner'
import { PageHeader } from '@/components/inmobiliaria/shared/PageHeader'

function JsonCell({ value }: { value: unknown }) {
  const text = JSON.stringify(value ?? {})
  return (
    <td className="max-w-[220px] px-3 py-2.5 sm:max-w-[320px] lg:max-w-[420px]">
      <pre className="max-h-28 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-snug text-[#4a433c]">
        {text}
      </pre>
    </td>
  )
}

export function FinancingAuditLogView({
  embedded = false,
  logs: logsProp,
}: {
  embedded?: boolean
  logs?: FinancingCalculationLog[]
}) {
  const { isAdmin, isLoading: roleLoading } = useRoleAccess()
  const router = useRouter()
  const [rows, setRows] = useState<FinancingCalculationLog[]>(logsProp ?? [])
  const [loading, setLoading] = useState(logsProp == null)

  useEffect(() => {
    if (!embedded && !roleLoading && !isAdmin) router.replace('/inmobiliaria/financiamiento')
  }, [embedded, isAdmin, roleLoading, router])

  useEffect(() => {
    if (logsProp != null) {
      setRows(logsProp)
      setLoading(false)
    }
  }, [logsProp])

  const load = useCallback(async () => {
    if (logsProp != null) return
    setLoading(true)
    try {
      const res = await fetch('/api/financing/admin/overview', { credentials: 'same-origin' })
      const json = (await res.json()) as {
        logs?: FinancingCalculationLog[]
        error?: string
      }
      if (!res.ok) throw new Error(json.error || 'No se pudo cargar la auditoría')
      setRows(json.logs ?? [])
    } catch (error) {
      console.error(error)
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [logsProp])

  useEffect(() => {
    if (isAdmin && logsProp == null) void load()
  }, [isAdmin, load, logsProp])

  if (roleLoading || !isAdmin || loading) {
    return (
      <div className={`flex items-center justify-center ${embedded ? 'min-h-[12vh]' : 'min-h-[40vh]'}`}>
        <Spinner size="lg" />
      </div>
    )
  }

  const table = (
    <div className="-mx-3 overflow-x-auto sm:mx-0">
      <table className="min-w-[720px] w-full text-sm sm:min-w-full">
        <thead className="bg-[#f7f3ee] text-left text-[10px] font-semibold tracking-[0.12em] text-[#6b645c] uppercase">
          <tr>
            <th className="px-3 py-2.5">Fecha</th>
            <th className="px-3 py-2.5">Scenario</th>
            <th className="px-3 py-2.5">Input</th>
            <th className="px-3 py-2.5">Output</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-3 py-6 text-sm text-[#6b645c]">
                Todavía no hay registros de auditoría.
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={row.id} className="border-t border-[#f0ebe3] align-top">
                <td className="whitespace-nowrap px-3 py-2.5 text-[#6b645c]">
                  {row.calculated_at ? new Date(row.calculated_at).toLocaleString('es-EC') : '—'}
                </td>
                <td className="max-w-[120px] truncate px-3 py-2.5 font-mono text-xs">
                  {row.scenario_id ?? '—'}
                </td>
                <JsonCell value={row.input_json} />
                <JsonCell value={row.output_json} />
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )

  if (embedded) {
    return (
      <section className="flex min-w-0 flex-col overflow-hidden rounded-2xl border border-[#ece6dc] bg-white">
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[#ece6dc] bg-[#f7f3ee]/70 px-3 py-2.5 sm:px-4">
          <h2 className="text-[11px] font-semibold tracking-[0.14em] text-[#6b645c] uppercase">
            Auditoría
          </h2>
        </header>
        <div className="min-w-0 p-3 sm:p-4">{table}</div>
      </section>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Simulador · Auditoría"
        description="Historial de cálculos generados por calculate_investment_analysis."
      />
      <div className="overflow-hidden rounded-2xl border border-[#ece6dc] bg-white p-3 sm:p-4">
        {table}
      </div>
    </div>
  )
}
