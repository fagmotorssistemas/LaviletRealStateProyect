'use client'

import { cn } from '@/lib/utils'

const unitStatusColors: Record<string, string> = {
  disponible: 'border-[#8aa090] bg-[#e8eee8] text-[#4d5c50]',
  en_preventa: 'border-[#8b917c] bg-[#e8e9e3] text-[#3a3d36]',
  reservado: 'border-[#8b917c] bg-[#e2e4dc] text-[#5c6156]',
  en_proceso: 'border-[#c5c8bc] bg-[#f4f4ef] text-[#3a3d36]',
  bajo_contrato: 'border-[#8b917c] bg-[#f4f4ef] text-[#3a3d36]',
  vendido: 'border-[#555c4a] bg-[#555c4a] text-[#f4f4ef]',
  deshabilitado: 'border-[#c5c8bc] bg-[#e8e9e3] text-[#7a7e70]',
}

const leadStatusColors: Record<string, string> = {
  nuevo: 'border-[#8b917c] bg-[#e8e9e3] text-[#3a3d36]',
  interesado: 'border-[#8aa090] bg-[#e8eee8] text-[#4d5c50]',
  en_contacto: 'border-[#c5c8bc] bg-[#f4f4ef] text-[#3a3d36]',
  agendado: 'border-[#8b917c] bg-[#e2e4dc] text-[#5c6156]',
  en_negociacion: 'border-[#8b917c] bg-[#c5c8bc] text-[#3a3d36]',
  reservado: 'border-[#8b917c] bg-[#f4f4ef] text-[#5c6156]',
  vendido: 'border-[#555c4a] bg-[#555c4a] text-[#f4f4ef]',
  no_interesado: 'border-[#c5c8bc] bg-[#e8e9e3] text-[#7a7e70]',
}

const appointmentStatusColors: Record<string, string> = {
  pendiente: 'border-[#8b917c] bg-[#e2e4dc] text-[#5c6156]',
  aceptado: 'border-[#8aa090] bg-[#e8eee8] text-[#4d5c50]',
  reprogramado: 'border-[#8b917c] bg-[#e8e9e3] text-[#3a3d36]',
  atendido: 'border-[#c5c8bc] bg-[#f4f4ef] text-[#3a3d36]',
  cancelado: 'border-[#c4a8a5] bg-[#f3eaea] text-[#8a5c58]',
}

const contractStatusColors: Record<string, string> = {
  pendiente: 'border-[#8b917c] bg-[#e2e4dc] text-[#5c6156]',
  firmado: 'border-[#8aa090] bg-[#e8eee8] text-[#4d5c50]',
  anulado: 'border-[#c4a8a5] bg-[#f3eaea] text-[#8a5c58]',
}

const financingStatusColors: Record<string, string> = {
  simulado: 'border-[#c5c8bc] bg-[#f4f4ef] text-[#3a3d36]',
  preaprobado: 'border-[#8b917c] bg-[#e8e9e3] text-[#3a3d36]',
  en_tramite: 'border-[#8b917c] bg-[#e2e4dc] text-[#5c6156]',
  aprobado: 'border-[#8aa090] bg-[#e8eee8] text-[#4d5c50]',
  negado: 'border-[#c4a8a5] bg-[#f3eaea] text-[#8a5c58]',
}

const leadTemperatureColors: Record<string, string> = {
  frio: 'border-[#c5c8bc] bg-[#f4f4ef] text-[#5c6156]',
  tibio: 'border-[#8b917c] bg-[#e8e9e3] text-[#3a3d36]',
  caliente: 'border-[#c4a8a5] bg-[#f3eaea] text-[#8a5c58]',
}

const leadTemperatureLabels: Record<string, string> = {
  frio: 'Frío',
  tibio: 'Tibio',
  caliente: 'Caliente',
}

type BadgeType = 'unit' | 'lead' | 'appointment' | 'contract' | 'financing' | 'temperature'

const colorMaps: Record<BadgeType, Record<string, string>> = {
  unit: unitStatusColors,
  lead: leadStatusColors,
  appointment: appointmentStatusColors,
  contract: contractStatusColors,
  financing: financingStatusColors,
  temperature: leadTemperatureColors,
}

interface StatusBadgeProps {
  status: string
  type: BadgeType
  className?: string
}

export function StatusBadge({ status, type, className }: StatusBadgeProps) {
  const colors = colorMaps[type]?.[status] ?? 'border-[#c5c8bc] bg-[#f4f4ef] text-[#5c6156]'
  const label =
    type === 'temperature' ? (leadTemperatureLabels[status] ?? status) : status.replace(/_/g, ' ')

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-sm border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]',
        colors,
        className,
      )}
    >
      {label}
    </span>
  )
}
