'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { Megaphone, RefreshCw } from 'lucide-react'
import { fetchMetaCapiBitacora } from '@/app/inmobiliaria/marketing/capi/actions'
import { PageHeader } from '@/components/inmobiliaria/shared/PageHeader'
import { EmptyState } from '@/components/inmobiliaria/shared/EmptyState'
import { Spinner } from '@/components/ui/Spinner'
import { Pagination } from '@/components/ui/Pagination'
import { cn } from '@/lib/utils'
import type {
  MetaCapiListFilters,
  MetaCapiOutboxKpis,
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
      timeZone,
      timeZoneName: 'short',
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
  tone?: 'good' | 'bad' | 'warn' | 'muted'
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
      {hint ? <p className="mt-1 text-[10px] text-[#8a8176]">{hint}</p> : null}
    </div>
  )
}

const STATUS_OPTIONS: { value: MetaCapiStatusBucket; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'delivered_backend', label: 'Entregados backend' },
  { value: 'pending', label: 'Pendientes' },
  { value: 'blocked_config', label: 'Bloqueados config' },
  { value: 'retained', label: 'Retenidos' },
  { value: 'cancelled', label: 'Cancelados' },
  { value: 'failed', label: 'Fallidos' },
]

export function MetaCapiBitacoraView() {
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

  const patchFilters = (partial: Partial<MetaCapiListFilters>, reload = true) => {
    setFilters((prev) => {
      const next = { ...prev, ...partial }
      if (reload) load(next)
      return next
    })
  }

  const kpis: MetaCapiOutboxKpis | null = data?.kpis ?? null
  const rows: MetaCapiOutboxRow[] = data?.rows ?? []
  const tz = data?.timezone ?? 'America/Guayaquil'

  return (
    <div className="space-y-6">
      <PageHeader
        title="CAPI Meta"
        eyebrow="Marketing"
        description="Historial de meta_capi_outbox con alcance por tenant. «Entregado al backend» no implica recepción verificada en Graph ni atribución publicitaria."
        actions={
          <button
            type="button"
            onClick={() => load(filters)}
            disabled={pending}
            className="inline-flex h-10 items-center gap-2 rounded-full border border-[#d9d0c3] bg-white px-4 text-[11px] font-semibold tracking-[0.12em] text-[#1f1a14] uppercase disabled:opacity-50"
          >
            <RefreshCw size={14} className={pending ? 'animate-spin' : undefined} />
            Actualizar
          </button>
        }
      />

      {kpis ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-4">
          <KpiCard label="Total (filtro)" value={kpis.total} />
          <KpiCard
            label="Entregados al backend"
            value={kpis.deliveredBackend}
            tone="good"
            hint="forwarded → Nest; no Graph verificado"
          />
          <KpiCard label="Pendientes" value={kpis.pending} tone="muted" />
          <KpiCard
            label="Bloqueados config"
            value={kpis.blockedConfig}
            tone={kpis.blockedConfig > 0 ? 'warn' : 'muted'}
            hint="p. ej. not_configured"
          />
          <KpiCard label="Retenidos" value={kpis.retained} tone="warn" />
          <KpiCard label="Cancelados" value={kpis.cancelled} tone="muted" />
          <KpiCard label="Fallidos (dead)" value={kpis.failed} tone={kpis.failed > 0 ? 'bad' : 'muted'} />
          <KpiCard
            label="% fallidos dead"
            value={
              kpis.hasConfigBlocks && kpis.failed === 0
                ? 'N/D'
                : kpis.deadErrorPct == null
                  ? '—'
                  : `${kpis.deadErrorPct}%`
            }
            tone={kpis.hasConfigBlocks && kpis.failed === 0 ? 'warn' : kpis.failed > 0 ? 'bad' : 'good'}
            hint={
              kpis.hasConfigBlocks && kpis.failed === 0
                ? 'Hay bloqueos not_configured: no interpretar 0% como salud'
                : undefined
            }
          />
        </div>
      ) : pending ? (
        <div className="flex items-center gap-2 py-6 text-sm text-[#8a8176]">
          <Spinner /> Cargando indicadores…
        </div>
      ) : null}

      {data?.metaOfficialMetrics ? (
        <div className="rounded-2xl border border-dashed border-[#d9d0c3] bg-[#fcfbf9] px-4 py-3 text-sm text-[#4a433c]">
          <p className="text-[10px] font-semibold tracking-[0.14em] text-[#8a8176] uppercase">
            Métricas oficiales Meta (Pixel / Events Manager)
          </p>
          <p className="mt-1">{data.metaOfficialMetrics.reason}</p>
          <p className="mt-1 text-[11px] text-[#8a8176]">
            PageView no pasa por la outbox CAPI. No se inventan filas PageView aquí.
          </p>
        </div>
      ) : null}

      {data?.absence ? (
        <div className="rounded-2xl border border-[#ece6dc] bg-white px-4 py-3 text-sm text-[#4a433c]">
          <p className="text-[10px] font-semibold tracking-[0.14em] text-[#8a8176] uppercase">
            Cobertura de tipos (todo el historial en alcance)
          </p>
          <p className="mt-2 tabular-nums">
            ViewContent {data.absence.viewContentCount} · Lead {data.absence.leadCount} · Schedule{' '}
            {data.absence.scheduleCount}
          </p>
          <p className="mt-1 text-[11px] text-[#8a8176]">
            Leads con ads consent: {data.absence.leadsWithAdsConsent} · con meta_lead_event_id:{' '}
            {data.absence.leadsWithMetaEventId} · flags Schedule persist=
            {String(data.absence.scheduleFlags.localPersist)} delivery=
            {String(data.absence.scheduleFlags.delivery)} flush=
            {String(data.absence.scheduleFlags.flush)} · WhatsApp Schedule bloqueado
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-[12px] text-[#6b645c]">
            {data.absence.notes.map((note) => (
              <li key={note.slice(0, 48)}>{note}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {data?.notConfigured?.length ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          <p className="text-[10px] font-semibold tracking-[0.14em] uppercase">
            Diagnóstico not_configured ({data.notConfigured.length})
          </p>
          <p className="mt-1 text-[11px] text-amber-900/80">
            Error histórico de flush sin META_CAPI_* en ese proceso. No implica que Production esté mal
            configurada. Proceso actual CAPI:{' '}
            {data.notConfigured[0]?.currentProcessCapiConfigured ? 'configurado' : 'sin config (este runtime)'}.
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-[12px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-amber-800/80">
                  <th className="py-1 pr-2">event_id</th>
                  <th className="py-1 pr-2">Canal</th>
                  <th className="py-1 pr-2">Lane</th>
                  <th className="py-1 pr-2">Destino</th>
                  <th className="py-1 pr-2">Host origen</th>
                  <th className="py-1 pr-2">Registro</th>
                  <th className="py-1 pr-2">Origen</th>
                </tr>
              </thead>
              <tbody>
                {data.notConfigured.map((row) => (
                  <tr key={row.eventId} className="border-t border-amber-200/60">
                    <td className="py-1.5 pr-2 font-mono text-[11px]">{row.eventId}</td>
                    <td className="py-1.5 pr-2">{row.channelLabel}</td>
                    <td className="py-1.5 pr-2">{row.deliveryLane}</td>
                    <td className="py-1.5 pr-2">{row.destinationLabel}</td>
                    <td className="py-1.5 pr-2 font-mono text-[11px]">
                      {row.eventSourceHost || '—'}
                      {row.historicalLocal ? ' · local' : ''}
                    </td>
                    <td className="py-1.5 pr-2">{formatWhen(row.createdAt, tz)}</td>
                    <td className="py-1.5 pr-2">{row.likelyOrigin}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px]">
            Sin entrega al backend · Nest: sin evidencia de recepción. No se reenvían ni reclasifican.
          </p>
        </div>
      ) : null}

      {data?.whatsapp ? (
        <div className="space-y-3 rounded-2xl border border-[#c5d4e8] bg-[#f4f7fb] px-4 py-3 text-sm text-[#1f2a3d]">
          <div>
            <p className="text-[10px] font-semibold tracking-[0.14em] text-[#5a6b82] uppercase">
              WhatsApp / Kommo (CRM — no conversión Meta)
            </p>
            <p className="mt-1 text-[12px] text-[#4a5a70]">{data.whatsapp.disclaimer}</p>
            <p className="mt-1 text-[11px] tabular-nums text-[#5a6b82]">
              Contactos {data.whatsapp.totals.contacts} · Mensajes {data.whatsapp.totals.messages} ·
              CTWA capturas {data.whatsapp.totals.ctwaCaptures} · Outbox CAPI WhatsApp{' '}
              {data.whatsapp.totals.capiWhatsappOutbox} · Schedule WA bloqueado
            </p>
            <p className="mt-1 text-[11px] text-[#5a6b82]">{data.whatsapp.ctwa.note}</p>
          </div>

          {data.whatsapp.contacts.length === 0 ? (
            <p className="text-[12px] text-[#5a6b82]">
              No hay contactos WhatsApp/Kommo en el alcance de tenants de esta sesión.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[#d5e0ef] bg-white">
              <table className="w-full min-w-[640px] text-left text-[12px]">
                <thead>
                  <tr className="border-b border-[#e4ebf5] text-[10px] uppercase tracking-wide text-[#5a6b82]">
                    <th className="px-3 py-2">Teléfono (CRM)</th>
                    <th className="px-3 py-2">Nombre</th>
                    <th className="px-3 py-2">Origen</th>
                    <th className="px-3 py-2">Kommo</th>
                    <th className="px-3 py-2">Msgs</th>
                    <th className="px-3 py-2">Último msg</th>
                  </tr>
                </thead>
                <tbody>
                  {data.whatsapp.contacts.map((c) => (
                    <tr key={c.leadId} className="border-t border-[#f0f4fa]">
                      <td className="px-3 py-2 font-medium tabular-nums">
                        {c.phone || '—'}
                        <span className="mt-0.5 block text-[10px] font-normal text-[#8a8176]">
                          CRM (lead)
                        </span>
                      </td>
                      <td className="px-3 py-2">{c.name || '—'}</td>
                      <td className="px-3 py-2">
                        {c.source || '—'}
                        {c.channelOrigin ? ` / ${c.channelOrigin}` : ''}
                      </td>
                      <td className="px-3 py-2">{c.hasKommo ? 'sí' : 'no'}</td>
                      <td className="px-3 py-2 tabular-nums">{c.messageCount}</td>
                      <td className="px-3 py-2 tabular-nums text-[#5a6b82]">
                        {formatWhen(c.lastMessageAt, tz)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {data.whatsapp.recentMessages.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-[#d5e0ef] bg-white">
              <p className="border-b border-[#e4ebf5] px-3 py-2 text-[10px] font-semibold tracking-[0.12em] text-[#5a6b82] uppercase">
                Mensajes recientes (CRM) — no enviados a Meta como conversión
              </p>
              <table className="w-full min-w-[640px] text-left text-[12px]">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-[#5a6b82]">
                    <th className="px-3 py-2">Teléfono</th>
                    <th className="px-3 py-2">Rol</th>
                    <th className="px-3 py-2">Enviado</th>
                    <th className="px-3 py-2">Vista previa</th>
                  </tr>
                </thead>
                <tbody>
                  {data.whatsapp.recentMessages.map((m) => (
                    <tr key={m.messageId} className="border-t border-[#f0f4fa]">
                      <td className="px-3 py-2 tabular-nums">
                        {m.phone || '—'}
                        <span className="mt-0.5 block text-[10px] text-[#8a8176]">CRM (lead)</span>
                      </td>
                      <td className="px-3 py-2">{m.role}</td>
                      <td className="px-3 py-2 tabular-nums text-[#5a6b82]">
                        {formatWhen(m.sentAt, tz)}
                      </td>
                      <td className="max-w-[280px] truncate px-3 py-2 text-[#4a5a70]" title={m.preview}>
                        {m.preview || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col gap-3 rounded-2xl border border-[#ece6dc] bg-[#f7f3ee] p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="block space-y-1 text-[11px]">
            <span className="font-semibold tracking-[0.12em] text-[#6b645c] uppercase">Desde</span>
            <input
              type="date"
              value={filters.dateFrom?.slice(0, 10) || ''}
              onChange={(e) =>
                patchFilters({ dateFrom: e.target.value || null, page: 1 }, false)
              }
              className="w-full rounded-xl border border-[#e4ddd3] bg-white px-3 py-2 text-sm"
            />
          </label>
          <label className="block space-y-1 text-[11px]">
            <span className="font-semibold tracking-[0.12em] text-[#6b645c] uppercase">Hasta</span>
            <input
              type="date"
              value={filters.dateTo?.slice(0, 10) || ''}
              onChange={(e) => patchFilters({ dateTo: e.target.value || null, page: 1 }, false)}
              className="w-full rounded-xl border border-[#e4ddd3] bg-white px-3 py-2 text-sm"
            />
          </label>
          <label className="block space-y-1 text-[11px]">
            <span className="font-semibold tracking-[0.12em] text-[#6b645c] uppercase">Evento</span>
            <select
              value={filters.eventName || 'all'}
              onChange={(e) =>
                patchFilters({
                  eventName: e.target.value === 'all' ? null : e.target.value,
                  page: 1,
                })
              }
              className="w-full rounded-xl border border-[#e4ddd3] bg-white px-3 py-2 text-sm"
            >
              <option value="all">Todos</option>
              {(data?.eventNames ?? ['ViewContent', 'Lead', 'Schedule']).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1 text-[11px]">
            <span className="font-semibold tracking-[0.12em] text-[#6b645c] uppercase">Estado</span>
            <select
              value={filters.statusBucket || 'all'}
              onChange={(e) =>
                patchFilters({ statusBucket: e.target.value as MetaCapiStatusBucket, page: 1 })
              }
              className="w-full rounded-xl border border-[#e4ddd3] bg-white px-3 py-2 text-sm"
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1 text-[11px]">
            <span className="font-semibold tracking-[0.12em] text-[#6b645c] uppercase">Lane</span>
            <select
              value={filters.lane || 'all'}
              onChange={(e) =>
                patchFilters({
                  lane: e.target.value as 'all' | 'test' | 'live',
                  page: 1,
                })
              }
              className="w-full rounded-xl border border-[#e4ddd3] bg-white px-3 py-2 text-sm"
            >
              <option value="all">Todas</option>
              <option value="test">test</option>
              <option value="live">live</option>
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block min-w-[10rem] flex-1 space-y-1 text-[11px]">
            <span className="font-semibold tracking-[0.12em] text-[#6b645c] uppercase">Origen</span>
            <select
              value={filters.origin || 'all'}
              onChange={(e) =>
                patchFilters({
                  origin: e.target.value === 'all' ? null : e.target.value,
                  page: 1,
                })
              }
              className="w-full rounded-xl border border-[#e4ddd3] bg-white px-3 py-2 text-sm"
            >
              <option value="all">Todos</option>
              {(data?.origins ?? []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => load({ ...filters, page: 1 })}
            className="inline-flex h-10 items-center rounded-full bg-[#1a2744] px-4 text-[11px] font-semibold tracking-[0.12em] text-white uppercase"
          >
            Aplicar fechas
          </button>
          <button
            type="button"
            onClick={() => {
              const reset: MetaCapiListFilters = {
                statusBucket: 'all',
                lane: 'all',
                page: 1,
                pageSize: 50,
                dateFrom: null,
                dateTo: null,
                eventName: null,
                origin: null,
              }
              setFilters(reset)
              load(reset)
            }}
            className="inline-flex h-10 items-center rounded-full border border-[#d9d0c3] bg-white px-4 text-[11px] font-semibold tracking-[0.12em] uppercase"
          >
            Limpiar
          </button>
          <p className="ml-auto text-[11px] tabular-nums text-[#8a8176]">
            {data ? `${data.totalFiltered} registros · TZ ${tz}` : null}
            {data?.fetchedAt ? ` · ${formatWhen(data.fetchedAt, tz)}` : null}
          </p>
        </div>
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
                onClick={() => load(filters)}
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
              title="Sin eventos en este alcance"
              description="No hay filas en meta_capi_outbox para los filtros y tenants de la sesión."
            />
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] text-left text-sm">
                <thead>
                  <tr className="border-b border-[#ece6dc] bg-[#f7f3ee] text-[10px] font-semibold tracking-[0.14em] text-[#8a8176] uppercase">
                    <th className="px-3 py-3">Teléfono</th>
                    <th className="px-3 py-3">Origen tel.</th>
                    <th className="px-3 py-3">Canal</th>
                    <th className="px-3 py-3">Lane</th>
                    <th className="px-3 py-3">Destino</th>
                    <th className="px-3 py-3">Evento (hora)</th>
                    <th className="px-3 py-3">Registro</th>
                    <th className="px-3 py-3">Entrega backend</th>
                    <th className="px-3 py-3">Evento</th>
                    <th className="px-3 py-3">Estado</th>
                    <th className="px-3 py-3">Recepción Meta</th>
                    <th className="px-3 py-3">Detalle</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id} className="border-t border-[#f0ebe3]">
                      <td className="px-3 py-2.5 text-[#1f1a14]">
                        {row.phoneSource === 'none' ? (
                          <span className="text-[#8a8176]">{row.phoneDisplay}</span>
                        ) : (
                          <span className="font-medium tabular-nums">{row.phoneDisplay}</span>
                        )}
                        {row.phoneSource === 'event' && row.phoneCrm && row.phoneCrm !== row.phoneEvent ? (
                          <span className="mt-0.5 block text-[10px] text-[#8a8176]">
                            CRM: {row.phoneCrm}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 text-[11px] text-[#6b645c]" title={row.phoneSourceLabel}>
                        {row.phoneSource === 'event'
                          ? 'Evento'
                          : row.phoneSource === 'crm_lead'
                            ? 'CRM (lead)'
                            : '—'}
                      </td>
                      <td className="px-3 py-2.5 text-[12px] text-[#4a433c]">{row.channelLabel}</td>
                      <td className="px-3 py-2.5 font-mono text-[11px] text-[#6b645c]">
                        {row.deliveryLane}
                      </td>
                      <td
                        className="max-w-[160px] px-3 py-2.5 text-[11px] text-[#6b645c]"
                        title={row.destinationLabel}
                      >
                        {row.destinationLabel}
                        {row.hasCtwaClid ? (
                          <span className="mt-0.5 block text-[10px] text-amber-800">
                            ctwa en payload ≠ atribución
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 text-[12px] tabular-nums text-[#6b645c]">
                        {formatWhen(row.eventAt, tz)}
                      </td>
                      <td className="px-3 py-2.5 text-[12px] tabular-nums text-[#6b645c]">
                        {formatWhen(row.registeredAt, tz)}
                      </td>
                      <td className="px-3 py-2.5 text-[12px] tabular-nums text-[#6b645c]">
                        {formatWhen(row.forwardedAt, tz)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="rounded-md bg-[#1a2744]/8 px-2 py-0.5 text-[11px] font-semibold text-[#1a2744]">
                          {row.eventName}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={cn(
                            'inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-semibold tracking-[0.08em] uppercase',
                            row.statusBucket === 'delivered_backend' && 'bg-emerald-100 text-emerald-800',
                            row.statusBucket === 'failed' && 'bg-rose-100 text-rose-800',
                            row.statusBucket === 'blocked_config' && 'bg-amber-100 text-amber-900',
                            row.statusBucket === 'retained' && 'bg-orange-100 text-orange-900',
                            row.statusBucket === 'cancelled' && 'bg-stone-200 text-stone-700',
                            row.statusBucket === 'pending' && 'bg-sky-100 text-sky-900',
                          )}
                        >
                          {row.statusLabel}
                        </span>
                      </td>
                      <td className="max-w-[140px] px-3 py-2.5 text-[11px] text-[#6b645c]" title={row.receptionLabel}>
                        {row.receptionLabel}
                      </td>
                      <td
                        className="max-w-[180px] truncate px-3 py-2.5 font-mono text-[11px] text-[#8a8176]"
                        title={row.detail}
                      >
                        {row.detail}
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
                  onPageChange={(page) => patchFilters({ page })}
                />
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  )
}
