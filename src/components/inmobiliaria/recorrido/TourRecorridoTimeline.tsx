'use client'

import { formatDateTime, formatSeconds } from '@/lib/utils'
import { tourEventLabel } from '@/lib/tour/eventLabels'
import type { TourRecorridoDetail } from '@/app/inmobiliaria/recorrido/actions'

export function TourRecorridoTimeline({ detail }: { detail: TourRecorridoDetail }) {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-gray-50/60 px-4 py-3">
          <p className="text-xs text-gray-500">Tiempo en sesión</p>
          <p className="mt-1 text-lg font-semibold text-gray-900">{formatSeconds(detail.totalSeconds)}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-gray-50/60 px-4 py-3">
          <p className="text-xs text-gray-500">Ambiente más visto</p>
          <p className="mt-1 text-lg font-semibold text-gray-900">{detail.topRoom ?? '—'}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-gray-50/60 px-4 py-3">
          <p className="text-xs text-gray-500">Origen</p>
          <p className="mt-1 text-lg font-semibold text-gray-900">{detail.firstUtmSource ?? detail.utmSource ?? '—'}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-gray-50/60 px-4 py-3">
          <p className="text-xs text-gray-500">Ciudad</p>
          <p className="mt-1 text-lg font-semibold text-gray-900">
            {[detail.city, detail.country].filter(Boolean).join(', ') || '—'}
          </p>
        </div>
      </div>

      <div className="grid gap-2 text-sm text-gray-600 sm:grid-cols-2">
        <p>
          <span className="text-gray-400">Entrada · </span>
          {formatDateTime(detail.startedAt)}
        </p>
        <p>
          <span className="text-gray-400">Última actividad · </span>
          {detail.lastSeenAt ? formatDateTime(detail.lastSeenAt) : '—'}
        </p>
        <p>
          <span className="text-gray-400">Landing · </span>
          {detail.landingPath || '—'}
        </p>
        <p>
          <span className="text-gray-400">Asesor (b) · </span>
          {detail.salespersonRef || '—'}
        </p>
        <p>
          <span className="text-gray-400">Dispositivo · </span>
          {detail.deviceType || '—'}
        </p>
        <p>
          <span className="text-gray-400">Contacto · </span>
          {detail.leadName || 'Visitante anónimo'}
          {detail.leadPhone ? ` · ${detail.leadPhone}` : ''}
        </p>
      </div>

      {detail.rooms.length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-medium text-gray-700">Tiempo por ambiente</h3>
          <ul className="space-y-1.5">
            {detail.rooms.map((item) => (
              <li key={item.room} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2 text-sm">
                <span className="text-gray-800">{item.room}</span>
                <span className="crm-num text-gray-600">{formatSeconds(item.seconds)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <h3 className="mb-2 text-sm font-medium text-gray-700">Línea de tiempo</h3>
        {detail.events.length === 0 ? (
          <p className="text-sm text-gray-500">Esta sesión no tiene eventos.</p>
        ) : (
          <ol className="space-y-2">
            {detail.events.map((event) => (
              <li key={event.id} className="flex items-start justify-between gap-3 rounded-lg border border-gray-100 px-3 py-2 text-sm">
                <div>
                  <p className="font-medium text-gray-800">{tourEventLabel(event.eventType)}</p>
                  <p className="text-xs text-gray-500">
                    {[event.room, event.typology, formatDateTime(event.createdAt)].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <span className="crm-num shrink-0 text-gray-500">
                  {event.seconds > 0 ? formatSeconds(event.seconds) : ''}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}
