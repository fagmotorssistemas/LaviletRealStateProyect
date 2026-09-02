'use client'

import { Thermometer } from 'lucide-react'
import { cn } from '@/lib/utils'

const unitStatusColors: Record<string, string> = {
  disponible: 'border-[#8aa090] bg-[#e8eee8] text-[#4d5c50]',
  en_preventa: 'border-[#8b917c] bg-[#e8e9e3] text-[#3a3d36]',
  reservado: 'border-[#8b917c] bg-[#e2e4dc] text-[#5c6156]',
  en_proceso: 'border-[#c5c8bc] bg-[#f4f4ef] text-[#3a3d36]',
  bajo_contrato: 'border-[#8b917c] bg-[#f4f4ef] text-[#3a3d36]',
  vendido: 'border-[#2B1A18] bg-[#2B1A18] text-[#f7f3ee]',
  deshabilitado: 'border-[#c5c8bc] bg-[#e8e9e3] text-[#7a7e70]',
}

const leadStatusColors: Record<string, string> = {
  nuevo: 'border-[#8b917c] bg-[#e8e9e3] text-[#3a3d36]',
  interesado: 'border-[#8aa090] bg-[#e8eee8] text-[#4d5c50]',
  en_contacto: 'border-[#c5c8bc] bg-[#f4f4ef] text-[#3a3d36]',
  agendado: 'border-[#8b917c] bg-[#e2e4dc] text-[#5c6156]',
  en_negociacion: 'border-[#8b917c] bg-[#c5c8bc] text-[#3a3d36]',
  reservado: 'border-[#8b917c] bg-[#f4f4ef] text-[#5c6156]',
  vendido: 'border-[#2B1A18] bg-[#2B1A18] text-[#f7f3ee]',
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
  frio: 'border-[#7a9bb8]/40 bg-[#e8f1f7] text-[#3d5a73]',
  tibio: 'border-[#e07a5f]/40 bg-[#fdeee8] text-[#c45c3e]',
  caliente: 'border-[#c45c4a]/45 bg-[#f8e6e4] text-[#b42318]',
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
  const isTemperature = type === 'temperature'

  return (
    <span
      className={cn(
        'inline-flex items-center justify-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wide whitespace-nowrap',
        isTemperature && 'w-[5.75rem]',
        type === 'lead' && 'w-[9rem] uppercase tracking-[0.06em]',
        !isTemperature && type !== 'lead' && 'uppercase tracking-[0.06em]',
        colors,
        className,
      )}
    >
      {isTemperature && <Thermometer size={12} strokeWidth={1.75} className="shrink-0 opacity-80" />}
      {label}
    </span>
  )
}
