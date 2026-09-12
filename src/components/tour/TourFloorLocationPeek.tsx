'use client'

import { useEffect, useMemo, useState } from 'react'
import Image from 'next/image'
import { floorPlanLevelLabel, unitFloorNumber } from '@/lib/tour/floorPlanHotspots'
import { fetchFloorPlanDoc, versionedFloorPlanUrl } from '@/lib/tour/floorPlanClientCache'
import type { FloorPlanZonesDoc } from '@/lib/tour/floorPlanZones'
import {
  applyOverlayAlign,
  getFloorPlanOverlayAlign,
  getFloorPlanVariantMedia,
  zoneDisplayPointsPercent,
} from '@/lib/tour/floorPlanZones'
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
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/^lc[-\s]?/i, '')
      .replace(/^0+/, '') || value.trim().toLowerCase()
  )
}

/** Resuelve la zona del plano que corresponde a esta unidad. */
function findZoneIdForUnit(
  unit: TourUnitSummary,
  zones: { id: string; label: string }[],
): string | null {
  const unitRaw = unit.unit_number.trim().toLowerCase()
  const unitNorm = normalizeUnitCode(unit.unit_number)

  const exact =
    zones.find((zone) => zone.id.trim().toLowerCase() === unitRaw) ??
    zones.find((zone) => zone.label.trim().toLowerCase() === unitRaw) ??
    null
  if (exact) return exact.id

  const byNorm =
    zones.find((zone) => normalizeUnitCode(zone.id) === unitNorm) ??
    zones.find((zone) => normalizeUnitCode(zone.label) === unitNorm) ??
    null
  if (byNorm) return byNorm.id

  const contained = zones.find((zone) => {
    const label = zone.label.trim().toLowerCase()
    const id = zone.id.trim().toLowerCase()
    return (
      label.includes(unitRaw) ||
      id.includes(unitRaw) ||
      (unitNorm.length >= 2 &&
        (normalizeUnitCode(zone.id) === unitNorm || normalizeUnitCode(zone.label).endsWith(unitNorm)))
    )
  })
  return contained?.id ?? null
}

function useCoarsePointer() {
  const [coarse, setCoarse] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(hover: none), (pointer: coarse)')
    const sync = () => setCoarse(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])
  return coarse
}

export function TourFloorLocationPeek({ unit }: TourFloorLocationPeekProps) {
  const coarsePointer = useCoarsePointer()
  const [hoverOpen, setHoverOpen] = useState(false)
  const [tapOpen, setTapOpen] = useState(false)
  const [planDoc, setPlanDoc] = useState<FloorPlanZonesDoc | null>(null)

  const floor = unit ? unitFloorNumber(unit) : null
  // Celular: solo tap. Desktop: hover o click para fijar.
  const grown = coarsePointer ? tapOpen : hoverOpen || tapOpen

  useEffect(() => {
    setTapOpen(false)
    setHoverOpen(false)
  }, [unit?.id])

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

  const overlayAlign = useMemo(
    () => getFloorPlanOverlayAlign(planDoc, '2d'),
    [planDoc],
  )

  const displaySlots = useMemo<DisplaySlot[]>(() => {
    if (!planDoc?.zones?.length) return []
    return [...planDoc.zones]
      .sort((a, b) => a.order - b.order)
      .filter((zone) => zone.pointsPercent.trim())
      .map((zone) => ({
        id: zone.id,
        label: zone.label || zone.id,
        points: applyOverlayAlign(zoneDisplayPointsPercent(zone), overlayAlign),
      }))
  }, [planDoc, overlayAlign])

  const activeSlotId = useMemo(() => {
    if (!unit || !planDoc?.zones?.length) return null
    return findZoneIdForUnit(unit, planDoc.zones)
  }, [unit, planDoc])

  if (!unit) return null

  const media = getFloorPlanVariantMedia(planDoc, '2d')
  const planImageUrl = versionedFloorPlanUrl(
    media.imageUrl || planDoc?.imageUrl,
    planDoc?.updatedAt,
  )

  if (!planImageUrl) return null

  const planW = media.imageWidth > 1 ? media.imageWidth : planDoc?.imageWidth || 1024
  const planH = media.imageHeight > 1 ? media.imageHeight : planDoc?.imageHeight || 499

  return (
    <div
      className="pointer-events-auto relative z-[40]"
      onMouseEnter={() => {
        if (!coarsePointer) setHoverOpen(true)
      }}
      onMouseLeave={() => {
        if (!coarsePointer && !tapOpen) setHoverOpen(false)
      }}
      onFocus={() => {
        if (!coarsePointer) setHoverOpen(true)
      }}
      onBlur={(event) => {
        if (
          !coarsePointer &&
          !tapOpen &&
          !event.currentTarget.contains(event.relatedTarget as Node | null)
        ) {
          setHoverOpen(false)
        }
      }}
    >
      <button
        type="button"
        onClick={() => {
          setTapOpen((value) => {
            const next = !value
            if (!next) setHoverOpen(false)
            return next
          })
        }}
        className={cn(
          'origin-bottom-right overflow-hidden rounded-2xl bg-[#1a1714] ring-1 ring-white/20 transition-[width,transform,box-shadow] duration-300 ease-out',
          grown
            ? 'w-72 translate-y-[-8px] scale-105 shadow-[0_22px_50px_rgba(0,0,0,0.55)] sm:w-80 sm:translate-y-[-12px] sm:scale-110'
            : 'w-28 shadow-[0_8px_24px_rgba(0,0,0,0.35)] sm:w-32',
        )}
        style={{ aspectRatio: `${planW} / ${planH}` }}
        aria-label={`Ubicación en ${floor != null ? floorPlanLevelLabel(floor) : 'piso'} · Unidad ${unit.unit_number}`}
        aria-expanded={grown}
      >
        <div className="relative h-full w-full">
          <Image
            key={planImageUrl}
            src={planImageUrl}
            alt=""
            fill
            unoptimized={planImageUrl.startsWith('http')}
            className="object-fill"
            sizes="320px"
            priority={grown}
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
                      ? grown
                        ? 'rgba(61,155,74,0.55)'
                        : 'rgba(61,155,74,0.42)'
                      : 'rgba(255,255,255,0.015)'
                  }
                  stroke={
                    active ? 'rgba(61,155,74,0.95)' : 'rgba(255,255,255,0.06)'
                  }
                  strokeWidth={active ? 0.5 : 0.12}
                  vectorEffect="non-scaling-stroke"
                />
              )
            })}
          </svg>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-2 pb-1.5 pt-5">
            <p
              className={cn(
                'text-center font-semibold tracking-wide text-white',
                grown ? 'text-[12px]' : 'text-[9px]',
              )}
            >
              {grown
                ? `Unidad ${unit.unit_number}${floor != null ? ` · ${floorPlanLevelLabel(floor)}` : ''}`
                : 'Ubicación en piso'}
            </p>
          </div>
        </div>
      </button>
    </div>
  )
}
