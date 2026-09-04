'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Cache, CONSTANTS, Viewer, events } from '@photo-sphere-viewer/core'
import { CompassPlugin } from '@photo-sphere-viewer/compass-plugin'
import { MarkersPlugin, events as markerEvents } from '@photo-sphere-viewer/markers-plugin'
import { VirtualTourPlugin, events as tourEvents } from '@photo-sphere-viewer/virtual-tour-plugin'
import type { VirtualTourNode } from '@photo-sphere-viewer/virtual-tour-plugin'
import type { Position } from '@photo-sphere-viewer/core'
import { Maximize2, Minimize2, Moon, Sun } from 'lucide-react'
import { createTourArrow, roomHotspotHtml } from '@/components/tour/createTourArrow'
import { TourHotspotLayer } from '@/components/tour/TourHotspotLayer'
import { TourPicker } from '@/components/tour/TourPicker'
import { TourUnitPanel } from '@/components/tour/TourUnitPanel'
import {
  buildTourRooms,
  roomSlugFromNode,
  TOUR_PANO_ROOM,
  TOUR_PANO_SLUG,
  tourRoomLabel,
} from '@/lib/tour/tourRooms'
import { pickTourWidth, type TourWidth } from '@/lib/tour/pickTourWidth'
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
import '@photo-sphere-viewer/compass-plugin/index.css'
import './tour-viewer.css'

Cache.enabled = true

const FADE = { speed: 700, rotation: false, effect: 'fade' as const }
const UPGRADE = { speed: 400, rotation: false, effect: 'fade' as const }

function variantUrl(node: VirtualTourNode | undefined, width: TourWidth): string | undefined {
  const variants = node?.data?.variants as Record<string, { url?: string }> | undefined
  return variants?.[String(width)]?.url ?? (typeof node?.panorama === 'string' ? node.panorama : undefined)
}

export function TourViewer({ embedded = false }: { embedded?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<Viewer | null>(null)
  const tourRef = useRef<VirtualTourPlugin | null>(null)
  const targetWidthRef = useRef<TourWidth>(2048)
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
  const [fullscreen, setFullscreen] = useState(false)
  const [selectedFloor, setSelectedFloor] = useState('')
  const [selectedUnitId, setSelectedUnitId] = useState('')
  const [publicCatalog, setPublicCatalog] = useState<TourPublicCatalog | null>(null)
  const [selectedTypology, setSelectedTypology] = useState('')
  const [gateOpen, setGateOpen] = useState(false)

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

  const upgradeToHigh = useCallback(async (token: number) => {
    const viewer = viewerRef.current
    const tour = tourRef.current
    if (!viewer || !tour || targetWidthRef.current !== 4096) return

    const node = tour.getCurrentNode()
    const highUrl = variantUrl(node, 4096)
    if (!highUrl || currentUrlRef.current === highUrl) return

    if (!preloadedRef.current.has(highUrl)) {
      try {
        await viewer.textureLoader.preloadPanorama(highUrl)
        preloadedRef.current.add(highUrl)
      } catch {
        return
      }
    }

    if (token !== switchTokenRef.current) return
    const applied = await viewer.setPanorama(highUrl, {
      caption: node?.caption,
      showLoader: false,
      transition: UPGRADE,
    })
    if (token !== switchTokenRef.current) return
    if (applied) currentUrlRef.current = highUrl
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
          preferredWidth: 2048,
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
    targetWidthRef.current = pickTourWidth()

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
          preferredWidth: 2048,
        }),
      ])

      if (cancelled) return
      if (scene.nodes.length === 0) {
        setBooting(false)
        return
      }

      const startFinish = nextCatalog.finishes[0]?.slug ?? 'nogal'
      const startNode = scene.nodes.find((n) => n.id === scene.startNodeId) ?? scene.nodes[0]
      const startUrl = variantUrl(startNode, 2048) ?? String(startNode.panorama)

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
        maxFov: 95,
        touchmoveTwoFingers: false,
        mousewheelCtrlKey: false,
        defaultYaw: startNode.data?.initialYaw ?? 0,
        defaultPitch: startNode.data?.initialPitch ?? 0,
        defaultTransition: FADE,
        plugins: [
          MarkersPlugin.withConfig({}),
          CompassPlugin.withConfig({
            size: '48px',
            position: 'top right',
            navigation: true,
            className: 'tour-compass',
          }),
          VirtualTourPlugin.withConfig({
            dataMode: 'client',
            positionMode: 'manual',
            renderMode: '3d',
            nodes: scene.nodes,
            startNodeId: scene.startNodeId,
            preload: false,
            showLinkTooltip: true,
            linksOnCompass: true,
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
                  speed: 700,
                  rotateTo: saved,
                }
              }
              return {
                showLoader: Boolean(fromNode),
                effect: 'fade',
                rotation: Boolean(fromNode),
                speed: 700,
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
          void upgradeToHigh(switchTokenRef.current)
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
  }, [embedded, preloadCurrentRoom, upgradeToHigh])

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
    void applyCombo(slug, light)
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
    void applyCombo(finish, next)
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

  const floorOptions = useMemo(() => {
    const seen = new Map<string, string>()
    for (const item of displayUnits) {
      const key = item.floor?.trim()
      if (!key || seen.has(key)) continue
      seen.set(key, /^\d+$/.test(key) ? `Piso ${key}` : key)
    }
    return [...seen.entries()]
      .sort((a, b) => Number(a[0]) - Number(b[0]) || a[0].localeCompare(b[0], 'es'))
      .map(([value, label]) => ({ value, label }))
  }, [displayUnits])

  const unitsOnFloor = useMemo(
    () => displayUnits.filter((item) => (item.floor ?? '') === selectedFloor),
    [displayUnits, selectedFloor],
  )

  const unitOptions = useMemo(
    () => unitsOnFloor.map((item) => ({ value: item.id, label: item.unit_number })),
    [unitsOnFloor],
  )

  const selectedUnit = displayUnits.find((item) => item.id === selectedUnitId) ?? unitsOnFloor[0] ?? null

  const tourRooms = useMemo(() => {
    const fromUnit = buildTourRooms({
      bedrooms: selectedUnit?.bedrooms,
      bathrooms_full: selectedUnit?.bathrooms_full ?? selectedUnit?.bathrooms,
      bathrooms_half: selectedUnit?.bathrooms_half,
      spaces: selectedUnit?.spaces,
    })
    if (fromUnit.length > 0) return fromUnit
    return (currentTypology?.rooms ?? []).map((item) => ({ slug: item.slug, label: item.label }))
  }, [selectedUnit, currentTypology?.rooms])

  const photoBySlug = useMemo(() => {
    const map: Record<string, string | null> = {}
    for (const item of tourRooms) {
      map[item.slug] = currentTypology?.rooms.find((roomItem) => roomItem.slug === item.slug)?.url ?? null
    }
    return map
  }, [tourRooms, currentTypology])

  const typologyPanoUrl = currentTypology?.panorama?.url ?? null
  const isPanoRoom = room === TOUR_PANO_SLUG
  const flatPhotoUrl = isPanoRoom ? null : photoBySlug[room] ?? null
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
    const viewer = viewerRef.current
    if (!viewer || booting) return
    const markers = viewer.getPlugin<MarkersPlugin>(MarkersPlugin)
    if (!markers) return

    const count = Math.max(navTargets.length, 1)
    markers.setMarkers(
      isPanoRoom
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
  }, [booting, isPanoRoom, navTargets, onSelectRoom])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || booting || !isPanoRoom) return

    const key = `${selectedTypology}:${typologyPanoUrl ?? ''}`
    if (!typologyPanoUrl) {
      appliedPanoKeyRef.current = key
      currentUrlRef.current = ''
      return
    }
    if (appliedPanoKeyRef.current === key) return

    const token = ++switchTokenRef.current
    appliedPanoKeyRef.current = key
    setLoading(true)
    void viewer
      .setPanorama(typologyPanoUrl, { showLoader: false, transition: FADE })
      .then((applied) => {
        if (token !== switchTokenRef.current) return
        if (applied) currentUrlRef.current = typologyPanoUrl
        else appliedPanoKeyRef.current = ''
        setLoading(false)
      })
      .catch(() => {
        if (token === switchTokenRef.current) {
          appliedPanoKeyRef.current = ''
          setLoading(false)
        }
      })
  }, [booting, isPanoRoom, typologyPanoUrl, selectedTypology])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || booting || publicCatalog || typologyPanoUrl) return
    if (finish) void applyCombo(finish, light)
  }, [booting, finish, light, applyCombo, typologyPanoUrl, publicCatalog])

  useEffect(() => {
    if (displayUnits.length === 0) return
    const current = displayUnits.find((item) => item.id === selectedUnitId)
    if (current) return
    const featured = displayUnits.find((item) => item.status === 'disponible') ?? displayUnits[0]
    setSelectedFloor(featured.floor ?? '')
    setSelectedUnitId(featured.id)
  }, [displayUnits, selectedUnitId])

  const onTypologyChange = (code: string) => {
    setSelectedTypology(code)
    setSelectedFloor('')
    setSelectedUnitId('')
    setRoom(TOUR_PANO_SLUG)
    currentUrlRef.current = ''
    appliedPanoKeyRef.current = ''
  }

  const onFloorChange = (nextFloor: string) => {
    setSelectedFloor(nextFloor)
    const nextUnits = displayUnits.filter((item) => (item.floor ?? '') === nextFloor)
    const keep = nextUnits.find((item) => item.id === selectedUnitId)
    setSelectedUnitId((keep ?? nextUnits[0])?.id ?? '')
  }

  const finishName = catalog?.finishes.find((f) => f.slug === finish)?.name ?? finish
  const currentNode = nodes.find((n) => n.id === room || roomSlugFromNode(n) === room)
  const roomName = isPanoRoom
    ? '360'
    : tourRooms.find((item) => item.slug === room)?.label ?? currentNode?.name ?? tourRoomLabel(room)
  const lightLabel = light === 'dia' ? 'Día' : 'Noche'
  const showFinish = currentNode?.data?.finishSlug != null

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
      <div
        ref={containerRef}
        className={cn('h-full w-full', (!isPanoRoom || !typologyPanoUrl) && !booting && 'invisible')}
      />

      {flatPhotoUrl && (
        <div className="absolute inset-0 z-10 bg-black">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={flatPhotoUrl} alt={roomName} className="h-full w-full object-cover" />
        </div>
      )}

      {!booting && isPanoRoom && !typologyPanoUrl && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black px-6 text-center">
          <p className="text-[13px] tracking-[0.16em] text-white/70 uppercase">Falta el 360</p>
          <p className="mt-2 text-sm text-white/45">Subilo en Imágenes tipología → 360</p>
        </div>
      )}

      {!booting && !isPanoRoom && !flatPhotoUrl && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black px-6 text-center">
          <p className="text-[13px] tracking-[0.16em] text-white/70 uppercase">Falta la foto</p>
          <p className="mt-2 text-sm text-white/45">{roomName}</p>
        </div>
      )}

      {!booting && !isPanoRoom && (
        <TourHotspotLayer targets={navTargets} onSelect={onSelectRoom} />
      )}

      {booting && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black text-[13px] tracking-[0.16em] text-white/70 uppercase">
          Cargando tour…
        </div>
      )}

      <div className="tour-chrome pointer-events-none absolute inset-0 z-20">
        <div
          className="pointer-events-auto absolute top-0 left-0 p-3 pt-[max(0.75rem,env(safe-area-inset-top))] pl-[max(0.75rem,env(safe-area-inset-left))]"
        >
          <div className="flex flex-col gap-2">
            {(catalog || selectedUnit) && (
              <TourUnitPanel
                unitTypeName={currentTypology?.name ?? catalog?.unitTypeName ?? selectedTypology}
                unit={selectedUnit}
                unitCount={displayUnits.length}
              />
            )}
            {(typologyOptions.length > 0 || floorOptions.length > 0) && (
              <TourPicker
                typologies={typologyOptions}
                typology={selectedTypology}
                floors={floorOptions}
                units={unitOptions}
                floor={selectedFloor}
                unitId={selectedUnit?.id ?? ''}
                onTypologyChange={onTypologyChange}
                onFloorChange={onFloorChange}
                onUnitChange={setSelectedUnitId}
              />
            )}
          </div>
        </div>

        <div
          className={cn(
            CONSTANTS.CAPTURE_EVENTS_CLASS,
            'pointer-events-none absolute right-0 bottom-0 left-0 flex flex-col items-end gap-2.5 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]',
          )}
        >
          <div className="pointer-events-auto flex items-end justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                viewerRef.current?.toggleFullscreen()
                setFullscreen((v) => {
                  const next = !v
                  logTourEvent({
                    event_type: 'fullscreen',
                    room,
                    typology_code: selectedTypology,
                    unit_type_id: currentTypology?.id,
                    metadata: { on: next },
                  })
                  return next
                })
              }}
              className="mb-1 inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-[4px] bg-black/55 text-white ring-1 ring-white/15 backdrop-blur-sm"
              aria-label={fullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
            >
              {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          </div>

          {loading && (
            <div className="self-center rounded-[4px] bg-black/65 px-3 py-1.5 text-[12px] font-medium tracking-wide text-white/90">
              Cargando…
            </div>
          )}

          {isPanoRoom && !typologyPanoUrl && (catalog?.finishes?.length ?? 0) > 0 && (
            <div className="pointer-events-auto mx-auto flex w-full max-w-md items-center gap-2 rounded-[4px] bg-black/55 p-2 backdrop-blur-sm">
              <div className="flex min-w-0 flex-1 gap-1.5">
                {(catalog?.finishes ?? []).map((item) => (
                  <button
                    key={item.slug}
                    type="button"
                    onClick={() => onFinish(item.slug)}
                    className={cn(
                      'h-10 flex-1 cursor-pointer rounded-[4px] text-[12px] font-semibold tracking-[0.12em] uppercase transition-colors',
                      finish === item.slug
                        ? 'bg-[#787D62] text-white'
                        : 'bg-white/10 text-white/80 hover:bg-white/16',
                    )}
                  >
                    {item.name}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={onLight}
                className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-[4px] bg-white/10 text-white hover:bg-white/16"
                aria-label={light === 'dia' ? 'Cambiar a noche' : 'Cambiar a día'}
                title={lightLabel}
              >
                {light === 'dia' ? <Moon size={16} strokeWidth={1.75} /> : <Sun size={16} strokeWidth={1.75} />}
              </button>
            </div>
          )}
          <p className="px-1 text-center text-[11px] font-medium tracking-wide text-white/55">
            {`${roomName}${
              isPanoRoom && !typologyPanoUrl && showFinish && finishName ? ` · ${finishName}` : ''
            }${isPanoRoom && !typologyPanoUrl ? ` · ${lightLabel}` : ''}`}
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
