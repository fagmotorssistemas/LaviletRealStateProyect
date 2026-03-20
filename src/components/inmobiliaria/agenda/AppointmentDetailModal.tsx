'use client'

import { Modal } from '@/components/ui/Modal'
import { StatusBadge } from '@/components/inmobiliaria/shared/StatusBadge'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { APPOINTMENT_STATUS_OPTIONS } from '@/types/inmobiliaria'
import type { Appointment, AppointmentStatus } from '@/types/inmobiliaria'
import { formatDateTime } from '@/lib/utils'
import { useState } from 'react'
import { Clock, MapPin, User, FileText } from 'lucide-react'

interface AppointmentDetailModalProps {
  appointment: Appointment | null
  isOpen: boolean
  onClose: () => void
  onStatusChange: (id: string, status: AppointmentStatus) => void
}

export function AppointmentDetailModal({ appointment, isOpen, onClose, onStatusChange }: AppointmentDetailModalProps) {
  const [newStatus, setNewStatus] = useState('')

  if (!appointment) return null

  const handleSave = () => {
    if (newStatus && newStatus !== appointment.status) {
      onStatusChange(appointment.id, newStatus as AppointmentStatus)
      setNewStatus('')
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={appointment.title || 'Detalle de Cita'} size="md">
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          <StatusBadge status={appointment.status} type="appointment" />
          <span className="text-sm text-gray-400 capitalize">{appointment.location_type}</span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Clock size={14} className="text-gray-400" />
            <div>
              <p className="text-xs text-gray-400">Inicio</p>
              <p>{formatDateTime(appointment.start_time)}</p>
            </div>
          </div>
          {appointment.end_time && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <Clock size={14} className="text-gray-400" />
              <div>
                <p className="text-xs text-gray-400">Fin</p>
                <p>{formatDateTime(appointment.end_time)}</p>
              </div>
            </div>
          )}
        </div>

        {appointment.lead && (
          <div className="flex items-center gap-2 text-sm">
            <User size={14} className="text-gray-400" />
            <span className="text-gray-600">Lead: <strong>{appointment.lead.name}</strong></span>
            {(appointment.lead as unknown as { phone?: string }).phone && (
              <span className="text-gray-400">• {(appointment.lead as unknown as { phone: string }).phone}</span>
            )}
          </div>
        )}

        {appointment.project && (
          <div className="flex items-center gap-2 text-sm">
            <MapPin size={14} className="text-gray-400" />
            <span className="text-gray-600">{appointment.project.name}</span>
          </div>
        )}

        {appointment.responsible?.full_name && (
          <div className="flex items-center gap-2 text-sm">
            <User size={14} className="text-gray-400" />
            <span className="text-gray-600">Responsable: {appointment.responsible.full_name}</span>
          </div>
        )}

        {appointment.notes && (
          <div className="rounded-lg bg-gray-50 p-3">
            <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
              <FileText size={12} /> Notas
            </div>
            <p className="text-sm text-gray-700">{appointment.notes}</p>
          </div>
        )}

        <div className="border-t border-gray-100 pt-4">
          <p className="text-sm font-medium text-gray-700 mb-2">Cambiar estado</p>
          <div className="flex gap-3">
            <Select options={APPOINTMENT_STATUS_OPTIONS} value={newStatus || appointment.status} onChange={(e) => setNewStatus(e.target.value)} className="flex-1" />
            <Button onClick={handleSave} disabled={!newStatus || newStatus === appointment.status}>Guardar</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
