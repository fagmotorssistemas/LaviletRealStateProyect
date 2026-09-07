'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Cache, CONSTANTS, Viewer, events } from '@photo-sphere-viewer/core'
import { GyroscopePlugin } from '@photo-sphere-viewer/gyroscope-plugin'
import { MarkersPlugin, events as markerEvents } from '@photo-sphere-viewer/markers-plugin'
import { VirtualTourPlugin, events as tourEvents } from '@photo-sphere-viewer/virtual-tour-plugin'
import type { VirtualTourNode } from '@photo-sphere-viewer/virtual-tour-plugin'
import type { Position } from '@photo-sphere-viewer/core'
import { ChevronLeft, ChevronRight, Moon, Sun } from 'lucide-react'
import { createTourArrow, roomHotspotHtml } from '@/components/tour/createTourArrow'
import { TourPicker } from '@/components/tour/TourPicker'
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
import { stabilizeTourGyro } from '@/lib/tour/stabilizeGyro'
import { pickRoomScene, pickSceneUrl } from '@/lib/tour/roomScene'
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
  viewMode: 'tour' | 'vistas',
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
}: {
  url: string | null
  alt: string
  contain?: boolean
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
        <StillFrame key={`out-${previous}`} src={previous} alt="" contain={contain} motion="out" />
      ) : null}
      {current ? (
        <StillFrame key={`in-${current}`} src={current} alt={alt} contain={contain} motion="in" />
      ) : null}
    </div>
  )
}

function StillFrame({
  src,
  alt,
  contain,
  motion,
}: {
  src: string
  alt: string
  contain: boolean
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
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        draggable={false}
        className={cn(
          'absolute inset-0 h-full w-full',
          contain ? 'object-contain object-center' : 'object-cover',
        )}
      />
    </div>
  )
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms)
  })
}

function isPhoneDevice() {
  if (typeof window === 'undefined') return false
  const short = Math.min(window.innerWidth, window.innerHeight)
  const long = Math.max(window.innerWidth, window.innerHeight)
  if (short <= 520 && long <= 1100) return true
  const coarse =
    window.matchMedia('(pointer: coarse)').matches ||
    window.matchMedia('(hover: none)').matches ||
    'ontouchstart' in window
  return coarse && short <= 540 && long <= 1100
}

function isOsLandscape() {
  const type = window.screen?.orientation?.type
  if (typeof type === 'string') {
    if (type.startsWith('landscape')) return true
    if (type.startsWith('portrait')) return false
  }
  if (window.matchMedia('(orientation: landscape)').matches) return true
  return window.innerWidth > window.innerHeight
}

function useShowroomImmersive(enabled: boolean) {
  const [want, setWant] = useState(false)

  useEffect(() => {
    if (!enabled) {
      setWant(false)
      return
    }
    const sync = () => {
      setWant(isPhoneDevice() && isOsLandscape())
    }
    sync()
    const landscapeMq = window.matchMedia('(orientation: landscape)')
    landscapeMq.addEventListener('change', sync)
    window.addEventListener('resize', sync)
    window.addEventListener('orientationchange', sync)
    window.visualViewport?.addEventListener('resize', sync)
    window.screen?.orientation?.addEventListener('change', sync)
    return () => {
      landscapeMq.removeEventListener('change', sync)
      window.removeEventListener('resize', sync)
      window.removeEventListener('orientationchange', sync)
      window.visualViewport?.removeEventListener('resize', sync)
      window.screen?.orientation?.removeEventListener('change', sync)
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
  const [viewMode, setViewMode] = useState<'tour' | 'vistas'>('tour')
  const [vistaIndex, setVistaIndex] = useState(0)
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
      void loadRoomVariantUrls(roomId, 2048).then((urls) => {
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

  const displayUnits = useMemo<TourUnitSummary[]>(() => {
    const imported = (publicCatalog?.units ?? [])
      .filter((item) => {
        if (!selectedTypology) return true
        if (currentTypology?.id && item.unit_type_id) return item.unit_type_id === currentTypology.id
        return item.typology_code === selectedTypology
      })
      .map((item) => ({
        id: item.id,
        unit_number: item.unit_code,
        floor: item.floor_label || (item.floor_number == null ? null : String(item.floor_number)),
        published_commercial_price: item.price,
        status: item.status,
        area_total_m2: item.area_internal_m2,
        bedrooms: item.bedrooms,
        bathrooms: item.bathrooms_full,
        bathrooms_full: item.bathrooms_full,
        bathrooms_half: item.bathrooms_half,
        spaces: item.spaces ?? [],
        slug: item.unit_code,
        typology_code: item.typology_code,
      }))
    return imported.length > 0 ? imported : units
  }, [publicCatalog, selectedTypology, currentTypology?.id, units])

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
      add(extra.id, extra.file_name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '), extra.url)
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

  const stepVista = useCallback(
    (delta: -1 | 1) => {
      setVistaIndex((index) => {
        const total = vistaImages.length
        if (total < 2) return index
        return (index + delta + total) % total
      })
    },
    [vistaImages.length],
  )
  const vistaSwipe = useSwipePages(viewMode === 'vistas', vistaImages.length, stepVista)
  const vistaUrl = vistaImages[Math.min(vistaIndex, Math.max(vistaImages.length - 1, 0))]?.url ?? null
  const stillUrl = viewMode === 'vistas' ? vistaUrl : null
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

    const start = () => {
      if (gyro.isEnabled()) return
      void gyro.start('smooth').catch(() => undefined)
    }
    root.addEventListener('pointerdown', start, { passive: true })
    return () => {
      root.removeEventListener('pointerdown', start)
    }
  }, [booting, viewMode, isPanoRoom])

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

    if (immersive) {
      document.documentElement.classList.add('tour-is-immersive')
      document.documentElement.style.overflow = 'hidden'
      document.body.style.overflow = 'hidden'
      fitViewport()
      void requestTourFullscreen(root).finally(fitViewport)
    } else {
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
    setRoom(homeSlug)
    setVistaIndex(0)
    currentUrlRef.current = ''
    appliedPanoKeyRef.current = ''
  }

  const sceneFinishes = (publicCatalog?.finishes?.length ? publicCatalog.finishes : catalog?.finishes ?? []).map(
    (item, index) => ({ ...item, name: `Acabado ${index + 1}` }),
  )
  const finishName = sceneFinishes.find((f) => f.slug === finish)?.name ?? finish
  const currentNode = nodes.find((n) => n.id === room || roomSlugFromNode(n) === room)
  const roomName =
    tourRooms.find((item) => item.slug === room)?.label ?? currentNode?.name ?? tourRoomLabel(room)
  const lightLabel = light === 'dia' ? 'Día' : 'Noche'
  const showSceneControls = Boolean(publicCatalog) || sceneFinishes.length > 0

  const trackingScene =
    viewMode === 'vistas'
      ? vistaImages[Math.min(vistaIndex, Math.max(vistaImages.length - 1, 0))]
      : null
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
      <div className="absolute inset-0 overflow-hidden">
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
      </div>

      <div
        className={cn(
          'tour-layer-fade tour-still-layer absolute inset-0 z-10 overflow-hidden select-none',
          showStill ? 'is-on' : 'pointer-events-none is-off',
          viewMode === 'vistas' && vistaImages.length > 1 && 'touch-pan-y',
        )}
        onPointerDown={vistaSwipe.onPointerDown}
      >
        <CrossfadeStill
          url={overlayUrl}
          alt={viewMode === 'vistas' ? (vistaImages[vistaIndex]?.label ?? 'Vista') : roomName}
          contain={viewMode === 'vistas'}
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

      <div
        className={cn(
          'tour-vignette pointer-events-none absolute inset-0 z-[12]',
          immersive && 'is-immersive',
        )}
      />

      <div
        className={cn(
          'tour-chrome pointer-events-none absolute inset-0 z-20',
          immersive && 'is-immersive',
        )}
      >
        <div className="pointer-events-auto absolute top-0 left-0 p-2 pt-[max(0.5rem,env(safe-area-inset-top))] pl-[max(0.5rem,env(safe-area-inset-left))] sm:p-3.5">
          <TourPicker
            typologies={typologyOptions}
            typology={selectedTypology}
            onTypologyChange={onTypologyChange}
            meta={typologyMeta}
          />
        </div>
        <div className="pointer-events-auto absolute top-0 right-0 p-2 pt-[max(0.5rem,env(safe-area-inset-top))] pr-[max(0.5rem,env(safe-area-inset-right))] sm:p-3.5">
          <div className="flex w-[5.75rem] flex-col gap-1.5 sm:w-[7.5rem] sm:gap-2">
            <button
              type="button"
              onClick={() => {
                setViewMode('tour')
                setRoom(homeSlug)
              }}
              className={cn(
                'tour-glass border-white/25 !bg-[#14110e]/72 px-2 py-2 text-left text-[10px] font-semibold tracking-[0.12em] uppercase [text-shadow:0_1px_8px_rgba(0,0,0,0.65)] transition-colors duration-300 sm:px-3 sm:py-3 sm:text-[12px] sm:tracking-[0.14em]',
                viewMode === 'tour'
                  ? 'text-white shadow-[inset_2px_0_0_#BDA27E]'
                  : 'text-white/80 hover:text-white',
              )}
            >
              Tour 360
            </button>
            <button
              type="button"
              onClick={() => setViewMode('vistas')}
              className={cn(
                'tour-glass border-white/25 !bg-[#14110e]/72 px-2 py-2 text-left text-[10px] font-semibold tracking-[0.12em] uppercase [text-shadow:0_1px_8px_rgba(0,0,0,0.65)] transition-colors duration-300 sm:px-3 sm:py-3 sm:text-[12px] sm:tracking-[0.14em]',
                viewMode === 'vistas'
                  ? 'text-white shadow-[inset_2px_0_0_#BDA27E]'
                  : 'text-white/80 hover:text-white',
              )}
            >
              Vistas
            </button>
          </div>
        </div>

        <div
          className={cn(
            CONSTANTS.CAPTURE_EVENTS_CLASS,
            'pointer-events-none absolute right-0 bottom-0 left-0 flex flex-col items-end gap-2 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:gap-2.5 sm:p-3.5',
          )}
        >
          {loading && <div className="tour-glass tour-caption self-center px-3 py-1.5">Cargando</div>}

          {viewMode === 'vistas' && vistaImages.length > 0 && (
            <div className="pointer-events-auto mx-auto flex w-full max-w-xl flex-col gap-1.5 sm:gap-2">
              <div className="flex items-center justify-center gap-1.5 sm:gap-2">
                {vistaImages.length > 1 ? (
                  <button
                    type="button"
                    onClick={() =>
                      setVistaIndex((index) => (index - 1 + vistaImages.length) % vistaImages.length)
                    }
                    className="tour-glass tour-icon"
                    aria-label="Vista anterior"
                  >
                    <ChevronLeft size={16} strokeWidth={1.5} />
                  </button>
                ) : null}
                <p className="tour-caption min-w-0 truncate px-2 text-center">
                  {vistaImages[Math.min(vistaIndex, vistaImages.length - 1)]?.label}
                </p>
                {vistaImages.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => setVistaIndex((index) => (index + 1) % vistaImages.length)}
                    className="tour-glass tour-icon"
                    aria-label="Vista siguiente"
                  >
                    <ChevronRight size={16} strokeWidth={1.5} />
                  </button>
                ) : null}
              </div>
              <div className="tour-thumbs">
                {vistaImages.map((item, index) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setVistaIndex(index)}
                    className={cn(
                      'tour-thumb',
                      index === Math.min(vistaIndex, vistaImages.length - 1) && 'is-on',
                    )}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={item.url} alt={item.label} className="h-full w-full object-cover" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {showSceneControls && (
            <div className="tour-glass tour-finish pointer-events-auto mx-auto w-full max-w-md">
              {sceneFinishes.length > 0 ? (
                sceneFinishes.map((item) => (
                  <button
                    key={item.slug}
                    type="button"
                    onClick={() => onFinish(item.slug)}
                    className={finish === item.slug ? 'is-on' : undefined}
                  >
                    {item.name}
                  </button>
                ))
              ) : (
                <p className="tour-caption min-w-0 flex-1 px-2">{lightLabel}</p>
              )}
              <button
                type="button"
                onClick={onLight}
                className="tour-icon shrink-0"
                aria-label={light === 'dia' ? 'Cambiar a noche' : 'Cambiar a día'}
                title={lightLabel}
              >
                {light === 'dia' ? <Moon size={15} strokeWidth={1.5} /> : <Sun size={15} strokeWidth={1.5} />}
              </button>
            </div>
          )}
          <p className="tour-caption hidden self-center px-1 text-center sm:block">
            {viewMode === 'vistas'
              ? `${vistaImages[Math.min(vistaIndex, Math.max(vistaImages.length - 1, 0))]?.label ?? 'Vistas'}${finishName ? ` · ${finishName}` : ''} · ${lightLabel}`
              : `${roomName}${finishName ? ` · ${finishName}` : ''} · ${lightLabel}`}
          </p>
        </div>
      </div>

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
