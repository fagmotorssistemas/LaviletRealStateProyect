'use client'

import { cn } from '@/lib/utils'

const unitStatusColors: Record<string, string> = {
  disponible: 'bg-green-100 text-green-700',
  en_preventa: 'bg-blue-100 text-blue-700',
  reservado: 'bg-amber-100 text-amber-700',
  en_proceso: 'bg-purple-100 text-purple-700',
  bajo_contrato: 'bg-gray-200 text-gray-700',
  vendido: 'bg-red-100 text-red-700',
  deshabilitado: 'bg-gray-300 text-gray-600',
}

const leadStatusColors: Record<string, string> = {
  nuevo: 'bg-blue-100 text-blue-700',
  interesado: 'bg-cyan-100 text-cyan-700',
  en_contacto: 'bg-indigo-100 text-indigo-700',
  agendado: 'bg-violet-100 text-violet-700',
  en_negociacion: 'bg-amber-100 text-amber-700',
  reservado: 'bg-orange-100 text-orange-700',
  vendido: 'bg-green-100 text-green-700',
  no_interesado: 'bg-gray-200 text-gray-600',
}

const appointmentStatusColors: Record<string, string> = {
  pendiente: 'bg-amber-100 text-amber-700',
  aceptado: 'bg-green-100 text-green-700',
  reprogramado: 'bg-blue-100 text-blue-700',
  atendido: 'bg-gray-200 text-gray-700',
  cancelado: 'bg-red-100 text-red-700',
}

const contractStatusColors: Record<string, string> = {
  pendiente: 'bg-amber-100 text-amber-700',
  firmado: 'bg-green-100 text-green-700',
  anulado: 'bg-red-100 text-red-700',
}

type BadgeType = 'unit' | 'lead' | 'appointment' | 'contract'

const colorMaps: Record<BadgeType, Record<string, string>> = {
  unit: unitStatusColors,
  lead: leadStatusColors,
  appointment: appointmentStatusColors,
  contract: contractStatusColors,
}

interface StatusBadgeProps {
  status: string
  type: BadgeType
  className?: string
}

export function StatusBadge({ status, type, className }: StatusBadgeProps) {
  const colors = colorMaps[type]?.[status] ?? 'bg-gray-100 text-gray-600'
  const label = status.replace(/_/g, ' ')

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
        colors,
        className
      )}
    >
      {label}
    </span>
  )
}
