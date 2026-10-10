'use client'

import { useTourLanguage } from '@/lib/tour/tourLocale'

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent, type ReactNode } from 'react'
import { Box, Hand, Minus, Plus, Square } from 'lucide-react'
import {
  floorPlanLevelLabel,
  floorPlanLevelShort,
  isFloorPlanLevel,
  unitFloorNumber,
} from '@/lib/tour/floorPlanHotspots'
import {
  fetchFloorPlanDoc,
  getCachedFloorView,
  getReadyFloorView,
  planDocMediaUrl,
  preferredFloorVariant,
  preloadFloorPlanHtml,
  preloadFloorPlanImage,
  refetchFloorPlanDoc,
  type ReadyFloorView,
} from '@/lib/tour/floorPlanClientCache'
import { floorPlanWhatsAppMessage, tourWhatsAppHref } from '@/lib/tour/tourWhatsApp'
import {
  applyOverlayAlign,
  floorPlanVariantHasMedia,
  getFloorPlanOverlayAlign,
  getFloorPlanVariantMedia,
  zoneDisplayPointsPercent,
  zonesForVariant,
  type FloorPlanVariant,
} from '@/lib/tour/floorPlanZones'
import {
  commonAreaFromZoneId,
  commonAreaLabel,
  type CommonArea,
} from '@/lib/tour/commonAreas'
import { SITE } from '@/lib/marketing/site'
import { findUnitByNumber } from '@/lib/tour/unitDeepLink'
import type { TourUnitSummary } from '@/types/tour'
import { cn } from '@/lib/utils'

type TourFloorPlanProps = {
  units: TourUnitSummary[]
  floor: number
  onFloorChange: (floor: number) => void
  selectedUnitId: string | null
  onSelectUnit: (unit: TourUnitSummary, slotId: string) => void
  /** Zona `area:CODIGO`: abre el área común, no una unidad. */
  onSelectArea?: (code: string) => void
  /** Empieza a bajar las fotos de la unidad al pasar el cursor, sin cambiar la selección. */
  onPrefetchUnit?: (unit: TourUnitSummary) => void
  onWhatsAppClick?: () => void
  /** Overlay dentro del marco del plano (p. ej. modos en desktop). */
  railLeading?: ReactNode
  /** Acciones bajo el selector de piso (p. ej. micrófono), encima de WhatsApp. */
  railTrailing?: ReactNode
  /** Preferencia 2D/3D según el modo del showroom (planos-2d / planos-3d). */
  preferredVariant?: FloorPlanVariant
  /** Cuando el usuario cambia 2D/3D dentro del plano. */
  onPreferredVariantChange?: (variant: FloorPlanVariant) => void
  /** Ignora toques sobre el plano (p. ej. justo después de cerrar el ingreso). */
  touchesLocked?: boolean
  /** El piso visible ya tiene imagen decodificada o el primer frame del 3D. */
  onFloorPresented?: (floor: number) => void
  /** Toque en el plano fuera de una unidad o área (cierra la ficha). */
  onEmptyPlanTap?: () => void
}

type DisplaySlot = {
  id: string
  label: string
  points: string
  unit: TourUnitSummary | null
  area: CommonArea | null
}

function slotOpens(slot: DisplaySlot) {
  return Boolean(slot.unit || slot.area)
}

type FloorLayer = ReadyFloorView & {
  width: number
  height: number
}

/** En horizontal, 1 es el plano ajustado y solo se puede acercar. */
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
  const pairs = points
    .split(/\s+/)
    .map((p) => p.split(',').map(Number))
    .filter((pair) => pair.length >= 2 && Number.isFinite(pair[0]) && Number.isFinite(pair[1]))
  if (pairs.length === 0) return { cx: 50, cy: 50 }

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let sx = 0
  let sy = 0
  for (const [x, y] of pairs) {
    sx += x
    sy += y
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  const avg = { cx: sx / pairs.length, cy: sy / pairs.length }
  const box = { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 }

  if (pairs.length < 3) return avg

  // Centroide por área (shoelace).
  let area2 = 0
  let cx = 0
  let cy = 0
  for (let i = 0; i < pairs.length; i++) {
    const [x0, y0] = pairs[i]!
    const [x1, y1] = pairs[(i + 1) % pairs.length]!
    const cross = x0 * y1 - x1 * y0
    area2 += cross
    cx += (x0 + x1) * cross
    cy += (y0 + y1) * cross
  }
  if (Math.abs(area2) < 1e-8) return avg
  const area = { cx: cx / (3 * area2), cy: cy / (3 * area2) }

  // En plantas en L el centroide puede caer fuera o “muy abajo”:
  // preferimos un punto dentro del polígono (área → promedio → caja).
  if (pointInPolygonPercent(area.cx, area.cy, points)) return area
  if (pointInPolygonPercent(avg.cx, avg.cy, points)) return avg
  if (pointInPolygonPercent(box.cx, box.cy, points)) return box
  return avg
}

function WhatsAppIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}

function normalizeUnitCode(value: string) {
  let v = value.trim().toLowerCase()
  // LC-01, L01, 001 → "1"
  v = v.replace(/^lc[-\s]?/i, '').replace(/^l(?=\d)/i, '')
  v = v.replace(/^0+/, '') || v
  return v
}

/** API pública del HTML interactivo (Three.js). */
type LaViletPlantaApi = {
  width?: number
  height?: number
  departamentos?: string[]
  unidades?: string[]
  seleccionar: (id: string | null, options?: { animate?: boolean }) => unknown
  restablecer: (options?: { animate?: boolean }) => unknown
  seleccionarEn?: (x: number, y: number, options?: { animate?: boolean }) => unknown
  identificar?: (x: number, y: number) => string | null
  identificarVista?: (x: number, y: number) => string | null
  seleccionarEnVista?: (x: number, y: number, options?: { animate?: boolean }) => unknown
  terminarPresentacion?: () => unknown
  estado?: () => { departamento?: string | null; unidad?: string | null; modo?: string }
  renderer?: { forceContextLoss?: () => void }
}

function releaseFloorIframe(node: HTMLIFrameElement | null) {
  if (!node) return
  try {
    const win = node.contentWindow as (Window & { LaViletPlanta?: LaViletPlantaApi }) | null
    win?.LaViletPlanta?.renderer?.forceContextLoss?.()
  } catch {
    /* el documento ya se fue */
  }
  try {
    node.src = 'about:blank'
  } catch {
    /* ignore */
  }
}

function plantaIdCandidates(raw: string | null | undefined, unit?: TourUnitSummary | null) {
  const out: string[] = []
  const push = (value?: string | null) => {
    const v = value?.trim()
    if (!v) return
    if (!out.includes(v)) out.push(v)
    const norm = normalizeUnitCode(v)
    if (norm && !out.includes(norm)) out.push(norm)
  }
  push(raw)
  push(unit?.unit_number)
  return out
}

function getLaViletPlanta(win: Window | null | undefined): LaViletPlantaApi | null {
  if (!win) return null
  try {
    const api = (win as Window & { LaViletPlanta?: LaViletPlantaApi }).LaViletPlanta
    if (!api || typeof api.seleccionar !== 'function') return null
    return api
  } catch {
    return null
  }
}

function findUnitByPlantaId(
  units: TourUnitSummary[],
  plantaId: string,
  floorHint?: number,
) {
  const raw = plantaId.trim()
  if (!raw) return null
  const lower = raw.toLowerCase()
  const digits = raw.replace(/\D/g, '')
  const normalized = normalizeUnitCode(raw)

  const matchIn = (list: TourUnitSummary[]) => {
    if (list.length === 0) return null
    return (
      findUnitByNumber(list, raw) ??
      list.find((item) => item.unit_number.trim().toLowerCase() === lower) ??
      list.find((item) => item.id === raw) ??
      list.find((item) => normalizeUnitCode(item.unit_number) === normalized) ??
      (digits
        ? list.find((item) => item.unit_number.replace(/\D/g, '') === digits) ??
          list.find((item) => normalizeUnitCode(item.unit_number) === digits)
        : null) ??
      null
    )
  }

  const onFloor =
    floorHint != null ? units.filter((item) => unitFloorNumber(item) === floorHint) : []
  return matchIn(onFloor) ?? matchIn(units)
}

function findUnitForZone(units: TourUnitSummary[], zoneId: string, zoneLabel: string) {
  if (commonAreaFromZoneId(zoneId)) return null
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

/** Resuelve id del HTML 3D contra zonas del piso (misma lógica que los pines). */
function findUnitFromSlots(slots: DisplaySlot[], plantaId: string) {
  const raw = plantaId.trim()
  if (!raw) return null
  const lower = raw.toLowerCase()
  const normalized = normalizeUnitCode(raw)
  const slot =
    slots.find((item) => item.id.trim().toLowerCase() === lower) ??
    slots.find((item) => item.label.trim().toLowerCase() === lower) ??
    slots.find((item) => normalizeUnitCode(item.id) === normalized) ??
    slots.find((item) => normalizeUnitCode(item.label) === normalized) ??
    slots.find((item) => item.unit && normalizeUnitCode(item.unit.unit_number) === normalized) ??
    null
  return slot?.unit ?? null
}

function parsePercentPoints(points: string) {
  return points
    .split(/\s+/)
    .map((p) => p.split(',').map(Number))
    .filter((pair) => pair.length >= 2 && Number.isFinite(pair[0]) && Number.isFinite(pair[1])) as [
    number,
    number,
  ][]
}

/** Ray casting: ¿el click (en %) cae dentro del polígono de la zona? */
function pointInPolygonPercent(x: number, y: number, points: string) {
  const pairs = parsePercentPoints(points)
  if (pairs.length < 3) return false
  let inside = false
  for (let i = 0, j = pairs.length - 1; i < pairs.length; j = i++) {
    const [xi, yi] = pairs[i]!
    const [xj, yj] = pairs[j]!
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + Number.EPSILON) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(px - ax, py - ay)
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function distanceToPolygonPercent(x: number, y: number, points: string) {
  if (pointInPolygonPercent(x, y, points)) return 0
  const pairs = parsePercentPoints(points)
  if (pairs.length === 0) return Infinity
  let best = Infinity
  for (let i = 0; i < pairs.length; i += 1) {
    const [ax, ay] = pairs[i]!
    const [bx, by] = pairs[(i + 1) % pairs.length]!
    best = Math.min(best, distanceToSegment(x, y, ax, ay, bx, by))
  }
  return best
}

/** Hit exacto. Con `snapPercent` (toque), la zona más cercana si el dedo cayó al lado. */
function findSlotAtPercent(
  slots: DisplaySlot[],
  xPercent: number,
  yPercent: number,
  snapPercent = 0,
) {
  for (let i = slots.length - 1; i >= 0; i -= 1) {
    const slot = slots[i]!
    if (!slot.unit && !slot.area) continue
    if (pointInPolygonPercent(xPercent, yPercent, slot.points)) return slot
  }
  if (snapPercent <= 0) return null
  let best: DisplaySlot | null = null
  let bestDistance = snapPercent
  for (let i = slots.length - 1; i >= 0; i -= 1) {
    const slot = slots[i]!
    if (!slot.unit && !slot.area) continue
    const distance = distanceToPolygonPercent(xPercent, yPercent, slot.points)
    if (distance < bestDistance) {
      bestDistance = distance
      best = slot
    }
  }
  return best
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

function alternateImageUrl(url: string) {
  if (/\.webp(\?|$)/i.test(url)) return url.replace(/\.webp(\?|$)/i, '.jpg$1')
  if (/\.jpe?g(\?|$)/i.test(url)) return url.replace(/\.jpe?g(\?|$)/i, '.webp$1')
  return null
}

function decodeFloorImage(url: string) {
  return new Promise<boolean>((resolve) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => {
      img.decode().then(() => resolve(true)).catch(() => resolve(true))
    }
    img.onerror = () => resolve(false)
    img.src = url
  })
}

export function TourFloorPlan({
  units,
  floor,
  onFloorChange,
  onSelectUnit,
  onSelectArea,
  onPrefetchUnit,
  onWhatsAppClick,
  railLeading,
  railTrailing,
  preferredVariant,
  onPreferredVariantChange,
  touchesLocked = false,
  onFloorPresented,
  onEmptyPlanTap,
  selectedUnitId,
}: TourFloorPlanProps) {
  const { t, locale } = useTourLanguage()

  const [hoverSlot, setHoverSlot] = useState<string | null>(null)
  const [scale, setScale] = useState(ZOOM_MIN)
  /** Capas montadas: se quedan en DOM y el cambio es solo visibility. */
  const [layers, setLayers] = useState<Partial<Record<number, FloorLayer>>>(() => {
    const ready = getReadyFloorView(floor, preferredVariant)
    const layer = ready ? toLayer(ready) : null
    return layer ? { [floor]: layer } : {}
  })
  const [variantByFloor, setVariantByFloor] = useState<Partial<Record<number, FloorPlanVariant>>>(() => {
    const ready = getReadyFloorView(floor, preferredVariant)
    return ready ? { [floor]: ready.variant } : {}
  })
  const [failedFloors, setFailedFloors] = useState<Partial<Record<number, boolean>>>({})
  const [readyFloors, setReadyFloors] = useState<Partial<Record<number, boolean>>>(() => {
    const ready = getReadyFloorView(floor, preferredVariant)
    return ready?.url ? { [floor]: true } : {}
  })
  const [holdFloor, setHoldFloor] = useState(floor)
  const [decodedUrl, setDecodedUrl] = useState<Record<string, boolean>>({})
  const [htmlFramed, setHtmlFramed] = useState<Partial<Record<number, string>>>({})
  const htmlIframeRefs = useRef<Partial<Record<number, HTMLIFrameElement | null>>>({})
  /** Como máximo el piso visible y el que se está pidiendo. */
  const [keptHtmlFloors, setKeptHtmlFloors] = useState<number[]>([floor])
  const [revealFloor, setRevealFloor] = useState<number | null>(null)
  const imageErrorRef = useRef<(layerFloor: number, url: string) => void>(() => {})
  const layerUrlByFloorRef = useRef<Partial<Record<number, string>>>({})
  const htmlLoadAtRef = useRef<Partial<Record<number, number>>>({})
  /** URL del HTML cuyo iframe ya disparó onLoad (por piso). */
  const [htmlLoadedUrl, setHtmlLoadedUrl] = useState<Partial<Record<number, string>>>({})
  const [portraitPan, setPortraitPan] = useState(false)
  const [panX, setPanX] = useState(0)
  const [panHint, setPanHint] = useState(false)
  /** Área disponible del stage: para encajar el plano sin romper aspect-ratio. */
  const stageRef = useRef<HTMLDivElement>(null)
  const [stageSize, setStageSize] = useState({ width: 0, height: 0 })
  /** Dimensiones naturales medidas del <img> activo (corrige metadata vieja). */
  const [measuredImageSize, setMeasuredImageSize] = useState<
    Partial<Record<string, { width: number; height: number }>>
  >({})
  const onSelectUnitRef = useRef(onSelectUnit)
  onSelectUnitRef.current = onSelectUnit
  const onSelectAreaRef = useRef(onSelectArea)
  onSelectAreaRef.current = onSelectArea
  const onPrefetchUnitRef = useRef(onPrefetchUnit)
  onPrefetchUnitRef.current = onPrefetchUnit
  const onEmptyPlanTapRef = useRef(onEmptyPlanTap)
  onEmptyPlanTapRef.current = onEmptyPlanTap
  const prefetchedUnitRef = useRef<string | null>(null)
  const floorRef = useRef(floor)
  floorRef.current = floor
  const displaySlotsRef = useRef<DisplaySlot[]>([])
  const htmlHoverUnitRef = useRef<TourUnitSummary | null>(null)
  const lastHtmlOpenAtRef = useRef(0)
  const lastHtmlOpenKeyRef = useRef('')
  const whatsappHref = tourWhatsAppHref(floorPlanWhatsAppMessage(locale))

  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait) and (pointer: coarse) and (max-width: 900px)')
    const sync = () => {
      const on = mq.matches
      setPortraitPan(on)
      if (!on) {
        setPanHint(false)
        return
      }
      try {
        setPanHint(sessionStorage.getItem('lavilet-plan-pan-hint') !== '1')
      } catch {
        setPanHint(true)
      }
    }
    sync()
    mq.addEventListener('change', sync)
    window.addEventListener('orientationchange', sync)
    window.addEventListener('resize', sync)
    return () => {
      mq.removeEventListener('change', sync)
      window.removeEventListener('orientationchange', sync)
      window.removeEventListener('resize', sync)
    }
  }, [])

  useEffect(() => {
    setPanX(0)
  }, [floor])

  useEffect(() => {
    const el = stageRef.current
  }, [floor, portraitPan])

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const sync = () => {
      const rect = el.getBoundingClientRect()
      setStageSize((prev) => {
        const width = Math.round(rect.width)
        const height = Math.round(rect.height)
        if (prev.width === width && prev.height === height) return prev
        return { width, height }
      })
    }
    sync()
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

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
      if (
        current &&
        current.url === layer.url &&
        current.variant === layer.variant &&
        current.kind === layer.kind
      ) {
        return prev
      }
      if (current && current.url !== layer.url) {
        setHtmlLoadedUrl((loaded) => {
          if (!loaded[view.floor]) return loaded
          const nextLoaded = { ...loaded }
          delete nextLoaded[view.floor]
          return nextLoaded
        })
      }
      return { ...prev, [view.floor]: layer }
    })
    setVariantByFloor((prev) =>
      prev[view.floor] === view.variant ? prev : { ...prev, [view.floor]: view.variant },
    )
  }

  const ensureFloor = (item: number, opts?: { fresh?: boolean; preferred?: FloorPlanVariant }) => {
    const preferred = opts?.preferred ?? variantByFloor[item] ?? preferredVariant
    const loadDoc = opts?.fresh ? refetchFloorPlanDoc(item) : fetchFloorPlanDoc(item)

    const ready = !opts?.fresh ? getReadyFloorView(item, preferred) : null
    if (ready) {
      upsertLayer(ready)
      setReadyFloors((prev) => (prev[item] ? prev : { ...prev, [item]: true }))
      return Promise.resolve(ready)
    }
    const cached = !opts?.fresh ? getCachedFloorView(item, preferred) : null
    if (cached) {
      upsertLayer(cached)
      if (cached.kind === 'html') {
        // Prefetch en HTTP cache; el iframe reutiliza bytes (misma calidad).
        return preloadFloorPlanHtml(cached.url).then(() => {
          setReadyFloors((prev) => ({ ...prev, [item]: true }))
          return cached
        })
      }
      return preloadFloorPlanImage(cached.url).then(() => {
        setReadyFloors((prev) => ({ ...prev, [item]: true }))
        return cached
      })
    }
    return loadDoc.then(async (doc) => {
      if (!doc) {
        setFailedFloors((prev) => ({ ...prev, [item]: true }))
        return null
      }
      setFailedFloors((prev) => {
        if (!prev[item]) return prev
        const next = { ...prev }
        delete next[item]
        return next
      })
      const variant = preferred ?? preferredFloorVariant(doc)
      const media = planDocMediaUrl(doc, variant)
      if (!media.url) {
        setFailedFloors((prev) => ({ ...prev, [item]: true }))
        return null
      }
      const view: ReadyFloorView = {
        floor: item,
        doc: { ...doc, floor: item },
        variant,
        url: media.url,
        kind: media.kind,
      }
      upsertLayer(view)
      if (media.kind === 'html') {
        void preloadFloorPlanHtml(media.url)
        setReadyFloors((prev) => ({ ...prev, [item]: true }))
        return view
      }
      void preloadFloorPlanImage(media.url)
      setReadyFloors((prev) => ({ ...prev, [item]: true }))
      return view
    })
  }

  // Solo el piso activo al montar. NO precargar vecinos aquí (compite con el scroll de pisos).
  useEffect(() => {
    void ensureFloor(floor, { preferred: preferredVariant })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setScale(ZOOM_MIN)
    htmlHoverUnitRef.current = null
    htmlHoverLabelRef.current = null
    if (preferredVariant) {
      setVariantByFloor((prev) =>
        prev[floor] === preferredVariant ? prev : { ...prev, [floor]: preferredVariant },
      )
    }
    void ensureFloor(floor, { preferred: preferredVariant })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor, preferredVariant])

  const currentLayer = layers[floor] ?? null
  const planVariant =
    variantByFloor[floor] ?? preferredVariant ?? currentLayer?.variant ?? '3d'

  useEffect(() => {
    if (portraitPan) setScale(1)
  }, [planVariant, portraitPan])
  const targetReady = Boolean(
    revealFloor === floor ||
      (currentLayer &&
        (currentLayer.kind === 'html'
          ? htmlFramed[floor] === currentLayer.url
          : decodedUrl[currentLayer.url])),
  )
  const frontFloor = targetReady ? floor : layers[holdFloor] ? holdFloor : floor

  useEffect(() => {
    if (!targetReady || holdFloor === floor) return
    const timer = window.setTimeout(() => setHoldFloor(floor), 250)
    return () => window.clearTimeout(timer)
  }, [targetReady, floor, holdFloor])

  const onPresentedRef = useRef(onFloorPresented)
  onPresentedRef.current = onFloorPresented
  useEffect(() => {
    if (!targetReady) return
    onPresentedRef.current?.(floor)
  }, [targetReady, floor])

  useEffect(() => {
    setRevealFloor(null)
    const timer = window.setTimeout(() => setRevealFloor(floor), 4000)
    return () => window.clearTimeout(timer)
  }, [floor])

  const activeImageUrl = currentLayer?.kind === 'image' ? currentLayer.url : ''
  useEffect(() => {
    if (!activeImageUrl || decodedUrl[activeImageUrl]) return
    let cancelled = false
    const url = activeImageUrl
    const layerFloor = floor
    void decodeFloorImage(url).then((ok) => {
      if (cancelled) return
      if (!ok) {
        imageErrorRef.current(layerFloor, url)
        setRevealFloor(layerFloor)
        onPresentedRef.current?.(layerFloor)
        return
      }
      setDecodedUrl((prev) => (prev[url] ? prev : { ...prev, [url]: true }))
    })
    return () => {
      cancelled = true
    }
  }, [activeImageUrl, decodedUrl, floor])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const coarse = window.matchMedia('(pointer: coarse)').matches
      for (const item of [floor - 1, floor + 1]) {
        if (!isFloorPlanLevel(item)) continue
        if (coarse) {
          void fetchFloorPlanDoc(item, undefined, { media: false })
          continue
        }
        void ensureFloor(item, { preferred: preferredVariant }).then((view) => {
          if (view?.kind !== 'image' || !view.url) return
          const url = view.url
          void decodeFloorImage(url).then((ok) => {
            if (!ok) return
            setDecodedUrl((prev) => (prev[url] ? prev : { ...prev, [url]: true }))
          })
        })
      }
    }, 400)
    return () => window.clearTimeout(timer)
    // La precarga sigue al piso activo; ensureFloor se recrea en cada render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor, preferredVariant])

  const shown = (planVariant === '3d' ? layers[frontFloor] ?? currentLayer : layers[frontFloor] ?? currentLayer) ?? null
  const missing = !currentLayer && Boolean(failedFloors[floor])
  useEffect(() => {
    if (!missing) return
    onPresentedRef.current?.(floor)
  }, [missing, floor])
  const docForToggles = currentLayer?.doc ?? null
  const has2d = floorPlanVariantHasMedia(docForToggles?.variants?.['2d'])
  const has3d = floorPlanVariantHasMedia(docForToggles?.variants?.['3d'])
  const canToggleVariant = has2d || has3d
  const expectsHtml3d = Boolean(docForToggles?.variants?.['3d']?.htmlUrl)
  const waitingHtmlBoot =
    planVariant === '3d' &&
    expectsHtml3d &&
    !failedFloors[floor] &&
    (!currentLayer?.url || htmlLoadedUrl[floor] !== currentLayer.url)

  // Como máximo dos iframes: el piso que se sigue viendo y el pedido.
  // Si el usuario cambia otra vez antes de que cargue, el pendiente se reemplaza.
  useEffect(() => {
    if (planVariant !== '3d') {
      setKeptHtmlFloors([])
      return
    }
    const coarse = window.matchMedia('(pointer: coarse)').matches
    const kept = coarse ? [floor] : [holdFloor, floor]
    setKeptHtmlFloors(kept.filter((item, index, list) => list.indexOf(item) === index))
  }, [floor, holdFloor, planVariant])

  const planAspectSize = useMemo(() => {
    const measuredKey =
      currentLayer && currentLayer.kind === 'image' ? currentLayer.url.split('?')[0] : null
    const measured = measuredKey ? measuredImageSize[measuredKey] : null
    if (measured && measured.width > 1 && measured.height > 1) {
      return { width: measured.width, height: measured.height }
    }
    if (planVariant === '3d') {
      const media = getFloorPlanVariantMedia(docForToggles, '3d')
      const w = media.imageWidth > 1 ? media.imageWidth : 2048
      const h =
        media.imageHeight > 1
          ? media.imageHeight === 970 && floor === 0
            ? 988
            : media.imageHeight
          : floor === 0
            ? 988
            : 970
      return { width: w, height: h }
    }
    const media = getFloorPlanVariantMedia(docForToggles, '2d')
    const w = media.imageWidth > 1 ? media.imageWidth : shown?.width || 1024
    const h = media.imageHeight > 1 ? media.imageHeight : shown?.height || 499
    return { width: w, height: h }
  }, [
    currentLayer,
    measuredImageSize,
    docForToggles,
    planVariant,
    shown?.width,
    shown?.height,
    floor,
  ])

  const planAspect = `${planAspectSize.width} / ${planAspectSize.height}`

  /**
   * 2D y 3D: pantalla completa, misma proporción que el archivo.
   * El marco se recorta; la imagen no se estira.
   */
  const planFrameStyle = useMemo(() => {
    const aspect = planAspectSize.width / Math.max(1, planAspectSize.height)
    const { width: stageW, height: stageH } = stageSize

    if (stageW <= 0 || stageH <= 0) {
      return {
        aspectRatio: planAspect,
        width: '100%' as const,
        height: 'auto' as const,
        maxHeight: '100%' as const,
      }
    }

    const stageWider = stageW / stageH > aspect
    const frameW = stageWider ? stageW : Math.round(stageH * aspect)
    const frameH = stageWider ? Math.round(frameW / aspect) : stageH
    return {
      width: frameW,
      height: frameH,
      flexShrink: 0,
    }
  }, [planAspect, planAspectSize.height, planAspectSize.width, stageSize])

  const overlayAlign = useMemo(
    () => getFloorPlanOverlayAlign(docForToggles ?? null, planVariant),
    [docForToggles, planVariant],
  )

  const unitsOnFloor = useMemo(() => {
    // Siempre el piso seleccionado (no el sticky), para pines/unidades correctos.
    const matched = units.filter((unit) => unitFloorNumber(unit) === floor)
    const list = matched.length > 0 ? matched : units
    return [...list].sort((a, b) =>
      a.unit_number.localeCompare(b.unit_number, 'es', { numeric: true }),
    )
  }, [units, floor])

  const displaySlots = useMemo<DisplaySlot[]>(() => {
    // Zonas del piso activo únicamente (evita pines del plano anterior).
    const zones = zonesForVariant(docForToggles, planVariant)
    if (!zones?.length) return []
    return [...zones]
      .sort((a, b) => a.order - b.order)
      .filter((zone) => zone.pointsPercent.trim())
      .map((zone) => {
        const area = commonAreaFromZoneId(zone.id)
        return {
          id: zone.id,
          label: area ? commonAreaLabel(area, locale === 'en' ? 'en' : 'es') : zone.label || zone.id,
          points: applyOverlayAlign(zoneDisplayPointsPercent(zone), overlayAlign),
          unit: area ? null : findUnitForZone(unitsOnFloor, zone.id, zone.label),
          area,
        }
      })
  }, [docForToggles, planVariant, unitsOnFloor, overlayAlign, locale])
  displaySlotsRef.current = displaySlots

  const activeHtmlFloor =
    planVariant === '3d' && currentLayer?.kind === 'html' && !waitingHtmlBoot ? floor : null
  const htmlInteractive = activeHtmlFloor != null
  /** Zonas y botones sobre la imagen 2D y la imagen 3D. El HTML WebGL no los pinta (el hover re-renderiza el canvas). */
  const showSegmentation = !htmlInteractive
  const htmlHoverLabelRef = useRef<string | null>(null)

  // CRÍTICO FPS: el hover del iframe NO hace setState (re-render = 4fps con WebGL).
  // Solo refs; la ficha sí actualiza UI al click.
  useEffect(() => {
    const resolveUnit = (plantaId: string) =>
      findUnitByPlantaId(units, plantaId, floorRef.current) ??
      findUnitFromSlots(displaySlotsRef.current, plantaId)

    const onMessage = (event: MessageEvent) => {
      const data = event.data
      if (data && data.type === 'lavilet-plan-ready') {
        const readyFloor = Number(data.floor)
        if (!Number.isFinite(readyFloor)) return
        const frame = htmlIframeRefs.current[readyFloor]
        if (!frame || event.source !== frame.contentWindow) return
        const url = layerUrlByFloorRef.current[readyFloor]
        if (!url) return
        const started = htmlLoadAtRef.current[readyFloor]
        console.info(
          started == null
            ? `lavilet-plan-ready piso ${readyFloor}: llegó antes de onLoad`
            : `lavilet-plan-ready piso ${readyFloor}: ${Math.round(performance.now() - started)} ms desde onLoad`,
        )
        setHtmlFramed((prev) => (prev[readyFloor] === url ? prev : { ...prev, [readyFloor]: url }))
        return
      }
      if (!data || data.source !== 'lavilet-floor-html') return
      if (data.type === 'hover') {
        const plantaId = String(data.departamento || '').trim()
        if (!plantaId) {
          htmlHoverUnitRef.current = null
          htmlHoverLabelRef.current = null
          return
        }
        const unit = resolveUnit(plantaId)
        htmlHoverUnitRef.current = unit
        htmlHoverLabelRef.current = unit?.unit_number ?? plantaId
        return
      }
      if (data.type !== 'ficha') return
      const coarse = window.matchMedia('(pointer: coarse)').matches
      const plantaId = String(data.departamento || '').trim()
      const xPercent = Number(data.xPercent)
      const yPercent = Number(data.yPercent)
      const hasPoint = Number.isFinite(xPercent) && Number.isFinite(yPercent)
      const fromPoint = hasPoint
        ? findSlotAtPercent(displaySlotsRef.current, xPercent, yPercent, coarse ? 8 : 0)
        : null
      const areaFromId =
        displaySlotsRef.current.find(
          (slot) => slot.area && (slot.id === plantaId || slot.label === plantaId),
        ) ?? null
      const areaSlot = fromPoint?.area ? fromPoint : areaFromId
      if (areaSlot?.area && !fromPoint?.unit) {
        const now = Date.now()
        if (areaSlot.id === lastHtmlOpenKeyRef.current && now - lastHtmlOpenAtRef.current < 350) return
        lastHtmlOpenAtRef.current = now
        lastHtmlOpenKeyRef.current = areaSlot.id
        onSelectAreaRef.current?.(areaSlot.area.code)
        return
      }
      const resolvedFromId = plantaId ? resolveUnit(plantaId) : null
      const unit = coarse
        ? (fromPoint?.unit ?? resolvedFromId)
        : (resolvedFromId ?? fromPoint?.unit ?? htmlHoverUnitRef.current)
      if (!unit) {
        if (!coarse || (!hasPoint && !plantaId)) return
        const now = Date.now()
        if (now - lastHtmlOpenAtRef.current < 450) return
        lastHtmlOpenAtRef.current = now
        lastHtmlOpenKeyRef.current = ''
        htmlHoverUnitRef.current = null
        onEmptyPlanTapRef.current?.()
        return
      }
      const slotId = fromPoint?.id ?? plantaId ?? unit.unit_number
      const now = Date.now()
      const openKey = unit.id
      if (openKey === lastHtmlOpenKeyRef.current && now - lastHtmlOpenAtRef.current < 350) return
      lastHtmlOpenAtRef.current = now
      lastHtmlOpenKeyRef.current = openKey
      htmlHoverUnitRef.current = unit
      htmlHoverLabelRef.current = unit.unit_number
      // El clic abre la ficha. El hover no pinta la unidad ni muestra un rótulo.
      onSelectUnitRef.current(unit, slotId)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [units])

  useEffect(() => {
    if (!htmlInteractive) {
      htmlHoverUnitRef.current = null
      htmlHoverLabelRef.current = null
    }
  }, [htmlInteractive])

  const portraitZoomMin = useMemo(() => {
    if (!portraitPan || stageSize.width < 8 || stageSize.height < 8) return ZOOM_MIN
    const aspect = planAspectSize.width / Math.max(1, planAspectSize.height)
    const boxAspect = stageSize.width / stageSize.height
    const coverH = boxAspect > aspect ? stageSize.width / aspect : stageSize.height
    const containH = boxAspect > aspect ? stageSize.height : stageSize.width / aspect
    return coverH > 0 ? Math.min(1, containH / coverH) : ZOOM_MIN
  }, [planAspectSize.height, planAspectSize.width, portraitPan, stageSize.height, stageSize.width])

  useEffect(() => {
    if (!portraitPan) {
      setScale((value) => (value < ZOOM_MIN ? ZOOM_MIN : value))
      return
    }
    setScale((value) => {
      const next = Math.min(1, Math.max(portraitZoomMin, value))
      return Math.abs(next - value) < 0.001 ? value : next
    })
  }, [portraitPan, portraitZoomMin])

  useEffect(() => {
    if (!portraitPan) return
    const frameW = typeof planFrameStyle.width === 'number' ? planFrameStyle.width : 0
    const max = Math.max(0, (frameW * scale - stageSize.width) / 2)
    setPanX((current) => Math.max(-max, Math.min(max, current)))
  }, [portraitPan, planFrameStyle.width, scale, stageSize.width])

  useEffect(() => {
    if (activeHtmlFloor == null) return
    const iframe = htmlIframeRefs.current[activeHtmlFloor]
    const api = getLaViletPlanta(iframe?.contentWindow ?? null)
    try {
      api?.terminarPresentacion?.()
    } catch {
      /* ignore */
    }
  }, [activeHtmlFloor])

  const elevateHtmlUnit = useCallback(
    (plantaId: string | null, unit?: TourUnitSummary | null) => {
      if (activeHtmlFloor == null) return
      const iframe = htmlIframeRefs.current[activeHtmlFloor]
      const win = iframe?.contentWindow ?? null
      const api = getLaViletPlanta(win)
      if (!plantaId) {
        try {
          api?.restablecer?.({ animate: true })
        } catch {
          try {
            api?.restablecer?.()
          } catch {
            /* ignore */
          }
        }
        try {
          win?.postMessage({ type: 'lavilet:restablecer' }, '*')
        } catch {
          /* ignore */
        }
        return
      }
      const ids = plantaIdCandidates(plantaId, unit)
      let done = false
      for (const id of ids) {
        if (!api) break
        try {
          // Firma simple primero: varios HTML 2–6 no elevan con options.
          api.seleccionar(id)
          done = true
          break
        } catch {
          try {
            api.seleccionar(id, { animate: true })
            done = true
            break
          } catch {
            /* next id */
          }
        }
      }
      if (!done) {
        for (const id of ids) {
          try {
            win?.postMessage({ type: 'lavilet:seleccionar', unidad: id }, '*')
            break
          } catch {
            /* ignore */
          }
        }
      }
    },
    [activeHtmlFloor],
  )

  const handleSelectSlot = (slot: DisplaySlot) => {
    if (!slotOpens(slot)) return
    const now = Date.now()
    // Ignora el click sintético del mismo toque. Otro departamento sí abre al primer toque.
    if (slot.id === lastHtmlOpenKeyRef.current && now - lastHtmlOpenAtRef.current < 350) return
    lastHtmlOpenAtRef.current = now
    lastHtmlOpenKeyRef.current = slot.id
    if (slot.area) {
      onSelectAreaRef.current?.(slot.area.code)
      return
    }
    if (!slot.unit) return
    onSelectUnit(slot.unit, slot.id)
  }

  const slotPointerRef = useRef<{
    slotId: string
    pointerId: number
    x: number
    y: number
  } | null>(null)

  const onSlotPointerDown = (slot: DisplaySlot, event: PointerEvent) => {
    if (!slotOpens(slot)) return
    if (slot.unit) prefetchSlotUnit(slot.unit)
    if (event.pointerType === 'mouse' && event.button !== 0) return
    slotPointerRef.current = {
      slotId: slot.id,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    }
  }

  const onSlotPointerUp = (slot: DisplaySlot, event: PointerEvent) => {
    if (!slotOpens(slot)) return
    const start = slotPointerRef.current
    slotPointerRef.current = null
    if (panMovedRef.current) return
    if (!start || start.slotId !== slot.id || start.pointerId !== event.pointerId) return
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > (portraitPanRef.current ? 22 : 14)) return
    event.preventDefault()
    event.stopPropagation()
    handleSelectSlot(slot)
  }

  const onPlanBackgroundTap = (event: PointerEvent<SVGSVGElement>) => {
    if (event.target !== event.currentTarget) return
    if (panMovedRef.current) {
      panMovedRef.current = false
      return
    }
    const rect = event.currentTarget.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const xPercent = ((event.clientX - rect.left) / rect.width) * 100
    const yPercent = ((event.clientY - rect.top) / rect.height) * 100
    const coarse = window.matchMedia('(pointer: coarse)').matches
    const slot = findSlotAtPercent(displaySlotsRef.current, xPercent, yPercent, coarse ? 8 : 0)
    if (slot && slotOpens(slot)) {
      handleSelectSlot(slot)
      return
    }
    onEmptyPlanTapRef.current?.()
  }

  const onSlotClick = (slot: DisplaySlot, event: MouseEvent) => {
    if (!slotOpens(slot)) return
    if (panMovedRef.current) {
      panMovedRef.current = false
      return
    }
    event.preventDefault()
    event.stopPropagation()
    handleSelectSlot(slot)
  }

  const prefetchSlotUnit = (unit: TourUnitSummary) => {
    if (prefetchedUnitRef.current === unit.id) return
    prefetchedUnitRef.current = unit.id
    onPrefetchUnitRef.current?.(unit)
  }

  const handleHoverSlot = (slot: DisplaySlot | null) => {
    if (!slot || !slotOpens(slot)) {
      setHoverSlot(null)
      elevateHtmlUnit(null)
      return
    }
    setHoverSlot(slot.id)
    if (!slot.unit) return
    elevateHtmlUnit(slot.id || slot.unit.unit_number, slot.unit)
    prefetchSlotUnit(slot.unit)
  }

  const zoomFloor = portraitPan ? portraitZoomMin : ZOOM_MIN
  const zoomCeil = portraitPan ? 1 : ZOOM_MAX
  const zoomOut = () =>
    setScale((value) => Math.max(zoomFloor, Number((value - ZOOM_STEP).toFixed(2))))
  const zoomIn = () =>
    setScale((value) => Math.min(zoomCeil, Number((value + ZOOM_STEP).toFixed(2))))

  const panXRef = useRef(0)
  panXRef.current = panX
  const scaleRef = useRef(scale)
  scaleRef.current = scale
  const portraitPanRef = useRef(portraitPan)
  portraitPanRef.current = portraitPan
  const frameWRef = useRef(0)
  frameWRef.current = typeof planFrameStyle.width === 'number' ? planFrameStyle.width : stageSize.width
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchRef = useRef<{ dist: number; scale: number } | null>(null)
  const dragRef = useRef<{
    id: number
    x: number
    y: number
    pan: number
    lastX: number
    lastT: number
    v: number
    moved: boolean
  } | null>(null)
  const inertiaRef = useRef(0)
  const panMovedRef = useRef(false)

  const panMax = portraitPan
    ? Math.max(0, (frameWRef.current * scale - stageSize.width) / 2)
    : 0

  const applyPan = (next: number) => {
    const view = stageRef.current?.clientWidth ?? stageSize.width
    const max = Math.max(0, (frameWRef.current * scaleRef.current - view) / 2)
    const clamped = Math.max(-max, Math.min(max, next))
    panXRef.current = clamped
    setPanX((prev) => (Math.abs(prev - clamped) < 0.4 ? prev : clamped))
    return clamped
  }

  const dismissPanHint = () => {
    setPanHint(false)
    try {
      sessionStorage.setItem('lavilet-plan-pan-hint', '1')
    } catch {
      /* el aviso igual se oculta */
    }
  }

  const onPlanPanDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!portraitPanRef.current) return
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const target = event.target
    if (target instanceof Element && target.closest('button, a, input, textarea')) return
    if (inertiaRef.current) cancelAnimationFrame(inertiaRef.current)
    inertiaRef.current = 0
    if (event.isPrimary) {
      pointersRef.current.clear()
      pinchRef.current = null
    }
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointersRef.current.size >= 2) {
      const pts = [...pointersRef.current.values()]
      const a = pts[0]
      const b = pts[1]
      if (a && b) pinchRef.current = { dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), scale: scaleRef.current }
      dragRef.current = null
      return
    }
    dragRef.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      pan: panXRef.current,
      lastX: event.clientX,
      lastT: performance.now(),
      v: 0,
      moved: false,
    }
    panMovedRef.current = false
  }

  const onPlanPanMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
    if (pointersRef.current.size >= 2 && pinchRef.current) {
      const pts = [...pointersRef.current.values()]
      const a = pts[0]
      const b = pts[1]
      if (!a || !b) return
      const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
      const next = Math.max(zoomFloor, Math.min(zoomCeil, pinchRef.current.scale * (dist / pinchRef.current.dist)))
      scaleRef.current = next
      setScale(Number(next.toFixed(3)))
      return
    }
    const drag = dragRef.current
    if (!drag || drag.id !== event.pointerId) return
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    if (!drag.moved && Math.hypot(dx, dy) < 22) return
    if (!drag.moved) {
      drag.moved = true
      panMovedRef.current = true
      dismissPanHint()
      stageRef.current?.setPointerCapture(event.pointerId)
    }
    const now = performance.now()
    const dt = Math.max(8, now - drag.lastT)
    drag.v = (event.clientX - drag.lastX) / dt
    drag.lastX = event.clientX
    drag.lastT = now
    applyPan(drag.pan + dx)
  }

  const onPlanPanUp = (event: PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId)
    if (pointersRef.current.size < 2) pinchRef.current = null
    const drag = dragRef.current
    if (!drag || drag.id !== event.pointerId) return
    dragRef.current = null
    if (!drag.moved) return
    let velocity = drag.v * 16
    const step = () => {
      velocity *= 0.9
      if (Math.abs(velocity) < 0.35) {
        inertiaRef.current = 0
        return
      }
      applyPan(panXRef.current + velocity)
      inertiaRef.current = requestAnimationFrame(step)
    }
    inertiaRef.current = requestAnimationFrame(step)
  }

  useEffect(() => {
    pointersRef.current.clear()
    pinchRef.current = null
    dragRef.current = null
  }, [portraitPan])

  useEffect(() => {
    const clear = () => {
      pointersRef.current.clear()
      pinchRef.current = null
      dragRef.current = null
    }
    window.addEventListener('orientationchange', clear)
    return () => {
      window.removeEventListener('orientationchange', clear)
      if (inertiaRef.current) cancelAnimationFrame(inertiaRef.current)
      inertiaRef.current = 0
    }
  }, [])

  const switchVariant = (next: FloorPlanVariant) => {
    const doc = layers[floor]?.doc ?? shown?.doc
    if (!doc) return
    const media = getFloorPlanVariantMedia(doc, next)
    if (!floorPlanVariantHasMedia(media)) return
    const resolved = planDocMediaUrl(doc, next)
    if (!resolved.url) return
    setVariantByFloor((prev) => ({ ...prev, [floor]: next }))
    onPreferredVariantChange?.(next)
    const apply = () => {
      upsertLayer({
        floor,
        doc: { ...doc, floor },
        variant: next,
        url: resolved.url!,
        kind: resolved.kind,
      })
      setReadyFloors((prev) => ({ ...prev, [floor]: true }))
      setFailedFloors((prev) => {
        if (!prev[floor]) return prev
        const nextFailed = { ...prev }
        delete nextFailed[floor]
        return nextFailed
      })
    }
    if (resolved.kind === 'html') {
      apply()
      return
    }
    void preloadFloorPlanImage(resolved.url).then(apply)
  }

  const handleImageError = (layerFloor: number, url: string) => {
    const layer = layers[layerFloor]
    if (layer?.kind === 'html') {
      setReadyFloors((prev) => ({ ...prev, [layerFloor]: true }))
      return
    }
    const altExt = alternateImageUrl(url)
    if (altExt && layer && layer.url === url) {
      upsertLayer({ ...layer, url: altExt, kind: 'image' })
      void preloadFloorPlanImage(altExt).then(() => {
        setReadyFloors((prev) => ({ ...prev, [layerFloor]: true }))
      })
      return
    }
    // Si falla el 3D, vuelve al 2D (o viceversa) en vez de tumbar todo el piso.
    if (layer?.doc) {
      const other: FloorPlanVariant = layer.variant === '3d' ? '2d' : '3d'
      const otherMedia = planDocMediaUrl(layer.doc, other)
      if (otherMedia.url && otherMedia.url !== url) {
        setVariantByFloor((prev) => ({ ...prev, [layerFloor]: other }))
        upsertLayer({
          ...layer,
          variant: other,
          url: otherMedia.url,
          kind: otherMedia.kind,
        })
        if (otherMedia.kind === 'image') void preloadFloorPlanImage(otherMedia.url)
        return
      }
    }
    setFailedFloors((prev) => ({ ...prev, [layerFloor]: true }))
  }
  imageErrorRef.current = handleImageError

  // Capas listas; iframes HTML solo del piso activo.
  layerUrlByFloorRef.current = {}
  for (const layer of Object.values(layers)) {
    if (layer?.url) layerUrlByFloorRef.current[layer.floor] = layer.url
  }

  const layerEntries = useMemo(
    () => Object.values(layers).filter((layer): layer is FloorLayer => Boolean(layer?.url)),
    [layers],
  )
  const htmlLayerEntries = useMemo(
    () =>
      layerEntries.filter(
        (layer) => layer.kind === 'html' && keptHtmlFloors.includes(layer.floor),
      ),
    [layerEntries, keptHtmlFloors],
  )

  const showPlanChrome = canToggleVariant

  return (
    <div
      data-plan-front={frontFloor}
      className={cn(
        'absolute inset-0 z-[18] bg-[#14110e]',
        'pt-[max(0px,env(safe-area-inset-top))] pb-[max(0px,env(safe-area-inset-bottom))]',
        'pl-[max(0px,env(safe-area-inset-left))] pr-[max(0px,env(safe-area-inset-right))]',
        touchesLocked && 'pointer-events-none',
      )}
    >
      <div
        ref={stageRef}
        className={cn(
          'absolute inset-0 flex min-h-0 min-w-0 items-center justify-center overflow-hidden p-0',
          portraitPan && 'touch-none',
        )}
        data-plan-stage
        style={portraitPan ? { touchAction: 'none' } : undefined}
        onPointerDownCapture={portraitPan ? onPlanPanDown : undefined}
        onPointerMoveCapture={portraitPan ? onPlanPanMove : undefined}
        onPointerUpCapture={portraitPan ? onPlanPanUp : undefined}
        onPointerCancelCapture={portraitPan ? onPlanPanUp : undefined}
        onLostPointerCapture={portraitPan ? onPlanPanUp : undefined}
      >
          {portraitPan
            ? (() => {
                const blurLayer =
                  layerEntries.find(
                    (layer) =>
                      layer.kind !== 'html' &&
                      layer.floor === frontFloor &&
                      layer.variant === planVariant &&
                      layer.url,
                  ) ??
                  layerEntries.find(
                    (layer) => layer.kind !== 'html' && layer.floor === frontFloor && layer.url,
                  )
                if (!blurLayer?.url) return null
                return (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={blurLayer.url}
                    alt=""
                    aria-hidden
                    draggable={false}
                    className="pointer-events-none absolute inset-[-12%] z-0 h-[124%] w-[124%] max-w-none object-cover"
                    style={{ filter: 'blur(28px) brightness(0.72) saturate(1.05)' }}
                  />
                )
              })()
            : null}
          {portraitPan && panHint ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-[max(5.5rem,env(safe-area-inset-bottom)+4.5rem)] z-20 flex justify-center px-16">
              <p className="inline-flex items-center gap-2 rounded-full bg-[#14110e]/80 px-3 py-2 text-[12px] text-[#f7f3ee] shadow-[0_8px_20px_rgba(0,0,0,0.28)]">
                <Hand size={16} className="text-[#bda27e]" aria-hidden />
                <span aria-hidden>↔</span>
                {t('Desliza para ver todo el edificio')}
              </p>
            </div>
          ) : null}
          {showPlanChrome ? (
            <div
              className="tour-plan-switch pointer-events-auto absolute z-30 flex rounded-full border border-[#bda27e]/40 bg-[#14110e]/55 p-0.5 shadow-[0_8px_24px_rgba(20,17,14,0.28)] backdrop-blur-md"
            >
              {(['2d', '3d'] as const).map((item) => {
                const available = item === '2d' ? has2d : has3d
                const active = planVariant === item
                const Icon = item === '2d' ? Square : Box
                return (
                  <button
                    key={item}
                    type="button"
                    disabled={!available}
                    onClick={() => switchVariant(item)}
                    className={cn(
                      'tour-plan-variant inline-flex items-center justify-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-semibold uppercase tracking-wide transition-colors sm:px-3 sm:text-[12px]',
                      '[@media(pointer:coarse)]:min-h-11 [@media(pointer:coarse)]:min-w-11',
                      active
                        ? 'bg-[#bda27e] text-[#14110e] shadow-sm'
                        : available
                          ? 'text-[#f7f3ee] hover:bg-white/10'
                          : 'cursor-not-allowed text-[#f7f3ee]/35',
                    )}
                    aria-pressed={active}
                    title={
                      t(available
                        ? `Ver plano ${item.toUpperCase()}`
                        : `Todavía no hay plano ${item.toUpperCase()}`)
                    }
                  >
                    <Icon size={13} strokeWidth={2} aria-hidden />
                    {t(item)}
                  </button>
                )
              })}
            </div>
          ) : null}

          {railLeading ? (
            <div className="pointer-events-auto absolute top-[calc(4rem+env(safe-area-inset-top)+0.75rem)] right-3 z-30 sm:right-4">
              {t(railLeading)}
            </div>
          ) : null}

          <div
            className={cn(
              'relative shrink-0',
              portraitPan ? 'z-[1] overflow-visible' : 'overflow-hidden',
              planVariant === '3d' ? 'bg-[#14110e]' : 'bg-white',
            )}
            data-plan-frame
            data-pan={portraitPan ? panX.toFixed(1) : undefined}
            data-pan-max={portraitPan ? panMax.toFixed(1) : undefined}
            style={{
              ...planFrameStyle,
              ...(portraitPan
                ? {
                    transform: `translate3d(${panX}px, 0, 0) scale(${scale})`,
                    transformOrigin: 'center center',
                    touchAction: 'none' as const,
                  }
                : null),
            }}
            onMouseLeave={() => setHoverSlot(null)}
          >
            {/* Un solo iframe WebGL (piso activo). */}
            {htmlLayerEntries.map((layer) => {
              const active = layer.floor === frontFloor && planVariant === '3d'
              const kept = layer.floor === frontFloor || layer.floor === holdFloor
              const booted = htmlFramed[layer.floor] === layer.url || htmlLoadedUrl[layer.floor] === layer.url
              const forced = revealFloor === layer.floor && active
              return (
                <iframe
                  key={`floor-html-${layer.floor}`}
                  ref={(node) => {
                    if (node) {
                      htmlIframeRefs.current[layer.floor] = node
                      return () => {
                        releaseFloorIframe(node)
                        if (htmlIframeRefs.current[layer.floor] === node) {
                          htmlIframeRefs.current[layer.floor] = null
                        }
                      }
                    }
                    htmlIframeRefs.current[layer.floor] = null
                  }}
                  src={layer.url}
                  title={t(`Plano interactivo piso ${layer.floor}`)}
                  loading="eager"
                  allow="fullscreen"
                  className={cn(
                    'absolute inset-0 z-[1] h-full w-full border-0 bg-[#14110e] transition-opacity duration-[250ms]',
                    active && (booted || forced) ? 'opacity-100' : 'pointer-events-none opacity-0',
                  )}
                  style={{
                    pointerEvents:
                      active && booted && displaySlots.length === 0 ? 'auto' : 'none',
                    visibility: kept ? 'visible' : 'hidden',
                  }}
                  onLoad={(event) => {
                    htmlLoadAtRef.current[layer.floor] = performance.now()
                    htmlIframeRefs.current[layer.floor] = event.currentTarget
                    setHtmlLoadedUrl((prev) =>
                      prev[layer.floor] === layer.url
                        ? prev
                        : { ...prev, [layer.floor]: layer.url },
                    )
                    setReadyFloors((prev) => ({ ...prev, [layer.floor]: true }))
                    try {
                      getLaViletPlanta(event.currentTarget.contentWindow)?.terminarPresentacion?.()
                    } catch {
                      /* ignore */
                    }
                    const mark = () => {
                      setHtmlFramed((prev) =>
                        prev[layer.floor] === layer.url ? prev : { ...prev, [layer.floor]: layer.url },
                      )
                    }
                    window.setTimeout(mark, 1500)
                  }}
                  onError={() => {
                    setRevealFloor(layer.floor)
                    onPresentedRef.current?.(layer.floor)
                  }}
                />
              )
            })}

            <div
              className={cn(
                'absolute inset-0 z-[2] origin-center transition-transform duration-150 ease-out',
                htmlInteractive && 'pointer-events-none',
              )}
              style={{ transform: portraitPan ? undefined : `scale(${scale})` }}
            >
              {layerEntries.map((layer) => {
                if (layer.kind === 'html') return null
                // Imagen 2D o 3D (webp) según la variante activa — no solo en modo 2d.
                const active = layer.floor === frontFloor && layer.variant === planVariant
                const kept = layer.floor === frontFloor || layer.floor === holdFloor
                return (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={`floor-${layer.floor}-${layer.variant}`}
                    src={layer.url}
                    alt={t("")}
                    draggable={false}
                    decoding="async"
                    fetchPriority={active ? 'high' : 'low'}
                    loading="eager"
                    ref={(node) => {
                      if (node?.complete && node.naturalWidth > 0) {
                        setReadyFloors((prev) =>
                          prev[layer.floor] ? prev : { ...prev, [layer.floor]: true },
                        )
                        const key = layer.url.split('?')[0]
                        setMeasuredImageSize((prev) => {
                          const cur = prev[key]
                          if (
                            cur &&
                            cur.width === node.naturalWidth &&
                            cur.height === node.naturalHeight
                          ) {
                            return prev
                          }
                          return {
                            ...prev,
                            [key]: { width: node.naturalWidth, height: node.naturalHeight },
                          }
                        })
                      }
                    }}
                    onLoad={(event) => {
                      const node = event.currentTarget
                      setReadyFloors((prev) => ({ ...prev, [layer.floor]: true }))
                      if (node.naturalWidth > 0 && node.naturalHeight > 0) {
                        const key = layer.url.split('?')[0]
                        setMeasuredImageSize((prev) => {
                          const cur = prev[key]
                          if (
                            cur &&
                            cur.width === node.naturalWidth &&
                            cur.height === node.naturalHeight
                          ) {
                            return prev
                          }
                          return {
                            ...prev,
                            [key]: { width: node.naturalWidth, height: node.naturalHeight },
                          }
                        })
                      }
                    }}
                    onError={() => handleImageError(layer.floor, layer.url)}
                    className={cn(
                      'absolute inset-0 h-full w-full object-contain transition-opacity duration-[250ms]',
                      active ? 'opacity-100' : 'opacity-0',
                    )}
                    style={{
                      visibility: kept ? 'visible' : 'hidden',
                      pointerEvents: 'none',
                    }}
                  />
                )
              })}

              {/* Segmentación 2D (clickeable). En 3D las zonas van en capa aparte (solo visual). */}
              {!htmlInteractive ? (
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                className="absolute inset-0 z-[1] h-full w-full touch-manipulation"
                role="img"
                aria-label={t("Departamentos del piso")}
                onMouseLeave={() => setHoverSlot(null)}
                onPointerUp={onPlanBackgroundTap}
              >
              {displaySlots.map((slot) => {
                const opens = slotOpens(slot)
                const marked = opens && (hoverSlot === slot.id || slot.unit?.id === selectedUnitId)
                const hovered = marked
                const areaFill = hovered ? 'rgba(189,162,126,0.46)' : 'rgba(189,162,126,0.22)'
                const areaStroke = hovered ? '#BDA27E' : 'rgba(189,162,126,0.95)'
                return (
                  <polygon
                    key={slot.id}
                    points={slot.points}
                    className={cn(
                      'cursor-pointer transition-[fill,stroke] duration-100',
                      !opens && 'cursor-not-allowed',
                    )}
                    fill={
                      slot.area
                        ? showSegmentation
                          ? areaFill
                          : 'rgba(189,162,126,0.16)'
                        : showSegmentation
                          ? hovered
                            ? 'rgba(61,155,74,0.42)'
                            : 'rgba(255,255,255,0.04)'
                          : 'rgba(255,255,255,0.001)'
                    }
                    stroke={
                      slot.area
                        ? areaStroke
                        : showSegmentation
                          ? hovered
                            ? 'rgba(61,155,74,0.95)'
                            : 'rgba(255,255,255,0.28)'
                          : 'rgba(0,0,0,0)'
                    }
                    strokeWidth={slot.area || showSegmentation ? (hovered ? 1.15 : 0.7) : 0.01}
                    vectorEffect="non-scaling-stroke"
                    style={{ pointerEvents: opens ? 'visiblePainted' : 'none' }}
                    onMouseEnter={() => handleHoverSlot(slot)}
                    onMouseLeave={() => {
                      setHoverSlot((current) => (current === slot.id ? null : current))
                    }}
                    onPointerDown={(event) => onSlotPointerDown(slot, event)}
                    onPointerUp={(event) => onSlotPointerUp(slot, event)}
                    onPointerCancel={() => {
                      slotPointerRef.current = null
                    }}
                    onClick={(event) => onSlotClick(slot, event)}
                  />
                )
              })}
            </svg>
              ) : null}

            {showSegmentation ? (
            <div className="pointer-events-none absolute inset-0 z-[2]">
              {displaySlots.map((slot) => {
                const { cx, cy } = slotCentroid(slot.points)
                const opens = slotOpens(slot)
                const marked = opens && (hoverSlot === slot.id || slot.unit?.id === selectedUnitId)
                const hovered = marked
                const label = slot.area ? slot.label : (slot.unit?.unit_number ?? slot.label)
                const shiftY = cy > 86 ? '-100%' : cy < 14 ? '0%' : '-50%'

                return (
                  <button
                    key={`label-${slot.id}`}
                    type="button"
                    disabled={!opens}
                    onMouseEnter={() => setHoverSlot(slot.id)}
                    onMouseLeave={() => setHoverSlot(null)}
                    onPointerDown={(event) => onSlotPointerDown(slot, event)}
                    onPointerUp={(event) => onSlotPointerUp(slot, event)}
                    onPointerCancel={() => {
                      slotPointerRef.current = null
                    }}
                    onClick={(event) => onSlotClick(slot, event)}
                    className={cn(
                      'tour-unit-pin pointer-events-auto absolute z-[2] flex touch-manipulation items-center justify-center gap-1.5 rounded-md bg-white px-2 py-1.5 text-left shadow-[0_2px_8px_rgba(15,23,42,0.22)]',
                      'sm:gap-2 sm:rounded-lg sm:px-2.5 sm:py-1.5',
                      opens
                        ? 'cursor-pointer hover:shadow-[0_4px_14px_rgba(15,23,42,0.28)]'
                        : 'cursor-not-allowed opacity-55',
                      slot.area && 'border border-[#BDA27E] text-[#2b1a18]',
                      hovered && !slot.area && 'ring-2 ring-[#3d9b4a]/80',
                      hovered && slot.area && 'ring-2 ring-[#BDA27E]',
                    )}
                    data-pin-id={slot.id}
                    style={{ left: `${cx}%`, top: `${cy}%`, transform: `translate(-50%, ${shiftY})` }}
                    aria-label={t(slot.area ? slot.label : slot.unit ? `Departamento ${label}` : `Zona ${label}`)}
                  >
                    <span
                      className={cn(
                        'h-2 w-2 shrink-0 rounded-full sm:h-2.5 sm:w-2.5',
                        slot.area ? 'bg-[#BDA27E]' : slot.unit ? statusDotClass(slot.unit.status) : 'bg-[#c4c4c4]',
                      )}
                    />
                    <span className="text-[10px] font-semibold tracking-wide text-[#2b2f36] sm:text-[11px]">
                      {t(label)}
                    </span>
                  </button>
                )
              })}
            </div>
            ) : null}
          </div>

          {missing ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-[#14110e]/55 text-xs text-white/80">
              {t(" No hay plano para este piso ")}</div>
          ) : null}

          {/* Hit SVG sobre el HTML 3D: hover eleva, clic abre ficha (pisos 2–6). */}
          {htmlInteractive && displaySlots.length > 0 ? (
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              className="absolute inset-0 z-[3] h-full w-full touch-manipulation"
              role="img"
              aria-label={t("Departamentos del piso")}
              style={{ pointerEvents: 'none' }}
              onMouseLeave={() => handleHoverSlot(null)}
            >
              {displaySlots.map((slot) => (
                <polygon
                  key={`html-hit-${slot.id}`}
                  points={slot.points}
                  fill={slot.area ? 'rgba(189,162,126,0.28)' : 'rgba(255,255,255,0.001)'}
                  stroke={slot.area ? '#BDA27E' : 'rgba(0,0,0,0)'}
                  strokeWidth={slot.area ? 1.15 : 0.01}
                  vectorEffect="non-scaling-stroke"
                  style={{ pointerEvents: slotOpens(slot) ? 'visiblePainted' : 'none' }}
                  className={slotOpens(slot) ? 'cursor-pointer' : undefined}
                  onMouseEnter={() => handleHoverSlot(slot)}
                  onMouseLeave={() => {
                    setHoverSlot((current) => (current === slot.id ? null : current))
                    elevateHtmlUnit(null)
                  }}
                  onPointerDown={(event) => onSlotPointerDown(slot, event)}
                  onPointerUp={(event) => onSlotPointerUp(slot, event)}
                  onPointerCancel={() => {
                    slotPointerRef.current = null
                  }}
                  onClick={(event) => onSlotClick(slot, event)}
                />
              ))}
            </svg>
          ) : null}
          {htmlInteractive ? (
            <div className="pointer-events-none absolute inset-0 z-[4]">
              {displaySlots.filter((slot) => slot.area).map((slot) => {
                const { cx, cy } = slotCentroid(slot.points)
                const shiftY = cy > 86 ? '-100%' : cy < 14 ? '0%' : '-50%'
                return (
                  <button
                    key={`html-area-${slot.id}`}
                    type="button"
                    onPointerDown={(event) => onSlotPointerDown(slot, event)}
                    onPointerUp={(event) => onSlotPointerUp(slot, event)}
                    onPointerCancel={() => {
                      slotPointerRef.current = null
                    }}
                    onClick={(event) => onSlotClick(slot, event)}
                    data-pin-id={slot.id}
                    className="tour-unit-pin pointer-events-auto absolute z-[2] flex items-center justify-center gap-1.5 rounded-md border border-[#BDA27E] bg-white px-2 py-1.5 text-left shadow-[0_2px_8px_rgba(15,23,42,0.22)]"
                    style={{ left: `${cx}%`, top: `${cy}%`, transform: `translate(-50%, ${shiftY})` }}
                    aria-label={slot.label}
                  >
                    <span className="h-2 w-2 shrink-0 rounded-full bg-[#BDA27E]" />
                    <span className="text-[10px] font-semibold tracking-wide text-[#2b2f36] sm:text-[11px]">
                      {t(slot.label)}
                    </span>
                  </button>
                )
              })}
            </div>
          ) : null}

          </div>

        <div className="tour-zoom-row pointer-events-auto z-30">
          <button
            type="button"
            onClick={zoomOut}
            disabled={scale <= zoomFloor + 0.01}
            className="tour-zoom-btn disabled:opacity-40"
            aria-label={t("Alejar plano")}
            title={t("Alejar")}
          >
            <Minus size={18} strokeWidth={2.25} />
          </button>
          <button
            type="button"
            onClick={zoomIn}
            disabled={scale >= zoomCeil - 0.001}
            className="tour-zoom-btn disabled:opacity-40"
            aria-label={t("Acercar plano")}
            title={t("Acercar")}
          >
            <Plus size={18} strokeWidth={2.25} />
          </button>
        </div>
      </div>

      <div
        className="tour-floor-rail pointer-events-auto absolute right-[max(0.5rem,env(safe-area-inset-right))] z-30 h-auto w-[calc(clamp(56px,5vw,84px)+2px)] overflow-y-auto overscroll-contain rounded-2xl border border-[#bda27e]/35 bg-[#14110e]/55 p-0 shadow-[0_8px_24px_rgba(20,17,14,0.28)] backdrop-blur-md"
        style={{ WebkitOverflowScrolling: 'touch' }}
        onWheel={(event) => event.stopPropagation()}
        onTouchMove={(event) => event.stopPropagation()}
      >
        <div className="flex h-auto flex-col items-center gap-0">
          {[7, 6, 5, 4, 3, 2, 1, 0, -1, -2].map((item) => {
            const active = item === floor
            const short = item === 7 ? 'T' : floorPlanLevelShort(item)
            return (
              <button
                key={item}
                type="button"
                onClick={() => onFloorChange(item)}
                className={cn(
                  'tour-floor-btn flex w-[clamp(56px,5vw,84px)] shrink-0 items-center justify-center whitespace-nowrap rounded-md px-0.5 font-bold tracking-wide',
                  'h-[clamp(30px,calc((100dvh-9rem)/10),56px)] text-[clamp(13px,2.2vh,18px)]',
                  active
                    ? 'bg-[#bda27e] text-[#14110e] shadow-sm'
                    : 'text-[#f7f3ee] hover:bg-white/10',
                )}
                aria-pressed={active}
                aria-label={t(floorPlanLevelLabel(item))}
                title={t(floorPlanLevelLabel(item))}
              >
                {t(short)}
              </button>
            )
          })}
        </div>
      </div>

      <div
        className="tour-floor-side pointer-events-auto absolute z-30 flex w-[var(--fab)] flex-col items-center gap-[var(--fab-gap)]"
        style={{ right: 'var(--edge-right)', bottom: 'var(--edge-bottom)' }}
      >
        {railTrailing}
        {SITE.whatsapp && whatsappHref ? (
          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onWhatsAppClick?.()}
            className="tour-whatsapp-btn tour-glass pointer-events-auto shrink-0"
            aria-label={t("Consultar por WhatsApp")}
            title={t("Consultar por WhatsApp")}
          >
            <WhatsAppIcon size={16} />
          </a>
        ) : null}
      </div>
    </div>
  )
}
