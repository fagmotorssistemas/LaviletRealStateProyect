'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import { Minus, Plus } from 'lucide-react'
import {
  FLOOR_PLAN_FLOORS,
  FLOOR_PLAN_IMAGE,
  FLOOR_PLAN_SLOTS,
  unitFloorNumber,
} from '@/lib/tour/floorPlanHotspots'
import { FLOOR_PLAN_WHATSAPP_MESSAGE, tourWhatsAppHref } from '@/lib/tour/tourWhatsApp'
import { SITE } from '@/lib/marketing/site'
import type { TourUnitSummary } from '@/types/tour'
import { cn } from '@/lib/utils'

type TourFloorPlanProps = {
  units: TourUnitSummary[]
  floor: number
  onFloorChange: (floor: number) => void
  selectedUnitId: string | null
  onSelectUnit: (unit: TourUnitSummary, slotId: string) => void
  onWhatsAppClick?: () => void
}

const ZOOM_MIN = 1
const ZOOM_MAX = 2.5
const ZOOM_STEP = 0.2

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

function WhatsAppIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}

export function TourFloorPlan({
  units,
  floor,
  onFloorChange,
  selectedUnitId,
  onSelectUnit,
  onWhatsAppClick,
}: TourFloorPlanProps) {
  const [hoverSlot, setHoverSlot] = useState<string | null>(null)
  const [scale, setScale] = useState(1)
  const whatsappHref = tourWhatsAppHref(FLOOR_PLAN_WHATSAPP_MESSAGE)

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

  const zoomOut = () => setScale((value) => Math.max(ZOOM_MIN, Number((value - ZOOM_STEP).toFixed(2))))
  const zoomIn = () => setScale((value) => Math.min(ZOOM_MAX, Number((value + ZOOM_STEP).toFixed(2))))

  return (
    <div className="absolute inset-0 z-[18] flex bg-[#14110e]">
      {/* Plano */}
      <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden p-2 sm:p-3">
        <div
          className="relative w-full max-h-full overflow-hidden rounded-xl bg-[#1a1714] ring-1 ring-white/10"
          style={{ aspectRatio: '1024 / 499' }}
        >
          <div
            className="absolute inset-0 origin-center transition-transform duration-200 ease-out"
            style={{ transform: `scale(${scale})` }}
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

        <div className="pointer-events-auto absolute bottom-3 left-3 z-20 flex flex-col gap-1.5 sm:bottom-4 sm:left-4">
          <button
            type="button"
            onClick={zoomIn}
            disabled={scale >= ZOOM_MAX}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-[#1a2744] shadow-[0_4px_14px_rgba(15,23,42,0.22)] ring-1 ring-black/10 transition-opacity disabled:opacity-40"
            aria-label="Acercar plano"
            title="Acercar"
          >
            <Plus size={18} strokeWidth={2.25} />
          </button>
          <button
            type="button"
            onClick={zoomOut}
            disabled={scale <= ZOOM_MIN}
            className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-[#1a2744] shadow-[0_4px_14px_rgba(15,23,42,0.22)] ring-1 ring-black/10 transition-opacity disabled:opacity-40"
            aria-label="Alejar plano"
            title="Alejar"
          >
            <Minus size={18} strokeWidth={2.25} />
          </button>
        </div>
      </div>

      {/* Selector de piso + WhatsApp */}
      <div className="pointer-events-auto flex shrink-0 flex-col items-center justify-between gap-2 py-2 pr-2 sm:gap-2.5 sm:pr-3">
        <div className="flex min-h-0 flex-1 flex-col justify-center">
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
        {SITE.whatsapp && whatsappHref ? (
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onWhatsAppClick?.()}
            className="tour-whatsapp-btn tour-glass shrink-0"
            aria-label="Consultar por WhatsApp"
            title="Consultar por WhatsApp"
          >
            <WhatsAppIcon size={16} />
          </a>
        ) : null}
      </div>
    </div>
  )
}
