'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Cache, CONSTANTS, Viewer, events } from '@photo-sphere-viewer/core'
import { GyroscopePlugin } from '@photo-sphere-viewer/gyroscope-plugin'
import { MarkersPlugin, events as markerEvents } from '@photo-sphere-viewer/markers-plugin'
import { VirtualTourPlugin, events as tourEvents } from '@photo-sphere-viewer/virtual-tour-plugin'
import type { VirtualTourNode } from '@photo-sphere-viewer/virtual-tour-plugin'
import type { Position } from '@photo-sphere-viewer/core'
import {
  ChevronLeft,
  ChevronRight,
  Columns2,
  FileText,
  Images,
  Layers,
  Bookmark,
  PanelsTopLeft,
  Rotate3d,
  SwatchBook,
} from 'lucide-react'
import { createTourArrow, roomHotspotHtml } from '@/components/tour/createTourArrow'
import { TourPicker } from '@/components/tour/TourPicker'
import { TourFichaDrawer } from '@/components/tour/TourFichaDrawer'
import { TourFloorPlan } from '@/components/tour/TourFloorPlan'
import { TourComparador } from '@/components/tour/TourComparador'
import { TourFinishCompareOverlay } from '@/components/tour/TourFinishCompareOverlay'
import type { ComparePanoPose } from '@/components/tour/CompareSidePano'
import { TourSaveUnitModal } from '@/components/tour/TourSaveUnitModal'
import { TourTerminacionesPanel } from '@/components/tour/TourTerminacionesPanel'
import { TourInfoRequestModal } from '@/components/tour/TourInfoRequestModal'
import { TourFloorLocationPeek } from '@/components/tour/TourFloorLocationPeek'
import { SITE } from '@/lib/marketing/site'
import { buildTourWhatsAppMessage, tourWhatsAppHref } from '@/lib/tour/tourWhatsApp'
import {
  buildTourRooms,
  roomsShareFamily,
  roomsShareSlot,
  resolveTourRoomSlug,
  roomSlugFromNode,
  TOUR_HOME_SLUG,
  tourHomeSlug,
  tourRoomLabel,
} from '@/lib/tour/tourRooms'
import { pickCatalogPanoUrl, pickTourWidth, type TourWidth } from '@/lib/tour/pickTourWidth'
import { requestGyroPermission, stabilizeTourGyro } from '@/lib/tour/stabilizeGyro'
import { pickRoomScene, pickSceneUrl, finishesMatch } from '@/lib/tour/roomScene'
import { matchesPlanoVariant } from '@/lib/typology-assets'
import {
  getTourUnitTypeSlug,
  loadRoomVariantUrls,
  loadTourCatalog,
  loadTourNodes,
  loadTourUnits,
  type TourCatalog,
} from '@/services/tour.service'
import { useTourSceneTracking } from '@/hooks/useTourSceneTracking'
import { TourLeadGate } from '@/components/tour/TourLeadGate'
import { logTourEvent } from '@/lib/tour/visitorTracking'
import {
  findUnitByNumber,
  readUnitQueryParam,
  writeUnitQueryParam,
} from '@/lib/tour/unitDeepLink'
import { unitFloorNumber } from '@/lib/tour/floorPlanHotspots'
import type {
  TourLightMode,
  TourPlacedHotspot,
  TourPublicCatalog,
  TourTypologyOption,
  TourUnitSummary,
} from '@/types/tour'
import { cn } from '@/lib/utils'
import '@photo-sphere-viewer/core/index.css'
import '@photo-sphere-viewer/virtual-tour-plugin/index.css'
import '@photo-sphere-viewer/markers-plugin/index.css'
import './tour-viewer.css'

Cache.enabled = true

function lookAtSpot(viewer: Viewer, yaw: number, pitch: number) {
  return viewer.animate({
    yaw,
    pitch,
    zoom: 42,
    speed: 720,
    easing: 'inOutSine',
  })
}

function roomMarkerPin(item: TourPlacedHotspot) {
  const kind = item.kind === 'look' ? 'look' : 'go'
  return {
    id: `pin-${item.id}`,
    position: { yaw: item.yaw, pitch: item.pitch },
    html: roomHotspotHtml(item.label, kind),
    anchor: 'center center' as const,
    size: { width: 92, height: 78 },
    tooltip: item.label,
    data: { room: item.slug, kind, yaw: item.yaw, pitch: item.pitch },
  }
}

function buildTourMarkers(
  viewMode: string,
  room: string,
  _tourRooms: { slug: string; label: string }[],
  placed: TourPlacedHotspot[],
  _homeSlug: string,
) {
  if (viewMode !== 'tour') return []
  return placed.filter((item) => item.from === room).map((item) => roomMarkerPin(item))
}

function CrossfadeStill({
  url,
  alt,
  contain = false,
  fit = 'vistas',
}: {
  url: string | null
  alt: string
  contain?: boolean
  fit?: 'vistas' | 'planos'
}) {
  const [current, setCurrent] = useState<string | null>(url)
  const [previous, setPrevious] = useState<string | null>(null)

  useEffect(() => {
    if (!url) {
      setCurrent(null)
      setPrevious(null)
      return
    }
    const preload = new Image()
    preload.src = url
    setCurrent((prev) => {
      if (prev === url) return prev
      setPrevious(prev)
      return url
    })
  }, [url])

  useEffect(() => {
    if (!previous) return
    const done = window.setTimeout(() => setPrevious(null), 1100)
    return () => window.clearTimeout(done)
  }, [previous, current])

  if (!current && !previous) return null

  return (
    <div className="absolute inset-0 overflow-hidden bg-[#111]">
      {previous ? (
        <StillFrame key={`out-${previous}`} src={previous} alt="" contain={contain} fit={fit} motion="out" />
      ) : null}
      {current ? (
        <StillFrame key={`in-${current}`} src={current} alt={alt} contain={contain} fit={fit} motion="in" />
      ) : null}
    </div>
  )
}

function StillFrame({
  src,
  alt,
  contain,
  fit,
  motion,
}: {
  src: string
  alt: string
  contain: boolean
  fit: 'vistas' | 'planos'
  motion: 'in' | 'out'
}) {
  return (
    <div className={cn('pointer-events-none absolute inset-0', motion === 'in' ? 'tour-walk-in' : 'tour-walk-out')}>
      {contain ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          aria-hidden
          draggable={false}
          className="absolute inset-0 h-full w-full scale-[1.25] object-cover blur-[22px] brightness-[0.92] saturate-150"
        />
      ) : null}
      <div
        className={cn(
          'absolute inset-0',
          contain && 'tour-still-fit',
          contain && fit === 'planos' && 'tour-still-fit--planos',
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          draggable={false}
          className={cn(
            contain
              ? 'h-full w-full object-contain object-center'
              : 'absolute inset-0 h-full w-full object-cover',
          )}
        />
      </div>
    </div>
  )
}

type TourViewMode = 'tour' | 'vistas' | 'galeria' | 'planos-2d' | 'planos-3d'
type StillItem = { id: string; label: string; url: string }

function stillLabelFromFile(fileName: string) {
  return fileName
    .replace(/\.[^.]+$/, '')
    .replace(/^(2d|3d)[-_]/i, '')
    .replace(/[-_]/g, ' ')
    .trim()
}

function isPlanosMode(mode: TourViewMode): mode is 'planos-2d' | 'planos-3d' {
  return mode === 'planos-2d' || mode === 'planos-3d'
}

function WhatsAppIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
    </svg>
  )
}

function ModeButton({
  active,
  children,
  icon,
  onClick,
  disabled,
  title,
}: {
  active: boolean
  children: string
  icon: ReactNode
  onClick: () => void
  disabled?: boolean
  title?: string
}) {
  return (
    <button
      type="button"
      title={title ?? children}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'tour-mode-btn tour-glass border-white/25 !bg-[#14110e]/72 text-left font-semibold uppercase [text-shadow:0_1px_8px_rgba(0,0,0,0.65)] transition-colors duration-300',
        active ? 'text-white shadow-[inset_2px_0_0_#BDA27E]' : 'text-white/80 hover:text-white',
        disabled && 'cursor-not-allowed opacity-40 hover:text-white/80',
      )}
    >
      <span className="tour-mode-btn__icon" aria-hidden>
        {icon}
      </span>
      <span className="tour-mode-btn__label">{children}</span>
    </button>
  )
}

function PlanosModePicker({
  viewMode,
  onSelect,
}: {
  viewMode: TourViewMode
  onSelect: (mode: 'planos-2d' | 'planos-3d') => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const active = isPlanosMode(viewMode)
  const current = viewMode === 'planos-3d' ? '3d' : '2d'
  const label = active ? (current === '3d' ? 'Plano 3D' : 'Plano 2D') : 'Plano 3D'

  useEffect(() => {
    if (!open) return
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => {
          if (!active) {
            onSelect('planos-3d')
            return
          }
          setOpen((value) => !value)
        }}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          'tour-mode-btn tour-glass border-white/25 !bg-[#14110e]/72 text-left font-semibold uppercase [text-shadow:0_1px_8px_rgba(0,0,0,0.65)] transition-colors duration-300',
          active ? 'text-white shadow-[inset_2px_0_0_#BDA27E]' : 'text-white/80 hover:text-white',
        )}
      >
        <span className="tour-mode-btn__icon" aria-hidden>
          <Layers size={14} strokeWidth={1.75} />
        </span>
        <span className="tour-mode-btn__label">{label}</span>
      </button>
      {open ? (
        <ul
          role="listbox"
          className="tour-glass absolute top-[calc(100%+4px)] right-0 z-30 w-full min-w-[7.5rem] overflow-hidden rounded-xl py-1"
        >
          {(
            [
              { value: 'planos-3d' as const, label: 'Plano 3D' },
              { value: 'planos-2d' as const, label: 'Plano 2D' },
            ] as const
          ).map((opt) => {
            const selected = viewMode === opt.value
            return (
              <li key={opt.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onSelect(opt.value)
                    setOpen(false)
                  }}
                  className={cn(
                    'w-full px-3 py-2 text-left text-[10px] font-semibold tracking-[0.12em] uppercase sm:text-[11px]',
                    selected ? 'bg-white/12 text-white' : 'text-white/75 hover:bg-white/8 hover:text-white',
                  )}
                >
                  {opt.label}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

function StillGalleryBar({
  items,
  index,
  onIndex,
  showThumbs = true,
}: {
  items: StillItem[]
  index: number
  onIndex: (next: number) => void
  showThumbs?: boolean
}) {
  if (items.length === 0) return null
  const safe = Math.min(index, Math.max(items.length - 1, 0))
  return (
    <div className="pointer-events-auto mx-auto flex w-full min-w-0 max-w-2xl flex-col items-center gap-1 sm:gap-2">
      <div className="flex w-full min-w-0 items-center justify-center gap-1 sm:gap-2">
        {items.length > 1 ? (
          <button
            type="button"
            onClick={() => onIndex((safe - 1 + items.length) % items.length)}
            className="tour-glass tour-icon"
            aria-label="Anterior"
          >
            <ChevronLeft size={16} strokeWidth={1.5} />
          </button>
        ) : null}
        <p className="tour-caption min-w-0 flex-1 truncate px-2 text-center">{items[safe]?.label}</p>
        {items.length > 1 ? (
          <button
            type="button"
            onClick={() => onIndex((safe + 1) % items.length)}
            className="tour-glass tour-icon"
            aria-label="Siguiente"
          >
            <ChevronRight size={16} strokeWidth={1.5} />
          </button>
        ) : null}
      </div>
      {showThumbs ? (
        <div className="tour-thumbs">
          {items.map((item, itemIndex) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onIndex(itemIndex)}
              className={cn('tour-thumb', itemIndex === safe && 'is-on')}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.url} alt={item.label} className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function shortestViewport() {
  const vv = window.visualViewport
  return Math.min(
    window.innerWidth,
    window.innerHeight,
    vv?.width || window.innerWidth,
    vv?.height || window.innerHeight,
  )
}

function isOsLandscape() {
  const type = window.screen?.orientation?.type ?? ''
  const angle = window.screen?.orientation?.angle
  const legacy = (window as Window & { orientation?: number }).orientation
  const byType = type.startsWith('landscape')
  const byMq = window.matchMedia('(orientation: landscape)').matches
  const byBox = window.innerWidth > window.innerHeight + 24
  const vv = window.visualViewport
  const byVv = Boolean(vv && vv.width > vv.height + 24)
  const byAngle =
    (typeof angle === 'number' && (Math.abs(angle) === 90 || Math.abs(angle) === 270)) ||
    legacy === 90 ||
    legacy === -90
  return byType || byMq || byBox || byVv || byAngle
}

function shouldGoImmersive() {
  if (!isOsLandscape()) return false
  return shortestViewport() <= 720
}

function useShowroomImmersive(enabled: boolean) {
  const [want, setWant] = useState(false)

  useEffect(() => {
    if (!enabled) {
      setWant(false)
      return
    }
    const sync = () => {
      setWant(shouldGoImmersive())
    }
    sync()
    const timers = [0, 200, 500, 900].map((ms) => window.setTimeout(sync, ms))
    const onOrient = () => {
      sync()
      timers.push(window.setTimeout(sync, 200), window.setTimeout(sync, 700))
    }
    const landscapeMq = window.matchMedia('(orientation: landscape)')
    landscapeMq.addEventListener('change', sync)
    window.addEventListener('resize', sync)
    window.addEventListener('orientationchange', onOrient)
    window.visualViewport?.addEventListener('resize', sync)
    window.screen?.orientation?.addEventListener('change', onOrient)
    return () => {
      timers.forEach((id) => window.clearTimeout(id))
      landscapeMq.removeEventListener('change', sync)
      window.removeEventListener('resize', sync)
      window.removeEventListener('orientationchange', onOrient)
      window.visualViewport?.removeEventListener('resize', sync)
      window.screen?.orientation?.removeEventListener('change', onOrient)
    }
  }, [enabled])

  return { want }
}

async function requestTourFullscreen(el: HTMLElement) {
  const req =
    el.requestFullscreen?.bind(el) ??
    (el as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> }).webkitRequestFullscreen?.bind(el)
  if (!req || document.fullscreenElement) return
  try {
    await req()
  } catch {
    /* iOS often blocks this; CSS cover still applies */
  }
}

async function leaveTourFullscreen() {
  const exit =
    document.exitFullscreen?.bind(document) ??
    (document as Document & { webkitExitFullscreen?: () => Promise<void> }).webkitExitFullscreen?.bind(document)
  if (!exit || !document.fullscreenElement) return
  try {
    await exit()
  } catch {
    /* ignore */
  }
}

function capturePanoFrame(viewer: Viewer): string | null {
  const canvas = viewer.container.querySelector('canvas')
  if (!(canvas instanceof HTMLCanvasElement) || canvas.width < 2) return null
  try {
    return canvas.toDataURL('image/jpeg', 0.74)
  } catch {
    return null
  }
}

function useSwipePages(enabled: boolean, count: number, onStep: (delta: -1 | 1) => void) {
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const onStepRef = useRef(onStep)
  onStepRef.current = onStep

  useEffect(() => {
    if (!enabled || count < 2) return
    const finish = (event: PointerEvent) => {
      const start = startRef.current
      startRef.current = null
      if (!start) return
      const dx = event.clientX - start.x
      const dy = event.clientY - start.y
      if (Math.abs(dx) < 48 || Math.abs(dx) <= Math.abs(dy) * 1.2) return
      onStepRef.current(dx < 0 ? 1 : -1)
    }
    const cancel = () => {
      startRef.current = null
    }
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', cancel)
    return () => {
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', cancel)
    }
  }, [count, enabled])

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (!enabled || count < 2 || event.button !== 0) return
      startRef.current = { x: event.clientX, y: event.clientY }
    },
    [count, enabled],
  )

  return { onPointerDown }
}

function variantUrl(node: VirtualTourNode | undefined, width: TourWidth): string | undefined {
  const variants = node?.data?.variants as Record<string, { url?: string }> | undefined
  return variants?.[String(width)]?.url ?? (typeof node?.panorama === 'string' ? node.panorama : undefined)
}

function nodesFromPublicCatalog(
  catalog: TourPublicCatalog | null,
  width: TourWidth,
  finish: string,
  light: TourLightMode,
): { nodes: VirtualTourNode[]; startNodeId: string | undefined } {
  if (!catalog) return { nodes: [], startNodeId: undefined }
  const first = catalog.typologies.find(
    (item) => item.panorama || item.rooms.some((room) => room.url || room.scenes.length > 0),
  )
  if (!first) return { nodes: [], startNodeId: undefined }
  const home =
    first.rooms.find((room) => room.slug === TOUR_HOME_SLUG) ??
    first.rooms.find((room) => room.url || room.scenes.length > 0)
  const url =
    pickCatalogPanoUrl(first.panorama, width, finish, light) ??
    pickSceneUrl(pickRoomScene(home?.scenes, finish, light), width) ??
    home?.url
  if (!url) return { nodes: [], startNodeId: undefined }
  const id = home?.slug ?? TOUR_HOME_SLUG
  return {
    startNodeId: id,
    nodes: [
      {
        id,
        panorama: url,
        name: home?.label ?? 'Sala',
        caption: home?.label ?? 'Sala',
        links: [],
        data: { room: id, variants: {} },
      },
    ],
  }
}

export function TourViewer({ embedded = false }: { embedded?: boolean }) {
  const slotRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<Viewer | null>(null)
  const hold = useShowroomImmersive(true)
  const immersive = hold.want
  const tourRef = useRef<VirtualTourPlugin | null>(null)
  const targetWidthRef = useRef<TourWidth>(2048)
  const catalogWidthRef = useRef<TourWidth>(4096)
  const currentUrlRef = useRef('')
  const preloadedRef = useRef(new Set<string>())
  const switchTokenRef = useRef(0)
  const pendingRotateRef = useRef<Position | null>(null)
  const unitTypeSlugRef = useRef(getTourUnitTypeSlug())
  const appliedPanoKeyRef = useRef('')

  const [catalog, setCatalog] = useState<TourCatalog | null>(null)
  const [units, setUnits] = useState<TourUnitSummary[]>([])
  const [nodes, setNodes] = useState<VirtualTourNode[]>([])
  const [finish, setFinish] = useState('')
  const [light, setLight] = useState<TourLightMode>('dia')
  const [room, setRoom] = useState(TOUR_HOME_SLUG)
  const [loading, setLoading] = useState(false)
  const [booting, setBooting] = useState(true)
  const [publicCatalog, setPublicCatalog] = useState<TourPublicCatalog | null>(null)
  const [selectedTypology, setSelectedTypology] = useState('')
  const [gateOpen, setGateOpen] = useState(false)
  const [fichaOpen, setFichaOpen] = useState(() => Boolean(readUnitQueryParam()))
  const [fichaExpanded, setFichaExpanded] = useState(() => Boolean(readUnitQueryParam()))
  const [saveUnitOpen, setSaveUnitOpen] = useState(false)
  const [infoRequestOpen, setInfoRequestOpen] = useState(false)
  const [shellMode, setShellMode] = useState<'plan' | 'unit'>(() => {
    if (readUnitQueryParam()) return 'unit'
    return embedded ? 'plan' : 'unit'
  })
  const [planFloor, setPlanFloor] = useState(1)
  const [terminacionesFocus, setTerminacionesFocus] = useState(false)
  const [finishCompareOpen, setFinishCompareOpen] = useState(false)
  const [finishRight, setFinishRight] = useState('')
  const [finishCompareSplit, setFinishCompareSplit] = useState(50)
  const [comparePose, setComparePose] = useState<ComparePanoPose | null>(null)
  const comparePoseLockRef = useRef<'main' | 'side' | null>(null)
  const comparePoseRafRef = useRef(0)
  const [compareOpen, setCompareOpen] = useState(false)
  const [compareUnitBId, setCompareUnitBId] = useState<string | null>(null)
  const [comparePreviewIndex, setComparePreviewIndex] = useState(0)
  const [compareSplit, setCompareSplit] = useState(50)
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null)
  const [gyroHint, setGyroHint] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<TourViewMode>(() =>
    readUnitQueryParam() ? 'galeria' : 'tour',
  )
  const [vistaIndex, setVistaIndex] = useState(0)
  const [galeriaIndex, setGaleriaIndex] = useState(0)
  const [planoIndex, setPlanoIndex] = useState(0)
  const [panoGhost, setPanoGhost] = useState<string | null>(null)
  const [panoGhostKey, setPanoGhostKey] = useState(0)
  const [panoEntering, setPanoEntering] = useState(false)
  const [panoLeaving, setPanoLeaving] = useState(false)
  const lastStillRef = useRef<string | null>(null)
  const walkToRef = useRef<Position | null>(null)
  const walkingRef = useRef(false)
  const lookPromiseRef = useRef<PromiseLike<boolean> | null>(null)

  const preloadUrls = useCallback((viewer: Viewer, urls: string[]) => {
    void Promise.all(
      urls.map(async (url) => {
        if (preloadedRef.current.has(url)) return
        try {
          await viewer.textureLoader.preloadPanorama(url)
          preloadedRef.current.add(url)
        } catch {
          /* on-demand */
        }
      }),
    )
  }, [])

  const preloadCurrentRoom = useCallback(
    (viewer: Viewer, roomId: string, currentUrl?: string) => {
      void loadRoomVariantUrls(roomId, targetWidthRef.current).then((urls) => {
        preloadUrls(
          viewer,
          urls.filter((url) => url !== currentUrl),
        )
      })
    },
    [preloadUrls],
  )

  const applyCombo = useCallback(
    async (nextFinish: string, nextLight: TourLightMode) => {
      const viewer = viewerRef.current
      const tour = tourRef.current
      if (!viewer || !tour) return

      pendingRotateRef.current = viewer.getPosition()
      const token = ++switchTokenRef.current
      const stayId = tour.getCurrentNode()?.id ?? room

      try {
        const scene = await loadTourNodes({
          unitTypeSlug: unitTypeSlugRef.current,
          finishSlug: nextFinish,
          light: nextLight,
          preferredWidth: targetWidthRef.current,
        })
        if (token !== switchTokenRef.current) return
        if (scene.nodes.length === 0) return

        const nextNode = scene.nodes.find((n) => n.id === stayId) ?? scene.nodes[0]
        const nextUrl = String(nextNode?.panorama ?? '')
        const ready = Boolean(nextUrl && preloadedRef.current.has(nextUrl))
        if (!ready) setLoading(true)

        const startId = nextNode?.id ?? scene.startNodeId
        tour.setNodes(scene.nodes, startId)
        setNodes(scene.nodes)
        if (ready) setLoading(false)
      } catch (error) {
        console.error(error)
        if (token === switchTokenRef.current) setLoading(false)
      }
    },
    [room],
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const html = document.documentElement
    const { body } = document
    const prevHtmlOverflow = html.style.overflow
    const prevBodyOverflow = body.style.overflow
    const prevHtmlOverscroll = html.style.overscrollBehavior
    const prevBodyOverscroll = body.style.overscrollBehavior

    if (!embedded) {
      html.style.overflow = 'hidden'
      body.style.overflow = 'hidden'
      html.style.overscrollBehavior = 'none'
      body.style.overscrollBehavior = 'none'
    }

    let cancelled = false
    const bootWidth = pickTourWidth()
    targetWidthRef.current = bootWidth
    catalogWidthRef.current = bootWidth

    const boot = async () => {
      const unitTypeSlug = getTourUnitTypeSlug()
      unitTypeSlugRef.current = unitTypeSlug

      const [nextCatalog, nextUnits, dbScene, publicCat] = await Promise.all([
        loadTourCatalog(unitTypeSlug),
        loadTourUnits(unitTypeSlug),
        loadTourNodes({
          unitTypeSlug,
          finishSlug: 'nogal',
          light: 'dia',
          preferredWidth: bootWidth,
        }),
        fetch('/api/tour/catalog', { cache: 'no-store' })
          .then((res) => (res.ok ? (res.json() as Promise<TourPublicCatalog>) : null))
          .catch(() => null),
      ])

      if (cancelled) return

      if (publicCat) {
        setPublicCatalog(publicCat)
        const firstWithMedia = publicCat.typologies.find(
          (item) => item.panorama || item.renders.length > 0 || item.rooms.some((room) => room.url || room.scenes.length > 0),
        )
        setSelectedTypology((prev) => prev || firstWithMedia?.code || publicCat.typologies[0]?.code || '')
      }

      const startFinish =
        publicCat?.finishes[0]?.slug ?? nextCatalog.finishes[0]?.slug ?? 'nogal'
      const scene =
        dbScene.nodes.length > 0
          ? dbScene
          : nodesFromPublicCatalog(publicCat, bootWidth, startFinish, 'dia')
      if (scene.nodes.length === 0) {
        setBooting(false)
        return
      }

      const isNarrow = window.innerWidth < 768
      const startNode = scene.nodes.find((n) => n.id === scene.startNodeId) ?? scene.nodes[0]
      const startUrl = variantUrl(startNode, bootWidth) ?? String(startNode.panorama)

      setCatalog(nextCatalog)
      setUnits(nextUnits)
      setNodes(scene.nodes)
      setFinish(startFinish)
      setLight('dia')
      setRoom(TOUR_HOME_SLUG)
      currentUrlRef.current = startUrl
      preloadedRef.current.add(startUrl)

      const viewer = new Viewer({
        container,
        loadingTxt: 'Cargando…',
        navbar: false,
        canvasBackground: '#111',
        defaultZoomLvl: 0,
        maxFov: isNarrow ? 85 : 90,
        minFov: 40,
        touchmoveTwoFingers: false,
        mousewheelCtrlKey: false,
        rendererParameters: {
          alpha: true,
          antialias: !isNarrow,
          powerPreference: 'high-performance',
          preserveDrawingBuffer: true,
        },
        defaultYaw: startNode.data?.initialYaw ?? 0,
        defaultPitch: startNode.data?.initialPitch ?? 0,
        defaultTransition: { speed: 0, rotation: false },
        plugins: [
          GyroscopePlugin.withConfig({
            touchmove: true,
            roll: false,
            absolutePosition: false,
            moveMode: 'smooth',
          }),
          MarkersPlugin.withConfig({}),
          VirtualTourPlugin.withConfig({
            dataMode: 'client',
            positionMode: 'manual',
            renderMode: '3d',
            nodes: scene.nodes,
            startNodeId: scene.startNodeId,
            preload: false,
            showLinkTooltip: true,
            linksOnCompass: false,
            arrowStyle: {
              element: createTourArrow,
              size: { width: 36, height: 36 },
              className: 'tour-nav-arrow-wrap',
            },
            transitionOptions: (toNode, fromNode) => {
              const saved = pendingRotateRef.current
              if (saved) {
                pendingRotateRef.current = null
                return {
                  showLoader: !preloadedRef.current.has(String(toNode.panorama)),
                  effect: 'fade',
                  rotation: false,
                  speed: 900,
                  rotateTo: saved,
                }
              }
              return {
                showLoader: false,
                effect: 'fade',
                rotation: Boolean(fromNode),
                speed: 900,
              }
            },
          }),
        ],
      })

      const tour = viewer.getPlugin<VirtualTourPlugin>(VirtualTourPlugin)
      viewerRef.current = viewer
      tourRef.current = tour
      setBooting(false)

      tour.addEventListener(tourEvents.NodeChangedEvent.type, ({ node }) => {
        setLoading(false)
        preloadedRef.current.add(String(node.panorama))
      })

      viewer.addEventListener(
        events.ReadyEvent.type,
        () => {
          preloadCurrentRoom(viewer, startNode.id, startUrl)
        },
        { once: true },
      )
    }

    void boot().catch((error) => {
      console.error(error)
      if (!cancelled) setBooting(false)
    })

    return () => {
      cancelled = true
      switchTokenRef.current += 1
      viewerRef.current?.destroy()
      viewerRef.current = null
      tourRef.current = null
      html.style.overflow = prevHtmlOverflow
      body.style.overflow = prevBodyOverflow
      html.style.overscrollBehavior = prevHtmlOverscroll
      body.style.overscrollBehavior = prevBodyOverscroll
    }
  }, [embedded, preloadCurrentRoom])

  useEffect(() => {
    let cancelled = false
    void fetch('/api/tour/catalog', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: TourPublicCatalog | null) => {
        if (cancelled || !data) return
        setPublicCatalog(data)
        const firstWithMedia = data.typologies.find(
          (item) => item.panorama || item.renders.length > 0,
        )
        setSelectedTypology((prev) => prev || firstWithMedia?.code || data.typologies[0]?.code || '')
        if (data.finishes?.length) {
          setFinish((prev) => (prev && data.finishes.some((item) => item.slug === prev) ? prev : data.finishes[0].slug))
        }
      })
      .catch((error) => console.error(error))
    return () => {
      cancelled = true
    }
  }, [])

  const currentTypology: TourTypologyOption | undefined = publicCatalog?.typologies.find(
    (item) => item.code === selectedTypology,
  )
  const onFinish = (slug: string) => {
    if (slug === finish) return
    setFinish(slug)
    logTourEvent({
      event_type: 'cambio_acabado',
      room,
      typology_code: selectedTypology,
      unit_type_id: currentTypology?.id,
      finish: slug,
      light,
    })
    if (!publicCatalog) void applyCombo(slug, light)
  }

  const onLight = () => {
    const next: TourLightMode = light === 'dia' ? 'noche' : 'dia'
    setLight(next)
    logTourEvent({
      event_type: 'cambio_luz',
      room,
      typology_code: selectedTypology,
      unit_type_id: currentTypology?.id,
      finish,
      light: next,
    })
    if (!publicCatalog) void applyCombo(finish, next)
  }

  const allUnits = useMemo<TourUnitSummary[]>(() => {
    const imported = (publicCatalog?.units ?? []).map((item) => {
      const internal = item.area_internal_m2
      const exterior = item.area_exterior_m2 ?? null
      const terraceCov = item.area_terrace_covered_m2 ?? null
      const terraceOpen = item.area_terrace_open_m2 ?? null
      const parts = [internal, exterior, terraceCov, terraceOpen].filter(
        (n): n is number => n != null && n > 0,
      )
      const total =
        parts.length > 1 ? parts.reduce((a, b) => a + b, 0) : (internal ?? null)
      return {
        id: item.id,
        unit_number: item.unit_code,
        floor: item.floor_label || (item.floor_number == null ? null : String(item.floor_number)),
        published_commercial_price: item.price,
        status: item.status,
        area_total_m2: total,
        area_internal_m2: internal,
        area_exterior_m2: exterior,
        area_terrace_covered_m2: terraceCov,
        area_terrace_open_m2: terraceOpen,
        bedrooms: item.bedrooms,
        bathrooms: item.bathrooms_full,
        bathrooms_full: item.bathrooms_full,
        bathrooms_half: item.bathrooms_half,
        spaces: item.spaces ?? [],
        slug: item.unit_code,
        typology_code: item.typology_code,
      }
    })
    return imported.length > 0 ? imported : units
  }, [publicCatalog, units])

  const displayUnits = useMemo<TourUnitSummary[]>(() => {
    if (!selectedTypology) return allUnits
    return allUnits.filter((item) => item.typology_code === selectedTypology)
  }, [allUnits, selectedTypology])

  const selectedUnit = useMemo(
    () => allUnits.find((item) => item.id === selectedUnitId) ?? null,
    [allUnits, selectedUnitId],
  )

  const deepLinkAppliedRef = useRef(false)
  useEffect(() => {
    if (deepLinkAppliedRef.current || allUnits.length === 0) return
    const code = readUnitQueryParam()
    if (!code) {
      deepLinkAppliedRef.current = true
      return
    }
    const match = findUnitByNumber(allUnits, code)
    if (!match) return
    deepLinkAppliedRef.current = true
    setSelectedUnitId(match.id)
    if (match.typology_code) setSelectedTypology(match.typology_code)
    const floor = unitFloorNumber(match)
    if (floor) setPlanFloor(floor)
    setShellMode('unit')
    setViewMode('galeria')
    setGaleriaIndex(0)
    setFichaExpanded(true)
    setFichaOpen(true)
    writeUnitQueryParam(match.unit_number)
  }, [allUnits])

  useEffect(() => {
    if (!selectedUnit) return
    writeUnitQueryParam(selectedUnit.unit_number)
  }, [selectedUnit])

  const compareUnitB = useMemo(
    () => allUnits.find((item) => item.id === compareUnitBId) ?? null,
    [allUnits, compareUnitBId],
  )

  const comparePreviewsB = useMemo(() => {
    if (!compareUnitB) return []
    const code = compareUnitB.typology_code || selectedTypology
    const typ =
      publicCatalog?.typologies?.find((item) => item.code === code) ??
      (code === selectedTypology ? currentTypology : null)
    const items: { id: string; label: string; url: string }[] = []
    const seen = new Set<string>()
    const add = (id: string, label: string, url: string | null | undefined) => {
      if (!url || seen.has(url)) return
      seen.add(url)
      items.push({ id, label, url })
    }
    for (const roomItem of typ?.rooms ?? []) {
      const scene = pickRoomScene(roomItem.scenes, finish || null, light)
      add(`room-${roomItem.slug}`, roomItem.label, pickSceneUrl(scene) ?? roomItem.url)
    }
    for (const item of typ?.vistas ?? []) {
      const scene = pickRoomScene(item.scenes, finish || null, light)
      add(item.slug, item.label, pickSceneUrl(scene) ?? item.url)
    }
    for (const extra of typ?.renders ?? []) {
      add(extra.id, stillLabelFromFile(extra.file_name), extra.url)
    }
    return items
  }, [compareUnitB, publicCatalog, currentTypology, selectedTypology, finish, light])

  const comparePanoBUrl = useMemo(() => {
    if (!compareUnitB) return null
    const code = compareUnitB.typology_code || selectedTypology
    const typ =
      publicCatalog?.typologies?.find((item) => item.code === code) ??
      (code === selectedTypology ? currentTypology : null)
    if (!typ) return null
    const fromPano = pickCatalogPanoUrl(typ.panorama, catalogWidthRef.current, finish || null, light)
    if (fromPano) return fromPano
    const home =
      typ.rooms.find((item) => item.slug === 'home' || item.slug.includes('living')) ?? typ.rooms[0]
    if (!home) return null
    const scene = pickRoomScene(home.scenes, finish || null, light)
    return pickSceneUrl(scene, catalogWidthRef.current) ?? home.url
  }, [compareUnitB, publicCatalog, currentTypology, selectedTypology, finish, light])

  const fichaUnits = useMemo(() => {
    if (selectedUnit) return [selectedUnit]
    return displayUnits
  }, [selectedUnit, displayUnits])

  const showPlanShell = embedded && shellMode === 'plan'
  const showUnitChrome = !embedded || shellMode === 'unit'

  const typologyOptions = useMemo(
    () =>
      (publicCatalog?.typologies ?? []).map((item) => ({
        value: item.code,
        label: `${item.code} · ${item.name}`,
      })),
    [publicCatalog],
  )

  const typologyMeta = useMemo(() => {
    const sample = displayUnits[0]
    if (!sample) return undefined
    const parts: string[] = []
    if (sample.area_total_m2 != null) parts.push(`${sample.area_total_m2} m²`)
    if (sample.bedrooms != null) parts.push(`${sample.bedrooms} hab.`)
    return parts.join(' · ') || undefined
  }, [displayUnits])

  const tourRooms = useMemo(() => {
    const fromCatalog = (currentTypology?.rooms ?? [])
      .filter((item) => Boolean(item.url) || (item.scenes?.length ?? 0) > 0)
      .map((item) => ({ slug: item.slug, label: item.label }))
    if (fromCatalog.length > 0) return fromCatalog
    const sample = displayUnits[0]
    return buildTourRooms({
      bedrooms: sample?.bedrooms,
      bathrooms_full: sample?.bathrooms_full ?? sample?.bathrooms,
      bathrooms_half: sample?.bathrooms_half,
      spaces: sample?.spaces,
    })
  }, [currentTypology?.rooms, displayUnits])
  const homeSlug = tourHomeSlug(tourRooms)

  const photoBySlug = useMemo(() => {
    const map: Record<string, string | null> = {}
    for (const item of tourRooms) {
      const roomItem =
        currentTypology?.rooms.find((entry) => entry.slug === item.slug) ??
        currentTypology?.rooms.find((entry) => roomsShareSlot(entry.slug, item.slug) && entry.url)
      const scene = pickRoomScene(roomItem?.scenes, finish || null, light)
      map[item.slug] = pickSceneUrl(scene, catalogWidthRef.current) ?? roomItem?.url ?? null
    }
    return map
  }, [tourRooms, currentTypology, finish, light])

  const urlForRoom = useCallback(
    (slug: string) => {
      if (photoBySlug[slug]) return photoBySlug[slug]
      const slotted = Object.keys(photoBySlug).find((key) => roomsShareSlot(key, slug) && photoBySlug[key])
      if (slotted) return photoBySlug[slotted]
      const family = Object.keys(photoBySlug).find((key) => roomsShareFamily(key, slug) && photoBySlug[key])
      return family ? photoBySlug[family] : null
    },
    [photoBySlug],
  )

  const typologyPanoUrl = pickCatalogPanoUrl(
    currentTypology?.panorama,
    catalogWidthRef.current,
    finish || null,
    light,
  )
  const activePanoUrl = urlForRoom(room) ?? (room === homeSlug ? typologyPanoUrl : null)
  const isPanoRoom = viewMode === 'tour'
  const isComparador = compareOpen
  const isFinishCompare = finishCompareOpen
  const terminacionesUiOpen = (terminacionesFocus || isFinishCompare) && !immersive
  const compareContentMode =
    viewMode === 'galeria' || viewMode === 'vistas' ? viewMode : 'tour'
  const syncCompareCameras =
    isFinishCompare || (isComparador && Boolean(compareUnitB) && compareContentMode === 'tour')

  useEffect(() => {
    if (!syncCompareCameras) return
    const viewer = viewerRef.current
    if (!viewer) return

    const publish = () => {
      if (comparePoseLockRef.current === 'side') return
      comparePoseLockRef.current = 'main'
      const pos = viewer.getPosition()
      const next: ComparePanoPose = {
        yaw: pos.yaw,
        pitch: pos.pitch,
        zoom: viewer.getZoomLevel(),
      }
      if (comparePoseRafRef.current) cancelAnimationFrame(comparePoseRafRef.current)
      comparePoseRafRef.current = requestAnimationFrame(() => {
        setComparePose(next)
        if (comparePoseLockRef.current === 'main') comparePoseLockRef.current = null
      })
    }

    viewer.addEventListener('position-updated', publish)
    viewer.addEventListener('zoom-updated', publish)
    publish()
    return () => {
      viewer.removeEventListener('position-updated', publish)
      viewer.removeEventListener('zoom-updated', publish)
      if (comparePoseRafRef.current) cancelAnimationFrame(comparePoseRafRef.current)
    }
  }, [syncCompareCameras, compareUnitB, viewMode, room, finish, finishRight])

  const onCompareSidePoseChange = useCallback((pose: ComparePanoPose) => {
    if (comparePoseLockRef.current === 'main') return
    comparePoseLockRef.current = 'side'
    setComparePose(pose)
    const viewer = viewerRef.current
    if (viewer) {
      try {
        viewer.rotate({ yaw: pose.yaw, pitch: pose.pitch })
        viewer.zoom(pose.zoom)
      } catch {
        /* ignore */
      }
    }
    requestAnimationFrame(() => {
      if (comparePoseLockRef.current === 'side') comparePoseLockRef.current = null
    })
  }, [])
  const vistaImages = useMemo(() => {
    const items: { id: string; label: string; url: string }[] = []
    const seen = new Set<string>()
    const add = (id: string, label: string, url: string | null | undefined) => {
      if (!url || seen.has(url)) return
      seen.add(url)
      items.push({ id, label, url })
    }
    for (const item of currentTypology?.vistas ?? []) {
      const scene = pickRoomScene(item.scenes, finish || null, light)
      add(item.slug, item.label, pickSceneUrl(scene) ?? item.url)
    }
    for (const extra of currentTypology?.renders ?? []) {
      add(extra.id, stillLabelFromFile(extra.file_name), extra.url)
    }
    return items
  }, [currentTypology, finish, light])

  const galeriaImages = useMemo(() => {
    const items: StillItem[] = []
    const seen = new Set<string>()
    for (const roomItem of currentTypology?.rooms ?? []) {
      const scene = pickRoomScene(roomItem.scenes, finish || null, light)
      const url = pickSceneUrl(scene) ?? roomItem.url
      if (!url || seen.has(url)) continue
      seen.add(url)
      items.push({ id: `room-${roomItem.slug}`, label: roomItem.label, url })
    }
    // Fallback: renders tipología si no hay ambientes
    if (items.length === 0) {
      for (const extra of currentTypology?.renders ?? []) {
        if (!extra.url || seen.has(extra.url)) continue
        seen.add(extra.url)
        items.push({
          id: extra.id,
          label: stillLabelFromFile(extra.file_name),
          url: extra.url,
        })
      }
    }
    return items
  }, [currentTypology, finish, light])

  const planoImages = useMemo<StillItem[]>(() => {
    const variant = viewMode === 'planos-3d' ? '3d' : '2d'
    const items: StillItem[] = []
    const seen = new Set<string>()
    for (const item of currentTypology?.planos ?? []) {
      if (!item.url || seen.has(item.url)) continue
      if (!matchesPlanoVariant(item.file_name, variant)) continue
      seen.add(item.url)
      items.push({
        id: item.id,
        label: stillLabelFromFile(item.file_name) || `Plano ${variant.toUpperCase()}`,
        url: item.url,
      })
    }
    return items
  }, [currentTypology, viewMode])

  const fichaImages = useMemo(() => {
    const items: { id: string; label: string; url: string; kind: 'vista' | 'plano' | 'ambiente' }[] = []
    const seen = new Set<string>()
    const add = (
      id: string,
      label: string,
      url: string | null | undefined,
      kind: 'vista' | 'plano' | 'ambiente',
    ) => {
      if (!url || seen.has(url)) return
      seen.add(url)
      items.push({ id, label, url, kind })
    }
    for (const item of currentTypology?.planos ?? []) {
      const label = stillLabelFromFile(item.file_name) || 'Plano'
      if (matchesPlanoVariant(item.file_name, '2d')) {
        add(item.id, label.includes('2') ? label : `${label} 2D`, item.url, 'plano')
      } else if (matchesPlanoVariant(item.file_name, '3d')) {
        add(item.id, label.includes('3') ? label : `${label} 3D`, item.url, 'plano')
      } else {
        add(item.id, label, item.url, 'plano')
      }
    }
    for (const item of currentTypology?.vistas ?? []) {
      const scene = pickRoomScene(item.scenes, finish || null, light)
      add(item.slug, item.label, pickSceneUrl(scene) ?? item.url, 'vista')
    }
    for (const extra of currentTypology?.renders ?? []) {
      add(extra.id, stillLabelFromFile(extra.file_name), extra.url, 'vista')
    }
    for (const roomItem of currentTypology?.rooms ?? []) {
      const scene = pickRoomScene(roomItem.scenes, finish || null, light)
      add(
        `room-${roomItem.slug}`,
        roomItem.label,
        pickSceneUrl(scene) ?? roomItem.url,
        'ambiente',
      )
    }
    return items
  }, [currentTypology, finish, light])

  const onSelectRoom = useCallback(
    (roomId: string) => {
      const raw = roomSlugFromNode(nodes.find((node) => node.id === roomId) ?? { id: roomId })
      const slug = resolveTourRoomSlug(raw, tourRooms, (item) => Boolean(urlForRoom(item)))
      const destUrl = urlForRoom(slug)
      if (slug === room || !destUrl) return
      const pin = (currentTypology?.hotspots ?? []).find(
        (item) =>
          item.from === room &&
          (item.slug === slug || item.slug === raw || roomsShareFamily(item.slug, slug)),
      )
      const viewer = viewerRef.current
      walkingRef.current = true
      if (pin) {
        walkToRef.current = { yaw: pin.yaw, pitch: pin.pitch }
        if (viewer) {
          lookPromiseRef.current = viewer.animate({
            yaw: pin.yaw,
            pitch: pin.pitch,
            zoom: 48,
            speed: 820,
            easing: 'inOutSine',
          })
        }
      }
      if (viewer && !preloadedRef.current.has(destUrl)) {
        void viewer.textureLoader
          .preloadPanorama(destUrl)
          .then(() => {
            preloadedRef.current.add(destUrl)
          })
          .catch(() => undefined)
      }
      logTourEvent({
        event_type: 'hotspot',
        room: slug,
        typology_code: selectedTypology,
        unit_type_id: currentTypology?.id,
      })
      setViewMode('tour')
      setRoom(slug)
    },
    [nodes, room, selectedTypology, currentTypology?.id, currentTypology?.hotspots, urlForRoom, tourRooms],
  )

  const stillItems = isPlanosMode(viewMode)
    ? planoImages
    : viewMode === 'galeria'
      ? fichaExpanded
        ? fichaImages.map((item) => ({ id: item.id, label: item.label, url: item.url }))
        : galeriaImages
      : viewMode === 'vistas'
        ? vistaImages
        : []
  const stillIndex = isPlanosMode(viewMode)
    ? planoIndex
    : viewMode === 'galeria'
      ? galeriaIndex
      : vistaIndex
  const setStillIndex = isPlanosMode(viewMode)
    ? setPlanoIndex
    : viewMode === 'galeria'
      ? setGaleriaIndex
      : setVistaIndex
  const stepStill = useCallback(
    (delta: -1 | 1) => {
      setStillIndex((index) => {
        const total = stillItems.length
        if (total < 2) return index
        return (index + delta + total) % total
      })
    },
    [setStillIndex, stillItems.length],
  )
  const stillSwipe = useSwipePages(viewMode !== 'tour', stillItems.length, stepStill)
  const stillUrl = stillItems[Math.min(stillIndex, Math.max(stillItems.length - 1, 0))]?.url ?? null
  if (stillUrl) lastStillRef.current = stillUrl
  const overlayUrl = stillUrl ?? lastStillRef.current
  const showStill = Boolean(stillUrl)
  useEffect(() => {
    if (tourRooms.some((item) => item.slug === room)) return
    const aliased = resolveTourRoomSlug(room, tourRooms, (slug) => Boolean(urlForRoom(slug)))
    setRoom(aliased !== room && tourRooms.some((item) => item.slug === aliased) ? aliased : homeSlug)
  }, [tourRooms, room, homeSlug, urlForRoom])

  useEffect(() => {
    if (vistaImages.length === 0) {
      if (vistaIndex !== 0) setVistaIndex(0)
      return
    }
    if (vistaIndex >= vistaImages.length) setVistaIndex(0)
  }, [vistaImages.length, vistaIndex])

  useEffect(() => {
    if (galeriaImages.length === 0) {
      if (galeriaIndex !== 0) setGaleriaIndex(0)
      return
    }
    if (galeriaIndex >= galeriaImages.length) setGaleriaIndex(0)
  }, [galeriaImages.length, galeriaIndex])

  useEffect(() => {
    if (planoImages.length === 0) {
      if (planoIndex !== 0) setPlanoIndex(0)
      return
    }
    if (planoIndex >= planoImages.length) setPlanoIndex(0)
  }, [planoImages.length, planoIndex])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || booting) return
    const markers = viewer.getPlugin<MarkersPlugin>(MarkersPlugin)
    if (!markers) return

    if (!walkingRef.current) {
      markers.setMarkers(buildTourMarkers(viewMode, room, tourRooms, currentTypology?.hotspots ?? [], homeSlug))
    }

    const onMarker = (event: markerEvents.SelectMarkerEvent) => {
      const data = event.marker.data
      if (data?.kind === 'look') {
        const yaw = typeof data.yaw === 'number' ? data.yaw : null
        const pitch = typeof data.pitch === 'number' ? data.pitch : null
        if (yaw !== null && pitch !== null) void lookAtSpot(viewer, yaw, pitch)
        return
      }
      const slug = data?.room
      if (typeof slug === 'string' && slug) onSelectRoom(slug)
    }
    markers.addEventListener(markerEvents.SelectMarkerEvent.type, onMarker)
    return () => {
      markers.removeEventListener(markerEvents.SelectMarkerEvent.type, onMarker)
    }
  }, [booting, isPanoRoom, viewMode, tourRooms, onSelectRoom, currentTypology?.hotspots, room, homeSlug])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || booting || !isPanoRoom) return
    const onClick = (event: events.ClickEvent) => {
      if (event.data.rightclick || event.data.marker) return
      if (viewMode !== 'tour') return
      if (walkingRef.current) return
      void lookAtSpot(viewer, event.data.yaw, event.data.pitch)
    }
    viewer.addEventListener(events.ClickEvent.type, onClick)
    return () => {
      viewer.removeEventListener(events.ClickEvent.type, onClick)
    }
  }, [booting, isPanoRoom, viewMode])

  useEffect(() => {
    const viewer = viewerRef.current
    const root = rootRef.current
    if (!viewer || !root || booting) return
    const gyro = viewer.getPlugin<GyroscopePlugin>(GyroscopePlugin)
    if (!gyro) return
    stabilizeTourGyro(gyro)

    if (viewMode !== 'tour' || !isPanoRoom) {
      if (gyro.isEnabled()) gyro.stop()
      return
    }

    let busy = false
    const start = () => {
      if (gyro.isEnabled() || busy) return
      busy = true
      const permission = requestGyroPermission()
      void permission
        .then((granted) => {
          if (!granted) {
            setGyroHint('Tocá Permitir en el aviso de movimiento, o abrí el tour en Safari')
            busy = false
            return
          }
          return gyro.start('smooth').then(() => setGyroHint(null))
        })
        .catch(() => {
          setGyroHint('Abrí el tour en Safari y permití el movimiento del celular')
          busy = false
        })
    }
    root.addEventListener('click', start)
    root.addEventListener('touchend', start, { passive: true })
    return () => {
      root.removeEventListener('click', start)
      root.removeEventListener('touchend', start)
    }
  }, [booting, viewMode, isPanoRoom])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || booting) return
    const t1 = window.setTimeout(() => viewer.autoSize(), 80)
    const t2 = window.setTimeout(() => viewer.autoSize(), 320)
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [booting, isComparador])

  useEffect(() => {
    const root = rootRef.current
    const viewer = viewerRef.current
    if (!root) return

    const resize = () => {
      window.setTimeout(() => viewer?.autoSize(), 80)
      window.setTimeout(() => viewer?.autoSize(), 360)
    }

    const fitViewport = () => {
      if (!immersive) {
        root.style.top = ''
        root.style.left = ''
        root.style.width = ''
        root.style.height = ''
        return
      }
      const vv = window.visualViewport
      if (vv) {
        root.style.top = `${vv.offsetTop}px`
        root.style.left = `${vv.offsetLeft}px`
        root.style.width = `${vv.width}px`
        root.style.height = `${vv.height}px`
      }
      resize()
    }

    const slot = slotRef.current
    if (immersive) {
      if (root.parentElement !== document.body) document.body.appendChild(root)
      document.documentElement.classList.add('tour-is-immersive')
      document.documentElement.style.overflow = 'hidden'
      document.body.style.overflow = 'hidden'
      fitViewport()
      void requestTourFullscreen(root).finally(fitViewport)
    } else {
      if (slot && root.parentElement !== slot) slot.appendChild(root)
      document.documentElement.classList.remove('tour-is-immersive')
      void leaveTourFullscreen().finally(resize)
      if (embedded) {
        document.documentElement.style.overflow = ''
        document.body.style.overflow = ''
      }
      fitViewport()
    }

    window.visualViewport?.addEventListener('resize', fitViewport)
    window.visualViewport?.addEventListener('scroll', fitViewport)

    return () => {
      window.visualViewport?.removeEventListener('resize', fitViewport)
      window.visualViewport?.removeEventListener('scroll', fitViewport)
      root.style.top = ''
      root.style.left = ''
      root.style.width = ''
      root.style.height = ''
      const slot = slotRef.current
      if (slot && root.parentElement !== slot) slot.appendChild(root)
      document.documentElement.classList.remove('tour-is-immersive')
      if (embedded) {
        document.documentElement.style.overflow = ''
        document.body.style.overflow = ''
      }
    }
  }, [immersive, embedded])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || booting || !isPanoRoom || !activePanoUrl) {
      walkingRef.current = false
      setPanoEntering(false)
      setPanoLeaving(false)
      return
    }
    const url = activePanoUrl
    if (currentUrlRef.current === url) {
      walkingRef.current = false
      setPanoLeaving(false)
      return
    }
    const token = ++switchTokenRef.current
    const look = walkToRef.current
    walkToRef.current = null
    const lookPromise = lookPromiseRef.current
    lookPromiseRef.current = null
    const changing = Boolean(currentUrlRef.current)

    const run = async () => {
      const markers = viewer.getPlugin<MarkersPlugin>(MarkersPlugin)
      setPanoEntering(false)
      setPanoGhost(null)
      let ghost: string | null = null

      if (changing) {
        if (lookPromise) {
          await Promise.race([Promise.resolve(lookPromise), sleep(950)]).catch(() => undefined)
        } else if (look) {
          await Promise.race([
            viewer.animate({
              yaw: look.yaw,
              pitch: look.pitch,
              zoom: 48,
              speed: 820,
              easing: 'inOutSine',
            }),
            sleep(950),
          ]).catch(() => undefined)
        }
        if (token !== switchTokenRef.current) return
        markers?.setMarkers([])
        ghost = capturePanoFrame(viewer)
        if (ghost) {
          setPanoGhost(ghost)
          setPanoGhostKey((key) => key + 1)
          await sleep(40)
        } else {
          setPanoLeaving(true)
          await sleep(500)
        }
      }

      if (changing && ghost) setPanoEntering(true)

      try {
        await Promise.race([
          viewer.setPanorama(url, {
            showLoader: false,
            transition: ghost
              ? { speed: 900, rotation: false, effect: 'fade' }
              : false,
            zoom: 0,
          }),
          sleep(1800),
        ])
      } catch {
        /* still land so the walk never freezes */
      }

      if (token !== switchTokenRef.current) {
        walkingRef.current = false
        setPanoLeaving(false)
        setPanoGhost(null)
        return
      }
      currentUrlRef.current = url
      appliedPanoKeyRef.current = `${selectedTypology}:${url}`
      preloadedRef.current.add(url)
      viewer.needsUpdate()
      walkingRef.current = false
      markers?.setMarkers(buildTourMarkers(viewMode, room, tourRooms, currentTypology?.hotspots ?? [], homeSlug))
      setPanoLeaving(false)
      if (changing) {
        if (!ghost) setPanoEntering(true)
        await sleep(ghost ? 240 : 720)
        if (token !== switchTokenRef.current) return
        setPanoEntering(false)
        setPanoGhost(null)
      }
    }

    void run()
  }, [booting, isPanoRoom, activePanoUrl, selectedTypology, viewMode, room, tourRooms, currentTypology?.hotspots, homeSlug])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || booting || !isPanoRoom) return
    const urls = (currentTypology?.hotspots ?? [])
      .filter((item) => item.from === room && item.kind !== 'look' && item.slug !== room)
      .map((item) => urlForRoom(item.slug))
      .filter((item): item is string => Boolean(item))
    preloadUrls(viewer, urls)
  }, [booting, isPanoRoom, room, urlForRoom, currentTypology?.hotspots, preloadUrls])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || booting || showStill || !isPanoRoom) return
    viewer.needsUpdate()
  }, [booting, showStill, isPanoRoom, viewMode])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || booting || publicCatalog || activePanoUrl) return
    if (finish) void applyCombo(finish, light)
  }, [booting, finish, light, applyCombo, activePanoUrl, publicCatalog])

  const onTypologyChange = (code: string) => {
    walkingRef.current = false
    walkToRef.current = null
    lookPromiseRef.current = null
    setSelectedTypology(code)
    setFichaOpen(false)
    setRoom(homeSlug)
    setVistaIndex(0)
    setGaleriaIndex(0)
    setPlanoIndex(0)
    setTerminacionesFocus(false)
    setCompareOpen(false)
    setCompareUnitBId(null)
    setComparePreviewIndex(0)
    setCompareSplit(50)
    currentUrlRef.current = ''
    appliedPanoKeyRef.current = ''
  }

  const sceneFinishes = publicCatalog?.finishes?.length
    ? publicCatalog.finishes
    : catalog?.finishes ?? []
  const finishName = sceneFinishes.find((f) => f.slug === finish)?.name ?? finish
  const finishLeftOption = sceneFinishes.find((f) => f.slug === finish) ?? null
  const finishRightOption =
    sceneFinishes.find((f) => f.slug === finishRight) ??
    sceneFinishes.find((f) => f.slug !== finish) ??
    sceneFinishes[0] ??
    null

  const finishRightPanoUrl = useMemo(() => {
    if (!isFinishCompare || !finishRightOption) return null
    const finishSlug = finishRightOption.slug
    const leftSlug = finish || null
    // Textura más liviana en el lado B → carga más rápida / menos WebGL
    const sideWidth = 2048 as const

    const resolveFromScenes = (
      scenes: NonNullable<typeof currentTypology>['rooms'][number]['scenes'] | undefined,
    ) => {
      if (!scenes?.length) return null
      const exact =
        scenes.find(
          (item) => finishesMatch(item.finish, finishSlug) && item.light === light,
        ) ??
        scenes.find(
          (item) => finishesMatch(item.finish, finishSlug) && item.light === 'dia',
        ) ??
        scenes.find((item) => item.finish === finishSlug)
      if (exact) {
        return pickSceneUrl(exact, sideWidth) ?? pickSceneUrl(exact, catalogWidthRef.current)
      }
      const matched = pickRoomScene(scenes, finishSlug, light)
      if (!matched) return null
      if (leftSlug && finishesMatch(matched.finish, leftSlug)) {
        const other =
          scenes.find(
            (item) =>
              item.finish &&
              !finishesMatch(item.finish, leftSlug) &&
              item.light === light,
          ) ??
          scenes.find((item) => item.finish && !finishesMatch(item.finish, leftSlug))
        if (other) {
          return pickSceneUrl(other, sideWidth) ?? pickSceneUrl(other, catalogWidthRef.current)
        }
      }
      return pickSceneUrl(matched, sideWidth) ?? pickSceneUrl(matched, catalogWidthRef.current)
    }

    const roomItem =
      currentTypology?.rooms.find((entry) => entry.slug === room) ??
      currentTypology?.rooms.find((entry) => roomsShareSlot(entry.slug, room) && entry.url) ??
      currentTypology?.rooms.find((entry) => roomsShareFamily(entry.slug, room) && entry.url)

    const fromRoom = resolveFromScenes(roomItem?.scenes)
    if (fromRoom) return fromRoom

    // Buscar en todos los rooms de la tipología (misma familia)
    for (const entry of currentTypology?.rooms ?? []) {
      if (!roomsShareFamily(entry.slug, room) && entry.slug !== room) continue
      const found = resolveFromScenes(entry.scenes)
      if (found) return found
    }

    const home = currentTypology?.rooms.find((entry) => entry.slug === homeSlug)
    const fromHome = resolveFromScenes(home?.scenes)
    if (fromHome) return fromHome

    const fromPano = pickCatalogPanoUrl(
      currentTypology?.panorama,
      sideWidth,
      finishSlug,
      light,
    )
    if (fromPano) return fromPano

    // Último recurso: cualquier escena de la tipología con ese acabado
    for (const entry of currentTypology?.rooms ?? []) {
      const found = resolveFromScenes(entry.scenes)
      if (found) return found
    }
    return null
  }, [isFinishCompare, finishRightOption, currentTypology, room, light, homeSlug, finish])

  useEffect(() => {
    if (!sceneFinishes.length) return
    setFinishRight((prev) => {
      if (prev && sceneFinishes.some((item) => item.slug === prev) && prev !== finish) return prev
      const other = sceneFinishes.find((item) => item.slug !== finish)
      return other?.slug ?? sceneFinishes[0]?.slug ?? ''
    })
  }, [sceneFinishes, finish])
  const currentNode = nodes.find((n) => n.id === room || roomSlugFromNode(n) === room)
  const roomName =
    tourRooms.find((item) => item.slug === room)?.label ?? currentNode?.name ?? tourRoomLabel(room)
  const lightLabel = light === 'dia' ? 'Día' : 'Noche'

  const trackingScene =
    viewMode === 'tour' ? null : stillItems[Math.min(stillIndex, Math.max(stillItems.length - 1, 0))] ?? null
  const tracking = useTourSceneTracking(
    {
      room: trackingScene?.id ?? room,
      roomLabel: trackingScene?.label ?? roomName,
      typologyCode: selectedTypology,
      unitTypeId: currentTypology?.id,
      finish,
      light,
    },
    { pauseGateClock: gateOpen },
  )

  useEffect(() => {
    if (tracking.identified) return
    if (tracking.shouldOfferGate) setGateOpen(true)
  }, [tracking.shouldOfferGate, tracking.identified])

  return (
    <div ref={slotRef} className={embedded ? 'relative h-full min-h-[320px] w-full' : 'h-full w-full'}>
    <div
      ref={rootRef}
      className={cn(
        'tour-root overflow-hidden bg-black overscroll-none',
        immersive && 'is-immersive',
        immersive || !embedded
          ? 'fixed inset-0 z-[200] h-[100dvh] w-full'
          : 'relative h-full w-full',
      )}
    >
      <div
        className="absolute inset-0 overflow-hidden"
        style={
          (isComparador && compareUnitB) || isFinishCompare
            ? {
                clipPath: `inset(0 ${Math.max(
                  12,
                  Math.min(88, 100 - (isFinishCompare ? finishCompareSplit : compareSplit)),
                )}% 0 0)`,
              }
            : undefined
        }
      >
        <div
          className={cn(
            'tour-pano-stage h-full w-full',
            panoLeaving && !showStill && !panoGhost && 'is-leaving',
            panoEntering && !showStill && 'is-entering',
          )}
        >
          <div
            ref={containerRef}
            className={cn('h-full w-full', showStill && 'pointer-events-none')}
          />
        </div>
        {panoGhost && !showStill ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={panoGhostKey}
            src={panoGhost}
            alt=""
            className="tour-walk-out pointer-events-none absolute inset-0 z-[8] h-full w-full object-cover"
          />
        ) : null}

        {isComparador ? (
          <p className="pointer-events-none absolute inset-x-0 bottom-16 z-[9] mx-auto hidden max-w-[90%] text-center text-[10px] font-medium tracking-[0.14em] text-white/80 uppercase sm:bottom-20 sm:block sm:text-[11px]">
            Hacé clic y arrastrá para mirar alrededor
          </p>
        ) : null}
      </div>

      {isComparador ? (
        <TourComparador
          unitA={selectedUnit}
          unitB={compareUnitB}
          units={allUnits}
          contentMode={compareContentMode}
          panoBUrl={comparePanoBUrl}
          previewsB={comparePreviewsB}
          previewIndexB={comparePreviewIndex}
          onPreviewIndexB={setComparePreviewIndex}
          split={compareSplit}
          onSplitChange={setCompareSplit}
          onSelectUnitB={(unit) => {
            setCompareUnitBId(unit.id)
            setComparePreviewIndex(0)
          }}
          onClearUnitB={() => {
            setCompareUnitBId(null)
            setComparePreviewIndex(0)
          }}
          onSwap={() => {
            if (!compareUnitB) return
            const prevA = selectedUnitId
            setSelectedUnitId(compareUnitB.id)
            if (compareUnitB.typology_code) setSelectedTypology(compareUnitB.typology_code)
            setCompareUnitBId(prevA)
            setComparePreviewIndex(0)
            setCompareSplit(50)
          }}
          onClose={() => {
            setCompareOpen(false)
            setCompareUnitBId(null)
            setComparePreviewIndex(0)
            setCompareSplit(50)
          }}
          syncPose={syncCompareCameras ? comparePose : null}
          onPoseChange={onCompareSidePoseChange}
        />
      ) : null}

      {isFinishCompare && finishLeftOption && finishRightOption ? (
        <TourFinishCompareOverlay
          left={{
            slug: finishLeftOption.slug,
            name: finishLeftOption.name,
            swatchUrl: null,
          }}
          right={{
            slug: finishRightOption.slug,
            name: finishRightOption.name,
            swatchUrl: null,
          }}
          rightPanoUrl={finishRightPanoUrl}
          split={finishCompareSplit}
          onSplitChange={setFinishCompareSplit}
          onClose={() => {
            setFinishCompareOpen(false)
            setTerminacionesFocus(false)
            setFinishCompareSplit(50)
            setViewMode('tour')
          }}
          syncPose={comparePose}
          onPoseChange={onCompareSidePoseChange}
        />
      ) : null}

      <div
        className={cn(
          'tour-layer-fade tour-still-layer absolute inset-0 z-10 overflow-hidden select-none',
          showStill ? 'is-on' : 'pointer-events-none is-off',
          viewMode !== 'tour' && stillItems.length > 1 && 'touch-pan-y',
        )}
        style={
          (isComparador && compareUnitB) || isFinishCompare
            ? {
                clipPath: `inset(0 ${Math.max(
                  12,
                  Math.min(88, 100 - (isFinishCompare ? finishCompareSplit : compareSplit)),
                )}% 0 0)`,
              }
            : undefined
        }
        onPointerDown={stillSwipe.onPointerDown}
      >
        <CrossfadeStill
          url={overlayUrl}
          alt={viewMode === 'tour' ? roomName : (stillItems[stillIndex]?.label ?? (isPlanosMode(viewMode) ? 'Plano' : 'Vista'))}
          contain={viewMode !== 'tour'}
          fit={isPlanosMode(viewMode) ? 'planos' : 'vistas'}
        />
      </div>

      {!booting && viewMode === 'tour' && !activePanoUrl && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black px-6 text-center">
          <p className="text-[13px] tracking-[0.16em] text-white/70 uppercase">Falta el 360</p>
          <p className="mt-2 text-sm text-white/45">
            {roomName}
          </p>
        </div>
      )}

      {!booting && viewMode === 'vistas' && vistaImages.length === 0 && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black px-6 text-center">
          <p className="text-[13px] tracking-[0.16em] text-white/70 uppercase">Vistas</p>
          <p className="mt-2 text-sm text-white/45">Aún no hay renders en esta tipología.</p>
        </div>
      )}

      {!booting && viewMode === 'galeria' && galeriaImages.length === 0 && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black px-6 text-center">
          <p className="text-[13px] tracking-[0.16em] text-white/70 uppercase">Galería</p>
          <p className="mt-2 text-sm text-white/45">Aún no hay ambientes en esta tipología.</p>
        </div>
      )}

      {!booting && isPlanosMode(viewMode) && planoImages.length === 0 && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black px-6 text-center">
          <p className="text-[13px] tracking-[0.16em] text-white/70 uppercase">
            {viewMode === 'planos-3d' ? 'Planos 3D' : 'Planos 2D'}
          </p>
          <p className="mt-2 text-sm text-white/45">Aún no hay planos en esta tipología.</p>
        </div>
      )}

      {booting && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#111] text-center">
          <p className="text-[11px] tracking-[0.28em] text-[#BDA27E] uppercase">Showroom</p>
          <p className="mt-2 text-[13px] tracking-[0.16em] text-white/55 uppercase">Cargando…</p>
        </div>
      )}

      {immersive ? (
        <p className="tour-exit-hint" role="status">
          Poné el celular en vertical para salir
        </p>
      ) : null}

      {gyroHint && !immersive ? (
        <p className="tour-exit-hint" role="status">
          {gyroHint}
        </p>
      ) : null}

      {gyroHint && immersive ? (
        <p className="tour-exit-hint tour-exit-hint-top" role="status">
          {gyroHint}
        </p>
      ) : null}

      <div
        className={cn(
          'tour-vignette pointer-events-none absolute inset-0 z-[12]',
          immersive && 'is-immersive',
        )}
      />

      {showPlanShell ? (
        <TourFloorPlan
          units={allUnits}
          floor={planFloor}
          onFloorChange={(next) => {
            setPlanFloor(next)
            setSelectedUnitId(null)
          }}
          selectedUnitId={selectedUnitId}
          onSelectUnit={(unit) => {
            setSelectedUnitId(unit.id)
            if (unit.typology_code) setSelectedTypology(unit.typology_code)
            setFichaExpanded(false)
            setFichaOpen(true)
            writeUnitQueryParam(unit.unit_number)
          }}
          onWhatsAppClick={() => {
            logTourEvent({
              event_type: 'whatsapp_interest',
              room: `piso-${planFloor}`,
              typology_code: selectedTypology,
              unit_type_id: currentTypology?.id,
            })
          }}
        />
      ) : null}

      <div
        className={cn(
          'tour-chrome pointer-events-none absolute inset-0 z-20',
          immersive && 'is-immersive',
          showPlanShell && 'invisible pointer-events-none',
        )}
      >
        <div className="pointer-events-auto absolute top-0 left-0 flex flex-col items-start gap-2 p-2 pt-[max(0.5rem,env(safe-area-inset-top))] pl-[max(0.5rem,env(safe-area-inset-left))] sm:gap-2.5 sm:p-3.5">
          {embedded && showUnitChrome ? (
            <button
              type="button"
              onClick={() => {
                setShellMode('plan')
                setFichaOpen(false)
                setTerminacionesFocus(false)
                setCompareOpen(false)
                setFinishCompareOpen(false)
              }}
              className="tour-glass inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-medium tracking-[0.16em] text-[#f7f3ee] uppercase sm:px-3 sm:py-2 sm:text-[11px]"
            >
              <Layers size={13} strokeWidth={1.75} />
              Volver a los pisos
            </button>
          ) : null}
          {showUnitChrome && !isComparador && !terminacionesUiOpen ? (
            <>
              <TourPicker
                typologies={typologyOptions}
                typology={selectedTypology}
                onTypologyChange={onTypologyChange}
                meta={typologyMeta}
              />
              {selectedTypology && embedded ? (
                <button
                  type="button"
                  onClick={() => {
                    setFichaExpanded(false)
                    setFichaOpen(true)
                  }}
                  className="tour-glass inline-flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-medium tracking-[0.16em] text-[#f7f3ee] uppercase sm:px-3 sm:py-2 sm:text-[11px]"
                >
                  <FileText size={13} strokeWidth={1.75} />
                  Ficha técnica
                  {selectedUnit ? ` · ${selectedUnit.unit_number}` : ''}
                </button>
              ) : null}
            </>
          ) : null}
        </div>
        {showUnitChrome && !isComparador && !terminacionesUiOpen ? (
        <div className="pointer-events-auto absolute top-0 right-0 z-[36] p-2 pt-[max(0.5rem,env(safe-area-inset-top))] pr-[max(0.5rem,env(safe-area-inset-right))] sm:p-3.5">
          <div className="flex w-[8.25rem] flex-col gap-1.5 sm:w-[9.25rem] sm:gap-2">
            <ModeButton
              active={viewMode === 'galeria'}
              icon={<Images size={14} strokeWidth={1.75} />}
              onClick={() => {
                setTerminacionesFocus(false)
                setFinishCompareOpen(false)
                setViewMode('galeria')
              }}
            >
              Galería
            </ModeButton>
            <ModeButton
              active={viewMode === 'vistas'}
              icon={<PanelsTopLeft size={14} strokeWidth={1.75} />}
              onClick={() => {
                setTerminacionesFocus(false)
                setFinishCompareOpen(false)
                setViewMode('vistas')
              }}
            >
              Vistas
            </ModeButton>
            <PlanosModePicker
              viewMode={viewMode}
              onSelect={(mode) => {
                setTerminacionesFocus(false)
                setFinishCompareOpen(false)
                setCompareOpen(false)
                setViewMode(mode)
              }}
            />
            <ModeButton
              active={viewMode === 'tour'}
              icon={<Rotate3d size={14} strokeWidth={1.75} />}
              onClick={() => {
                setViewMode('tour')
                setRoom(homeSlug)
                setTerminacionesFocus(false)
                setFinishCompareOpen(false)
              }}
            >
              Tour 360°
            </ModeButton>
            <ModeButton
              active={terminacionesFocus || isFinishCompare}
              icon={<SwatchBook size={14} strokeWidth={1.75} />}
              onClick={() => {
                setFichaOpen(false)
                setFichaExpanded(false)
                setCompareOpen(false)
                setViewMode('tour')
                setTerminacionesFocus(true)
              }}
            >
              Terminaciones
            </ModeButton>
            <ModeButton
              active={isComparador}
              icon={<Columns2 size={14} strokeWidth={1.75} />}
              onClick={() => {
                setTerminacionesFocus(false)
                setFinishCompareOpen(false)
                setCompareOpen(true)
                setComparePreviewIndex(0)
                setCompareSplit(50)
                if (isPlanosMode(viewMode)) setViewMode('tour')
              }}
            >
              Comparador
            </ModeButton>
          </div>
        </div>
        ) : null}

        {showUnitChrome ? (
          <TourTerminacionesPanel
            open={terminacionesUiOpen}
            onClose={() => {
              setTerminacionesFocus(false)
              setFinishCompareOpen(false)
            }}
            contained={embedded && !immersive}
            rooms={tourRooms}
            room={room}
            onRoomChange={(slug) => {
              setViewMode('tour')
              setRoom(slug)
            }}
            finishes={sceneFinishes}
            finish={finish}
            onFinishChange={(slug) => {
              setViewMode('tour')
              onFinish(slug)
            }}
            compare={isFinishCompare}
            onCompareChange={(value) => {
              if (value) {
                setCompareOpen(false)
                setCompareUnitBId(null)
                setViewMode('tour')
                setFinishCompareSplit(50)
                const other = sceneFinishes.find((item) => item.slug !== finish)
                if (other) setFinishRight(other.slug)
                else if (sceneFinishes[0]) setFinishRight(sceneFinishes[0].slug)
                setFinishCompareOpen(true)
                setTerminacionesFocus(true)
              } else {
                setFinishCompareOpen(false)
              }
            }}
            finishLeft={finish}
            finishRight={finishRight || finishRightOption?.slug || finish}
            onFinishLeftChange={(slug) => {
              setViewMode('tour')
              onFinish(slug)
              if (slug === finishRight) {
                const other = sceneFinishes.find((item) => item.slug !== slug)
                if (other) setFinishRight(other.slug)
              }
            }}
            onFinishRightChange={(slug) => {
              setFinishRight(slug)
              if (slug === finish) {
                const other = sceneFinishes.find((item) => item.slug !== slug)
                if (other) onFinish(other.slug)
              }
            }}
          />
        ) : null}

        {showUnitChrome && !isComparador && !terminacionesUiOpen ? (
        <div
          className={cn(
            CONSTANTS.CAPTURE_EVENTS_CLASS,
            'pointer-events-none absolute inset-x-0 bottom-0 flex w-full min-w-0 flex-col items-center gap-1.5 p-2 pb-[max(0.45rem,env(safe-area-inset-bottom))] sm:gap-2.5 sm:p-3.5',
          )}
        >
          {loading && <div className="tour-glass tour-caption self-center px-3 py-1.5">Cargando</div>}

          {viewMode !== 'tour' && stillItems.length > 0 && (
            <StillGalleryBar
              items={stillItems}
              index={stillIndex}
              onIndex={setStillIndex}
              showThumbs={!isPlanosMode(viewMode)}
            />
          )}

          {!isPlanosMode(viewMode) ? (
          <p className="tour-caption hidden self-center px-1 text-center sm:block">
            {viewMode === 'tour'
              ? `${selectedUnit ? `Unidad ${selectedUnit.unit_number} · ` : ''}${roomName}${finishName ? ` · ${finishName}` : ''} · ${lightLabel}`
              : `${stillItems[Math.min(stillIndex, Math.max(stillItems.length - 1, 0))]?.label ?? 'Vistas'}${viewMode === 'vistas' && finishName ? ` · ${finishName}` : ''}${viewMode === 'vistas' ? ` · ${lightLabel}` : ''}`}
          </p>
          ) : null}
        </div>
        ) : null}
      </div>

      {!immersive && showUnitChrome ? (
        <div className="absolute right-[max(0.75rem,env(safe-area-inset-right))] bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 flex flex-col items-end gap-2">
          <button
            type="button"
            onClick={() => {
              setSaveUnitOpen(true)
            }}
            className="tour-glass inline-flex h-11 items-center gap-2 rounded-full px-3.5 text-[11px] font-semibold tracking-[0.1em] text-[#f7f3ee] uppercase"
            aria-label="Guardar departamento"
            title="Guardar departamento"
          >
            <Bookmark size={15} strokeWidth={2} />
            <span className="hidden sm:inline">Guardar</span>
          </button>
          {SITE.whatsapp ? (
            <a
              href={tourWhatsAppHref(
                buildTourWhatsAppMessage({
                  typologyCode: selectedTypology,
                  roomLabel:
                    viewMode === 'tour'
                      ? roomName
                      : stillItems[Math.min(stillIndex, Math.max(stillItems.length - 1, 0))]
                          ?.label ?? roomName,
                  viewMode,
                }),
              )!}
              target="_blank"
              rel="noopener noreferrer"
              className="tour-whatsapp-btn tour-glass"
              aria-label="Consultar por WhatsApp"
              title="Consultar por WhatsApp"
              onClick={() => {
                logTourEvent({
                  event_type: 'whatsapp_interest',
                  room:
                    viewMode === 'tour'
                      ? room
                      : stillItems[Math.min(stillIndex, Math.max(stillItems.length - 1, 0))]?.id ??
                        room,
                  typology_code: selectedTypology,
                  unit_type_id: currentTypology?.id,
                })
              }}
            >
              <WhatsAppIcon size={16} />
            </a>
          ) : null}
          {selectedUnit ? (
            <TourFloorLocationPeek unit={selectedUnit} units={allUnits} />
          ) : null}
        </div>
      ) : null}

      {embedded || showUnitChrome ? (
        <TourSaveUnitModal
          open={saveUnitOpen && !immersive}
          contained={embedded && !immersive}
          onClose={() => setSaveUnitOpen(false)}
          onIdentified={() => tracking.markIdentified()}
          context={{
            typologyCode: selectedTypology,
            unitTypeId: currentTypology?.id,
            unitId: selectedUnit?.id ?? null,
            unitNumber: selectedUnit?.unit_number ?? null,
            roomLabel: roomName,
            finish,
            light,
          }}
        />
      ) : null}

      {embedded ? (
        <TourFichaDrawer
          open={fichaOpen && !immersive}
          onClose={() => {
            setFichaOpen(false)
            setFichaExpanded(false)
          }}
          contained
          expanded={fichaExpanded}
          typologyCode={selectedTypology}
          typologyName={currentTypology?.name}
          units={fichaUnits}
          images={fichaImages}
          initialUnitId={selectedUnitId}
          onVerFicha={(unit) => {
            setSelectedUnitId(unit.id)
            if (unit.typology_code) setSelectedTypology(unit.typology_code)
            const floor = unitFloorNumber(unit)
            if (floor) setPlanFloor(floor)
            setTerminacionesFocus(false)
            setCompareOpen(false)
            setFinishCompareOpen(false)
            setShellMode('unit')
            setViewMode('galeria')
            setGaleriaIndex(0)
            setFichaExpanded(true)
            setFichaOpen(true)
            writeUnitQueryParam(unit.unit_number)
          }}
          onTour360={(unit) => {
            setSelectedUnitId(unit.id)
            if (unit.typology_code) setSelectedTypology(unit.typology_code)
            setFichaExpanded(false)
            setShellMode('unit')
            setViewMode('tour')
            setRoom(homeSlug)
            writeUnitQueryParam(unit.unit_number)
          }}
          onSelectGalleryImage={(index) => {
            if (viewMode === 'galeria') setGaleriaIndex(index)
          }}
          onBack={() => {
            setFichaOpen(false)
            setFichaExpanded(false)
            setShellMode('plan')
            setViewMode('tour')
          }}
          onRequestInfo={(unit) => {
            setSelectedUnitId(unit.id)
            if (unit.typology_code) setSelectedTypology(unit.typology_code)
            setInfoRequestOpen(true)
          }}
        />
      ) : null}

      <TourInfoRequestModal
        open={infoRequestOpen && !immersive}
        contained={embedded && !immersive}
        onClose={() => setInfoRequestOpen(false)}
        onIdentified={() => tracking.markIdentified()}
        typologyCode={selectedTypology}
        typologyName={currentTypology?.name}
        unitNumber={selectedUnit?.unit_number}
        unitId={selectedUnit?.id}
        unitTypeId={currentTypology?.id}
        floorLabel={selectedUnit?.floor}
        finish={finish}
        light={light}
      />

      <TourLeadGate
        open={gateOpen}
        typology={tracking.interestTypology || selectedTypology || tracking.lastTypology}
        roomLabel={tracking.interestRoomLabel}
        unitTypeId={currentTypology?.id ?? tracking.lastUnitTypeId}
        finish={finish}
        light={light}
        onClose={() => {
          tracking.snoozeGate()
          setGateOpen(false)
        }}
        onIdentified={() => {
          tracking.markIdentified()
          setGateOpen(false)
        }}
      />
    </div>
    </div>
  )
}
