'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import {
  FLOOR_PLAN_FLOORS,
  floorPlanLevelLabel,
  floorPlanLevelShort,
  unitFloorNumber,
} from '@/lib/tour/floorPlanHotspots'
import {
  fetchFloorPlanDoc,
  getCachedFloorView,
  getReadyFloorView,
  planDocImageUrl,
  preferredFloorVariant,
  prefetchFloorPlans,
  preloadFloorPlanImage,
  warmFloorPlans,
  type ReadyFloorView,
} from '@/lib/tour/floorPlanClientCache'
import { FLOOR_PLAN_WHATSAPP_MESSAGE, tourWhatsAppHref } from '@/lib/tour/tourWhatsApp'
import {
  applyOverlayAlign,
  getFloorPlanOverlayAlign,
  getFloorPlanVariantMedia,
  zoneDisplayPointsPercent,
  type FloorPlanVariant,
} from '@/lib/tour/floorPlanZones'
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

type DisplaySlot = {
  id: string
  label: string
  points: string
  unit: TourUnitSummary | null
}

type FloorLayer = ReadyFloorView & {
  width: number
  height: number
}

/** 1 = plano completo en el marco; solo se puede acercar desde ahí. */
const ZOOM_MIN = 1
const ZOOM_MAX = 3
const ZOOM_STEP = 0.25

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

function toLayer(view: ReadyFloorView): FloorLayer | null {
  if (!view.url) return null
  const media = getFloorPlanVariantMedia(view.doc, view.variant)
  return {
    ...view,
    width: media.imageWidth > 1 ? media.imageWidth : view.doc.imageWidth || 1024,
    height: media.imageHeight > 1 ? media.imageHeight : view.doc.imageHeight || 499,
  }
}

function neighborFloors(current: number, radius = 2) {
  const idx = FLOOR_PLAN_FLOORS.indexOf(current)
  if (idx < 0) return [current]
  const out = new Set<number>([current])
  for (let d = 1; d <= radius; d += 1) {
    if (FLOOR_PLAN_FLOORS[idx - d] != null) out.add(FLOOR_PLAN_FLOORS[idx - d])
    if (FLOOR_PLAN_FLOORS[idx + d] != null) out.add(FLOOR_PLAN_FLOORS[idx + d])
  }
  return [...out]
}

function alternateImageUrl(url: string) {
  if (/\.webp(\?|$)/i.test(url)) return url.replace(/\.webp(\?|$)/i, '.jpg$1')
  if (/\.jpe?g(\?|$)/i.test(url)) return url.replace(/\.jpe?g(\?|$)/i, '.webp$1')
  return null
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
  const [scale, setScale] = useState(ZOOM_MIN)
  /** Capas montadas: se quedan en DOM y el cambio es solo visibility. */
  const [layers, setLayers] = useState<Partial<Record<number, FloorLayer>>>({})
  const [variantByFloor, setVariantByFloor] = useState<Partial<Record<number, FloorPlanVariant>>>({})
  const [failedFloors, setFailedFloors] = useState<Partial<Record<number, boolean>>>({})
  const [readyFloors, setReadyFloors] = useState<Partial<Record<number, boolean>>>({})
  const stickyFloorRef = useRef<number | null>(null)
  const whatsappHref = tourWhatsAppHref(FLOOR_PLAN_WHATSAPP_MESSAGE)

  const upsertLayer = (view: ReadyFloorView) => {
    const layer = toLayer(view)
    if (!layer) return
    setFailedFloors((prev) => {
      if (!prev[view.floor]) return prev
      const next = { ...prev }
      delete next[view.floor]
      return next
    })
    setLayers((prev) => {
      const current = prev[view.floor]
      if (current && current.url === layer.url && current.variant === layer.variant) return prev
      return { ...prev, [view.floor]: layer }
    })
    setVariantByFloor((prev) =>
      prev[view.floor] === view.variant ? prev : { ...prev, [view.floor]: view.variant },
    )
  }

  const ensureFloor = (item: number) => {
    const preferred = variantByFloor[item]
    const ready = getReadyFloorView(item, preferred)
    if (ready) {
      upsertLayer(ready)
      setReadyFloors((prev) => (prev[item] ? prev : { ...prev, [item]: true }))
      return Promise.resolve(ready)
    }
    const cached = getCachedFloorView(item, preferred)
    if (cached) {
      upsertLayer(cached)
      return preloadFloorPlanImage(cached.url).then(() => {
        setReadyFloors((prev) => ({ ...prev, [item]: true }))
        return cached
      })
    }
    return fetchFloorPlanDoc(item).then((doc) => {
      if (!doc) {
        setFailedFloors((prev) => ({ ...prev, [item]: true }))
        return null
      }
      const variant = preferred ?? preferredFloorVariant(doc)
      const url = planDocImageUrl(doc, variant)
      if (!url) {
        setFailedFloors((prev) => ({ ...prev, [item]: true }))
        return null
      }
      const view: ReadyFloorView = {
        floor: item,
        doc: { ...doc, floor: item },
        variant,
        url,
      }
      upsertLayer(view)
      return preloadFloorPlanImage(url).then(() => {
        setReadyFloors((prev) => ({ ...prev, [item]: true }))
        return view
      })
    })
  }

  // Calienta TODOS los pisos (calidad intacta); prioridad al activo y vecinos.
  useEffect(() => {
    prefetchFloorPlans([...FLOOR_PLAN_FLOORS])
    void warmFloorPlans([...FLOOR_PLAN_FLOORS], neighborFloors(floor, 2)).then(() => {
      for (const item of FLOOR_PLAN_FLOORS) {
        const ready = getReadyFloorView(item)
        if (ready) {
          upsertLayer(ready)
          setReadyFloors((prev) => (prev[item] ? prev : { ...prev, [item]: true }))
        }
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setScale(ZOOM_MIN)
    void ensureFloor(floor)
    for (const item of neighborFloors(floor, 2)) {
      if (item !== floor) void ensureFloor(item)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor])

  const targetReady = Boolean(layers[floor] && readyFloors[floor])

  useEffect(() => {
    if (targetReady) stickyFloorRef.current = floor
  }, [targetReady, floor])

  const paintFloor =
    targetReady
      ? floor
      : stickyFloorRef.current != null && layers[stickyFloorRef.current]
        ? stickyFloorRef.current
        : floor

  const shown = layers[paintFloor] ?? layers[floor] ?? null
  const planVariant = shown?.variant ?? '2d'
  const waiting = !shown && !failedFloors[floor]
  const missing = !shown && Boolean(failedFloors[floor])
  const has2d = Boolean(shown?.doc.variants?.['2d']?.imageUrl)
  const has3d = Boolean(shown?.doc.variants?.['3d']?.imageUrl)
  const canToggleVariant = has2d || has3d

  const planAspect = useMemo(() => {
    const w = shown?.width || 1024
    const h = shown?.height || 499
    return `${w} / ${h}`
  }, [shown?.width, shown?.height])

  const overlayAlign = useMemo(
    () => getFloorPlanOverlayAlign(shown?.doc ?? null, planVariant),
    [shown?.doc, planVariant],
  )

  const unitsOnFloor = useMemo(() => {
    const docFloor = shown?.floor ?? paintFloor
    const matched = units.filter((unit) => unitFloorNumber(unit) === docFloor)
    const list = matched.length > 0 ? matched : units
    return [...list].sort((a, b) =>
      a.unit_number.localeCompare(b.unit_number, 'es', { numeric: true }),
    )
  }, [units, paintFloor, shown?.floor])

  const displaySlots = useMemo<DisplaySlot[]>(() => {
    const zones = shown?.doc.zones
    if (!zones?.length) return []
    return [...zones]
      .sort((a, b) => a.order - b.order)
      .filter((zone) => zone.pointsPercent.trim())
      .map((zone) => ({
        id: zone.id,
        label: zone.label || zone.id,
        points: applyOverlayAlign(zoneDisplayPointsPercent(zone), overlayAlign),
        unit: findUnitForZone(unitsOnFloor, zone.id, zone.label),
      }))
  }, [shown?.doc, unitsOnFloor, overlayAlign])

  const zoomOut = () =>
    setScale((value) => Math.max(ZOOM_MIN, Number((value - ZOOM_STEP).toFixed(2))))
  const zoomIn = () =>
    setScale((value) => Math.min(ZOOM_MAX, Number((value + ZOOM_STEP).toFixed(2))))

  const switchVariant = (next: FloorPlanVariant) => {
    const doc = layers[floor]?.doc ?? shown?.doc
    if (!doc) return
    const url = planDocImageUrl(doc, next)
    if (!url) return
    void preloadFloorPlanImage(url).then(() => {
      upsertLayer({ floor, doc: { ...doc, floor }, variant: next, url })
      setReadyFloors((prev) => ({ ...prev, [floor]: true }))
    })
  }

  const handleImageError = (layerFloor: number, url: string) => {
    const alt = alternateImageUrl(url)
    const layer = layers[layerFloor]
    if (alt && layer && layer.url === url) {
      upsertLayer({ ...layer, url: alt })
      void preloadFloorPlanImage(alt).then(() => {
        setReadyFloors((prev) => ({ ...prev, [layerFloor]: true }))
      })
      return
    }
    setFailedFloors((prev) => ({ ...prev, [layerFloor]: true }))
  }

  const warmOnIntent = (item: number) => {
    prefetchFloorPlans([item])
    void ensureFloor(item)
  }

  // Montar todas las capas ya cargadas: el swap es visibility (sin remount).
  const layerEntries = useMemo(
    () => Object.values(layers).filter((layer): layer is FloorLayer => Boolean(layer?.url)),
    [layers],
  )

  return (
    <div className="absolute inset-0 z-[18] flex bg-[#14110e] pt-[max(0px,env(safe-area-inset-top))] pb-[max(0px,env(safe-area-inset-bottom))]">
      <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden p-1.5 sm:p-3 [@media(max-height:520px)]:p-1">
        <div
          className="relative w-full max-h-full overflow-hidden rounded-xl bg-[#1a1714] ring-1 ring-white/10 [@media(max-height:520px)]:rounded-lg"
          style={{ aspectRatio: planAspect }}
        >
          <div
            className="absolute inset-0 origin-center transition-transform duration-150 ease-out"
            style={{ transform: `scale(${scale})` }}
          >
            {layerEntries.map((layer) => {
              const active = layer.floor === paintFloor
              return (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={`floor-${layer.floor}`}
                  src={layer.url}
                  alt=""
                  draggable={false}
                  decoding="async"
                  fetchPriority={active ? 'high' : 'low'}
                  loading="eager"
                  ref={(node) => {
                    if (node?.complete && node.naturalWidth > 0) {
                      setReadyFloors((prev) =>
                        prev[layer.floor] ? prev : { ...prev, [layer.floor]: true },
                      )
                    }
                  }}
                  onLoad={() => setReadyFloors((prev) => ({ ...prev, [layer.floor]: true }))}
                  onError={() => handleImageError(layer.floor, layer.url)}
                  className={cn(
                    'absolute inset-0 h-full w-full object-fill',
                    active ? 'opacity-100' : 'opacity-0',
                  )}
                  style={{
                    // Evita flash: capas inactivas no reciben hits pero siguen decodificadas.
                    visibility: active ? 'visible' : 'hidden',
                    pointerEvents: 'none',
                  }}
                />
              )
            })}

            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="absolute inset-0 h-full w-full touch-manipulation"
              role="img"
              aria-label="Departamentos del piso"
            >
              {displaySlots.map((slot) => {
                const selected = Boolean(slot.unit && slot.unit.id === selectedUnitId)
                const hovered = hoverSlot === slot.id
                return (
                  <polygon
                    key={slot.id}
                    points={slot.points}
                    className={cn(
                      'cursor-pointer transition-[fill,stroke] duration-100',
                      !slot.unit && 'cursor-not-allowed',
                    )}
                    fill={
                      selected
                        ? 'rgba(61,155,74,0.38)'
                        : hovered && slot.unit
                          ? 'rgba(61,155,74,0.18)'
                          : 'rgba(255,255,255,0.02)'
                    }
                    stroke={
                      selected
                        ? 'rgba(61,155,74,0.95)'
                        : hovered && slot.unit
                          ? 'rgba(255,255,255,0.55)'
                          : 'rgba(255,255,255,0.12)'
                    }
                    strokeWidth={selected || hovered ? 0.4 : 0.2}
                    vectorEffect="non-scaling-stroke"
                    onMouseEnter={() => setHoverSlot(slot.id)}
                    onMouseLeave={() => setHoverSlot(null)}
                    onClick={() => {
                      if (!slot.unit) return
                      onSelectUnit(slot.unit, slot.id)
                    }}
                  />
                )
              })}
            </svg>

            <div className="absolute inset-0">
              {displaySlots.map((slot) => {
                const { cx, cy } = slotCentroid(slot.points)
                const selected = Boolean(slot.unit && slot.unit.id === selectedUnitId)
                const hovered = hoverSlot === slot.id
                const label = slot.unit?.unit_number ?? slot.label

                return (
                  <button
                    key={`label-${slot.id}`}
                    type="button"
                    disabled={!slot.unit}
                    onMouseEnter={() => setHoverSlot(slot.id)}
                    onMouseLeave={() => setHoverSlot(null)}
                    onClick={() => {
                      if (!slot.unit) return
                      onSelectUnit(slot.unit, slot.id)
                    }}
                    className={cn(
                      'absolute z-[2] flex -translate-x-1/2 -translate-y-1/2 touch-manipulation items-center gap-1.5 rounded-md bg-white px-2 py-1.5 text-left shadow-[0_2px_8px_rgba(15,23,42,0.22)] transition-[transform,box-shadow] duration-100',
                      'sm:gap-2 sm:rounded-lg sm:px-2.5 sm:py-1.5',
                      slot.unit
                        ? 'cursor-pointer hover:shadow-[0_4px_14px_rgba(15,23,42,0.28)]'
                        : 'cursor-not-allowed opacity-55',
                      (selected || hovered) && slot.unit && 'ring-2 ring-[#3d9b4a]/45',
                    )}
                    style={{ left: `${cx}%`, top: `${cy}%` }}
                    aria-label={slot.unit ? `Departamento ${label}` : `Zona ${label}`}
                  >
                    <span
                      className={cn(
                        'h-2 w-2 shrink-0 rounded-full sm:h-2.5 sm:w-2.5',
                        slot.unit ? statusDotClass(slot.unit.status) : 'bg-[#c4c4c4]',
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

          {canToggleVariant ? (
            <div className="pointer-events-auto absolute left-3 top-3 z-20 flex rounded-lg bg-white/95 p-0.5 shadow-[0_4px_14px_rgba(15,23,42,0.18)] ring-1 ring-black/10 sm:left-4 sm:top-4">
              {(['2d', '3d'] as const).map((item) => {
                const available = item === '2d' ? has2d : has3d
                const active = planVariant === item
                return (
                  <button
                    key={item}
                    type="button"
                    disabled={!available}
                    onClick={() => switchVariant(item)}
                    className={cn(
                      'rounded-md px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors sm:px-3 sm:text-[12px]',
                      active
                        ? 'bg-[#1a2744] text-white shadow-sm'
                        : available
                          ? 'text-[#3a4050] hover:bg-[#eef1f6]'
                          : 'cursor-not-allowed text-[#9ca3af] opacity-50',
                    )}
                    aria-pressed={active}
                    title={
                      available
                        ? `Ver plano ${item.toUpperCase()}`
                        : `Todavía no hay plano ${item.toUpperCase()}`
                    }
                  >
                    {item}
                  </button>
                )
              })}
            </div>
          ) : null}

          {waiting ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#14110e]/40 text-xs text-white/70">
              Cargando plano…
            </div>
          ) : null}
          {missing ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#14110e]/55 text-xs text-white/80">
              No hay plano para este piso
            </div>
          ) : null}
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

      <div className="pointer-events-auto flex shrink-0 flex-col items-center justify-between gap-1.5 py-1.5 pr-1.5 sm:gap-2.5 sm:py-2 sm:pr-3 [@media(max-height:520px)]:gap-1 [@media(max-height:520px)]:pr-1">
        <div className="flex min-h-0 flex-1 flex-col justify-center">
          <div className="flex max-h-full flex-col gap-0.5 overflow-y-auto overscroll-contain rounded-xl bg-white/92 p-1 shadow-[0_8px_24px_rgba(15,23,42,0.18)] backdrop-blur-sm sm:gap-1.5 sm:p-2 [@media(max-height:520px)]:rounded-lg [@media(max-height:520px)]:p-0.5">
            {FLOOR_PLAN_FLOORS.map((item) => {
              const active = item === floor
              const short = floorPlanLevelShort(item)
              const warmed = Boolean(readyFloors[item] || layers[item])
              return (
                <button
                  key={item}
                  type="button"
                  onClick={() => onFloorChange(item)}
                  onMouseEnter={() => warmOnIntent(item)}
                  onFocus={() => warmOnIntent(item)}
                  onPointerDown={() => warmOnIntent(item)}
                  className={cn(
                    'min-w-[2.1rem] rounded-lg px-1.5 py-1 text-[10px] font-semibold tracking-wide transition-colors sm:min-w-[2.6rem] sm:px-2.5 sm:py-2 sm:text-[12px]',
                    '[@media(max-height:520px)]:min-w-[1.9rem] [@media(max-height:520px)]:px-1 [@media(max-height:520px)]:py-0.5 [@media(max-height:520px)]:text-[9px]',
                    active
                      ? 'bg-[#1a2744] text-white shadow-sm'
                      : 'bg-white text-[#3a4050] hover:bg-[#eef1f6]',
                    !warmed && !active && 'opacity-80',
                  )}
                  aria-pressed={active}
                  aria-label={floorPlanLevelLabel(item)}
                  title={floorPlanLevelLabel(item)}
                >
                  {short}
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
