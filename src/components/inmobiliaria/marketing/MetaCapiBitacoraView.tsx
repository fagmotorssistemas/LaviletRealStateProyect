'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { AlertTriangle, Check, Megaphone, RefreshCw, X } from 'lucide-react'
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
  hint,
}: {
  label: string
  value: string | number
  tone?: 'good' | 'bad' | 'muted' | 'warn'
  hint?: string
}) {
  return (
    <div className="rounded-2xl border border-[#ece6dc] bg-white px-4 py-3 shadow-[0_8px_24px_rgba(40,30,20,0.04)]">
      <p className="text-[10px] font-semibold tracking-[0.16em] text-[#8a8176] uppercase">{label}</p>
      <p
        className={cn(
          'mt-1 text-2xl font-semibold tabular-nums text-[#1f1a14]',
          tone === 'good' && 'text-emerald-700',
          tone === 'bad' && 'text-rose-700',
          tone === 'warn' && 'text-amber-800',
          tone === 'muted' && 'text-[#6b645c]',
        )}
      >
        {value}
      </p>
      {hint ? <p className="mt-1 text-[11px] leading-snug text-[#8a8176]">{hint}</p> : null}
    </div>
  )
}

function StatusBadge({ row }: { row: MetaCapiOutboxRow }) {
  const bucket = row.statusBucket
  if (bucket === 'delivered_backend') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-emerald-800 uppercase">
        <Check size={12} /> {row.statusLabel}
      </span>
    )
  }
  if (bucket === 'failed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-rose-800 uppercase">
        <X size={12} /> {row.statusLabel}
      </span>
    )
  }
  if (bucket === 'blocked_config') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-orange-900 uppercase">
        <AlertTriangle size={12} /> {row.statusLabel}
      </span>
    )
  }
  return (
    <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-amber-900 uppercase">
      {row.statusLabel}
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
  const errorPctLabel =
    kpis?.hasConfigBlocks && (kpis.failed ?? 0) === 0
      ? 'n/d (hay bloqueos de config)'
      : kpis?.deadErrorPct == null
        ? '—'
        : `${kpis.deadErrorPct}%`

  return (
    <div className="space-y-6">
      <PageHeader
        title="CAPI Meta — Bitácora de eventos"
        eyebrow="Marketing"
        description="Historial completo de la cola CAPI (web / servidor). PageView del navegador solo aparece como agregado oficial si hay permiso Graph. WhatsApp CRM es sección aparte, no conversión Meta."
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <KpiCard label="Total (alcance)" value={kpis?.total ?? '—'} />
        <KpiCard label="Entregado backend" value={kpis?.deliveredBackend ?? '—'} tone="good" />
        <KpiCard label="Pendiente" value={kpis?.pending ?? '—'} tone="muted" />
        <KpiCard label="Bloqueado config" value={kpis?.blockedConfig ?? '—'} tone="warn" />
        <KpiCard label="Retenido" value={kpis?.retained ?? '—'} tone="warn" />
        <KpiCard label="Fallido (dead)" value={kpis?.failed ?? '—'} tone={(kpis?.failed ?? 0) > 0 ? 'bad' : 'muted'} />
        <KpiCard
          label="% error terminal"
          value={errorPctLabel}
          tone={(kpis?.failed ?? 0) > 0 ? 'bad' : 'good'}
          hint="No mezcla not_configured ni agregados Meta"
        />
      </div>

      {kpis?.byEventName && Object.keys(kpis.byEventName).length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {Object.entries(kpis.byEventName).map(([name, count]) => (
            <span
              key={name}
              className="rounded-full border border-[#ece6dc] bg-white px-3 py-1 text-[11px] font-medium text-[#4a433c]"
            >
              {name} · <span className="tabular-nums">{count}</span>
            </span>
          ))}
        </div>
      ) : null}

      <section className="rounded-2xl border border-[#ece6dc] bg-white p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          <label className="flex flex-col gap-1 text-[10px] font-semibold tracking-[0.16em] text-[#8a8176] uppercase">
            Desde
            <input
              type="date"
              className="crm-field h-10 rounded-xl border border-[#e5dfd4] bg-white px-3 text-sm font-normal normal-case tracking-normal text-[#1f1a14]"
              value={filters.dateFrom ?? ''}
              onChange={(e) => apply({ dateFrom: e.target.value || null })}
            />
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-semibold tracking-[0.16em] text-[#8a8176] uppercase">
            Hasta
            <input
              type="date"
              className="crm-field h-10 rounded-xl border border-[#e5dfd4] bg-white px-3 text-sm font-normal normal-case tracking-normal text-[#1f1a14]"
              value={filters.dateTo ?? ''}
              onChange={(e) => apply({ dateTo: e.target.value || null })}
            />
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-semibold tracking-[0.16em] text-[#8a8176] uppercase">
            Evento
            <select
              className="h-10 rounded-xl border border-[#e5dfd4] bg-white px-3 text-sm font-normal normal-case tracking-normal text-[#1f1a14]"
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
          <label className="flex flex-col gap-1 text-[10px] font-semibold tracking-[0.16em] text-[#8a8176] uppercase">
            Estado
            <select
              className="h-10 rounded-xl border border-[#e5dfd4] bg-white px-3 text-sm font-normal normal-case tracking-normal text-[#1f1a14]"
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
          <label className="flex flex-col gap-1 text-[10px] font-semibold tracking-[0.16em] text-[#8a8176] uppercase">
            Lane
            <select
              className="h-10 rounded-xl border border-[#e5dfd4] bg-white px-3 text-sm font-normal normal-case tracking-normal text-[#1f1a14]"
              value={filters.lane ?? 'all'}
              onChange={(e) => apply({ lane: e.target.value as 'all' | 'test' | 'live' })}
            >
              <option value="all">Todas</option>
              <option value="test">test</option>
              <option value="live">live</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-semibold tracking-[0.16em] text-[#8a8176] uppercase">
            Canal
            <select
              className="h-10 rounded-xl border border-[#e5dfd4] bg-white px-3 text-sm font-normal normal-case tracking-normal text-[#1f1a14]"
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
          <label className="flex flex-col gap-1 text-[10px] font-semibold tracking-[0.16em] text-[#8a8176] uppercase">
            Origen
            <select
              className="h-10 rounded-xl border border-[#e5dfd4] bg-white px-3 text-sm font-normal normal-case tracking-normal text-[#1f1a14]"
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
          <label className="flex flex-col gap-1 text-[10px] font-semibold tracking-[0.16em] text-[#8a8176] uppercase">
            Dataset
            <select
              className="h-10 rounded-xl border border-[#e5dfd4] bg-white px-3 text-sm font-normal normal-case tracking-normal text-[#1f1a14]"
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
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              const next = emptyFilters()
              setFilters(next)
              load(next)
            }}
            className="text-[11px] font-semibold tracking-[0.12em] text-[#5b4a9a] uppercase"
          >
            Limpiar filtros
          </button>
          <p className="text-[11px] tabular-nums text-[#8a8176]">
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
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-left text-sm">
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
                      <td className="max-w-[180px] px-4 py-3 text-[11px] leading-snug text-[#6b645c]" title={row.receptionLabel}>
                        {row.receptionLabel}
                      </td>
                      <td
                        className="max-w-[240px] truncate px-4 py-3 font-mono text-[11px] text-[#8a8176]"
                        title={row.detail}
                      >
                        {row.detail}
                        {row.ctwaNote ? (
                          <span className="mt-1 block truncate font-sans text-[10px] text-amber-800">
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
              <div className="border-t border-[#ece6dc] px-4 py-3">
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

      <section className="rounded-2xl border border-dashed border-[#d9d0c3] bg-[#faf8f4] p-4">
        <h2 className="text-sm font-semibold text-[#1f1a14]">Agregados oficiales Meta (Pixel / dataset)</h2>
        <p className="mt-1 text-[12px] text-[#6b645c]">
          Separados de la cola CAPI. No se deduplican ni se suman con filas outbox.
        </p>
        {!data ? null : data.metaOfficialMetrics.available ? (
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {data.metaOfficialMetrics.aggregates.map((row) => (
              <li
                key={`${row.eventName}-${row.count}`}
                className="rounded-xl border border-[#ece6dc] bg-white px-3 py-2 text-sm"
              >
                <span className="font-medium text-[#5b4a9a]">{row.eventName}</span>
                <span className="ml-2 tabular-nums text-[#1f1a14]">{row.count}</span>
                {row.datasetHint ? (
                  <p className="text-[10px] text-[#8a8176]">dataset {row.datasetHint}</p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-amber-900">{data.metaOfficialMetrics.reason}</p>
        )}
        {data?.metaOfficialMetrics.available ? (
          <p className="mt-2 text-[11px] text-[#8a8176]">{data.metaOfficialMetrics.note}</p>
        ) : null}
      </section>

      {data?.absence ? (
        <section className="rounded-2xl border border-[#ece6dc] bg-white p-4">
          <h2 className="text-sm font-semibold text-[#1f1a14]">Diagnóstico de actividad</h2>
          <div className="mt-2 flex flex-wrap gap-3 text-[12px] text-[#4a433c]">
            <span>ViewContent · {data.absence.viewContentCount}</span>
            <span>Lead · {data.absence.leadCount}</span>
            <span>Schedule · {data.absence.scheduleCount}</span>
            <span>Leads con ads consent · {data.absence.leadsWithAdsConsent}</span>
            <span>Leads con meta_lead_event_id · {data.absence.leadsWithMetaEventId}</span>
          </div>
          <p className="mt-2 text-[11px] text-[#8a8176]">
            Flags Schedule: persist={String(data.absence.scheduleFlags.localPersist)} · delivery=
            {String(data.absence.scheduleFlags.delivery)} · flush=
            {String(data.absence.scheduleFlags.flush)} · WhatsApp Schedule bloqueado=
            {String(data.absence.scheduleFlags.whatsappScheduleBlocked)}
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-[12px] text-[#6b645c]">
            {data.absence.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {data && data.notConfigured.length > 0 ? (
        <section className="rounded-2xl border border-orange-200 bg-orange-50/60 p-4">
          <h2 className="text-sm font-semibold text-orange-950">
            Filas not_configured ({data.notConfigured.length})
          </h2>
          <p className="mt-1 text-[12px] text-orange-900/80">
            Error histórico al flush. No confundir con el estado actual de Production.
            Proceso actual CAPI configurado: {data.notConfigured[0]?.currentProcessCapiConfigured ? 'sí' : 'no'}.
          </p>
          <div className="mt-3 max-h-64 overflow-auto">
            <table className="w-full min-w-[720px] text-left text-[12px]">
              <thead>
                <tr className="text-[10px] tracking-[0.12em] text-orange-900/70 uppercase">
                  <th className="py-1 pr-3">Evento</th>
                  <th className="py-1 pr-3">Lane</th>
                  <th className="py-1 pr-3">Origen probable</th>
                  <th className="py-1">Host</th>
                </tr>
              </thead>
              <tbody>
                {data.notConfigured.slice(0, 40).map((row) => (
                  <tr key={row.eventId} className="border-t border-orange-200/60">
                    <td className="py-1.5 pr-3">{row.eventName}</td>
                    <td className="py-1.5 pr-3">{row.deliveryLane}</td>
                    <td className="py-1.5 pr-3">{row.likelyOrigin}</td>
                    <td className="py-1.5 font-mono text-[11px]">{row.eventSourceHost || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {data?.whatsapp ? (
        <section className="rounded-2xl border border-[#ece6dc] bg-white p-4">
          <h2 className="text-sm font-semibold text-[#1f1a14]">WhatsApp / Kommo (CRM)</h2>
          <p className="mt-1 text-[12px] text-[#6b645c]">{data.whatsapp.disclaimer}</p>
          <div className="mt-2 flex flex-wrap gap-3 text-[12px] text-[#4a433c]">
            <span>Contactos · {data.whatsapp.totals.contacts}</span>
            <span>Mensajes · {data.whatsapp.totals.messages}</span>
            <span>CTWA capturas · {data.whatsapp.totals.ctwaCaptures}</span>
            <span>Outbox canal WA · {data.whatsapp.totals.capiWhatsappOutbox}</span>
          </div>
          <p className="mt-2 text-[11px] text-[#8a8176]">{data.whatsapp.ctwa.note}</p>
          <p className="mt-1 text-[11px] font-medium text-amber-900">
            WhatsApp Schedule bloqueado · un mensaje/contacto no es Purchase, Lead ni Schedule CAPI.
          </p>
          {data.whatsapp.recentMessages.length > 0 ? (
            <ul className="mt-3 max-h-48 space-y-1 overflow-auto text-[12px] text-[#4a433c]">
              {data.whatsapp.recentMessages.map((msg) => (
                <li key={msg.messageId} className="rounded-lg border border-[#f0ebe3] px-3 py-1.5">
                  <span className="tabular-nums text-[#8a8176]">{msg.phone || 'Sin contacto asociado'}</span>
                  <span className="mx-2 text-[#c4bdb3]">·</span>
                  <span>{msg.role}</span>
                  <span className="mx-2 text-[#c4bdb3]">·</span>
                  <span className="text-[#6b645c]">{msg.preview || '—'}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  )
}
