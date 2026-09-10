'use client'

import { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import { floorPlanLevelLabel, unitFloorNumber } from '@/lib/tour/floorPlanHotspots'
import { fetchFloorPlanDoc, versionedFloorPlanUrl } from '@/lib/tour/floorPlanClientCache'
import type { FloorPlanZonesDoc } from '@/lib/tour/floorPlanZones'
import { getFloorPlanVariantMedia, zoneDisplayPointsPercent } from '@/lib/tour/floorPlanZones'
import type { TourUnitSummary } from '@/types/tour'
import { cn } from '@/lib/utils'

type TourFloorLocationPeekProps = {
  unit: TourUnitSummary | null
  units: TourUnitSummary[]
}

type DisplaySlot = {
  id: string
  label: string
  points: string
}

function normalizeUnitCode(value: string) {
  return value.trim().toLowerCase().replace(/^lc[-\s]?/i, '').replace(/^0+/, '') || value.trim().toLowerCase()
}

function findUnitForZone(units: TourUnitSummary[], zoneId: string, zoneLabel: string) {
  const needles = [zoneId, zoneLabel]
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
  if (needles.length === 0) return null
  const byExact =
    units.find((item) => needles.includes(item.unit_number.trim().toLowerCase())) ??
    units.find((item) => item.id === zoneId) ??
    null
  if (byExact) return byExact
  const normalizedNeedles = new Set(needles.map(normalizeUnitCode))
  return (
    units.find((item) => normalizedNeedles.has(normalizeUnitCode(item.unit_number))) ?? null
  )
}

export function TourFloorLocationPeek({
  unit,
}: TourFloorLocationPeekProps) {
  const [expanded, setExpanded] = useState(false)
  const [planDoc, setPlanDoc] = useState<FloorPlanZonesDoc | null>(null)

  const floor = unit ? unitFloorNumber(unit) : null

  useEffect(() => {
    let cancelled = false
    if (floor == null) {
      setPlanDoc(null)
      return
    }
    void fetchFloorPlanDoc(floor)
      .then((doc) => {
        if (!cancelled) setPlanDoc(doc)
      })
      .catch(() => {
        if (!cancelled) setPlanDoc(null)
      })
    return () => {
      cancelled = true
    }
  }, [floor])

  const displaySlots = useMemo<DisplaySlot[]>(() => {
    if (!planDoc?.zones?.length) return []
    return [...planDoc.zones]
      .sort((a, b) => a.order - b.order)
      .filter((zone) => zone.pointsPercent.trim())
      .map((zone) => ({
        id: zone.id,
        label: zone.label || zone.id,
        points: zoneDisplayPointsPercent(zone),
      }))
  }, [planDoc])

  const activeSlotId = useMemo(() => {
    if (!unit || !planDoc?.zones?.length) return null
    const match = planDoc.zones.find((zone) => findUnitForZone([unit], zone.id, zone.label))
    if (match) return match.id
    return (
      planDoc.zones.find(
        (zone) =>
          zone.label.trim().toLowerCase() === unit.unit_number.trim().toLowerCase() ||
          zone.id.trim().toLowerCase() === unit.unit_number.trim().toLowerCase(),
      )?.id ?? null
    )
  }, [unit, planDoc])

  if (!unit) return null

  const media = getFloorPlanVariantMedia(planDoc, '2d')
  const planImageUrl = versionedFloorPlanUrl(
    media.imageUrl || planDoc?.imageUrl,
    planDoc?.updatedAt,
  )

  // Sin plano real no mostramos el peek del ejemplo viejo.
  if (!planImageUrl) return null

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
        aria-label={`Ubicación en ${floor != null ? floorPlanLevelLabel(floor) : 'piso'} · Unidad ${unit.unit_number}`}
        aria-expanded={expanded}
      >
        <div className="relative h-full w-full">
          <Image
            key={planImageUrl}
            src={planImageUrl}
            alt=""
            fill
            unoptimized={planImageUrl.startsWith('http')}
            className="object-cover"
            sizes="256px"
          />
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
            aria-hidden
          >
            {displaySlots.map((slot) => {
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
