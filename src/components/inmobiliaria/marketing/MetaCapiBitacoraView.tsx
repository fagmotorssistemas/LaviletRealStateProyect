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
          {row.internalSubtypeLabel && row.internalSubtypeLabel !== '—' ? (
            <p className="text-[10px] text-[#8a8176]">Subtipo · {row.internalSubtypeLabel}</p>
          ) : null}
          {row.unitLabel ? (
            <p className="text-[10px] text-[#6b645c]">Unidad · {row.unitLabel}</p>
          ) : null}
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
      {row.graphFbtraceId || row.graphEventsReceived != null ? (
        <p className="text-[10px] text-emerald-800">
          Graph
          {row.graphEventsReceived != null ? ` · events_received=${row.graphEventsReceived}` : ''}
          {row.graphFbtraceId ? ` · fbtrace=${row.graphFbtraceId.slice(0, 12)}…` : ''}
        </p>
      ) : null}
      {row.detail ? (
        <p className="break-all font-mono text-[10px] leading-snug text-[#8a8176]">{row.detail}</p>
      ) : null}
      {row.ctwaNote ? <p className="text-[10px] text-amber-800">{row.ctwaNote}</p> : null}
    </article>
  )
}

function StatusBadge({ row }: { row: MetaCapiOutboxRow }) {
  const outcome = String(row.deliveryOutcome || row.statusBucket)
  const tone =
    outcome === 'meta_accepted'
      ? 'bg-emerald-100 text-emerald-900'
      : outcome === 'nest_received' || outcome === 'delivered_backend'
        ? 'bg-sky-100 text-sky-900'
        : outcome === 'failed_retrying' || outcome === 'failed'
          ? 'bg-rose-100 text-rose-800'
          : outcome === 'blocked' || outcome === 'blocked_config'
            ? 'bg-orange-100 text-orange-900'
            : outcome === 'pending_backend_support' ||
                outcome === 'internal_activity' ||
                outcome === 'retained'
              ? 'bg-violet-100 text-violet-900'
              : outcome === 'unknown'
                ? 'bg-stone-200 text-stone-800'
                : 'bg-amber-100 text-amber-900'

  const Icon =
    outcome === 'meta_accepted' || outcome === 'nest_received' || outcome === 'delivered_backend'
      ? Check
      : outcome === 'failed_retrying' || outcome === 'failed'
        ? X
        : outcome === 'blocked' || outcome === 'blocked_config'
          ? AlertTriangle
          : null

  return (
    <span
      className={cn(
        'inline-flex h-8 w-[11.5rem] shrink-0 items-center justify-center gap-1 rounded-full px-2.5 text-center text-[10px] font-semibold tracking-[0.06em] uppercase',
        tone,
      )}
      title={row.deliveryReason || row.statusLabel}
    >
      {Icon ? <Icon size={12} className="shrink-0" aria-hidden /> : null}
      <span className="min-w-0 truncate leading-tight">
        {row.deliveryOutcomeLabel || row.statusLabel}
      </span>
    </span>
  )
}

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
          Indicadores de outbox Meta.
          {data ? ` ${data.totalFiltered} registros · página ${data.page} · TZ ${tz}` : null}
          {data?.fetchedAt ? ` · actualizado ${formatWhen(data.fetchedAt, tz)}` : null}
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7">
          <KpiCard label="Total (alcance)" value={kpis?.total ?? '—'} />
          <KpiCard label="Pendiente" value={kpis?.pending ?? '—'} tone="muted" />
          <KpiCard
            label="Recibido Nest"
            value={kpis?.nestReceived ?? kpis?.deliveredBackend ?? '—'}
            tone="good"
          />
          <KpiCard label="Aceptado Meta" value={kpis?.metaAccepted ?? '—'} tone="good" />
          <KpiCard
            label="Bloqueado"
            value={kpis?.blocked ?? kpis?.blockedConfig ?? '—'}
            tone="warn"
          />
          <KpiCard
            label="Fallido"
            value={kpis?.failedRetrying ?? kpis?.failed ?? '—'}
            tone={(kpis?.failedRetrying ?? kpis?.failed ?? 0) > 0 ? 'bad' : 'muted'}
          />
          <KpiCard label="Desconocido" value={kpis?.unknown ?? '—'} tone="muted" />
        </div>
        <div className="grid grid-cols-3 gap-2">
          <KpiCard label="Outbox web" value={data?.kpisByChannel.web ?? '—'} tone="muted" />
          <KpiCard
            label="Outbox WhatsApp"
            value={data?.kpisByChannel.whatsapp ?? '—'}
            tone="muted"
          />
          <KpiCard
            label="Outbox n/d"
            value={data?.kpisByChannel.undetermined ?? '—'}
            tone="muted"
          />
        </div>
      </section>

      <section className="space-y-2 rounded-2xl border border-[#ece6dc] bg-white p-3 sm:p-4">
        <div>
          <h2 className="text-sm font-semibold text-[#1f1a14]">
            Volumen para optimización · últimos 7 días
          </h2>
          <p className="mt-1 text-[11px] text-[#6b645c]">
            Meta de referencia: 50 por tipo de evento. Captura local, aceptación de Meta y
            atribución son evidencias distintas.
          </p>
        </div>
        {data?.optimizationVolume?.length ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-[11px]">
              <thead className="border-b border-[#ece6dc] text-[10px] tracking-[0.08em] text-[#8a8176] uppercase">
                <tr>
                  <th className="px-2 py-2">Evento / destino</th>
                  <th className="px-2 py-2">Elegibles / capturados</th>
                  <th className="px-2 py-2">Meta aceptó</th>
                  <th className="px-2 py-2">Meta atribuyó</th>
                  <th className="px-2 py-2">Brechas</th>
                  <th className="px-2 py-2">Cobertura incompleta</th>
                  <th className="px-2 py-2">Conjunto de anuncios verificado</th>
                </tr>
              </thead>
              <tbody>
                {data.optimizationVolume.map((row) => (
                  <tr
                    key={`${row.eventType}:${row.channel}:${row.dataset}:${row.deliveryLane}`}
                    className="border-b border-[#f0ebe3] align-top"
                  >
                    <td className="px-2 py-2 font-medium text-[#1f1a14]">
                      {row.eventType}
                      <div className="font-normal text-[#8a8176]">
                        {row.channel} · {row.dataset} · {row.deliveryLane}
                      </div>
                    </td>
                    <td className="px-2 py-2 tabular-nums">
                      {row.eligibleDetected} / {row.captured}
                      <div className="text-[#8a8176]">
                        pending {row.pending} · retenidos {row.retained}
                      </div>
                    </td>
                    <td className="px-2 py-2 tabular-nums">{row.metaAccepted}</td>
                    <td className="px-2 py-2 tabular-nums">{row.metaAttributed}</td>
                    <td className="px-2 py-2 text-[#6b645c]">
                      Captura {row.capturedGap} · aceptación {row.acceptedGap} · atribución{' '}
                      {row.attributedGap}
                    </td>
                    <td className="px-2 py-2 text-[#6b645c]">
                      Entrega {row.incompleteDeliveryEvidence} · atribución{' '}
                      {row.incompleteAttributionCoverage}
                      <div>
                        backend {row.backendAccepted} · rechazo {row.metaRejected} · transporte{' '}
                        {row.transportFailed}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-[#6b645c]">
                      {row.byVerifiedAdSet.length
                        ? row.byVerifiedAdSet
                            .map((set) => `${set.adSetId}: ${set.metaAttributed} atribuidos`)
                            .join(' · ')
                        : 'Sin atribución verificable'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[11px] text-[#8a8176]">
            No hay eventos capturados en la ventana o la fuente todavía no está disponible.
          </p>
        )}
      </section>

      <section className="space-y-2 rounded-2xl border border-[#ece6dc] bg-white p-3 sm:p-4">
        <div>
          <h2 className="text-sm font-semibold text-[#1f1a14]">Calificación semanal por objetivo</h2>
          <p className="mt-1 text-[11px] text-[#6b645c]">
            Ventana móvil de siete días. Selección interna, envío y aceptación de Meta se cuentan por separado.
          </p>
        </div>
        {data?.weeklyQualification?.rows?.length ? (
          <div className="overflow-x-auto"><table className="min-w-full text-left text-[11px]">
            <thead className="border-b border-[#ece6dc] text-[10px] tracking-[0.08em] text-[#8a8176] uppercase"><tr>
              <th className="px-2 py-2">Objetivo</th><th className="px-2 py-2">Propios</th>
              <th className="px-2 py-2">Incorporados</th><th className="px-2 py-2">Seleccionados</th>
              <th className="px-2 py-2">Pendientes</th><th className="px-2 py-2">Enviados</th><th className="px-2 py-2">Meta aceptó</th>
              <th className="px-2 py-2">Faltante a 50</th>
            </tr></thead>
            <tbody>{data.weeklyQualification.rows.map(row=><tr key={row.objectiveId} className="border-b border-[#f0ebe3]">
              <td className="px-2 py-2 font-medium">{row.label}</td><td className="px-2 py-2 tabular-nums">{row.own}</td>
              <td className="px-2 py-2 tabular-nums">{row.incorporated}</td><td className="px-2 py-2 tabular-nums">{row.selected}</td>
              <td className="px-2 py-2 tabular-nums">{row.pending}</td>
              <td className="px-2 py-2 tabular-nums">{row.sent}</td><td className="px-2 py-2 tabular-nums">{row.metaAccepted}</td>
              <td className="px-2 py-2 tabular-nums">{row.missing}</td>
            </tr>)}</tbody>
          </table></div>
        ):<p className="text-[11px] text-[#8a8176]">Sin evidencia positiva elegible en la ventana.</p>}
        <p className="text-[10px] text-[#8a8176]">{data?.weeklyQualification?.note}</p>
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
              description="No hay filas en la cola CAPI para este alcance."
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
                        {row.internalSubtypeLabel && row.internalSubtypeLabel !== '—' ? (
                          <p className="text-[10px] text-[#8a8176]">{row.internalSubtypeLabel}</p>
                        ) : null}
                        {row.unitLabel ? (
                          <p className="text-[10px] text-[#6b645c]">{row.unitLabel}</p>
                        ) : null}
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
                      <td
                        className="max-w-[180px] px-4 py-3 text-[11px] leading-snug break-words text-[#6b645c]"
                        title={row.receptionLabel}
                      >
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
    </div>
  )
}
