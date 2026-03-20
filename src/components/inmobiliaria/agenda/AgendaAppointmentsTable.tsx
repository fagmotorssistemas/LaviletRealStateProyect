'use client'

import type { Appointment } from '@/types/inmobiliaria'
import { StatusBadge } from '@/components/inmobiliaria/shared/StatusBadge'
import { formatDateTime } from '@/lib/utils'
import { Clock, MapPin, User } from 'lucide-react'

interface AgendaAppointmentsTableProps {
  appointments: Appointment[]
  onSelect: (appointment: Appointment) => void
}

export function AgendaAppointmentsTable({ appointments, onSelect }: AgendaAppointmentsTableProps) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50/50">
            <th className="px-4 py-3 text-left font-medium text-gray-600">Cita</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Estado</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Lead</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Responsable</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Proyecto</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Inicio</th>
          </tr>
        </thead>
        <tbody>
          {appointments.map((a) => (
            <tr
              key={a.id}
              onClick={() => onSelect(a)}
              className="border-b border-gray-50 hover:bg-gray-50/50 cursor-pointer transition-colors"
            >
              <td className="px-4 py-3 font-medium text-gray-900">
                {a.title ?? '—'}
                <div className="text-xs text-gray-400 mt-1 flex items-center gap-2">
                  <Clock size={12} />
                  <span className="inline-flex items-center gap-2">
                    <span className="sr-only">Tipo de ubicación</span>
                    <span>{a.location_type}</span>
                  </span>
                </div>
              </td>
              <td className="px-4 py-3">
                <StatusBadge status={a.status} type="appointment" />
              </td>
              <td className="px-4 py-3 text-gray-600">{a.lead?.name ?? '—'}</td>
              <td className="px-4 py-3 text-gray-600">
                {a.responsible?.full_name ?? (
                  <span className="inline-flex items-center gap-1 text-gray-400">
                    <User size={14} />
                    —
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-gray-600">
                {a.project?.name ?? (
                  <span className="inline-flex items-center gap-1 text-gray-400">
                    <MapPin size={14} />
                    —
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-gray-600">{formatDateTime(a.start_time)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

