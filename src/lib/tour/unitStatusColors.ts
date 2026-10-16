import type { UnitStatus } from '@/types/inmobiliaria'

type StatusColor = { solid: string; soft: string }

const COLORS: Record<UnitStatus, StatusColor> = {
  disponible: { solid: 'bg-[#2f9e44]', soft: 'bg-[#e5f2e6] text-[#246b32]' },
  en_preventa: { solid: 'bg-[#2b8a7e]', soft: 'bg-[#e0f0ed] text-[#1f6b60]' },
  reservado: { solid: 'bg-[#e8a54b]', soft: 'bg-[#f9ecd8] text-[#8a6230]' },
  en_proceso: { solid: 'bg-[#e07a2f]', soft: 'bg-[#fbe8da] text-[#8c4a1c]' },
  bajo_contrato: { solid: 'bg-[#9a6b4f]', soft: 'bg-[#efe4dc] text-[#6b4a35]' },
  vendido: { solid: 'bg-[#d64545]', soft: 'bg-[#f8e3e3] text-[#9a2f2f]' },
  deshabilitado: { solid: 'bg-[#9ca3af]', soft: 'bg-[#eceaea] text-[#6d645b]' },
}

function statusColor(status?: string | null): StatusColor {
  return status && Object.hasOwn(COLORS, status) ? COLORS[status as UnitStatus] : COLORS.deshabilitado
}

export function unitStatusDot(status?: string | null) {
  return statusColor(status).solid
}

export function unitStatusBadge(status?: string | null) {
  return statusColor(status).solid + ' text-white'
}

export function unitStatusChip(status?: string | null) {
  return statusColor(status).soft
}
