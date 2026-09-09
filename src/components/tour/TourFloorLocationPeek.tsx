'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import {
  FLOOR_PLAN_IMAGE,
  FLOOR_PLAN_SLOTS,
  unitFloorNumber,
} from '@/lib/tour/floorPlanHotspots'
import type { TourUnitSummary } from '@/types/tour'
import { cn } from '@/lib/utils'

type TourFloorLocationPeekProps = {
  unit: TourUnitSummary | null
  units: TourUnitSummary[]
}

function resolveSlotId(unit: TourUnitSummary, unitsOnFloor: TourUnitSummary[]) {
  const byLabel = FLOOR_PLAN_SLOTS.find(
    (slot) => slot.label.trim().toLowerCase() === unit.unit_number.trim().toLowerCase(),
  )
  if (byLabel) return byLabel.id
  const index = unitsOnFloor.findIndex((item) => item.id === unit.id)
  if (index < 0) return null
  return FLOOR_PLAN_SLOTS.find((slot) => slot.order === index)?.id ?? null
}

export function TourFloorLocationPeek({ unit, units }: TourFloorLocationPeekProps) {
  const [expanded, setExpanded] = useState(false)

  const unitsOnFloor = useMemo(() => {
    if (!unit) return []
    const floor = unitFloorNumber(unit)
    const matched =
      floor != null ? units.filter((item) => unitFloorNumber(item) === floor) : units
    const list = matched.length > 0 ? matched : units
    return [...list].sort((a, b) =>
      a.unit_number.localeCompare(b.unit_number, 'es', { numeric: true }),
    )
  }, [unit, units])

  const activeSlotId = useMemo(() => {
    if (!unit) return null
    return resolveSlotId(unit, unitsOnFloor)
  }, [unit, unitsOnFloor])

  if (!unit) return null

  const floor = unitFloorNumber(unit)

  return (
    <div
      className="pointer-events-auto relative"
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      onFocus={() => setExpanded(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setExpanded(false)
        }
      }}
    >
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        className={cn(
          'overflow-hidden rounded-2xl bg-[#1a1714] shadow-[0_8px_24px_rgba(0,0,0,0.35)] ring-1 ring-white/15 transition-[width,height] duration-300 ease-out',
          expanded ? 'h-44 w-56 sm:h-52 sm:w-64' : 'h-16 w-24 sm:h-[4.5rem] sm:w-28',
        )}
        aria-label={`Ubicación en piso${floor ? ` ${floor}` : ''} · Unidad ${unit.unit_number}`}
        aria-expanded={expanded}
      >
        <div className="relative h-full w-full">
          <Image
            src={FLOOR_PLAN_IMAGE}
            alt=""
            fill
            className="object-cover"
            sizes="256px"
          />
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
            aria-hidden
          >
            {FLOOR_PLAN_SLOTS.map((slot) => {
              const active = slot.id === activeSlotId
              return (
                <polygon
                  key={slot.id}
                  points={slot.points}
                  fill={
                    active
                      ? expanded
                        ? 'rgba(61,155,74,0.55)'
                        : 'rgba(61,155,74,0.4)'
                      : 'rgba(255,255,255,0.02)'
                  }
                  stroke={
                    active ? 'rgba(61,155,74,0.95)' : 'rgba(255,255,255,0.08)'
                  }
                  strokeWidth={active ? 0.45 : 0.15}
                  vectorEffect="non-scaling-stroke"
                />
              )
            })}
          </svg>
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-2 pb-1.5 pt-5">
            <p
              className={cn(
                'text-center font-semibold tracking-wide text-white',
                expanded ? 'text-[11px]' : 'text-[9px]',
              )}
            >
              {expanded ? `Unidad ${unit.unit_number}` : 'Ubicación en piso'}
            </p>
          </div>
        </div>
      </button>
    </div>
  )
}
