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
  solicitada: 'border-[#8b917c] bg-[#e2e4dc] text-[#5c6156]',
  pendiente: 'border-[#8b917c] bg-[#e2e4dc] text-[#5c6156]',
  solicitada: 'border-[#8b917c] bg-[#e8e9e3] text-[#3a3d36]',
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

<<<<<<< Updated upstream
type BadgeType =
  | 'unit'
  | 'lead'
  | 'appointment'
  | 'contract'
  | 'financing'
  | 'temperature'
  | 'stage'
  | 'handoff'
  | 'bot'
  | 'sla'
=======
const stageColors: Record<string, string> = {
  lanzamiento: 'border-[#8b917c] bg-[#e8e9e3] text-[#3a3d36]',
  precalificacion: 'border-[#8aa090] bg-[#e8eee8] text-[#4d5c50]',
  nutricion: 'border-[#8b917c] bg-[#e2e4dc] text-[#5c6156]',
  preventa: 'border-[#BDA27E]/50 bg-[#f7f3ee] text-[#7a6548]',
  reserva_venta: 'border-[#2B1A18] bg-[#2B1A18] text-[#f7f3ee]',
}

const slaColors: Record<string, string> = {
  no_aplica: 'border-[#c5c8bc] bg-[#f4f4ef] text-[#7a7e70]',
  pendiente: 'border-[#e07a5f]/40 bg-[#fdeee8] text-[#c45c3e]',
  vencido: 'border-[#c45c4a]/45 bg-[#f8e6e4] text-[#b42318]',
  respondido: 'border-[#8aa090] bg-[#e8eee8] text-[#4d5c50]',
}

const botColors: Record<string, string> = {
  activo: 'border-[#8aa090] bg-[#e8eee8] text-[#4d5c50]',
  desactivado: 'border-[#c5c8bc] bg-[#e8e9e3] text-[#7a7e70]',
}

const handoffColors: Record<string, string> = {
  none: 'border-[#c5c8bc] bg-[#f4f4ef] text-[#7a7e70]',
  queued: 'border-[#e07a5f]/40 bg-[#fdeee8] text-[#c45c3e]',
  assigned: 'border-[#8aa090] bg-[#e8eee8] text-[#4d5c50]',
  acknowledged: 'border-[#8aa090] bg-[#e8eee8] text-[#4d5c50]',
  resolved: 'border-[#8aa090] bg-[#e8eee8] text-[#4d5c50]',
}

const stageLabels: Record<string, string> = {
  lanzamiento: 'Lanzamiento',
  precalificacion: 'Precalificación',
  nutricion: 'Nutrición',
  preventa: 'Preventa',
  reserva_venta: 'Reserva / venta',
}

const slaLabels: Record<string, string> = {
  no_aplica: 'No aplica',
  pendiente: 'Pendiente',
  vencido: 'Vencido',
  respondido: 'Respondido',
}

const botLabels: Record<string, string> = {
  activo: 'Bot activo',
  desactivado: 'Bot desactivado',
}

const handoffLabels: Record<string, string> = {
  none: 'Sin traspaso',
  queued: 'En cola',
  assigned: 'Asignado',
  acknowledged: 'Reconocido',
  resolved: 'Resuelto',
}

type BadgeType = 'unit' | 'lead' | 'appointment' | 'contract' | 'financing' | 'temperature' | 'stage' | 'sla' | 'bot' | 'handoff'
>>>>>>> Stashed changes

const colorMaps: Record<BadgeType, Record<string, string>> = {
  unit: unitStatusColors,
  lead: leadStatusColors,
  appointment: appointmentStatusColors,
  contract: contractStatusColors,
  financing: financingStatusColors,
  temperature: leadTemperatureColors,
<<<<<<< Updated upstream

  stage: {},
  handoff: {},
  bot: {
    activo: 'border-[#8aa090] bg-[#e8eee8] text-[#4d5c50]',
    desactivado: 'border-[#c5c8bc] bg-[#e8e9e3] text-[#7a7e70]',
  },
  sla: {},
=======
  stage: stageColors,
  sla: slaColors,
  bot: botColors,
  handoff: handoffColors,
>>>>>>> Stashed changes
}

interface StatusBadgeProps {
  status: string
  type: BadgeType
  className?: string
}

export function StatusBadge({ status, type, className }: StatusBadgeProps) {
  const colors = colorMaps[type]?.[status] ?? 'border-[#c5c8bc] bg-[#f4f4ef] text-[#5c6156]'
  const extraLabels: Partial<Record<BadgeType, Record<string, string>>> = {
    temperature: leadTemperatureLabels,
    stage: stageLabels,
    sla: slaLabels,
    bot: botLabels,
    handoff: handoffLabels,
  }
  const label = extraLabels[type]?.[status] ?? status.replace(/_/g, ' ')
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
