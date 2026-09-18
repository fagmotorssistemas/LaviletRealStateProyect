'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { Check, Megaphone, RefreshCw, X } from 'lucide-react'
import { fetchMetaCapiBitacora } from '@/app/inmobiliaria/marketing/capi/actions'
import { PageHeader } from '@/components/inmobiliaria/shared/PageHeader'
import { EmptyState } from '@/components/inmobiliaria/shared/EmptyState'
import { Spinner } from '@/components/ui/Spinner'
import { Pagination } from '@/components/ui/Pagination'
import { cn } from '@/lib/utils'
import type {
  MetaCapiListFilters,
  MetaCapiOutboxResult,
  MetaCapiOutboxRow,
  MetaCapiStatusBucket,
} from '@/services/metaCapiOutbox.service'

type SimpleTab = 'all' | 'sent' | 'failed'

function formatWhen(iso: string | null | undefined, timeZone: string) {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('es-EC', {
      day: 'numeric',
      month: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
      timeZone,
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

function statusForRow(row: MetaCapiOutboxRow): 'sent' | 'failed' | 'other' {
  if (row.statusBucket === 'delivered_backend') return 'sent'
  if (row.statusBucket === 'failed') return 'failed'
  return 'other'
}

function tabToBucket(tab: SimpleTab): MetaCapiStatusBucket {
  if (tab === 'sent') return 'delivered_backend'
  if (tab === 'failed') return 'failed'
  return 'all'
}

export function MetaCapiBitacoraView() {
  const [tab, setTab] = useState<SimpleTab>('all')
  const [filters, setFilters] = useState<MetaCapiListFilters>({
    statusBucket: 'all',
    lane: 'all',
    page: 1,
    pageSize: 50,
  })
  const [data, setData] = useState<MetaCapiOutboxResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const load = useCallback((next: MetaCapiListFilters) => {
    startTransition(async () => {
      const result = await fetchMetaCapiBitacora(next)
      if (!result.ok) {
        setError(result.error)
        setData(null)
        return
      }
      setError(null)
      setData(result.data)
    })
  }, [])

  useEffect(() => {
    load(filters)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const applyTab = (nextTab: SimpleTab) => {
    setTab(nextTab)
    const next: MetaCapiListFilters = {
      ...filters,
      statusBucket: tabToBucket(nextTab),
      page: 1,
    }
    setFilters(next)
    load(next)
  }

  const refresh = () => {
    const next: MetaCapiListFilters = { ...filters, page: 1 }
    setFilters(next)
    load(next)
  }

  const rows: MetaCapiOutboxRow[] = data?.rows ?? []
  const tz = data?.timezone ?? 'America/Guayaquil'
  const kpis = data?.kpis

  const summary = useMemo(() => {
    const total = kpis?.total ?? 0
    const sent = kpis?.deliveredBackend ?? 0
    const failed = kpis?.failed ?? 0
    const errorPct = total > 0 ? Math.round((failed / total) * 1000) / 10 : 0
    return { total, sent, failed, errorPct }
  }, [kpis])

  return (
    <div className="space-y-6">
      <PageHeader
        title="CAPI Meta — Bitácora de eventos"
        eyebrow="Marketing"
        description="Rastreo web → Recorrido 360° → leads → cola CAPI. El teléfono aparece cuando el visitante se identificó (mismo visitor_key del tour)."
        actions={
          <button
            type="button"
            onClick={refresh}
            disabled={pending}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-[#d9d0c3] bg-white px-4 text-[11px] font-semibold tracking-[0.12em] text-[#1f1a14] uppercase disabled:opacity-50"
          >
            <RefreshCw size={14} className={pending ? 'animate-spin' : undefined} />
            Actualizar
          </button>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total eventos" value={summary.total} />
        <KpiCard label="Enviados" value={summary.sent} tone="good" />
        <KpiCard label="Fallidos" value={summary.failed} tone={summary.failed > 0 ? 'bad' : 'muted'} />
        <KpiCard
          label="% error"
          value={`${summary.errorPct}%`}
          tone={summary.failed > 0 ? 'bad' : 'good'}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {(
          [
            { id: 'all' as const, label: 'Todas' },
            { id: 'sent' as const, label: 'Enviados' },
            { id: 'failed' as const, label: 'Fallidos' },
          ] as const
        ).map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => applyTab(opt.id)}
            className={cn(
              'rounded-full px-4 py-1.5 text-[11px] font-semibold tracking-[0.12em] uppercase',
              tab === opt.id
                ? 'bg-[#1a2744] text-white'
                : 'border border-[#d9d0c3] bg-white text-[#4a433c]',
            )}
          >
            {opt.label}
          </button>
        ))}
        <p className="ml-auto text-[11px] tabular-nums text-[#8a8176]">
          {data ? `${data.totalFiltered} registros` : null}
        </p>
      </div>

      <section className="overflow-hidden rounded-2xl border border-[#ece6dc] bg-white">
        {pending && rows.length === 0 ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-[#8a8176]">
            <Spinner /> Cargando eventos…
          </div>
        ) : error ? (
          <div className="p-6">
            <EmptyState icon={Megaphone} title="No se pudo cargar CAPI" description={error}>
              <button
                type="button"
                onClick={refresh}
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
              title="Sin eventos"
              description="No hay filas en la cola CAPI para este alcance."
            />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-left text-sm">
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
                  {rows.map((row) => {
                    const kind = statusForRow(row)
                    return (
                      <tr key={row.id} className="border-t border-[#f0ebe3]">
                        <td className="px-4 py-3 text-[#1f1a14]">
                          {row.phoneSource === 'none' ? (
                            <span className="text-[#8a8176]" title={row.phoneSourceLabel}>
                              Sin teléfono
                            </span>
                          ) : (
                            <span className="tabular-nums" title={row.phoneSourceLabel}>
                              {row.phoneDisplay}
                            </span>
                          )}
                          {row.connectedLead && row.leadId ? (
                            <span className="mt-0.5 flex flex-wrap gap-x-2 text-[10px]">
                              <a
                                href={`/inmobiliaria/leads`}
                                className="text-[#5b4a9a] underline-offset-2 hover:underline"
                                title={`Lead ${row.leadId}`}
                              >
                                Lead
                              </a>
                              <a
                                href="/inmobiliaria/recorrido"
                                className="text-[#5b4a9a] underline-offset-2 hover:underline"
                              >
                                Recorrido 360°
                              </a>
                            </span>
                          ) : row.visitorKey ? (
                            <span className="mt-0.5 block text-[10px] text-[#8a8176]">
                              Visitante 360 anónimo
                            </span>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 tabular-nums text-[#6b645c]">
                          {formatWhen(row.eventAt || row.registeredAt, tz)}
                        </td>
                        <td className="px-4 py-3 font-medium text-[#5b4a9a]">{row.eventName}</td>
                        <td className="px-4 py-3">
                          {kind === 'sent' ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-emerald-800 uppercase">
                              <Check size={12} /> Enviado
                            </span>
                          ) : kind === 'failed' ? (
                            <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-rose-800 uppercase">
                              <X size={12} /> Fallido
                            </span>
                          ) : (
                            <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-amber-900 uppercase">
                              {row.statusLabel}
                            </span>
                          )}
                        </td>
                        <td
                          className="max-w-[280px] truncate px-4 py-3 font-mono text-[11px] text-[#8a8176]"
                          title={row.detail}
                        >
                          {row.detail}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {data ? (
              <div className="border-t border-[#ece6dc] px-4 py-3">
                <Pagination
                  page={data.page}
                  pageSize={data.pageSize}
                  total={data.totalFiltered}
                  onPageChange={(page) => {
                    const next = { ...filters, page }
                    setFilters(next)
                    load(next)
                  }}
                />
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  )
}
