'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { Megaphone, RefreshCw } from 'lucide-react'
import { fetchMetaCapiBitacora } from '@/app/inmobiliaria/marketing/capi/actions'
import { PageHeader } from '@/components/inmobiliaria/shared/PageHeader'
import { EmptyState } from '@/components/inmobiliaria/shared/EmptyState'
import { Spinner } from '@/components/ui/Spinner'
import { cn } from '@/lib/utils'
import type {
  MetaCapiOutboxKpis,
  MetaCapiOutboxRow,
  MetaCapiStatusFilter,
} from '@/services/metaCapiOutbox.service'

function formatWhen(iso: string) {
  try {
    return new Intl.DateTimeFormat('es-EC', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string
  value: string | number
  tone?: 'good' | 'bad' | 'muted'
}) {
  return (
    <div className="rounded-2xl border border-[#ece6dc] bg-white px-4 py-3 shadow-[0_8px_24px_rgba(40,30,20,0.04)]">
      <p className="text-[10px] font-semibold tracking-[0.16em] text-[#8a8176] uppercase">{label}</p>
      <p
        className={cn(
          'mt-1 text-2xl font-semibold tabular-nums text-[#1f1a14]',
          tone === 'good' && 'text-emerald-700',
          tone === 'bad' && 'text-rose-700',
          tone === 'muted' && 'text-[#6b645c]',
        )}
      >
        {value}
      </p>
    </div>
  )
}

export function MetaCapiBitacoraView() {
  const [filter, setFilter] = useState<MetaCapiStatusFilter>('all')
  const [kpis, setKpis] = useState<MetaCapiOutboxKpis | null>(null)
  const [rows, setRows] = useState<MetaCapiOutboxRow[]>([])
  const [totalFiltered, setTotalFiltered] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const load = useCallback((nextFilter: MetaCapiStatusFilter = filter) => {
    startTransition(async () => {
      const result = await fetchMetaCapiBitacora({ filter: nextFilter, hours: 24 })
      if (!result.ok) {
        setError(result.error)
        setKpis(null)
        setRows([])
        setTotalFiltered(0)
        return
      }
      setError(null)
      setKpis(result.data.kpis)
      setRows(result.data.rows)
      setTotalFiltered(result.data.totalFiltered)
      setFetchedAt(result.data.fetchedAt)
    })
  }, [filter])

  useEffect(() => {
    load('all')
    // Solo al montar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onFilter = (value: MetaCapiStatusFilter) => {
    setFilter(value)
    load(value)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="CAPI Meta"
        eyebrow="Marketing"
        description="Conversiones encoladas y enviadas a Meta (últimas 24 h). Atribución Click-to-WhatsApp cuando hay ctwa_clid."
        actions={
          <button
            type="button"
            onClick={() => load(filter)}
            disabled={pending}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-[#d9d0c3] bg-white px-4 text-[11px] font-semibold tracking-[0.12em] text-[#1f1a14] uppercase disabled:opacity-50"
          >
            <RefreshCw size={14} className={pending ? 'animate-spin' : undefined} />
            Actualizar
          </button>
        }
      />

      {kpis ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <KpiCard label={`Total eventos (${kpis.windowHours}h)`} value={kpis.total} />
          <KpiCard label="Enviados" value={kpis.sent} tone="good" />
          <KpiCard label="Fallidos" value={kpis.failed} tone={kpis.failed > 0 ? 'bad' : 'muted'} />
          <KpiCard
            label="% error"
            value={`${kpis.errorPct}%`}
            tone={kpis.errorPct > 0 ? 'bad' : 'good'}
          />
        </div>
      ) : pending ? (
        <div className="flex items-center gap-2 py-6 text-sm text-[#8a8176]">
          <Spinner /> Cargando indicadores…
        </div>
      ) : null}

      {fetchedAt && !error ? (
        <p className="text-[11px] text-[#8a8176]">
          Actualizado {formatWhen(fetchedAt)}
          {kpis && kpis.pending > 0 ? ` · ${kpis.pending} pendientes en cola` : ''}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-full border border-[#ece6dc] bg-[#f7f3ee] p-1">
          {(
            [
              ['all', 'Todos'],
              ['sent', 'Enviados'],
              ['failed', 'Fallidos'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => onFilter(value)}
              className={cn(
                'rounded-full px-3.5 py-1.5 text-[11px] font-semibold tracking-[0.1em] uppercase transition-colors',
                filter === value
                  ? 'bg-[#1a2744] text-white'
                  : 'text-[#6b645c] hover:text-[#1f1a14]',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="text-[11px] tabular-nums text-[#8a8176]">{totalFiltered} registros</p>
      </div>

      <section className="overflow-hidden rounded-2xl border border-[#ece6dc] bg-white">
        {pending && rows.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-[#8a8176]">
            <Spinner /> Cargando eventos…
          </div>
        ) : error ? (
          <div className="p-6">
            <EmptyState
              icon={Megaphone}
              title="No se pudo cargar CAPI"
              description={error}
            >
              <button
                type="button"
                onClick={() => load(filter)}
                className="inline-flex h-10 items-center rounded-full border border-[#d9d0c3] bg-white px-4 text-[11px] font-semibold tracking-[0.12em] uppercase"
              >
                Reintentar
              </button>
            </EmptyState>
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={Megaphone}
              title="Sin eventos en esta ventana"
              description="No hay filas en meta_capi_outbox para el filtro y las últimas 24 horas."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead>
                <tr className="border-b border-[#ece6dc] bg-[#f7f3ee] text-[10px] font-semibold tracking-[0.14em] text-[#8a8176] uppercase">
                  <th className="px-4 py-3">Teléfono</th>
                  <th className="px-4 py-3">Fecha</th>
                  <th className="px-4 py-3">Evento</th>
                  <th className="px-4 py-3">Estado</th>
                  <th className="px-4 py-3">Detalle</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-t border-[#f0ebe3]">
                    <td className="px-4 py-3 font-medium tabular-nums text-[#1f1a14]">
                      {row.phone || '—'}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-[#6b645c]">{formatWhen(row.createdAt)}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-md bg-[#1a2744]/8 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-[#1a2744]">
                        {row.eventName}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={cn(
                          'inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.1em] uppercase',
                          row.uiBucket === 'sent' && 'bg-emerald-100 text-emerald-800',
                          row.uiBucket === 'failed' && 'bg-rose-100 text-rose-800',
                          row.uiBucket === 'other' && 'bg-amber-100 text-amber-900',
                        )}
                      >
                        {row.statusLabel}
                      </span>
                    </td>
                    <td className="max-w-[220px] truncate px-4 py-3 font-mono text-[11px] text-[#8a8176]" title={row.detail}>
                      {row.detail}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
