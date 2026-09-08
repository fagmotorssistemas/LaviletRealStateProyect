'use client'

import { formatDateTime, formatSeconds } from '@/lib/utils'
import { tourEventLabel } from '@/lib/tour/eventLabels'
import type { TourRecorridoDetail } from '@/app/inmobiliaria/recorrido/actions'

export function TourRecorridoTimeline({ detail }: { detail: TourRecorridoDetail }) {
  return (
    <div className="space-y-5 sm:space-y-6">
      <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
        <div className="rounded-xl border border-gray-200 bg-gray-50/60 px-3 py-3 sm:px-4">
          <p className="text-[11px] text-gray-500 sm:text-xs">Tiempo en sesión</p>
          <p className="mt-1 text-base font-semibold text-gray-900 sm:text-lg">
            {formatSeconds(detail.totalSeconds)}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-gray-50/60 px-3 py-3 sm:px-4">
          <p className="text-[11px] text-gray-500 sm:text-xs">Ambiente más visto</p>
          <p className="mt-1 truncate text-base font-semibold text-gray-900 sm:text-lg">
            {detail.topRoom ?? '—'}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-gray-50/60 px-3 py-3 sm:px-4">
          <p className="text-[11px] text-gray-500 sm:text-xs">Origen</p>
          <p className="mt-1 truncate text-base font-semibold text-gray-900 sm:text-lg">
            {detail.firstUtmSource ?? detail.utmSource ?? '—'}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-gray-50/60 px-3 py-3 sm:px-4">
          <p className="text-[11px] text-gray-500 sm:text-xs">Ciudad</p>
          <p className="mt-1 truncate text-base font-semibold text-gray-900 sm:text-lg">
            {[detail.city, detail.country].filter(Boolean).join(', ') || '—'}
          </p>
        </div>
      </div>

      <div className="grid gap-2 text-sm text-gray-600 sm:grid-cols-2">
        <p className="min-w-0 break-words">
          <span className="text-gray-400">Entrada · </span>
          {formatDateTime(detail.startedAt)}
        </p>
        <p className="min-w-0 break-words">
          <span className="text-gray-400">Última actividad · </span>
          {detail.lastSeenAt ? formatDateTime(detail.lastSeenAt) : '—'}
        </p>
        <p className="min-w-0 break-words">
          <span className="text-gray-400">Landing · </span>
          {detail.landingPath || '—'}
        </p>
        <p className="min-w-0 break-words">
          <span className="text-gray-400">Asesor (b) · </span>
          {detail.salespersonRef || '—'}
        </p>
        <p className="min-w-0 break-words">
          <span className="text-gray-400">Dispositivo · </span>
          {detail.deviceType || '—'}
        </p>
        <p className="min-w-0 break-words">
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
              <li
                key={item.room}
                className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2 text-sm"
              >
                <span className="min-w-0 truncate text-gray-800">{item.room}</span>
                <span className="crm-num shrink-0 text-gray-600">{formatSeconds(item.seconds)}</span>
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
              <li
                key={event.id}
                className="flex items-start justify-between gap-3 rounded-lg border border-gray-100 px-3 py-2 text-sm"
              >
                <div className="min-w-0">
                  <p className="font-medium text-gray-800">{tourEventLabel(event.eventType)}</p>
                  <p className="break-words text-xs text-gray-500">
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
