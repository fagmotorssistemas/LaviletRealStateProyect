'use client'

import { useEffect, useMemo, useState } from 'react'
import { listLeadTourRecorridosAction, type TourRecorridoDetail } from '@/app/inmobiliaria/recorrido/actions'
import { TourRecorridoTimeline } from '@/components/inmobiliaria/recorrido/TourRecorridoTimeline'
import { TourHeatmap } from '@/components/inmobiliaria/users/TourHeatmap'
import type { TourHeatCell } from '@/app/inmobiliaria/usuarios/actions'
import { Spinner } from '@/components/ui/Spinner'
import { formatDateTime, formatSeconds } from '@/lib/utils'
import { cn } from '@/lib/utils'

function isRealAmbiente(room: string | null | undefined) {
  const r = String(room ?? '').trim()
  if (!r || r.length > 48) return false
  if (/gemini|generated|image|\.webp|\.png|\.jpe?g|https?:|piso-\d/i.test(r)) return false
  return true
}

function heatCellsFromDetail(detail: TourRecorridoDetail): TourHeatCell[] {
  const map = new Map<string, TourHeatCell>()
  for (const event of detail.events) {
    if (event.eventType !== 'ambiente' && event.eventType !== 'salida') continue
    const seconds = Math.max(0, Number(event.seconds) || 0)
    if (seconds < 1 || !isRealAmbiente(event.room)) continue
    const typology = String(event.typology ?? '').trim() || '—'
    const room = String(event.room).trim()
    const key = `${typology}|${room}`
    const prev = map.get(key)
    map.set(key, {
      typology,
      room,
      unit: prev?.unit ?? null,
      seconds: (prev?.seconds ?? 0) + seconds,
    })
  }
  return [...map.values()].sort((a, b) => b.seconds - a.seconds)
}

function mergeHeatCells(details: TourRecorridoDetail[]): TourHeatCell[] {
  const map = new Map<string, TourHeatCell>()
  for (const detail of details) {
    for (const cell of heatCellsFromDetail(detail)) {
      const key = `${cell.typology}|${cell.room}`
      const prev = map.get(key)
      map.set(key, {
        typology: cell.typology,
        room: cell.room,
        unit: cell.unit || prev?.unit || null,
        seconds: (prev?.seconds ?? 0) + cell.seconds,
      })
    }
  }
  return [...map.values()].sort((a, b) => b.seconds - a.seconds)
}

export function LeadDetailTourTab({ leadId }: { leadId: string }) {
  const [rows, setRows] = useState<TourRecorridoDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sessionFilter, setSessionFilter] = useState<'all' | string>('all')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    listLeadTourRecorridosAction(leadId)
      .then((data) => {
        if (!cancelled) {
          setRows(data)
          setSessionFilter('all')
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'No se pudo leer el recorrido')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [leadId])

  const visibleRows = useMemo(() => {
    if (sessionFilter === 'all') return rows
    return rows.filter((row) => row.sessionId === sessionFilter)
  }, [rows, sessionFilter])

  const heatCells = useMemo(() => mergeHeatCells(visibleRows), [visibleRows])

  const totalSeconds = useMemo(
    () => visibleRows.reduce((sum, row) => sum + Math.max(0, row.totalSeconds || 0), 0),
    [visibleRows],
  )

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    )
  }

  if (error) return <p className="text-sm text-red-600">{error}</p>

  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-10 text-center">
        <p className="text-sm font-medium text-slate-700">Sin recorrido del showroom 360°</p>
        <p className="mt-2 text-sm text-slate-500">
          Este lead aún no tiene sesiones vinculadas. La actividad anónima solo aparece aquí después
          de identificarse (celular / solicitud) en el mismo visitante.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium tracking-wide text-slate-400 uppercase">
              Mapa de calor del lead
            </p>
            <p className="mt-1 text-sm text-slate-600">
              Solo tipologías y ambientes con evidencia de tiempo. Las unidades concretas no se
              atribuyen por una visita genérica al modelo.
            </p>
          </div>
          <p className="text-sm tabular-nums text-slate-500">
            {visibleRows.length} sesión{visibleRows.length === 1 ? '' : 'es'} · {formatSeconds(totalSeconds)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSessionFilter('all')}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
              sessionFilter === 'all'
                ? 'bg-[#2B1A18] text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
            )}
          >
            Acumulado
          </button>
          {rows.map((row) => (
            <button
              key={row.sessionId}
              type="button"
              onClick={() => setSessionFilter(row.sessionId)}
              className={cn(
                'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                sessionFilter === row.sessionId
                  ? 'bg-[#2B1A18] text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
              )}
            >
              {formatDateTime(row.startedAt)}
            </button>
          ))}
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-3">
          <TourHeatmap cells={heatCells} />
        </div>
      </section>

      {visibleRows.map((detail) => (
        <section key={detail.sessionId} className="space-y-3">
          <p className="text-xs font-medium tracking-wide text-slate-400 uppercase">
            Sesión · {formatDateTime(detail.startedAt)} · {formatSeconds(detail.totalSeconds)}
          </p>
          <TourRecorridoTimeline detail={detail} />
        </section>
      ))}
    </div>
  )
}
