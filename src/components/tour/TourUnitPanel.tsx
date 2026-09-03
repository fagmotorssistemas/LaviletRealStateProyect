'use client'

import { UNIT_STATUS_OPTIONS, type UnitStatus } from '@/types/inmobiliaria'
import type { TourUnitSummary } from '@/types/tour'
import { cn } from '@/lib/utils'

type TourUnitPanelProps = {
  unitTypeName: string
  unit: TourUnitSummary | null
  unitCount: number
}

function statusLabel(status: UnitStatus): string {
  return UNIT_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status
}

function compactPrice(value: number | null): string {
  if (value == null) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value)
}

function statusClass(status: UnitStatus): string {
  if (status === 'disponible' || status === 'en_preventa') return 'bg-[#787D62] text-white'
  if (status === 'reservado' || status === 'en_proceso' || status === 'bajo_contrato') {
    return 'bg-[#BDA27E] text-[#2B1A18]'
  }
  return 'bg-white/20 text-white/80'
}

export function TourUnitPanel({ unitTypeName, unit, unitCount }: TourUnitPanelProps) {
  if (!unit) return null

  return (
    <div className="max-w-[16.5rem] rounded-[4px] bg-black/55 px-3 py-2.5 text-white shadow-lg ring-1 ring-white/15 backdrop-blur-sm">
      <p className="text-[10px] font-semibold tracking-[0.16em] text-white/50 uppercase">
        {unitTypeName}
        {unitCount > 1 ? ` · ${unitCount} uds.` : ''}
      </p>
      <div className="mt-1 flex items-baseline justify-between gap-3">
        <p className="text-[17px] leading-none font-semibold tracking-wide">{unit.unit_number}</p>
        <p className="text-[15px] leading-none font-semibold tabular-nums">{compactPrice(unit.published_commercial_price)}</p>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span className={cn('rounded-[4px] px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase', statusClass(unit.status))}>
          {statusLabel(unit.status)}
        </span>
        {unit.area_total_m2 != null && (
          <span className="text-[11px] text-white/65">{unit.area_total_m2} m²</span>
        )}
        {unit.bedrooms != null && (
          <span className="text-[11px] text-white/65">{unit.bedrooms} hab.</span>
        )}
      </div>
    </div>
  )
}
