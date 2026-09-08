'use client'

import type { Appointment } from '@/types/inmobiliaria'
import { StatusBadge } from '@/components/inmobiliaria/shared/StatusBadge'
import { appointmentIsOverdue, formatAgendaDateTime } from '@/lib/inmobiliaria/agendaTime'
import { MapPin, User } from 'lucide-react'

interface AgendaAppointmentsTableProps {
  appointments: Appointment[]
  onSelect: (appointment: Appointment) => void
}

export function AgendaAppointmentsTable({ appointments, onSelect }: AgendaAppointmentsTableProps) {
  return (
    <div className="min-w-0 overflow-x-auto border border-[#c5c8bc] bg-[#f7f7f3]">
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
              <td className="px-4 py-3 font-medium text-gray-900">{a.title ?? '—'}</td>
              <td className="px-4 py-3">
                <div className="flex flex-col items-start gap-1">
                  <StatusBadge status={a.status} type="appointment" />
                  {a.openReschedule ? (
                    <span className="text-[10px] uppercase text-[#5c6156]">Cambio pendiente</span>
                  ) : null}
                </div>
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
              <td className="px-4 py-3 text-gray-600">
                {formatAgendaDateTime(a.start_time)}
                {a.no_show ? <span className="ml-2 text-[10px] uppercase text-[#8a5c58]">No asistió</span> : null}
                {appointmentIsOverdue(a.start_time) && (a.status === 'aceptado' || a.status === 'reprogramado') ? (
                  <span className="ml-2 text-[10px] uppercase text-[#8a5c58]">Vencida</span>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

