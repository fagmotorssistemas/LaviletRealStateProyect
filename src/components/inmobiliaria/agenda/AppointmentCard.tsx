'use client'

import { Calendar, MapPin, User, Clock } from 'lucide-react'
import { StatusBadge } from '@/components/inmobiliaria/shared/StatusBadge'
import { formatDateTime } from '@/lib/utils'
import type { Appointment } from '@/types/inmobiliaria'

interface AppointmentCardProps {
  appointment: Appointment
  onSelect: (appointment: Appointment) => void
}

export function AppointmentCard({ appointment, onSelect }: AppointmentCardProps) {
  return (
    <div
      onClick={() => onSelect(appointment)}
      className="rounded-xl border border-gray-200 bg-white p-4 hover:border-gray-300 hover:shadow-sm transition-all cursor-pointer"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-gray-900 truncate">{appointment.title || 'Cita'}</h3>
          <p className="text-xs text-gray-500 mt-1">
            {appointment.lead?.name ? appointment.lead.name : '—'}
            {appointment.project?.name ? <span className="text-gray-400"> • {appointment.project.name}</span> : null}
          </p>
        </div>
        <div className="shrink-0">
          <StatusBadge status={appointment.status} type="appointment" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm text-gray-600">
        <div className="flex items-center gap-2">
          <Clock size={14} className="text-gray-400" />
          <span>{formatDateTime(appointment.start_time)}</span>
        </div>

        <div className="flex items-center gap-2">
          <Calendar size={14} className="text-gray-400" />
          <span className="capitalize">{appointment.location_type}</span>
        </div>

        <div className="flex items-center gap-2">
          <User size={14} className="text-gray-400" />
          <span className="truncate">{appointment.lead?.name ?? '—'}</span>
        </div>

        <div className="flex items-center gap-2">
          <MapPin size={14} className="text-gray-400" />
          <span className="truncate">{appointment.project?.name ?? '—'}</span>
        </div>
      </div>

      {appointment.responsible?.full_name && (
        <div className="mt-3 pt-3 border-t border-gray-100">
          <p className="text-xs text-gray-500">
            Responsable: <span className="font-medium text-gray-700">{appointment.responsible.full_name}</span>
          </p>
        </div>
      )}
    </div>
  )
}
