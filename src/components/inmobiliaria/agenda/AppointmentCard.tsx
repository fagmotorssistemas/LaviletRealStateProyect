'use client'

import { MapPin, User, Clock } from 'lucide-react'
import { StatusBadge } from '@/components/inmobiliaria/shared/StatusBadge'
import { formatDateTime } from '@/lib/utils'
import type { Appointment } from '@/types/inmobiliaria'

interface AppointmentCardProps {
  appointment: Appointment
  onSelect: (appointment: Appointment) => void
}

export function AppointmentCard({ appointment, onSelect }: AppointmentCardProps) {
  return (
    <button
      type="button"
      onClick={() => onSelect(appointment)}
      className="w-full min-w-0 cursor-pointer border border-[#c5c8bc] bg-[#f7f7f3] p-4 text-left transition-all hover:border-[#8b917c]"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg font-semibold break-words text-[#3a3d36]">
            {appointment.title || 'Cita'}
          </h3>
          <p className="mt-1 truncate text-xs text-[#5c6156]">
            {appointment.lead?.name ? appointment.lead.name : '—'}
            {appointment.project?.name ? (
              <span className="text-[#8a8d82]"> · {appointment.project.name}</span>
            ) : null}
          </p>
        </div>
        <div className="shrink-0">
          <StatusBadge status={appointment.status} type="appointment" />
        </div>
      </div>

      <div className="space-y-2 text-sm text-[#5c564f]">
        <div className="flex min-w-0 items-start gap-2">
          <Clock size={14} className="mt-0.5 shrink-0 text-[#8a8d82]" />
          <span className="min-w-0 break-words">{formatDateTime(appointment.start_time)}</span>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <User size={14} className="shrink-0 text-[#8a8d82]" />
          <span className="truncate">{appointment.lead?.name ?? '—'}</span>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <MapPin size={14} className="shrink-0 text-[#8a8d82]" />
          <span className="truncate">{appointment.project?.name ?? '—'}</span>
        </div>
      </div>

      {appointment.responsible?.full_name && (
        <div className="mt-3 border-t border-[#e8e2d8] pt-3">
          <p className="truncate text-xs text-[#5c6156]">
            Responsable:{' '}
            <span className="font-medium text-[#3a3d36]">{appointment.responsible.full_name}</span>
          </p>
        </div>
      )}
    </button>
  )
}
