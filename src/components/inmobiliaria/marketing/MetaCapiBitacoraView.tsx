'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { AlertTriangle, Check, Megaphone, RefreshCw, X } from 'lucide-react'
import { fetchMetaCapiBitacora } from '@/app/inmobiliaria/marketing/capi/actions'
import { PageHeader } from '@/components/inmobiliaria/shared/PageHeader'
import { EmptyState } from '@/components/inmobiliaria/shared/EmptyState'
import { Spinner } from '@/components/ui/Spinner'
import { Pagination } from '@/components/ui/Pagination'
import { MetaCapiWhatsAppSection } from '@/components/inmobiliaria/marketing/MetaCapiWhatsAppSection'
import { cn } from '@/lib/utils'
import type {
  MetaCapiListFilters,
  MetaCapiOutboxResult,
  MetaCapiOutboxRow,
  MetaCapiStatusBucket,
} from '@/services/metaCapiOutbox.service'

function formatWhen(iso: string | null | undefined, timeZone: string) {
  if (!iso) return '—'
  try {
    return new Intl.DateTimeFormat('es-EC', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
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
  tone?: 'good' | 'bad' | 'muted' | 'warn'
}) {
  return (
    <div className="min-w-0 rounded-xl border border-[#ece6dc] bg-white px-2.5 py-2 sm:px-3 sm:py-2">
      <p className="text-[9px] font-semibold leading-tight tracking-[0.12em] text-[#8a8176] uppercase sm:text-[10px]">
        {label}
      </p>
      <p
        className={cn(
          'mt-0.5 text-lg font-semibold tabular-nums leading-none text-[#1f1a14] sm:text-xl',
          tone === 'good' && 'text-emerald-700',
          tone === 'bad' && 'text-rose-700',
          tone === 'warn' && 'text-amber-800',
          tone === 'muted' && 'text-[#6b645c]',
        )}
      >
        {value}
      </p>
    </div>
  )
}

function EventRowCard({ row, tz }: { row: MetaCapiOutboxRow; tz: string }) {
  return (
    <article className="space-y-2.5 border-b border-[#f0ebe3] px-3 py-3.5 last:border-b-0 sm:px-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-[#5b4a9a]">{row.eventName}</p>
          <p
            className={cn(
              'mt-0.5 text-sm',
              row.phoneSource === 'none' ? 'text-[#8a8176]' : 'tabular-nums text-[#1f1a14]',
            )}
            title={row.phoneSourceLabel}
          >
            {row.phoneDisplay}
          </p>
          <p className="text-[10px] text-[#8a8176]">{row.phoneSourceLabel}</p>
        </div>
        <StatusBadge row={row} />
      </div>
      <dl className="grid grid-cols-1 gap-1.5 text-[11px] text-[#6b645c] sm:grid-cols-2">
        <div>
          <dt className="text-[#8a8176]">Evento</dt>
          <dd>{formatWhen(row.eventAt, tz)}</dd>
        </div>
        <div>
          <dt className="text-[#8a8176]">Registro</dt>
          <dd>{formatWhen(row.registeredAt, tz)}</dd>
        </div>
        <div>
          <dt className="text-[#8a8176]">Entrega</dt>
          <dd>{formatWhen(row.forwardedAt, tz)}</dd>
        </div>
        <div>
          <dt className="text-[#8a8176]">Canal</dt>
          <dd>
            {row.channelLabel} · lane {row.deliveryLane}
          </dd>
        </div>
      </dl>
      <p className="text-[11px] leading-snug text-[#6b645c]">{row.receptionLabel}</p>
      {row.detail ? (
        <p className="break-all font-mono text-[10px] leading-snug text-[#8a8176]">{row.detail}</p>
      ) : null}
      {row.ctwaNote ? (
        <p className="text-[10px] text-amber-800">{row.ctwaNote}</p>
      ) : null}
    </article>
  )
}

function StatusBadge({ row }: { row: MetaCapiOutboxRow }) {
  const bucket = row.statusBucket
  const tone =
    bucket === 'delivered_backend'
      ? 'bg-emerald-100 text-emerald-800'
      : bucket === 'failed'
        ? 'bg-rose-100 text-rose-800'
        : bucket === 'blocked_config'
          ? 'bg-orange-100 text-orange-900'
          : 'bg-amber-100 text-amber-900'

  const Icon =
    bucket === 'delivered_backend'
      ? Check
      : bucket === 'failed'
        ? X
        : bucket === 'blocked_config'
          ? AlertTriangle
          : null

  return (
    <span
      className={cn(
        'inline-flex h-8 w-[11.5rem] shrink-0 items-center justify-center gap-1 rounded-full px-2.5 text-center text-[10px] font-semibold tracking-[0.06em] uppercase',
        tone,
      )}
      title={row.statusLabel}
    >
      {Icon ? <Icon size={12} className="shrink-0" aria-hidden /> : null}
      <span className="min-w-0 truncate leading-tight">{row.statusLabel}</span>
    </span>
  )
}

const STATUS_OPTIONS: { value: MetaCapiStatusBucket; label: string }[] = [
  { value: 'all', label: 'Todos los estados' },
  { value: 'delivered_backend', label: 'Entregado al backend' },
  { value: 'pending', label: 'Encolado / pendiente' },
  { value: 'blocked_config', label: 'Bloqueado (config)' },
  { value: 'retained', label: 'Retenido' },
  { value: 'cancelled', label: 'Cancelado' },
  { value: 'failed', label: 'Fallido' },
]

const emptyFilters = (): MetaCapiListFilters => ({
  statusBucket: 'all',
  lane: 'all',
  channel: 'all',
  eventName: 'all',
  origin: 'all',
  dataset: 'all',
  dateFrom: null,
  dateTo: null,
  page: 1,
  pageSize: 50,
})

export function MetaCapiBitacoraView() {
  const [filters, setFilters] = useState<MetaCapiListFilters>(emptyFilters)
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

  const apply = (patch: Partial<MetaCapiListFilters>, resetPage = true) => {
    const next: MetaCapiListFilters = {
      ...filters,
      ...patch,
      page: resetPage ? 1 : (patch.page ?? filters.page ?? 1),
    }
    setFilters(next)
    load(next)
  }

  const refresh = () => load({ ...filters })

  const rows = data?.rows ?? []
  const tz = data?.timezone ?? 'America/Guayaquil'
  const kpis = data?.kpis

  return (
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="CAPI Meta"
        eyebrow="Marketing"
        description="Cola CAPI web/servidor y, aparte, recepción WhatsApp del CRM con seguimiento de conversiones. No se mezclan totales."
        actions={
          <button
            type="button"
            onClick={refresh}
            disabled={pending}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-full border border-[#d9d0c3] bg-white px-4 text-[11px] font-semibold tracking-[0.12em] text-[#1f1a14] uppercase disabled:opacity-50 sm:w-auto"
          >
            <RefreshCw size={14} className={pending ? 'animate-spin' : undefined} />
            Actualizar
          </button>
        }
      />

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-[#1f1a14]">Cola CAPI · Web / servidor</h2>
        <p className="text-[11px] text-[#6b645c]">
          Indicadores de outbox Meta (no incluyen mensajes CRM WhatsApp). Separación por canal abajo.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">
          <KpiCard label="Total (alcance)" value={kpis?.total ?? '—'} />
          <KpiCard label="Entregado backend" value={kpis?.deliveredBackend ?? '—'} tone="good" />
          <KpiCard label="Pendiente" value={kpis?.pending ?? '—'} tone="muted" />
          <KpiCard label="Bloqueado config" value={kpis?.blockedConfig ?? '—'} tone="warn" />
          <KpiCard label="Retenido" value={kpis?.retained ?? '—'} tone="warn" />
          <KpiCard label="Fallido (dead)" value={kpis?.failed ?? '—'} tone={(kpis?.failed ?? 0) > 0 ? 'bad' : 'muted'} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <KpiCard label="Outbox web" value={data?.kpisByChannel.web ?? '—'} tone="muted" />
          <KpiCard label="Outbox WhatsApp" value={data?.kpisByChannel.whatsapp ?? '—'} tone="muted" />
          <KpiCard label="Outbox n/d" value={data?.kpisByChannel.undetermined ?? '—'} tone="muted" />
        </div>
      </section>

      <section className="rounded-2xl border border-[#ece6dc] bg-white p-3 sm:p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <label className="flex min-w-0 flex-col gap-1 text-[10px] font-semibold tracking-[0.16em] text-[#8a8176] uppercase">
            Desde
            <input
              type="date"
              className="crm-field h-10 w-full min-w-0 rounded-xl border border-[#e5dfd4] bg-white px-3 text-sm font-normal normal-case tracking-normal text-[#1f1a14]"
              value={filters.dateFrom ?? ''}
              onChange={(e) => apply({ dateFrom: e.target.value || null })}
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-[10px] font-semibold tracking-[0.16em] text-[#8a8176] uppercase">
            Hasta
            <input
              type="date"
              className="crm-field h-10 w-full min-w-0 rounded-xl border border-[#e5dfd4] bg-white px-3 text-sm font-normal normal-case tracking-normal text-[#1f1a14]"
              value={filters.dateTo ?? ''}
              onChange={(e) => apply({ dateTo: e.target.value || null })}
            />
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-[10px] font-semibold tracking-[0.16em] text-[#8a8176] uppercase">
            Evento
            <select
              className="h-10 w-full min-w-0 rounded-xl border border-[#e5dfd4] bg-white px-3 text-sm font-normal normal-case tracking-normal text-[#1f1a14]"
              value={filters.eventName ?? 'all'}
              onChange={(e) => apply({ eventName: e.target.value })}
            >
              <option value="all">Todos</option>
              {(data?.eventNames ?? ['ViewContent', 'Lead', 'Schedule']).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-[10px] font-semibold tracking-[0.16em] text-[#8a8176] uppercase">
            Estado
            <select
              className="h-10 w-full min-w-0 rounded-xl border border-[#e5dfd4] bg-white px-3 text-sm font-normal normal-case tracking-normal text-[#1f1a14]"
              value={filters.statusBucket ?? 'all'}
              onChange={(e) => apply({ statusBucket: e.target.value as MetaCapiStatusBucket })}
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-[10px] font-semibold tracking-[0.16em] text-[#8a8176] uppercase">
            Lane
            <select
              className="h-10 w-full min-w-0 rounded-xl border border-[#e5dfd4] bg-white px-3 text-sm font-normal normal-case tracking-normal text-[#1f1a14]"
              value={filters.lane ?? 'all'}
              onChange={(e) => apply({ lane: e.target.value as 'all' | 'test' | 'live' })}
            >
              <option value="all">Todas</option>
              <option value="test">test</option>
              <option value="live">live</option>
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-[10px] font-semibold tracking-[0.16em] text-[#8a8176] uppercase">
            Canal
            <select
              className="h-10 w-full min-w-0 rounded-xl border border-[#e5dfd4] bg-white px-3 text-sm font-normal normal-case tracking-normal text-[#1f1a14]"
              value={filters.channel ?? 'all'}
              onChange={(e) =>
                apply({ channel: e.target.value as 'all' | 'web' | 'whatsapp' | 'undetermined' })
              }
            >
              <option value="all">Todos</option>
              <option value="web">Web</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="undetermined">No determinado</option>
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-[10px] font-semibold tracking-[0.16em] text-[#8a8176] uppercase">
            Origen
            <select
              className="h-10 w-full min-w-0 rounded-xl border border-[#e5dfd4] bg-white px-3 text-sm font-normal normal-case tracking-normal text-[#1f1a14]"
              value={filters.origin ?? 'all'}
              onChange={(e) => apply({ origin: e.target.value })}
            >
              <option value="all">Todos</option>
              {(data?.origins ?? []).map((origin) => (
                <option key={origin} value={origin}>
                  {origin}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-0 flex-col gap-1 text-[10px] font-semibold tracking-[0.16em] text-[#8a8176] uppercase">
            Dataset
            <select
              className="h-10 w-full min-w-0 rounded-xl border border-[#e5dfd4] bg-white px-3 text-sm font-normal normal-case tracking-normal text-[#1f1a14]"
              value={filters.dataset ?? 'all'}
              onChange={(e) => apply({ dataset: e.target.value })}
            >
              <option value="all">Todos / sin dato</option>
              {(data?.datasets ?? []).map((dataset) => (
                <option key={dataset} value={dataset}>
                  {dataset}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
          <button
            type="button"
            onClick={() => {
              const next = emptyFilters()
              setFilters(next)
              load(next)
            }}
            className="text-left text-[11px] font-semibold tracking-[0.12em] text-[#5b4a9a] uppercase"
          >
            Limpiar filtros
          </button>
          <p className="text-[11px] leading-relaxed tabular-nums text-[#8a8176]">
            {data
              ? `${data.totalFiltered} registros · página ${data.page} · TZ ${tz}`
              : null}
            {data?.fetchedAt ? ` · actualizado ${formatWhen(data.fetchedAt, tz)}` : null}
          </p>
        </div>
      </section>

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
              description="No hay filas en la cola CAPI para este alcance y filtros."
            />
          </div>
        ) : (
          <>
            {/* Móvil / tablet: tarjetas */}
            <div className="lg:hidden">
              {rows.map((row) => (
                <EventRowCard key={row.id} row={row} tz={tz} />
              ))}
            </div>
            {/* Desktop: tabla */}
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full min-w-[960px] text-left text-sm">
                <thead>
                  <tr className="border-b border-[#ece6dc] bg-[#f7f3ee] text-[10px] font-semibold tracking-[0.14em] text-[#8a8176] uppercase">
                    <th className="px-4 py-3">Teléfono</th>
                    <th className="px-4 py-3">Fechas</th>
                    <th className="px-4 py-3">Evento</th>
                    <th className="px-4 py-3">Canal / lane</th>
                    <th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3">Recepción</th>
                    <th className="px-4 py-3">Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-t border-[#f0ebe3] align-top">
                      <td className="px-4 py-3 text-[#1f1a14]">
                        <span
                          className={cn(
                            row.phoneSource === 'none' ? 'text-[#8a8176]' : 'tabular-nums',
                          )}
                          title={row.phoneSourceLabel}
                        >
                          {row.phoneDisplay}
                        </span>
                        <span className="mt-0.5 block text-[10px] text-[#8a8176]">
                          {row.phoneSourceLabel}
                        </span>
                        {row.connectedLead && row.leadId ? (
                          <span className="mt-0.5 block text-[10px] text-[#5b4a9a]">
                            Lead asociado
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-[11px] leading-relaxed text-[#6b645c]">
                        <div>
                          <span className="text-[#8a8176]">Evento · </span>
                          {formatWhen(row.eventAt, tz)}
                        </div>
                        <div>
                          <span className="text-[#8a8176]">Registro · </span>
                          {formatWhen(row.registeredAt, tz)}
                        </div>
                        <div>
                          <span className="text-[#8a8176]">Entrega · </span>
                          {formatWhen(row.forwardedAt, tz)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-[#5b4a9a]">{row.eventName}</p>
                        {row.datasetHint ? (
                          <p className="text-[10px] text-[#8a8176]">dataset {row.datasetHint}</p>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-[11px] text-[#4a433c]">
                        <p>{row.channelLabel}</p>
                        <p className="text-[#8a8176]">lane {row.deliveryLane}</p>
                        <p className="text-[#8a8176]">{row.destinationLabel}</p>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge row={row} />
                      </td>
                      <td className="max-w-[180px] px-4 py-3 text-[11px] leading-snug break-words text-[#6b645c]" title={row.receptionLabel}>
                        {row.receptionLabel}
                      </td>
                      <td
                        className="max-w-[240px] px-4 py-3 font-mono text-[11px] break-all text-[#8a8176]"
                        title={row.detail}
                      >
                        {row.detail}
                        {row.ctwaNote ? (
                          <span className="mt-1 block font-sans text-[10px] text-amber-800">
                            {row.ctwaNote}
                          </span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data ? (
              <div className="border-t border-[#ece6dc] px-3 py-3 sm:px-4">
                <Pagination
                  page={data.page}
                  pageSize={data.pageSize}
                  total={data.totalFiltered}
                  onPageChange={(page) => apply({ page }, false)}
                />
              </div>
            ) : null}
          </>
        )}
      </section>

      {data?.whatsapp ? <MetaCapiWhatsAppSection whatsapp={data.whatsapp} tz={tz} /> : null}
    </div>
  )
}
