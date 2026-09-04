'use client'

import { useEffect, useState } from 'react'
import { listLeadTourRecorridosAction, type TourRecorridoDetail } from '@/app/inmobiliaria/recorrido/actions'
import { TourRecorridoTimeline } from '@/components/inmobiliaria/recorrido/TourRecorridoTimeline'
import { Spinner } from '@/components/ui/Spinner'
import { formatDateTime, formatSeconds } from '@/lib/utils'

export function LeadDetailTourTab({ leadId }: { leadId: string }) {
  const [rows, setRows] = useState<TourRecorridoDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    listLeadTourRecorridosAction(leadId)
      .then((data) => {
        if (!cancelled) setRows(data)
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
      <p className="text-sm text-slate-500">
        Este lead todavía no tiene sesiones del showroom 360°. Cuando recorra el tour, el tiempo y los
        ambientes aparecen aquí.
      </p>
    )
  }

  return (
    <div className="space-y-8">
      {rows.map((detail) => (
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
