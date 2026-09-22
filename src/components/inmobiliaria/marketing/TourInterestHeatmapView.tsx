'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { Flame, RefreshCw } from 'lucide-react'
import {
  fetchTourInterestHeatmap,
  type InterestPeriod,
  type TourInterestHeatmapResult,
} from '@/app/inmobiliaria/marketing/interes/actions'
import { PageHeader } from '@/components/inmobiliaria/shared/PageHeader'
import { EmptyState } from '@/components/inmobiliaria/shared/EmptyState'
import { Spinner } from '@/components/ui/Spinner'
import { Button } from '@/components/ui/Button'
import { cn, formatSeconds } from '@/lib/utils'

const PERIODS: { id: InterestPeriod; label: string }[] = [
  { id: 'dia', label: 'Día' },
  { id: 'semana', label: 'Semana' },
  { id: 'mes', label: 'Mes' },
]

function heatColor(ratio: number) {
  const t = Math.max(0, Math.min(1, ratio))
  const start = { r: 252, g: 250, b: 247 }
  const mid = { r: 232, g: 180, b: 120 }
  const end = { r: 180, g: 72, b: 48 }
  const from = t < 0.5 ? start : mid
  const to = t < 0.5 ? mid : end
  const local = t < 0.5 ? t * 2 : (t - 0.5) * 2
  const r = Math.round(from.r + (to.r - from.r) * local)
  const g = Math.round(from.g + (to.g - from.g) * local)
  const b = Math.round(from.b + (to.b - from.b) * local)
  return `rgb(${r} ${g} ${b})`
}

function formatRange(startIso: string, endIso: string) {
  try {
    const fmt = new Intl.DateTimeFormat('es-EC', {
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Guayaquil',
    })
    return `${fmt.format(new Date(startIso))} → ${fmt.format(new Date(endIso))}`
  } catch {
    return `${startIso} → ${endIso}`
  }
}

function periodAxisHint(period: InterestPeriod) {
  if (period === 'dia') return 'Cada columna es una hora del día (00:00–23:00, hora Ecuador).'
  if (period === 'semana') return 'Cada columna es un día de la semana (lunes a domingo).'
  return 'Cada columna es un día del mes. Se actualiza sola: mañana aparece el día nuevo.'
}

function shortTime(seconds: number) {
  if (!seconds) return null
  if (seconds < 60) return `${seconds}s`
  const m = Math.round(seconds / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem ? `${h}h ${rem}m` : `${h}h`
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="min-w-0 rounded-xl border border-[#ece6dc] bg-white px-3 py-2.5">
      <p className="text-[10px] font-semibold tracking-[0.12em] text-[#8a8176] uppercase">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-[#1f1a14]">{value}</p>
    </div>
  )
}

export function TourInterestHeatmapView() {
  const [period, setPeriod] = useState<InterestPeriod>('semana')
  const [data, setData] = useState<TourInterestHeatmapResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const load = useCallback((next: InterestPeriod) => {
    startTransition(async () => {
      const res = await fetchTourInterestHeatmap(next)
      if (!res.ok) {
        setError(res.error)
        setData(null)
        return
      }
      setError(null)
      setData(res.data)
    })
  }, [])

  useEffect(() => {
    load(period)
  }, [load, period])

  const maxPuntaje = useMemo(() => {
    if (!data?.cells.length) return 1
    return Math.max(...data.cells.map((c) => c.puntaje), 1)
  }, [data])

  const cellLookup = useMemo(() => {
    const map = new Map<string, TourInterestHeatmapResult['cells'][number]>()
    for (const cell of data?.cells ?? []) {
      map.set(`${cell.rowKey}|${cell.bucket}`, cell)
    }
    return map
  }, [data])

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Marketing"
        title="Interés del recorrido"
        description="Qué tipologías miran más, en qué ambiente se quedan y qué deptos generan interés real."
        actions={
          <Button type="button" variant="outline" disabled={pending} onClick={() => load(period)}>
            <RefreshCw size={15} className={cn('mr-2', pending && 'animate-spin')} />
            Actualizar
          </Button>
        }
      />

      <div className="crm-tabs">
        {PERIODS.map((item) => (
          <button
            key={item.id}
            type="button"
            data-active={period === item.id}
            className="crm-tab"
            onClick={() => setPeriod(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </p>
      ) : null}

      {pending && !data ? (
        <div className="flex justify-center py-20">
          <Spinner size="lg" />
        </div>
      ) : !data || (data.rows.length === 0 && data.units.length === 0) ? (
        <EmptyState
          icon={Flame}
          title="Sin actividad en este periodo"
          description="Cuando haya recorridos 360° o unidades guardadas/consultadas, verás la intensidad aquí."
        />
      ) : (
        <>
          <p className="text-xs text-[#8a8176]">
            {formatRange(data.rangeStart, data.rangeEnd)}
            {period === 'mes' ? ' · Columnas del mes: se suman solas cada día.' : null}
          </p>

          {data.truncated ? (
            <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              Totales parciales: la consulta alcanzó un tope de filas.
              {data.truncationNotes?.length ? ` ${data.truncationNotes.join(' ')}` : null}
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
            <Kpi label="Entradas a tipología" value={data.totals.entradas ?? data.totals.visits} />
            <Kpi label="Sesiones" value={data.totals.sessions ?? '—'} />
            <Kpi label="Visitantes" value={data.totals.visitors ?? '—'} />
            <Kpi label="Cambios de ambiente" value={data.totals.ambienteChanges ?? '—'} />
            <Kpi label="Tiempo mirando" value={formatSeconds(data.totals.seconds)} />
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-2">
            <Kpi label="Tipologías activas" value={data.totals.typologies} />
            <Kpi label="Unidades con interés" value={data.totals.unitsWithInterest} />
          </div>

          <section className="overflow-hidden rounded-xl border border-[#e4ddd2] bg-white">
            <div className="border-b border-[#f0ebe3] px-4 py-3">
              <h2 className="text-sm font-semibold text-[#1f1a14]">Calor del recorrido (tipología)</h2>
              <p className="mt-0.5 text-xs text-[#8a8176]">{periodAxisHint(period)}</p>
              <p className="mt-1 text-xs text-[#8a8176]">
                Puntaje = <strong className="font-semibold text-[#4a433c]">entradas + minutos mirando</strong>.
                Casilla: entradas (no cambios de ambiente) y tiempo. Color = puntaje.
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] text-[#8a8176]">
                <span>Menos</span>
                <span className="inline-flex overflow-hidden rounded">
                  {[0.1, 0.35, 0.55, 0.75, 1].map((t) => (
                    <span key={t} className="h-3 w-6" style={{ background: heatColor(t) }} />
                  ))}
                </span>
                <span>Más calor</span>
              </div>
            </div>
            {data.rows.length === 0 ? (
              <p className="px-4 py-8 text-sm text-[#8a8176]">
                Sin tipologías con recorrido en el periodo.
              </p>
            ) : (
              <div className="overflow-x-auto p-3">
                <table className="w-full min-w-[42rem] border-separate border-spacing-1 text-xs">
                  <thead>
                    <tr>
                      <th className="px-2 py-1 text-left font-medium text-[#8a8176]">Tipología</th>
                      <th className="min-w-[8rem] px-2 py-1 text-left font-medium text-[#8a8176]">
                        Ambiente con más tiempo
                      </th>
                      {data.buckets.map((b) => (
                        <th
                          key={b.key}
                          className="min-w-[2.75rem] px-1 py-1 text-center font-medium text-[#8a8176]"
                          title={
                            period === 'mes'
                              ? `Día ${b.key} del mes`
                              : period === 'dia'
                                ? `Hora ${b.label}`
                                : b.label
                          }
                        >
                          {b.label}
                        </th>
                      ))}
                      <th className="px-2 py-1 text-right font-medium text-[#8a8176]">Puntaje</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.rows.map((row) => (
                      <tr key={row.key}>
                        <td className="whitespace-nowrap px-2 py-1 font-semibold text-[#2B1A18]">
                          {row.label}
                        </td>
                        <td className="max-w-[11rem] px-2 py-1 text-[#4a433c]">
                          {row.topAmbiente ? (
                            <>
                              <span className="font-medium">{row.topAmbiente}</span>
                              <span className="mt-0.5 block text-[10px] text-[#8a8176]">
                                {formatSeconds(row.topAmbienteSeconds)}
                              </span>
                            </>
                          ) : (
                            <span className="text-[#c4bbb0]">—</span>
                          )}
                        </td>
                        {data.buckets.map((b) => {
                          const cell = cellLookup.get(`${row.key}|${b.key}`)
                          const visits = cell?.visits ?? 0
                          const seconds = cell?.seconds ?? 0
                          const puntaje = cell?.puntaje ?? 0
                          const ratio = puntaje / maxPuntaje
                          const timeLabel = shortTime(seconds)
                          return (
                            <td key={b.key} className="p-0">
                              <div
                                className="flex min-h-12 min-w-[2.75rem] flex-col items-center justify-center rounded-md px-1 py-1 text-center"
                                style={{
                                  background: puntaje ? heatColor(Math.max(0.12, ratio)) : '#f7f3ee',
                                  color: ratio > 0.55 ? '#fff' : '#2B1A18',
                                }}
                                title={
                                  cell
                                    ? `${row.label} · ${b.label}: puntaje ${Math.round(puntaje)} · ${visits} entradas · ${formatSeconds(seconds)}`
                                    : `${row.label} · ${b.label}: sin actividad`
                                }
                              >
                                {visits || seconds ? (
                                  <>
                                    <span className="text-sm font-semibold tabular-nums leading-none">
                                      {visits || '·'}
                                    </span>
                                    {timeLabel ? (
                                      <span className="mt-0.5 text-[9px] leading-none opacity-85">
                                        {timeLabel}
                                      </span>
                                    ) : null}
                                  </>
                                ) : (
                                  <span className="text-[#c4bbb0]">·</span>
                                )}
                              </div>
                            </td>
                          )
                        })}
                        <td className="whitespace-nowrap px-2 py-1 text-right text-[#4a433c]">
                          <span className="font-semibold tabular-nums">
                            {Math.round(row.totalPuntaje)}
                          </span>
                          <span className="mt-0.5 block text-[10px] text-[#8a8176]">
                            {row.visits} entr. · {formatSeconds(row.seconds)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="overflow-hidden rounded-xl border border-[#e4ddd2] bg-white">
            <div className="border-b border-[#f0ebe3] px-4 py-3">
              <h2 className="text-sm font-semibold text-[#1f1a14]">
                Calor comercial (unidad concreta)
              </h2>
              <p className="mt-0.5 text-xs text-[#8a8176]">
                Puntaje = <strong className="font-semibold text-[#4a433c]">abrir ficha ×2</strong>
                {' · '}
                <strong className="font-semibold text-[#4a433c]">unidad vinculada (lead_units) ×3</strong>
                {' · '}
                <strong className="font-semibold text-[#4a433c]">favorito ×4</strong>
                . No suma identificaciones genéricas sin unidad.
              </p>
            </div>
            {data.units.length === 0 ? (
              <p className="px-4 py-8 text-sm text-[#8a8176]">
                Aún no hay consultas, favoritos ni leads vinculados a unidades en este periodo.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#f0ebe3] bg-[#faf8f5]">
                      <th className="px-4 py-2.5 text-left font-medium text-[#6b645c]">Unidad</th>
                      <th className="px-4 py-2.5 text-left font-medium text-[#6b645c]">Tipología</th>
                      <th className="px-4 py-2.5 text-right font-medium text-[#6b645c]">Ficha ×2</th>
                      <th className="px-4 py-2.5 text-right font-medium text-[#6b645c]">Lead ×3</th>
                      <th className="px-4 py-2.5 text-right font-medium text-[#6b645c]">
                        Favorito ×4
                      </th>
                      <th className="px-4 py-2.5 text-right font-medium text-[#6b645c]">Puntaje</th>
                      <th className="px-4 py-2.5 text-right font-medium text-[#6b645c]">
                        Intensidad
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.units.map((u) => {
                      const maxUnit = Math.max(...data.units.map((x) => x.puntaje), 1)
                      const ratio = u.puntaje / maxUnit
                      return (
                        <tr key={u.unitId} className="border-b border-[#f7f3ee]">
                          <td className="px-4 py-2.5">
                            <span className="font-semibold text-[#1f1a14]">{u.unitNumber}</span>
                            {u.floor ? (
                              <span className="ml-2 text-xs text-[#8a8176]">{u.floor}</span>
                            ) : null}
                          </td>
                          <td className="px-4 py-2.5 text-[#6b645c]">
                            {u.typologyCode || u.category || '—'}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {u.consults}
                            {u.consults > 0 ? (
                              <span className="ml-1 text-[10px] text-[#8a8176]">
                                ({u.consults * 2})
                              </span>
                            ) : null}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {u.leads}
                            {u.leads > 0 ? (
                              <span className="ml-1 text-[10px] text-[#8a8176]">({u.leads * 3})</span>
                            ) : null}
                          </td>
                          <td className="px-4 py-2.5 text-right tabular-nums">
                            {u.saves}
                            {u.saves > 0 ? (
                              <span className="ml-1 text-[10px] text-[#8a8176]">({u.saves * 4})</span>
                            ) : null}
                          </td>
                          <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-[#1f1a14]">
                            {u.puntaje}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <span
                              className="inline-flex min-w-[2.5rem] justify-center rounded-md px-2 py-1 text-xs font-semibold"
                              style={{
                                background: heatColor(Math.max(0.15, ratio)),
                                color: ratio > 0.55 ? '#fff' : '#2B1A18',
                              }}
                            >
                              {ratio > 0.66 ? 'Alta' : ratio > 0.33 ? 'Media' : 'Baja'}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
