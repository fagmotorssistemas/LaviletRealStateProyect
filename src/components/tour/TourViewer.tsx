'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Cache, CONSTANTS, Viewer, events } from '@photo-sphere-viewer/core'
import { MarkersPlugin, events as markerEvents } from '@photo-sphere-viewer/markers-plugin'
import { VirtualTourPlugin, events as tourEvents } from '@photo-sphere-viewer/virtual-tour-plugin'
import type { VirtualTourNode } from '@photo-sphere-viewer/virtual-tour-plugin'
import type { Position } from '@photo-sphere-viewer/core'
import { ChevronLeft, ChevronRight, Moon, Sun } from 'lucide-react'
import { createTourArrow, roomHotspotHtml } from '@/components/tour/createTourArrow'
import { TourHotspotLayer } from '@/components/tour/TourHotspotLayer'
import { TourPicker } from '@/components/tour/TourPicker'
import {
  buildTourRooms,
  roomSlugFromNode,
  TOUR_PANO_ROOM,
  TOUR_PANO_SLUG,
  tourRoomLabel,
} from '@/lib/tour/tourRooms'
import { pickCatalogPanoUrl, pickTourWidth, type TourWidth } from '@/lib/tour/pickTourWidth'
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
import type { TourLightMode, TourPublicCatalog, TourTypologyOption, TourUnitSummary } from '@/types/tour'
import { cn } from '@/lib/utils'
import '@photo-sphere-viewer/core/index.css'
import '@photo-sphere-viewer/virtual-tour-plugin/index.css'
import '@photo-sphere-viewer/markers-plugin/index.css'
import './tour-viewer.css'

Cache.enabled = true

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
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={`out-${previous}`}
          src={previous}
          alt=""
          className={cn(
            'tour-walk-out absolute inset-0 h-full w-full',
            contain ? 'object-contain object-center' : 'object-cover',
          )}
        />
      ) : null}
      {current ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={`in-${current}`}
          src={current}
          alt={alt}
          className={cn(
            'tour-walk-in absolute inset-0 h-full w-full',
            contain ? 'object-contain object-center' : 'object-cover',
          )}
        />
      ) : null}
    </div>
  )
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

function variantUrl(node: VirtualTourNode | undefined, width: TourWidth): string | undefined {
  const variants = node?.data?.variants as Record<string, { url?: string }> | undefined
  return variants?.[String(width)]?.url ?? (typeof node?.panorama === 'string' ? node.panorama : undefined)
}

export function TourViewer({ embedded = false }: { embedded?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<Viewer | null>(null)
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
  const [room, setRoom] = useState(TOUR_PANO_SLUG)
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
  const lastStillRef = useRef<string | null>(null)

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
    const bootWidth = pickTourWidth({ cap: 4096 })
    targetWidthRef.current = bootWidth
    catalogWidthRef.current = pickTourWidth()

    const boot = async () => {
      const unitTypeSlug = getTourUnitTypeSlug()
      unitTypeSlugRef.current = unitTypeSlug

      const [nextCatalog, nextUnits, scene] = await Promise.all([
        loadTourCatalog(unitTypeSlug),
        loadTourUnits(unitTypeSlug),
        loadTourNodes({
          unitTypeSlug,
          finishSlug: 'nogal',
          light: 'dia',
          preferredWidth: bootWidth,
        }),
      ])

      if (cancelled) return
      if (scene.nodes.length === 0) {
        setBooting(false)
        return
      }

      const isNarrow = window.innerWidth < 768
      const startFinish = nextCatalog.finishes[0]?.slug ?? 'nogal'
      const startNode = scene.nodes.find((n) => n.id === scene.startNodeId) ?? scene.nodes[0]
      const startUrl = variantUrl(startNode, bootWidth) ?? String(startNode.panorama)

      setCatalog(nextCatalog)
      setUnits(nextUnits)
      setNodes(scene.nodes)
      setFinish(startFinish)
      setLight('dia')
      setRoom(TOUR_PANO_SLUG)
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
    void fetch('/api/tour/catalog')
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

  const onSelectRoom = useCallback(
    (roomId: string) => {
      const slug = roomSlugFromNode(nodes.find((node) => node.id === roomId) ?? { id: roomId })
      if (slug === room) return
      logTourEvent({
        event_type: 'minimapa',
        room: slug,
        typology_code: selectedTypology,
        unit_type_id: currentTypology?.id,
      })
      setViewMode('tour')
      setRoom(slug)
    },
    [nodes, room, selectedTypology, currentTypology?.id],
  )

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
    const fromCatalog = (currentTypology?.rooms ?? []).map((item) => ({ slug: item.slug, label: item.label }))
    if (fromCatalog.length > 0) return fromCatalog
    const sample = displayUnits[0]
    return buildTourRooms({
      bedrooms: sample?.bedrooms,
      bathrooms_full: sample?.bathrooms_full ?? sample?.bathrooms,
      bathrooms_half: sample?.bathrooms_half,
      spaces: sample?.spaces,
    })
  }, [currentTypology?.rooms, displayUnits])

  const photoBySlug = useMemo(() => {
    const map: Record<string, string | null> = {}
    for (const item of tourRooms) {
      const roomItem = currentTypology?.rooms.find((entry) => entry.slug === item.slug)
      const scene = pickRoomScene(roomItem?.scenes, finish || null, light)
      map[item.slug] = pickSceneUrl(scene) ?? roomItem?.url ?? null
    }
    return map
  }, [tourRooms, currentTypology, finish, light])

  const typologyPanoUrl = pickCatalogPanoUrl(
    currentTypology?.panorama,
    catalogWidthRef.current,
    finish || null,
    light,
  )
  const isPanoRoom = room === TOUR_PANO_SLUG
  const flatPhotoUrl = isPanoRoom ? null : photoBySlug[room] ?? null
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
    const vistaLabels = new Set(items.map((item) => item.label))
    for (const item of currentTypology?.rooms ?? []) {
      if (vistaLabels.has(item.label)) continue
      const scene = pickRoomScene(item.scenes, finish || null, light)
      add(item.slug, item.label, pickSceneUrl(scene) ?? item.url)
    }
    for (const extra of currentTypology?.renders ?? []) {
      add(extra.id, extra.file_name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '), extra.url)
    }
    return items
  }, [currentTypology, finish, light])
  const vistaUrl = vistaImages[Math.min(vistaIndex, Math.max(vistaImages.length - 1, 0))]?.url ?? null
  const stillUrl = viewMode === 'vistas' ? vistaUrl : flatPhotoUrl
  if (stillUrl) lastStillRef.current = stillUrl
  const overlayUrl = stillUrl ?? lastStillRef.current
  const showStill = Boolean(stillUrl)
  const navTargets = useMemo(
    () => [TOUR_PANO_ROOM, ...tourRooms].filter((item) => item.slug !== room),
    [tourRooms, room],
  )

  useEffect(() => {
    if (room === TOUR_PANO_SLUG) return
    if (tourRooms.some((item) => item.slug === room)) return
    setRoom(TOUR_PANO_SLUG)
  }, [tourRooms, room])

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

    const count = Math.max(navTargets.length, 1)
    markers.setMarkers(
      isPanoRoom && viewMode === 'tour'
        ? navTargets.map((item, index) => ({
            id: `ambiente-${item.slug}`,
            position: { yaw: (index / count) * Math.PI * 2, pitch: -0.36 },
            html: roomHotspotHtml(item.label),
            anchor: 'center center',
            size: { width: 92, height: 78 },
            tooltip: item.label,
            data: { room: item.slug },
          }))
        : [],
    )

    const onMarker = (event: markerEvents.SelectMarkerEvent) => {
      const slug = event.marker.data?.room
      if (typeof slug === 'string' && slug) onSelectRoom(slug)
    }
    markers.addEventListener(markerEvents.SelectMarkerEvent.type, onMarker)
    return () => {
      markers.removeEventListener(markerEvents.SelectMarkerEvent.type, onMarker)
    }
  }, [booting, isPanoRoom, viewMode, navTargets, onSelectRoom])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || booting || !isPanoRoom || !typologyPanoUrl) {
      setPanoEntering(false)
      return
    }
    const url = typologyPanoUrl
    const token = ++switchTokenRef.current
    if (currentUrlRef.current && currentUrlRef.current !== url) {
      const ghost = capturePanoFrame(viewer)
      if (ghost) {
        setPanoGhost(ghost)
        setPanoGhostKey((key) => key + 1)
      }
      setPanoEntering(false)
    }
    void viewer
      .setPanorama(url, { showLoader: false, transition: false })
      .catch(() => undefined)
      .finally(() => {
        if (token !== switchTokenRef.current) return
        currentUrlRef.current = url
        appliedPanoKeyRef.current = `${selectedTypology}:${url}`
        viewer.needsUpdate()
        requestAnimationFrame(() => setPanoEntering(true))
        window.setTimeout(() => {
          if (token !== switchTokenRef.current) return
          setPanoGhost(null)
          setPanoEntering(false)
        }, 1100)
      })
  }, [booting, isPanoRoom, typologyPanoUrl, selectedTypology])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || booting || showStill || !isPanoRoom) return
    viewer.needsUpdate()
  }, [booting, showStill, isPanoRoom, viewMode])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || booting || publicCatalog || typologyPanoUrl) return
    if (finish) void applyCombo(finish, light)
  }, [booting, finish, light, applyCombo, typologyPanoUrl, publicCatalog])

  const onTypologyChange = (code: string) => {
    setSelectedTypology(code)
    setRoom(TOUR_PANO_SLUG)
    setVistaIndex(0)
    currentUrlRef.current = ''
    appliedPanoKeyRef.current = ''
  }

  const sceneFinishes = (publicCatalog?.finishes?.length ? publicCatalog.finishes : catalog?.finishes ?? []).map(
    (item, index) => ({ ...item, name: `Acabado ${index + 1}` }),
  )
  const finishName = sceneFinishes.find((f) => f.slug === finish)?.name ?? finish
  const currentNode = nodes.find((n) => n.id === room || roomSlugFromNode(n) === room)
  const roomName = isPanoRoom
    ? '360'
    : tourRooms.find((item) => item.slug === room)?.label ?? currentNode?.name ?? tourRoomLabel(room)
  const lightLabel = light === 'dia' ? 'Día' : 'Noche'
  const showSceneControls = Boolean(publicCatalog) || sceneFinishes.length > 0

  const tracking = useTourSceneTracking(
    {
      room,
      roomLabel: roomName,
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
    <div
      className={cn(
        'overflow-hidden bg-black overscroll-none',
        embedded ? 'relative h-full w-full' : 'fixed inset-0 z-50 h-[100dvh] w-full',
      )}
    >
      <div className="absolute inset-0 overflow-hidden">
        <div className={cn('h-full w-full', panoEntering && !showStill && 'tour-walk-in')}>
          <div
            ref={containerRef}
            className={cn('h-full w-full', showStill && 'pointer-events-none')}
          />
        </div>
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

      <div
        className={cn(
          'tour-layer-fade tour-still-layer absolute inset-0 z-10 overflow-hidden',
          showStill ? 'is-on' : 'pointer-events-none is-off',
        )}
      >
        <CrossfadeStill
          url={overlayUrl}
          alt={viewMode === 'vistas' ? (vistaImages[vistaIndex]?.label ?? 'Vista') : roomName}
          contain={viewMode === 'vistas'}
        />
      </div>

      {!booting && viewMode === 'tour' && isPanoRoom && !typologyPanoUrl && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black px-6 text-center">
          <p className="text-[13px] tracking-[0.16em] text-white/70 uppercase">Falta el 360</p>
          <p className="mt-2 text-sm text-white/45">Subilo en Imágenes tipología → 360</p>
        </div>
      )}

      {!booting && viewMode === 'tour' && !isPanoRoom && !flatPhotoUrl && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black px-6 text-center">
          <p className="text-[13px] tracking-[0.16em] text-white/70 uppercase">Falta la foto</p>
          <p className="mt-2 text-sm text-white/45">{roomName}</p>
        </div>
      )}

      {!booting && viewMode === 'vistas' && vistaImages.length === 0 && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black px-6 text-center">
          <p className="text-[13px] tracking-[0.16em] text-white/70 uppercase">Vistas</p>
          <p className="mt-2 text-sm text-white/45">Aún no hay renders en esta tipología.</p>
        </div>
      )}

      {!booting && viewMode === 'tour' && !isPanoRoom && (
        <TourHotspotLayer targets={navTargets} onSelect={onSelectRoom} />
      )}

      {booting && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#111] text-center">
          <p className="text-[11px] tracking-[0.28em] text-[#BDA27E] uppercase">Showroom</p>
          <p className="mt-2 text-[13px] tracking-[0.16em] text-white/55 uppercase">Cargando…</p>
        </div>
      )}

      <div className="tour-vignette pointer-events-none absolute inset-0 z-[12]" />

      <div className="tour-chrome pointer-events-none absolute inset-0 z-20">
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
                setRoom(TOUR_PANO_SLUG)
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
        typology={selectedTypology || tracking.lastTypology}
        unitTypeId={currentTypology?.id ?? tracking.lastUnitTypeId}
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
  )
}
