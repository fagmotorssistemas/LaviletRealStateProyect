'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
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
  planDocMediaUrl,
  preferredFloorVariant,
  prefetchFloorPlans,
  preloadFloorPlanHtml,
  preloadFloorPlanImage,
  refetchFloorPlanDoc,
  warmFloorPlans,
  type ReadyFloorView,
} from '@/lib/tour/floorPlanClientCache'
import { FLOOR_PLAN_WHATSAPP_MESSAGE, tourWhatsAppHref } from '@/lib/tour/tourWhatsApp'
import {
  applyOverlayAlign,
  floorPlanVariantHasMedia,
  getFloorPlanOverlayAlign,
  getFloorPlanVariantMedia,
  zoneDisplayPointsPercent,
  type FloorPlanVariant,
} from '@/lib/tour/floorPlanZones'
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
  onWhatsAppClick?: () => void
  /** Overlay dentro del marco del plano (p. ej. modos en desktop). */
  railLeading?: ReactNode
  /** Preferencia 2D/3D según el modo del showroom (planos-2d / planos-3d). */
  preferredVariant?: FloorPlanVariant
  /** Cuando el usuario cambia 2D/3D dentro del plano. */
  onPreferredVariantChange?: (variant: FloorPlanVariant) => void
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
  terminarPresentacion?: () => unknown
  estado?: () => { departamento?: string | null; modo?: string }
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

function findUnitByPlantaId(units: TourUnitSummary[], plantaId: string) {
  const raw = plantaId.trim()
  if (!raw) return null
  const byNumber = findUnitByNumber(units, raw)
  if (byNumber) return byNumber
  const lower = raw.toLowerCase()
  const digits = raw.replace(/\D/g, '')
  return (
    units.find((item) => item.unit_number.trim().toLowerCase() === lower) ??
    units.find((item) => item.id === raw) ??
    (digits
      ? units.find((item) => item.unit_number.replace(/\D/g, '') === digits)
      : null) ??
    null
  )
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
  railLeading,
  preferredVariant,
  onPreferredVariantChange,
}: TourFloorPlanProps) {
  const [hoverSlot, setHoverSlot] = useState<string | null>(null)
  const [htmlHoverUnit, setHtmlHoverUnit] = useState<TourUnitSummary | null>(null)
  const [htmlHoverLabel, setHtmlHoverLabel] = useState<string | null>(null)
  const [scale, setScale] = useState(ZOOM_MIN)
  /** Capas montadas: se quedan en DOM y el cambio es solo visibility. */
  const [layers, setLayers] = useState<Partial<Record<number, FloorLayer>>>({})
  const [variantByFloor, setVariantByFloor] = useState<Partial<Record<number, FloorPlanVariant>>>({})
  const [failedFloors, setFailedFloors] = useState<Partial<Record<number, boolean>>>({})
  const [readyFloors, setReadyFloors] = useState<Partial<Record<number, boolean>>>({})
  const stickyFloorRef = useRef<number | null>(null)
  const htmlIframeRefs = useRef<Partial<Record<number, HTMLIFrameElement | null>>>({})
  /** Iframes WebGL montados: activo + vecinos (swap casi instantáneo). */
  const [keptHtmlFloors, setKeptHtmlFloors] = useState<number[]>([])
  /** URL del HTML cuyo iframe ya disparó onLoad (por piso). */
  const [htmlLoadedUrl, setHtmlLoadedUrl] = useState<Partial<Record<number, string>>>({})
  const onSelectUnitRef = useRef(onSelectUnit)
  onSelectUnitRef.current = onSelectUnit
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
          const next = { ...loaded }
          delete next[view.floor]
          return next
        })
      }
      return { ...prev, [view.floor]: layer }
    })
    setVariantByFloor((prev) =>
      prev[view.floor] === view.variant ? prev : { ...prev, [view.floor]: view.variant },
    )
    // Montar iframe apenas tenemos URL (boot WebGL en background).
    if (layer.kind === 'html') {
      setKeptHtmlFloors((prev) => {
        if (prev.includes(view.floor)) return prev
        const next = [...prev, view.floor]
        return next.slice(-6)
      })
    }
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
        await preloadFloorPlanHtml(media.url)
        setReadyFloors((prev) => ({ ...prev, [item]: true }))
        return view
      }
      await preloadFloorPlanImage(media.url)
      setReadyFloors((prev) => ({ ...prev, [item]: true }))
      return view
    })
  }

  // Calienta TODOS los pisos (calidad intacta); prioridad al activo y vecinos.
  useEffect(() => {
    prefetchFloorPlans([...FLOOR_PLAN_FLOORS])
    void warmFloorPlans([...FLOOR_PLAN_FLOORS], neighborFloors(floor, 2)).then(() => {
      for (const item of FLOOR_PLAN_FLOORS) {
        const preferred = variantByFloor[item] ?? preferredVariant
        const ready = getReadyFloorView(item, preferred)
        if (!ready) continue
        // No pisar una capa 3D/HTML activa con el 2D del warm.
        setLayers((prev) => {
          const current = prev[item]
          if (current?.kind === 'html' && preferred === '3d') return prev
          if (current && current.variant === preferred && current.url === ready.url) return prev
          const layer = toLayer(ready)
          if (!layer) return prev
          return { ...prev, [item]: layer }
        })
        setReadyFloors((prev) => (prev[item] ? prev : { ...prev, [item]: true }))
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    setScale(ZOOM_MIN)
    if (preferredVariant) {
      setVariantByFloor((prev) =>
        prev[floor] === preferredVariant ? prev : { ...prev, [floor]: preferredVariant },
      )
    }
    // Usar cache caliente (HTML precargado). Solo refetch fresco al montar / invalidar.
    void ensureFloor(floor, { preferred: preferredVariant })
    for (const item of neighborFloors(floor, 2)) {
      if (item !== floor) void ensureFloor(item, { preferred: preferredVariant })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor, preferredVariant])

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
  /** Variantes del piso seleccionado (no del sticky) para el toggle 2D/3D. */
  const selectedLayer = layers[floor] ?? shown
  // Prioridad al toggle local del piso; preferredVariant solo inicializa / sincroniza desde el menú.
  const planVariant =
    variantByFloor[floor] ?? preferredVariant ?? selectedLayer?.variant ?? shown?.variant ?? '3d'
  const waiting = !shown && !failedFloors[floor]
  const missing = !shown && Boolean(failedFloors[floor])
  const docForToggles = selectedLayer?.doc ?? shown?.doc
  const has2d = floorPlanVariantHasMedia(docForToggles?.variants?.['2d'])
  const has3d = floorPlanVariantHasMedia(docForToggles?.variants?.['3d'])
  const canToggleVariant = has2d || has3d
  const expectsHtml3d = Boolean(docForToggles?.variants?.['3d']?.htmlUrl)
  // Esperar hasta que el iframe del piso activo haya booteado (o no hay HTML).
  // Si ya hay sticky de otro piso, no tapamos con overlay negro (cambio fluido).
  const activeHtmlUrl =
    planVariant === '3d' && layers[paintFloor]?.kind === 'html' ? layers[paintFloor]?.url : null
  const activeHtmlReady =
    Boolean(activeHtmlUrl) && htmlLoadedUrl[paintFloor] === activeHtmlUrl
  const waitingHtml =
    planVariant === '3d' &&
    expectsHtml3d &&
    !failedFloors[paintFloor] &&
    Boolean(activeHtmlUrl) &&
    !activeHtmlReady &&
    paintFloor === floor
  const waitingHtmlBoot =
    waitingHtml ||
    (planVariant === '3d' &&
      expectsHtml3d &&
      !failedFloors[floor] &&
      !layers[floor]?.url &&
      paintFloor === floor)

  useEffect(() => {
    if (planVariant !== '3d') return
    const keep = neighborFloors(floor, 2)
    setKeptHtmlFloors((prev) => {
      const merged = [...keep, ...prev.filter((item) => !keep.includes(item))]
      // Activo + vecinos primero; conservar hasta 6 para no matar la GPU.
      return merged.slice(0, 6)
    })
    for (const item of keep) {
      void ensureFloor(item, { preferred: preferredVariant })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floor, planVariant, preferredVariant])

  const planAspect = useMemo(() => {
    if (planVariant === '3d') {
      const media = getFloorPlanVariantMedia(docForToggles, '3d')
      // PB HTML es 2048×988; el JSON a veces trae 970 por defecto.
      const w = media.imageWidth > 1 ? media.imageWidth : 2048
      const h =
        media.imageHeight > 1
          ? media.imageHeight === 970 && floor === 0
            ? 988
            : media.imageHeight
          : floor === 0
            ? 988
            : 970
      return `${w} / ${h}`
    }
    const media = getFloorPlanVariantMedia(docForToggles, '2d')
    const w = media.imageWidth > 1 ? media.imageWidth : shown?.width || 1024
    const h = media.imageHeight > 1 ? media.imageHeight : shown?.height || 499
    return `${w} / ${h}`
  }, [docForToggles, planVariant, shown?.width, shown?.height, floor])

  const overlayAlign = useMemo(
    () => getFloorPlanOverlayAlign(docForToggles ?? null, planVariant),
    [docForToggles, planVariant],
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
    const zones = docForToggles?.zones ?? shown?.doc.zones
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
  }, [docForToggles?.zones, shown?.doc.zones, unitsOnFloor, overlayAlign])

  const activeHtmlFloor =
    planVariant === '3d' && layers[paintFloor]?.kind === 'html' ? paintFloor : null
  /** Segmentación (zonas/etiquetas) solo en 2D. */
  const showSegmentation = planVariant !== '3d'
  const htmlInteractive = activeHtmlFloor != null

  // El HTML maneja hover/click; el showroom abre la unidad vía postMessage.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data
      if (!data || data.source !== 'lavilet-floor-html') return
      if (data.type === 'hover') {
        const plantaId = String(data.departamento || '').trim()
        if (!plantaId) {
          setHtmlHoverUnit(null)
          setHtmlHoverLabel(null)
          return
        }
        const unit = findUnitByPlantaId(units, plantaId)
        setHtmlHoverUnit(unit)
        setHtmlHoverLabel(unit?.unit_number ?? plantaId)
        return
      }
      if (data.type !== 'ficha') return
      const plantaId = String(data.departamento || '').trim()
      if (!plantaId) return
      const unit = findUnitByPlantaId(units, plantaId)
      setHtmlHoverLabel(unit?.unit_number ?? plantaId)
      if (!unit) return
      setHtmlHoverUnit(unit)
      onSelectUnitRef.current(unit, plantaId)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [units])

  useEffect(() => {
    if (!htmlInteractive) {
      setHtmlHoverUnit(null)
      setHtmlHoverLabel(null)
    }
  }, [htmlInteractive])

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

  const handleSelectSlot = (slot: DisplaySlot) => {
    if (!slot.unit) return
    onSelectUnit(slot.unit, slot.id)
  }

  const zoomOut = () =>
    setScale((value) => Math.max(ZOOM_MIN, Number((value - ZOOM_STEP).toFixed(2))))
  const zoomIn = () =>
    setScale((value) => Math.min(ZOOM_MAX, Number((value + ZOOM_STEP).toFixed(2))))

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

  const warmOnIntent = (item: number) => {
    prefetchFloorPlans([item])
    void ensureFloor(item)
  }

  // Capas listas; iframes HTML solo de los pisos "kept" (activo + anterior).
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

  return (
    <div className="absolute inset-0 z-[18] flex bg-[#14110e] pt-[max(0px,env(safe-area-inset-top))] pb-[max(0px,env(safe-area-inset-bottom))]">
      <div className="relative flex min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden p-2 sm:p-3">
          {/* Controles encima del plano para que no los tape el hit-area */}
          {canToggleVariant ? (
            <div className="pointer-events-auto absolute left-3 top-3 z-30 flex rounded-lg bg-white/95 p-0.5 shadow-[0_4px_14px_rgba(15,23,42,0.18)] ring-1 ring-black/10 sm:left-4 sm:top-4">
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

          {railLeading ? (
            <div className="pointer-events-auto absolute top-3 right-3 z-30 sm:top-4 sm:right-4">
              {railLeading}
            </div>
          ) : null}

          <div
            className={cn(
              'relative max-h-full max-w-full overflow-hidden',
              planVariant === '3d'
                ? 'bg-[#14110e]'
                : 'rounded-xl bg-white ring-1 ring-white/10 [@media(max-height:520px)]:rounded-lg',
            )}
            style={{
              aspectRatio: planAspect,
              width: '100%',
              height: 'auto',
              maxHeight: '100%',
            }}
            onMouseLeave={() => setHoverSlot(null)}
          >
            {/* HTML/WebGL: activo + vecinos precargados (calidad intacta). */}
            {htmlLayerEntries.map((layer) => {
              const active = layer.floor === paintFloor && planVariant === '3d'
              return (
                <iframe
                  key={`floor-html-${layer.floor}`}
                  ref={(node) => {
                    htmlIframeRefs.current[layer.floor] = node
                  }}
                  src={layer.url}
                  title={`Plano interactivo piso ${layer.floor}`}
                  loading="eager"
                  allow="fullscreen"
                  className={cn(
                    'absolute inset-0 z-[1] h-full w-full border-0 bg-[#14110e]',
                    active ? 'opacity-100' : 'pointer-events-none opacity-0',
                  )}
                  style={{
                    pointerEvents: active ? 'auto' : 'none',
                    // Mantener WebGL vivo en capas ocultas (no display:none).
                    visibility: active ? 'visible' : 'hidden',
                  }}
                  onLoad={(event) => {
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
                  }}
                />
              )
            })}
            {waitingHtmlBoot && paintFloor === floor ? (
              <div className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center bg-[#14110e]/55 text-sm text-white/70">
                Cargando plano 3D…
              </div>
            ) : null}

            <div
              className={cn(
                'absolute inset-0 z-[2] origin-center transition-transform duration-150 ease-out',
                htmlInteractive && 'pointer-events-none',
              )}
              style={{ transform: `scale(${scale})` }}
            >
              {layerEntries.map((layer) => {
                if (layer.kind === 'html') return null
                // Imagen 2D o 3D (webp) según la variante activa — no solo en modo 2d.
                const active = layer.floor === paintFloor && layer.variant === planVariant
                return (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={`floor-${layer.floor}-${layer.variant}`}
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
                      visibility: active ? 'visible' : 'hidden',
                      pointerEvents: 'none',
                    }}
                  />
                )
              })}

              {/* Segmentación solo en 2D. En HTML 3D el iframe recibe el cursor. */}
              {!htmlInteractive ? (
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                className="absolute inset-0 z-[1] h-full w-full touch-manipulation"
                role="img"
                aria-label="Departamentos del piso"
                onMouseLeave={() => setHoverSlot(null)}
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
                      showSegmentation
                        ? selected
                          ? 'rgba(61,155,74,0.38)'
                          : hovered && slot.unit
                            ? 'rgba(61,155,74,0.18)'
                            : 'rgba(255,255,255,0.04)'
                        : 'rgba(255,255,255,0.001)'
                    }
                    stroke={
                      showSegmentation
                        ? selected
                          ? 'rgba(61,155,74,0.95)'
                          : hovered && slot.unit
                            ? 'rgba(255,255,255,0.7)'
                            : 'rgba(255,255,255,0.28)'
                        : 'rgba(0,0,0,0)'
                    }
                    strokeWidth={showSegmentation ? (selected || hovered ? 0.55 : 0.35) : 0.01}
                    vectorEffect="non-scaling-stroke"
                    style={{ pointerEvents: slot.unit ? 'visiblePainted' : 'none' }}
                    onMouseEnter={() => {
                      if (!slot.unit) return
                      setHoverSlot(slot.id)
                    }}
                    onPointerDown={(event) => {
                      if (!slot.unit) return
                      // Evita que el pan/zoom del contenedor se coma el tap.
                      event.stopPropagation()
                      handleSelectSlot(slot)
                    }}
                  />
                )
              })}
            </svg>
              ) : null}

            {showSegmentation ? (
            <div className="pointer-events-none absolute inset-0 z-[2]">
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
                      handleSelectSlot(slot)
                    }}
                    className={cn(
                      'pointer-events-auto absolute z-[2] flex -translate-x-1/2 -translate-y-1/2 touch-manipulation items-center gap-1.5 rounded-md bg-white px-2 py-1.5 text-left shadow-[0_2px_8px_rgba(15,23,42,0.22)] transition-[transform,box-shadow] duration-100',
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
            ) : null}
          </div>

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

          {/* En 3D: número en el centro de cada depto (sobre el plano). */}
          {htmlInteractive && displaySlots.length > 0 ? (
            <div className="pointer-events-none absolute inset-0 z-[3]">
              {displaySlots.map((slot) => {
                if (!slot.unit && !slot.label) return null
                const { cx, cy } = slotCentroid(slot.points)
                const label = slot.unit?.unit_number ?? slot.label
                const active =
                  (htmlHoverUnit != null && slot.unit?.id === htmlHoverUnit.id) ||
                  (htmlHoverLabel != null &&
                    (label.trim().toLowerCase() === htmlHoverLabel.trim().toLowerCase() ||
                      slot.id.trim().toLowerCase() === htmlHoverLabel.trim().toLowerCase()))
                const selected = Boolean(slot.unit && slot.unit.id === selectedUnitId)
                return (
                  <button
                    key={`html-pin-${slot.id}`}
                    type="button"
                    disabled={!slot.unit}
                    className={cn(
                      'pointer-events-auto absolute z-[3] flex -translate-x-1/2 -translate-y-1/2 touch-manipulation items-center gap-1 rounded-md px-1.5 py-1 shadow-[0_2px_10px_rgba(15,23,42,0.28)] ring-1 transition-[transform,background-color] duration-100',
                      active || selected
                        ? 'scale-110 bg-white ring-black/15'
                        : 'bg-white/92 ring-black/10 hover:bg-white',
                      !slot.unit && 'cursor-not-allowed opacity-70',
                    )}
                    style={{ left: `${cx}%`, top: `${cy}%` }}
                    onClick={() => {
                      if (slot.unit) onSelectUnit(slot.unit, slot.id)
                    }}
                    title={slot.unit ? `Abrir unidad ${label}` : label}
                  >
                    <span
                      className={cn(
                        'h-1.5 w-1.5 shrink-0 rounded-full sm:h-2 sm:w-2',
                        slot.unit ? statusDotClass(slot.unit.status) : 'bg-[#c4c4c4]',
                      )}
                      aria-hidden
                    />
                    <span
                      className={cn(
                        'font-bold tracking-wide text-[#1a2744]',
                        active || selected ? 'text-[11px] sm:text-[12px]' : 'text-[10px] sm:text-[11px]',
                      )}
                    >
                      {label}
                    </span>
                  </button>
                )
              })}
            </div>
          ) : null}

          {/* Hover sin zona: pin al centro con el id del HTML. */}
          {htmlInteractive && htmlHoverLabel && displaySlots.length === 0 ? (
            <div className="pointer-events-none absolute inset-0 z-[3]">
              <button
                type="button"
                className="pointer-events-auto absolute top-1/2 left-1/2 z-[3] flex -translate-x-1/2 -translate-y-1/2 touch-manipulation items-center gap-1.5 rounded-md bg-white px-2.5 py-1.5 shadow-[0_4px_16px_rgba(15,23,42,0.35)] ring-1 ring-black/10"
                onClick={() => {
                  if (htmlHoverUnit) onSelectUnit(htmlHoverUnit, htmlHoverUnit.unit_number)
                }}
                disabled={!htmlHoverUnit}
              >
                <span
                  className={cn(
                    'h-2 w-2 shrink-0 rounded-full',
                    htmlHoverUnit ? statusDotClass(htmlHoverUnit.status) : 'bg-[#BDA27E]',
                  )}
                  aria-hidden
                />
                <span className="text-[11px] font-bold tracking-wide text-[#1a2744]">
                  {htmlHoverLabel}
                </span>
              </button>
            </div>
          ) : null}
          </div>

        <div className="pointer-events-auto absolute bottom-3 left-3 z-30 flex flex-col gap-1.5 sm:bottom-4 sm:left-4">
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
