'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import {
  FLOOR_PLAN_FLOORS,
  FLOOR_PLAN_IMAGE,
  FLOOR_PLAN_SLOTS,
  unitFloorNumber,
} from '@/lib/tour/floorPlanHotspots'
import type { TourUnitSummary } from '@/types/tour'
import { cn } from '@/lib/utils'

type TourFloorPlanProps = {
  units: TourUnitSummary[]
  floor: number
  onFloorChange: (floor: number) => void
  selectedUnitId: string | null
  onSelectUnit: (unit: TourUnitSummary, slotId: string) => void
}

/** Verde disponible / rojo no disponible — estilo referencia showroom */
function statusDotClass(status: TourUnitSummary['status']) {
  if (status === 'disponible' || status === 'en_preventa') return 'bg-[#2f9e44]'
  if (status === 'reservado' || status === 'en_proceso' || status === 'bajo_contrato') {
    return 'bg-[#d64545]'
  }
  if (status === 'vendido' || status === 'deshabilitado') return 'bg-[#d64545]'
  return 'bg-[#9ca3af]'
}

function slotCentroid(points: string) {
  const xs = points.split(' ').map((p) => Number(p.split(',')[0]))
  const ys = points.split(' ').map((p) => Number(p.split(',')[1]))
  return {
    cx: (Math.min(...xs) + Math.max(...xs)) / 2,
    cy: (Math.min(...ys) + Math.max(...ys)) / 2,
  }
}

export function TourFloorPlan({
  units,
  floor,
  onFloorChange,
  selectedUnitId,
  onSelectUnit,
}: TourFloorPlanProps) {
  const [hoverSlot, setHoverSlot] = useState<string | null>(null)

  const unitsOnFloor = useMemo(() => {
    const matched = units.filter((unit) => unitFloorNumber(unit) === floor)
    const list = matched.length > 0 ? matched : units
    return [...list].sort((a, b) =>
      a.unit_number.localeCompare(b.unit_number, 'es', { numeric: true }),
    )
  }, [units, floor])

  const slotUnits = useMemo(() => {
    const map = new Map<string, TourUnitSummary | null>()
    for (const slot of FLOOR_PLAN_SLOTS) {
      map.set(slot.id, unitsOnFloor[slot.order] ?? null)
    }
    return map
  }, [unitsOnFloor])

  return (
    <div className="absolute inset-0 z-[18] flex bg-[#14110e]">
      {/* Plano */}
      <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center p-2 sm:p-3">
        <div
          className="relative w-full max-h-full overflow-hidden rounded-xl bg-[#1a1714] ring-1 ring-white/10"
          style={{ aspectRatio: '1024 / 499' }}
        >
          <Image
            src={FLOOR_PLAN_IMAGE}
            alt={`Plano del piso ${floor}`}
            fill
            priority
            className="object-fill"
            sizes="(max-width: 1024px) 100vw, 1100px"
          />

          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
            role="img"
            aria-label="Departamentos del piso"
          >
            {FLOOR_PLAN_SLOTS.map((slot) => {
              const unit = slotUnits.get(slot.id) ?? null
              const selected = Boolean(unit && unit.id === selectedUnitId)
              const hovered = hoverSlot === slot.id
              return (
                <polygon
                  key={slot.id}
                  points={slot.points}
                  className={cn(
                    'cursor-pointer transition-[fill,stroke] duration-200',
                    !unit && 'cursor-not-allowed',
                  )}
                  fill={
                    selected
                      ? 'rgba(61,155,74,0.38)'
                      : hovered && unit
                        ? 'rgba(61,155,74,0.18)'
                        : 'rgba(255,255,255,0.02)'
                  }
                  stroke={
                    selected
                      ? 'rgba(61,155,74,0.95)'
                      : hovered && unit
                        ? 'rgba(255,255,255,0.55)'
                        : 'rgba(255,255,255,0.12)'
                  }
                  strokeWidth={selected || hovered ? 0.4 : 0.2}
                  vectorEffect="non-scaling-stroke"
                  onMouseEnter={() => setHoverSlot(slot.id)}
                  onMouseLeave={() => setHoverSlot(null)}
                  onClick={() => {
                    if (!unit) return
                    onSelectUnit(unit, slot.id)
                  }}
                />
              )
            })}
          </svg>

          {/* Botones de departamento — pill blanca + dot */}
          <div className="absolute inset-0">
            {FLOOR_PLAN_SLOTS.map((slot) => {
              const unit = slotUnits.get(slot.id) ?? null
              const { cx, cy } = slotCentroid(slot.points)
              const selected = Boolean(unit && unit.id === selectedUnitId)
              const hovered = hoverSlot === slot.id
              const label = unit?.unit_number ?? slot.label

              return (
                <button
                  key={`label-${slot.id}`}
                  type="button"
                  disabled={!unit}
                  onMouseEnter={() => setHoverSlot(slot.id)}
                  onMouseLeave={() => setHoverSlot(null)}
                  onClick={() => {
                    if (!unit) return
                    onSelectUnit(unit, slot.id)
                  }}
                  className={cn(
                    'absolute z-[2] flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 rounded-md bg-white px-2 py-1 text-left shadow-[0_2px_8px_rgba(15,23,42,0.22)] transition-[transform,box-shadow] duration-150',
                    'sm:gap-2 sm:rounded-lg sm:px-2.5 sm:py-1.5',
                    unit
                      ? 'cursor-pointer hover:shadow-[0_4px_14px_rgba(15,23,42,0.28)]'
                      : 'cursor-not-allowed opacity-55',
                    (selected || hovered) && unit && 'ring-2 ring-[#3d9b4a]/45',
                  )}
                  style={{ left: `${cx}%`, top: `${cy}%` }}
                  aria-label={unit ? `Departamento ${label}` : `Zona ${label}`}
                >
                  <span
                    className={cn(
                      'h-2 w-2 shrink-0 rounded-full sm:h-2.5 sm:w-2.5',
                      unit ? statusDotClass(unit.status) : 'bg-[#c4c4c4]',
                    )}
                  />
                  <span className="text-[10px] font-semibold tracking-wide text-[#2b2f36] sm:text-[11px]">
                    {label}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Selector de piso vertical */}
      <div className="pointer-events-auto flex shrink-0 flex-col justify-center py-2 pr-2 sm:pr-3">
        <div className="flex max-h-full flex-col gap-1 overflow-y-auto rounded-xl bg-white/92 p-1.5 shadow-[0_8px_24px_rgba(15,23,42,0.18)] backdrop-blur-sm sm:gap-1.5 sm:p-2">
          {FLOOR_PLAN_FLOORS.map((item) => {
            const active = item === floor
            return (
              <button
                key={item}
                type="button"
                onClick={() => onFloorChange(item)}
                className={cn(
                  'min-w-[2.35rem] rounded-lg px-2 py-1.5 text-[11px] font-semibold tracking-wide transition-colors sm:min-w-[2.6rem] sm:px-2.5 sm:py-2 sm:text-[12px]',
                  active
                    ? 'bg-[#1a2744] text-white shadow-sm'
                    : 'bg-white text-[#3a4050] hover:bg-[#eef1f6]',
                )}
                aria-pressed={active}
                aria-label={`Piso ${item}`}
              >
                {item}°
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
