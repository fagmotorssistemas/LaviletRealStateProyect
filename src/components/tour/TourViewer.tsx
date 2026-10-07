'use client'

import { useDualBuffer } from '@/components/tour/useDualBuffer'
import { CmafVideo } from '@/components/media/CmafVideo'
import { TourLocaleProvider, useTourLanguage } from '@/lib/tour/tourLocale'
import { translateTourText, type TourLocale } from '@/lib/tour/tourMessages'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type SyntheticEvent } from 'react'
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
  Calculator,
  Compass,
  FileText,
  Hand,
  Images,
  Layers,
  Heart,
  Landmark,
  Menu,
  Bookmark,
  Mic,
  Plus,
  Minus,
  MoreHorizontal,
  Rotate3d,
  SwatchBook,
} from 'lucide-react'
import { createTourArrow, roomHotspotHtml } from '@/components/tour/createTourArrow'
import { TourFichaDrawer } from '@/components/tour/TourFichaDrawer'
import { TourRotateHint } from '@/components/tour/TourRotateHint'
import { TourSimulatorDrawer } from '@/components/tour/TourSimulatorDrawer'
import {
  TourPhoneUnlockModal,
  type TourPhoneUnlockIntent,
} from '@/components/tour/TourPhoneUnlockModal'
import { TourFloorPlan } from '@/components/tour/TourFloorPlan'
import { TourComparador } from '@/components/tour/TourComparador'
import { TourFinishCompareOverlay } from '@/components/tour/TourFinishCompareOverlay'
import type { ComparePanoPose } from '@/components/tour/CompareSidePano'
import { TourSaveUnitModal } from '@/components/tour/TourSaveUnitModal'
import { TourTerminacionesPanel } from '@/components/tour/TourTerminacionesPanel'
import { TourInfoRequestModal } from '@/components/tour/TourInfoRequestModal'
import { TourFloorLocationPeek } from '@/components/tour/TourFloorLocationPeek'
import { TourFavoritesPanel } from '@/components/tour/TourFavoritesPanel'
import { TourNavModeModal, type TourNavMode } from '@/components/tour/TourNavModeModal'
import { TourVoiceAssist } from '@/components/tour/TourVoiceAssist'
import { ShowroomMenu } from '@/components/tour/ShowroomMenu'
import { TourAmenitiesGallery } from '@/components/tour/TourAmenitiesGallery'
import { SITE } from '@/lib/marketing/site'
import { buildTourWhatsAppMessage, tourWhatsAppHref } from '@/lib/tour/tourWhatsApp'
import { MetaViewContentUnit } from '@/components/marketing/MetaViewContentUnit'
import { MetaViewContentShowroom } from '@/components/marketing/MetaViewContentShowroom'
import { finishSwatchStyle } from '@/lib/tour/finishSwatch'
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
import { pickCatalogPanoUrl, pickTourWidth, smallerTourUrl, tourCoarsePanoUrl, type TourWidth } from '@/lib/tour/pickTourWidth'
import { requestGyroPermission, stabilizeTourGyro } from '@/lib/tour/stabilizeGyro'
import { attachForceLandscapePan } from '@/lib/tour/forceLandscapePan'
import { pickRoomScene, pickSceneUrl, finishesMatch, hasBothFinishesForRoom } from '@/lib/tour/roomScene'
import { buildGaleriaStills } from '@/lib/tour/galeriaStills'
import { galleryFinishPresentation } from '@/lib/tour/finishSwatch'
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
  canAccessShowroomTools,
  SHOWROOM_IDENTITY_EVENT,
} from '@/lib/tour/showroomIdentity'
import {
  findUnitByNumber,
  readUnitQueryParam,
  writeUnitQueryParam,
} from '@/lib/tour/unitDeepLink'
import { FLOOR_PLAN_FLOORS, FLOOR_PLAN_LEVELS, unitFloorNumber } from '@/lib/tour/floorPlanHotspots'
import { fetchFloorPlanReady, prefetchFloorPlans, warmFloorPlans } from '@/lib/tour/floorPlanClientCache'
import { preloadStill, warmStills } from '@/lib/tour/stillPreload'
import { isGalleryOnlyTypology } from '@/lib/tour/localesTypology'
import { normalizeUnitCategory } from '@/types/inmobiliaria'
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

function roomMarkerPin(item: TourPlacedHotspot, locale: TourLocale) {
  const kind = item.kind === 'look' ? 'look' : 'go'
  return {
    id: `pin-${item.id}`,
    position: { yaw: item.yaw, pitch: item.pitch },
    html: roomHotspotHtml(translateTourText(item.label, locale), kind),
    anchor: 'center center' as const,
    size: { width: 92, height: 78 },
    tooltip: translateTourText(item.label, locale),
    data: { room: item.slug, kind, yaw: item.yaw, pitch: item.pitch },
  }
}

function buildTourMarkers(
  viewMode: string,
  room: string,
  _tourRooms: { slug: string; label: string }[],
  placed: TourPlacedHotspot[],
  _homeSlug: string,
  locale: TourLocale = 'es',
) {
  if (viewMode !== 'tour') return []
  return placed.filter((item) => item.from === room).map((item) => roomMarkerPin(item, locale))
}

function CrossfadeStill({
  url,
  alt,
  contain = false,
  fit = 'vistas',
  lateralPan = false,
  onStep,
  zoom,
}: {
  url: string | null
  alt: string
  contain?: boolean
  fit?: 'vistas' | 'planos'
  lateralPan?: boolean
  onStep?: (dir: 1 | -1) => void
  zoom?: number
}) {
  const { t } = useTourLanguage()
  const { aRef, bRef, front, assigned } = useDualBuffer(url)
  const rootRef = useRef<HTMLDivElement>(null)
  const [portrait, setPortrait] = useState(false)
  const [aspect, setAspect] = useState(1.6)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [pan, setPan] = useState(0)
  const panRef = useRef(0)
  panRef.current = pan
  const dragRef = useRef<{ x: number; pan: number; moved: boolean; over: number } | null>(null)
  const active = lateralPan && portrait && !contain && zoom == null
  const maxPan = active ? Math.max(0, (box.h * aspect - box.w) / 2) : 0

  useEffect(() => {
    void preloadStill(url)
    setPan(0)
  }, [url])

  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait) and (pointer: coarse)')
    const sync = () => setPortrait(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const sync = () => {
      const rect = el.getBoundingClientRect()
      setBox({ w: rect.width, h: rect.height })
    }
    sync()
    const obs = new ResizeObserver(sync)
    obs.observe(el)
    return () => obs.disconnect()
  }, [assigned.a, assigned.b])

  const onLoad = (event: SyntheticEvent<HTMLImageElement>) => {
    const img = event.currentTarget
    if (img.naturalWidth > 0 && img.naturalHeight > 0) {
      setAspect(img.naturalWidth / img.naturalHeight)
    }
  }

  const position = maxPan > 0 ? `${50 - (pan / maxPan) * 50}% center` : 'center'

  const onDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!active) return
    event.stopPropagation()
    dragRef.current = { x: event.clientX, pan: panRef.current, moved: false, over: 0 }
  }

  const onMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = event.clientX - drag.x
    if (!drag.moved && Math.abs(dx) < 8 && Math.abs(event.movementY) < 8) return
    drag.moved = true
    const raw = drag.pan + dx
    const limit = Math.max(0, maxPan)
    const next = Math.max(-limit, Math.min(limit, raw))
    drag.over = raw - next
    panRef.current = next
    setPan(next)
  }

  const onUp = () => {
    const drag = dragRef.current
    dragRef.current = null
    if (!drag?.moved) return
    if (drag.over > 48) onStep?.(-1)
    else if (drag.over < -48) onStep?.(1)
  }

  if (!assigned.a && !assigned.b) return null

  const frame = (slot: 'a' | 'b', ref: typeof aRef) => {
    const src = assigned[slot]
    if (!src) return null
    return (
      <div
        className={cn(
          'pointer-events-none absolute inset-0 transition-opacity duration-[400ms] ease-linear',
          front === slot ? 'opacity-100' : 'opacity-0',
        )}
      >
        <div
          className={cn(
            'absolute inset-0',
            contain && 'tour-still-fit',
            contain && fit === 'planos' && 'tour-still-fit--planos',
          )}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            ref={ref}
            src={src}
            alt={front === slot ? t(alt) : ''}
            draggable={false}
            decoding="async"
            fetchPriority={front === slot ? 'high' : 'low'}
            onLoad={front === slot ? onLoad : undefined}
            style={
              zoom != null
                ? { transform: `scale(${zoom})` }
                : active
                  ? { objectPosition: position }
                  : undefined
            }
            className={cn(
              zoom != null || contain
                ? 'h-full w-full object-contain object-center'
                : 'absolute inset-0 h-full w-full object-cover',
              zoom != null && 'origin-center',
            )}
          />
        </div>
      </div>
    )
  }

  return (
    <div
      ref={rootRef}
      data-still-pan={active ? pan.toFixed(1) : undefined}
      data-still-pan-max={active ? maxPan.toFixed(1) : undefined}
      className={cn('absolute inset-0 overflow-hidden bg-[#111]', active && 'touch-none')}
      style={active ? { touchAction: 'none' } : undefined}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      {frame('a', aRef)}
      {frame('b', bRef)}
    </div>
  )
}

const ENTRY_VIDEO_ASPECT = 1280 / 610

function EntryLateral({ active, children }: { active: boolean; children: ReactNode }) {
  const stageRef = useRef<HTMLDivElement>(null)
  const [portrait, setPortrait] = useState(false)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [pan, setPan] = useState(0)
  const panRef = useRef(0)
  const draggedRef = useRef(false)
  const dragRef = useRef<{ x: number; pan: number; moved: boolean } | null>(null)
  const max = Math.max(0, (size.h * ENTRY_VIDEO_ASPECT - size.w) / 2)
  const live = active && portrait

  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait) and (pointer: coarse)')
    const sync = () => setPortrait(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const sync = () => {
      const rect = el.getBoundingClientRect()
      setSize({ w: rect.width, h: rect.height })
    }
    sync()
    const obs = new ResizeObserver(sync)
    obs.observe(el)
    return () => obs.disconnect()
  }, [live])

  useEffect(() => {
    if (!live || max < 8 || draggedRef.current) return
    const from = max
    const to = -max
    const started = performance.now()
    panRef.current = from
    setPan(from)
    let raf = 0
    const tick = (now: number) => {
      if (draggedRef.current) return
      const t = Math.min(1, (now - started) / 8000)
      const next = from + (to - from) * t
      panRef.current = next
      setPan(next)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [live, max])

  const onDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!live || event.pointerType === 'mouse') return
    draggedRef.current = true
    dragRef.current = { x: event.clientX, pan: panRef.current, moved: false }
  }
  const onMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = event.clientX - drag.x
    if (!drag.moved && Math.abs(dx) < 8) return
    drag.moved = true
    const next = Math.max(-max, Math.min(max, drag.pan + dx))
    panRef.current = next
    setPan(next)
  }
  const onUp = () => {
    dragRef.current = null
  }

  return (
    <div
      ref={stageRef}
      data-entry-pan={live ? pan.toFixed(1) : undefined}
      data-entry-pan-max={live ? max.toFixed(1) : undefined}
      className={cn('absolute inset-0 overflow-hidden', live && 'touch-none')}
      style={live ? { touchAction: 'none' } : undefined}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <div
        className="absolute top-0 left-1/2 h-full"
        style={
          live
            ? {
                width: Math.max(size.w, size.h * ENTRY_VIDEO_ASPECT),
                transform: `translateX(calc(-50% + ${pan}px))`,
              }
            : { width: '100%', transform: 'translateX(-50%)' }
        }
      >
        {children}
      </div>
    </div>
  )
}

type TourViewMode = 'tour' | 'galeria' | 'planos-2d' | 'planos-3d'
type StillItem = { id: string; label: string; url: string; roomSlug?: string }

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
  onPointerDown,
  onPointerEnter,
  disabled,
  title,
}: {
  active: boolean
  children: string
  icon: ReactNode
  onClick: () => void
  onPointerDown?: () => void
  onPointerEnter?: () => void
  disabled?: boolean
  title?: string
}) {
  const { t } = useTourLanguage()

  return (
    <button
      type="button"
      title={t(title ?? children)}
      disabled={disabled}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerEnter={onPointerEnter}
      data-active={active ? 'true' : undefined}
        className={cn(
        'tour-mode-btn tour-glass border-white/25 !bg-[#14110e]/72 text-left font-semibold uppercase [text-shadow:0_1px_8px_rgba(0,0,0,0.65)] transition-colors duration-300',
        active ? 'text-white shadow-[inset_2px_0_0_#BDA27E]' : 'text-white/80 hover:text-white',
        disabled && 'cursor-not-allowed opacity-40 hover:text-white/80',
      )}
    >
      <span className="tour-mode-btn__icon" aria-hidden>
        {t(icon)}
      </span>
      <span className="tour-mode-btn__label">{t(children)}</span>
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
  const { t } = useTourLanguage()

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
        data-active={active ? 'true' : undefined}
      >
        <span className="tour-mode-btn__icon" aria-hidden>
          <Layers size={14} strokeWidth={1.75} />
        </span>
        <span className="tour-mode-btn__label">{t(label)}</span>
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
                  {t(opt.label)}
                </button>
              </li>
            )
          })}
        </ul>
      ) : null}
    </div>
  )
}

function DesktopModesList({
  viewMode,
  active,
  show,
  onGaleria,
  onPlanos,
  onTour,
  onTourPrime,
  onTerminaciones,
  onComparador,
  terminacionesDisabled,
}: {
  viewMode: TourViewMode
  active: {
    galeria: boolean
    tour: boolean
    terminaciones: boolean
    comparador: boolean
  }
  show: {
    galeria: boolean
    planos: boolean
    tour: boolean
    terminaciones: boolean
    comparador: boolean
  }
  onGaleria: () => void
  onPlanos: (mode: 'planos-2d' | 'planos-3d') => void
  onTour: () => void
  onTourPrime?: () => void
  onTerminaciones: () => void
  onComparador: () => void
  terminacionesDisabled?: boolean
}) {
  const { t } = useTourLanguage()

  return (
    <>
      {show.galeria ? (
        <ModeButton active={active.galeria} icon={<Images size={14} strokeWidth={1.75} />} onClick={onGaleria}>
          {t(" Galería ")}</ModeButton>
      ) : null}
      {show.planos ? <PlanosModePicker viewMode={viewMode} onSelect={onPlanos} /> : null}
      {show.tour ? (
        <ModeButton active={active.tour} icon={<Rotate3d size={14} strokeWidth={1.75} />} onClick={onTour} onPointerDown={onTourPrime} onPointerEnter={onTourPrime}>
          {t(" Tour 360° ")}</ModeButton>
      ) : null}
      {show.terminaciones ? (
        <ModeButton
          active={active.terminaciones}
          disabled={terminacionesDisabled}
          title={terminacionesDisabled ? t('Este ambiente no tiene otra terminación') : undefined}
          icon={<SwatchBook size={14} strokeWidth={1.75} />}
          onClick={onTerminaciones}
        >
          {t(" Terminaciones ")}</ModeButton>
      ) : null}
      {show.comparador ? (
        <ModeButton active={active.comparador} icon={<Columns2 size={14} strokeWidth={1.75} />} onClick={onComparador}>
          {t(" Comparador ")}</ModeButton>
      ) : null}
    </>
  )
}

/** Qué modos tiene sentido mostrar según la vista actual. */
function modeButtonsForView(input: {
  shellMode: 'plan' | 'unit'
  viewMode: TourViewMode
  terminacionesFocus: boolean
  galleryOnly?: boolean
  showTerminaciones?: boolean
}): {
  galeria: boolean
  planos: boolean
  tour: boolean
  terminaciones: boolean
  comparador: boolean
} {
  if (input.shellMode === 'plan') {
    return { galeria: false, planos: false, tour: false, terminaciones: false, comparador: false }
  }
  if (input.galleryOnly) {
    return { galeria: true, planos: false, tour: false, terminaciones: false, comparador: false }
  }
  // Panel de terminaciones: volver al tour o seguir en terminaciones.
  if (input.terminacionesFocus) {
    return { galeria: false, planos: false, tour: true, terminaciones: true, comparador: false }
  }
  // Galería: terminaciones solo si los dos acabados tienen imagen.
  if (input.viewMode === 'galeria') {
    return { galeria: true, planos: false, tour: true, terminaciones: true, comparador: true }
  }
  // Planos tipología (stills): no mezclar con menú de modos del edificio.
  if (isPlanosMode(input.viewMode)) {
    return { galeria: true, planos: false, tour: true, terminaciones: false, comparador: false }
  }
  // Tour 360°: el botón de terminaciones queda visible y se deshabilita si este ambiente no tiene las dos.
  return { galeria: true, planos: false, tour: true, terminaciones: true, comparador: true }
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
  // En celular el showroom vive siempre a pantalla completa (landscape nativo o CSS).
  return isTouchShowroomDevice()
}

function isTouchShowroomDevice() {
  if (typeof window === 'undefined') return false
  const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0
  return touch && shortestViewport() <= 900
}

/**
 * iOS Safari tumba el tab con CSS rotate(90deg) + WebGL ("A problem repeatedly occurred").
 * En iOS no forzamos landscape por CSS: el usuario gira el teléfono o usa portrait estable.
 */
function isIOSWebKit() {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  if (/iPad|iPhone|iPod/.test(ua)) return true
  // iPadOS desktop UA
  return navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
}

function panoramaFallbackUrls(url: string): string[] {
  const urls: string[] = []
  let cursor: string | null = url
  for (let step = 0; step < 3; step += 1) {
    cursor = smallerTourUrl(cursor)
    if (!cursor || urls.includes(cursor)) break
    urls.push(cursor)
  }
  return urls
}

/** Libera WebGL de forma agresiva (recargas en iOS dejan contextos vivos y tumba el tab). */
function disposeTourViewer(viewer: Viewer | null | undefined, container?: HTMLElement | null) {
  if (viewer) {
    try {
      const gyro = viewer.getPlugin<GyroscopePlugin>(GyroscopePlugin)
      if (gyro?.isEnabled()) gyro.stop()
    } catch {
      /* ignore */
    }
    try {
      viewer.destroy()
    } catch {
      /* ignore */
    }
  }
  const root = container
  if (!root) return
  root.querySelectorAll('canvas').forEach((canvas) => {
    try {
      const el = canvas as HTMLCanvasElement
      // Sin attrs: si pedís preserveDrawingBuffer distinto al del contexto vivo, getContext → null en iOS.
      const gl =
        el.getContext('webgl2') ||
        el.getContext('webgl') ||
        el.getContext('experimental-webgl')
      const lose = (gl as WebGLRenderingContext | null)?.getExtension?.('WEBGL_lose_context')
      lose?.loseContext()
    } catch {
      /* ignore */
    }
    try {
      canvas.remove()
    } catch {
      /* ignore */
    }
  })
}

function clearTourDomFlags() {
  if (typeof document === 'undefined') return
  document.documentElement.classList.remove('tour-is-immersive', 'tour-is-force-landscape')
  document.documentElement.style.overflow = ''
  document.body.style.overflow = ''
}

function useOrientationSync(onChange: () => void) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    const timers: number[] = []
    const sync = () => {
      onChangeRef.current()
    }
    const onOrient = () => {
      sync()
      timers.push(window.setTimeout(sync, 200), window.setTimeout(sync, 700))
    }
    sync()
    timers.push(...[0, 200, 500, 900].map((ms) => window.setTimeout(sync, ms)))
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
  }, [])
}

function useShowroomImmersive(enabled: boolean) {
  const [want, setWant] = useState(false)
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  useOrientationSync(() => {
    if (!enabledRef.current) {
      setWant(false)
      return
    }
    setWant(shouldGoImmersive())
  })

  useEffect(() => {
    if (!enabled) setWant(false)
    else setWant(shouldGoImmersive())
  }, [enabled])

  return { want }
}

/** Portrait + touch → landscape visual (CSS rotate). Desactivado en iOS (crash WebKit). */
function useForceLandscapeCss(enabled: boolean) {
  const [force, setForce] = useState(false)
  const enabledRef = useRef(enabled)
  enabledRef.current = enabled

  useOrientationSync(() => {
    if (!enabledRef.current || isIOSWebKit()) {
      setForce(false)
      return
    }
    setForce(isTouchShowroomDevice() && !isOsLandscape())
  })

  useEffect(() => {
    if (!enabled || isIOSWebKit()) setForce(false)
    else setForce(isTouchShowroomDevice() && !isOsLandscape())
  }, [enabled])

  return force
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

async function lockTourLandscape(el: HTMLElement) {
  await requestTourFullscreen(el)
  try {
    const orient = window.screen?.orientation as
      | (ScreenOrientation & { lock?: (mode: string) => Promise<void> })
      | undefined
    if (typeof orient?.lock === 'function') {
      await orient.lock('landscape')
    }
  } catch {
    /* iOS / desktop without Orientation Lock API */
  }
}

async function unlockTourOrientation() {
  try {
    window.screen?.orientation?.unlock?.()
  } catch {
    /* ignore */
  }
}

async function leaveTourFullscreen() {
  await unlockTourOrientation()
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
  coarse = false,
): { nodes: VirtualTourNode[]; startNodeId: string | undefined } {
  if (!catalog) return { nodes: [], startNodeId: undefined }
  const first = catalog.typologies.find(
    (item) => item.panorama || item.rooms.some((room) => room.url || room.scenes.length > 0),
  )
  if (!first) return { nodes: [], startNodeId: undefined }
  const home =
    first.rooms.find((room) => room.slug === TOUR_HOME_SLUG) ??
    first.rooms.find((room) => room.url || room.scenes.length > 0)
  const picked =
    pickCatalogPanoUrl(first.panorama, width, finish, light, { coarse }) ??
    pickSceneUrl(pickRoomScene(home?.scenes, finish, light), width, { coarse })
  const url = picked ?? (coarse ? tourCoarsePanoUrl(home?.url) : home?.url)
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

function preloadLeadGallery(
  typ: TourTypologyOption | null | undefined,
  finishes: TourPublicCatalog['finishes'] | undefined,
) {
  if (!typ) return
  const local = isGalleryOnlyTypology(typ)
  const lead = buildGaleriaStills(typ, finishes, {
    finish: local ? null : (finishes?.[0]?.slug ?? null),
    light: local ? null : 'dia',
    strict: !local,
    roomLabelOnly: !local,
    rendersOnly: local,
  })[0]
  if (lead?.url) void preloadStill(lead.url)
}

export function TourViewer({ embedded = false }: { embedded?: boolean }) {
  return <TourLocaleProvider><TourViewerContent embedded={embedded}/></TourLocaleProvider>
}

function TourViewerContent({ embedded = false }: { embedded?: boolean }) {
  const { t, locale } = useTourLanguage()
  const localeRef = useRef(locale)
  useEffect(() => { localeRef.current = locale }, [locale])
  const tourMarkersRef = useRef({
    viewMode: 'planos-3d',
    room: TOUR_HOME_SLUG,
    rooms: [] as { slug: string; label: string }[],
    hotspots: [] as TourPlacedHotspot[],
    homeSlug: TOUR_HOME_SLUG,
  })
  const applyTourMarkersRef = useRef(() => {})

  const slotRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<Viewer | null>(null)
  const hold = useShowroomImmersive(!embedded)
  const immersive = hold.want
  // Let the responsive menu and viewer follow the device orientation.
  // Do not rotate the entire application with CSS on portrait phones.
  const forceLandscapeCss = useForceLandscapeCss(false)
  const tourRef = useRef<VirtualTourPlugin | null>(null)
  const targetWidthRef = useRef<TourWidth>(2048)
  const catalogWidthRef = useRef<TourWidth>(4096)
  const currentUrlRef = useRef('')
  const preloadedRef = useRef(new Set<string>())
  const neighborChainRef = useRef<Promise<void>>(Promise.resolve())
  const neighborQueuedRef = useRef(new Set<string>())
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
  const [panoRevealed, setPanoRevealed] = useState(false)
  const [viewerMounted, setViewerMounted] = useState(false)
  const [booting, setBooting] = useState(true)
  const [bootError, setBootError] = useState<string | null>(null)
  const [publicCatalog, setPublicCatalog] = useState<TourPublicCatalog | null>(null)
  const [selectedTypology, setSelectedTypology] = useState('')
  const [gateOpen, setGateOpen] = useState(false)
  const [fichaOpen, setFichaOpen] = useState(false)
  const [amenitiesOpen, setAmenitiesOpen] = useState(false)
  const [showroomReady, setShowroomReady] = useState(false)
  const [fichaExpanded, setFichaExpanded] = useState(false)
  const [simulatorOpen, setSimulatorOpen] = useState(false)
  const [simulatorEntry, setSimulatorEntry] = useState<{
    mode?: 'cash' | 'financed' | 'manual'
    section?: 'financing' | 'rent' | null
  }>({})
  const [phoneUnlock, setPhoneUnlock] = useState<{
    open: boolean
    intent: TourPhoneUnlockIntent
  }>({ open: false, intent: 'simulator' })
  const [showroomIdentified, setShowroomIdentified] = useState(false)
  const [saveUnitOpen, setSaveUnitOpen] = useState(false)
  const [favoritesOpen, setFavoritesOpen] = useState(false)
  const [mobilePanel, setMobilePanel] = useState<'nav' | 'modes' | null>(null)
  const [infoRequestOpen, setInfoRequestOpen] = useState(false)
  const [tourNavMode, setTourNavMode] = useState<TourNavMode | null>(null)
  const [navChooserOpen, setNavChooserOpen] = useState(false)
  const [voiceAssistOpen, setVoiceAssistOpen] = useState(false)
  const [shellMode, setShellMode] = useState<'plan' | 'unit'>('plan')
  const openingPlanFloor = FLOOR_PLAN_LEVELS.find((level) => level.storageKey === 'terraza')?.id ?? 7
  const [planFloor, setPlanFloor] = useState(openingPlanFloor)
  const [planEntryOpen, setPlanEntryOpen] = useState(true)
  const [entryVideo, setEntryVideo] = useState(false)
  // TourViewer se monta solo en el cliente. El primer render ya elige el ingreso
  // del teléfono, así el HLS de escritorio no llega a pedirse.
  const [entryCoarse] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches,
  )
  // El src del ingreso se asigna solo después de medir el puntero. Si no, el
  // celular llega a pedir el MP4 de escritorio y luego el de teléfono.
  const [ingresoCoarse, setIngresoCoarse] = useState<boolean | null>(null)
  const [coverReady, setCoverReady] = useState(false)
  const coverVideoRef = useRef<HTMLVideoElement | null>(null)
  useLayoutEffect(() => {
    setIngresoCoarse(window.matchMedia('(pointer: coarse)').matches)
  }, [])
  useEffect(() => {
    if (!planEntryOpen || shellMode !== 'plan') return
    const timer = window.setTimeout(() => setCoverReady(true), 2500)
    // En celular la portada se vuelve a pedir: el botón espera el primer cuadro.
    if (entryCoarse) return () => window.clearTimeout(timer)
    const video = coverVideoRef.current
    const markLoaded = () => {
      if (video && video.readyState >= 2) setCoverReady(true)
    }
    video?.addEventListener('loadeddata', markLoaded)
    markLoaded()
    return () => {
      window.clearTimeout(timer)
      video?.removeEventListener('loadeddata', markLoaded)
    }
  }, [planEntryOpen, shellMode, entryCoarse])
  const entryFailedRef = useRef(false)
  const [droneOn, setDroneOn] = useState(false)
  const droneRef = useRef<HTMLVideoElement>(null)
  const [planTouchUntil, setPlanTouchUntil] = useState(0)
  const [planPresented, setPlanPresented] = useState(false)
  const [awaitPlanClose, setAwaitPlanClose] = useState(false)
  const [entryExit, setEntryExit] = useState(false)
  const [coverHidden, setCoverHidden] = useState(false)
  const finishLookupSlugRef = useRef('')
  const armPlanTouchLock = useCallback(() => {
    setPlanTouchUntil(Date.now() + 400)
  }, [])
  const planTouchLock = planTouchUntil > Date.now()

  useEffect(() => {
    if (!planTouchUntil) return
    const delay = Math.max(0, planTouchUntil - Date.now())
    const timer = window.setTimeout(() => setPlanTouchUntil(0), delay)
    return () => window.clearTimeout(timer)
  }, [planTouchUntil])

  const requestEntryClose = useCallback(() => {
    const video = droneRef.current
    if (video && !video.paused) video.pause()
    setEntryVideo(false)
    setAwaitPlanClose(true)
  }, [])

  useEffect(() => {
    if (!entryVideo || !planEntryOpen || droneOn) return
    const timer = window.setTimeout(() => requestEntryClose(), 10000)
    return () => window.clearTimeout(timer)
  }, [entryVideo, planEntryOpen, droneOn, requestEntryClose])

  useEffect(() => {
    if (!entryVideo) return
    const video = droneRef.current
    if (!video) return
    let done = false
    const mark = () => {
      if (done) return
      done = true
      setDroneOn(true)
    }
    if (typeof video.requestVideoFrameCallback === 'function') {
      const id = video.requestVideoFrameCallback(() => mark())
      return () => video.cancelVideoFrameCallback?.(id)
    }
    const onPlaying = () => requestAnimationFrame(() => requestAnimationFrame(mark))
    video.addEventListener('playing', onPlaying)
    return () => video.removeEventListener('playing', onPlaying)
  }, [entryVideo])

  useEffect(() => {
    if (!droneOn) return
    const timer = window.setTimeout(() => setCoverHidden(true), 400)
    return () => window.clearTimeout(timer)
  }, [droneOn])

  useEffect(() => {
    const cover = coverVideoRef.current
    if (!cover) return
    if (shellMode === 'plan' && planEntryOpen && !coverHidden) {
      void cover.play().catch(() => undefined)
      return
    }
    cover.pause()
  }, [shellMode, planEntryOpen, coverHidden])

  useEffect(() => {
    if (!awaitPlanClose || !planEntryOpen) return
    let fadeTimer = 0
    const close = () => {
      setPlanEntryOpen(false)
      setEntryExit(false)
      setAwaitPlanClose(false)
      armPlanTouchLock()
    }
    const startFade = () => {
      setEntryExit(true)
      fadeTimer = window.setTimeout(close, 400)
    }
    if (planPresented) {
      startFade()
      return () => window.clearTimeout(fadeTimer)
    }
    const cap = window.setTimeout(startFade, 5000)
    return () => {
      window.clearTimeout(cap)
      window.clearTimeout(fadeTimer)
    }
  }, [awaitPlanClose, planPresented, planEntryOpen, armPlanTouchLock])

  useEffect(() => {
    return () => {
      void leaveTourFullscreen()
    }
  }, [])

  useEffect(() => {
    void fetchFloorPlanReady(openingPlanFloor)
  }, [openingPlanFloor])

  useEffect(() => {
    if (planEntryOpen) return
    const ios = isIOSWebKit()
    const coarse = window.matchMedia('(pointer: coarse)').matches
    // Celular: solo los datos de los demás pisos. Un WebGL vivo a la vez.
    if (ios || coarse) {
      void warmFloorPlans([planFloor], [planFloor])
      if (coarse) prefetchFloorPlans([...FLOOR_PLAN_FLOORS], undefined, { media: false })
      return
    }
    prefetchFloorPlans([...FLOOR_PLAN_FLOORS])
    const idx = FLOOR_PLAN_FLOORS.indexOf(planFloor)
    const priority = FLOOR_PLAN_FLOORS.filter((_, i) => Math.abs(i - Math.max(0, idx)) <= 1)
    void warmFloorPlans(priority.length ? priority : [planFloor], [planFloor])
  }, [planEntryOpen, planFloor])

  useEffect(() => {
    const sync = () => setShowroomIdentified(canAccessShowroomTools())
    sync()
    window.addEventListener(SHOWROOM_IDENTITY_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(SHOWROOM_IDENTITY_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  useEffect(() => {
    if (planEntryOpen) return
    const ios = isIOSWebKit()
    if (ios) {
      void warmFloorPlans([planFloor], [planFloor])
      return
    }
    const idx = FLOOR_PLAN_FLOORS.indexOf(planFloor)
    const neighbors = FLOOR_PLAN_FLOORS.filter((_, i) => Math.abs(i - Math.max(0, idx)) <= 1)
    void warmFloorPlans(neighbors, [planFloor])
  }, [planFloor, planEntryOpen])

  const [terminacionesFocus, setTerminacionesFocus] = useState(false)
  const [finishCompareOpen, setFinishCompareOpen] = useState(false)
  const [finishRight, setFinishRight] = useState('')
  const [finishCompareSplit, setFinishCompareSplit] = useState(50)
  const [comparePose, setComparePose] = useState<ComparePanoPose | null>(null)
  const comparePoseLockRef = useRef<'main' | 'side' | null>(null)
  const comparePoseRafRef = useRef(0)
  /** Pose en vivo para sync frame-a-frame del lado B. */
  const comparePoseLiveRef = useRef<ComparePanoPose | null>(null)
  const [compareOpen, setCompareOpen] = useState(false)
  const [compareUnitBId, setCompareUnitBId] = useState<string | null>(null)
  const [comparePreviewIndex, setComparePreviewIndex] = useState(0)
  const [compareFinishB, setCompareFinishB] = useState('')
  const [compareLightB, setCompareLightB] = useState<TourLightMode>('dia')
  const [compareSplit, setCompareSplit] = useState(50)
  const [compareRoomB, setCompareRoomB] = useState<string | null>(null)
  const compareLookAtBRef = useRef<((yaw: number, pitch: number) => void) | null>(null)
  const [panoFailed, setPanoFailed] = useState(false)
  const [selectedUnitId, setSelectedUnitId] = useState<string | null>(null)
  const consultUnitLoggedRef = useRef<string | null>(null)
  const [viewMode, setViewMode] = useState<TourViewMode>('planos-3d')
  const deepLinkBootRef = useRef(false)
  useEffect(() => {
    if (deepLinkBootRef.current) return
    deepLinkBootRef.current = true
    let tourFailed = false
    try {
      tourFailed = sessionStorage.getItem('lavilet-tour-360-failed') === '1'
    } catch {
      tourFailed = false
    }
    if (!readUnitQueryParam()) {
      if (tourFailed) {
        try {
          sessionStorage.removeItem('lavilet-tour-360-failed')
        } catch {
          /* ignore */
        }
      }
      return
    }
    if (tourFailed) {
      try {
        sessionStorage.removeItem('lavilet-tour-360-failed')
      } catch {
        /* ignore */
      }
    }
    setPlanEntryOpen(false)
    setShellMode('unit')
    setViewMode('galeria')
    setFichaOpen(true)
    setFichaExpanded(true)
  }, [])
  const [galeriaIndex, setGaleriaIndex] = useState(0)
  const [galleryZoom, setGalleryZoom] = useState(1)
  useEffect(() => {
    setGalleryZoom(1)
  }, [galeriaIndex])
  /** Semilla estable: cambia al entrar a galería / tipología para re-sortear acabado×luz. */
  const [galeriaSeed, setGaleriaSeed] = useState(() => Math.floor(Math.random() * 1_000_000))
  const [compareGaleriaSeedB, setCompareGaleriaSeedB] = useState(() => Math.floor(Math.random() * 1_000_000))
  const [planoIndex, setPlanoIndex] = useState(0)
  const [panoGhost, setPanoGhost] = useState<string | null>(null)
  const [panoGhostKey, setPanoGhostKey] = useState(0)
  const [panoEntering, setPanoEntering] = useState(false)
  const [panoLeaving, setPanoLeaving] = useState(false)
  const lastStillRef = useRef<string | null>(null)
  const stillScopeRef = useRef('')
  const viewModeRef = useRef(viewMode)
  const moreActionsRef = useRef<HTMLDetailsElement>(null)
  const desiredPanoRef = useRef<string | null>(null)
  const shownPanoRef = useRef('')
  const steppedPanoRef = useRef<{ requested: string; shown: string } | null>(null)
  const panoRequestRef = useRef<string | null>(null)
  const triedPanoRef = useRef(new Set<string>())
  const pendingPreloadUrlRef = useRef<string | null>(null)
  const preloadingRef = useRef(new Set<string>())
  const revealTourRef = useRef<(url: string) => void>(() => {})
  const coverStillRef = useRef<string | null>(null)
  const mountTourViewerRef = useRef<(() => void) | null>(null)
  viewModeRef.current = viewMode
  const walkToRef = useRef<Position | null>(null)
  const walkingRef = useRef(false)
  const lookPromiseRef = useRef<PromiseLike<boolean> | null>(null)

  useEffect(() => {
    if (moreActionsRef.current?.open) moreActionsRef.current.open = false
  }, [viewMode, selectedUnitId, room])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const root = moreActionsRef.current
      if (!root?.open) return
      const target = event.target
      if (!(target instanceof Node) || root.contains(target)) return
      const secondary = root.parentElement?.querySelector('.tour-actions-secondary')
      if (secondary?.contains(target)) return
      root.open = false
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [])

  const preloadUrls = useCallback((viewer: Viewer, urls: string[]) => {
    if (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches) return
    for (const url of urls) {
      if (!url || preloadedRef.current.has(url) || neighborQueuedRef.current.has(url)) continue
      neighborQueuedRef.current.add(url)
      neighborChainRef.current = neighborChainRef.current.then(async () => {
        if (preloadedRef.current.has(url)) return
        try {
          await viewer.textureLoader.preloadPanorama(url)
          preloadedRef.current.add(url)
        } catch {
          neighborQueuedRef.current.delete(url)
        }
      })
    }
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

        const nextNode = scene.nodes.find((n) => n.id === stayId)
        if (!nextNode) return
        const nextUrl = String(nextNode?.panorama ?? '')
        if (nextUrl && !preloadedRef.current.has(nextUrl)) {
          setLoading(true)
          try {
            await Promise.race([
              viewer.textureLoader.preloadPanorama(nextUrl).then(() => {
                preloadedRef.current.add(nextUrl)
              }),
              sleep(2500),
            ])
          } catch {
            /* sigue el cambio; el fade cubre la espera */
          }
        }
        if (token !== switchTokenRef.current) {
          setLoading(false)
          return
        }

        const startId = nextNode?.id ?? scene.startNodeId
        tour.setNodes(scene.nodes, startId)
        setNodes(scene.nodes)
        setLoading(false)
        const linked = (nextNode?.links ?? [])
          .map((link) => scene.nodes.find((node) => node.id === link.nodeId))
          .map((node) => (node ? String(node.panorama) : ''))
          .filter((item): item is string => Boolean(item) && item !== nextUrl)
        preloadUrls(viewer, linked)
      } catch (error) {
        console.error(error)
        if (token === switchTokenRef.current) setLoading(false)
      }
    },
    [room, preloadUrls],
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
      setBootError(null)
      const unitTypeSlug = getTourUnitTypeSlug()
      unitTypeSlugRef.current = unitTypeSlug

      const withTimeout = <T,>(promise: Promise<T>, ms: number, label: string) =>
        Promise.race([
          promise,
          new Promise<T>((_, reject) => {
            window.setTimeout(() => reject(new Error(`${label} tardó demasiado`)), ms)
          }),
        ])

      const [nextCatalog, nextUnits, dbScene, publicCat] = await Promise.all([
        withTimeout(loadTourCatalog(unitTypeSlug), 20000, 'Catálogo').catch(() => null),
        withTimeout(loadTourUnits(unitTypeSlug), 20000, 'Unidades').catch(() => [] as TourUnitSummary[]),
        withTimeout(
        loadTourNodes({
          unitTypeSlug,
          finishSlug: 'nogal',
          light: 'dia',
          preferredWidth: bootWidth,
        }),
          20000,
          'Escenas',
        ).catch(() => ({ nodes: [] as VirtualTourNode[], startNodeId: undefined as string | undefined })),
        withTimeout(
          fetch('/api/tour/catalog', { cache: 'no-store' }).then((res) =>
            res.ok ? (res.json() as Promise<TourPublicCatalog>) : null,
          ),
          20000,
          'Catálogo público',
        ).catch(() => null),
      ])

      if (cancelled) return

      if (publicCat) {
        setPublicCatalog(publicCat)
        const code = readUnitQueryParam()
        const unit = code ? findUnitByNumber(nextUnits, code) : null
        const typ = unit
          ? publicCat.typologies.find((item) => item.id === unit.unit_type_id) ??
            publicCat.typologies.find((item) => item.code === unit.typology_code)
          : undefined
        preloadLeadGallery(typ, publicCat.finishes)
      }

      const startFinish =
        publicCat?.finishes[0]?.slug ?? nextCatalog?.finishes[0]?.slug ?? 'nogal'
      const scene =
        dbScene.nodes.length > 0
          ? dbScene
          : nodesFromPublicCatalog(
              publicCat,
              bootWidth,
              startFinish,
              'dia',
              window.matchMedia('(pointer: coarse)').matches,
            )
      if (scene.nodes.length === 0) {
        if (!publicCat && !nextCatalog) {
          setBootError('No se pudo conectar con Supabase. Revisa tu internet o vuelve a intentar.')
        }
        // Sin panoramas: aún así montar catálogo/unidades para ficha y simulador.
        if (publicCat) {
          setCatalog(nextCatalog)
          setUnits(nextUnits ?? [])
          setFinish(startFinish)
          setLight('dia')
          if (!cancelled) setShowroomReady(true)
        }
        setBooting(false)
        return
      }

      const isNarrow = window.innerWidth < 768
      const ios = isIOSWebKit()
      const startNode = scene.nodes.find((n) => n.id === scene.startNodeId) ?? scene.nodes[0]
      const startUrl = variantUrl(startNode, bootWidth) ?? String(startNode.panorama)

      setCatalog(nextCatalog)
      setUnits(nextUnits ?? [])
      setNodes(scene.nodes)
      setFinish(startFinish)
      setLight('dia')
      setRoom(TOUR_HOME_SLUG)

      const mountTourViewer = () => {
        if (cancelled || viewerRef.current) return
        const openingUrl = desiredPanoRef.current || startUrl
        const openingNodes = scene.nodes.map((node) =>
          node.id === startNode.id ? { ...node, panorama: openingUrl } : node,
        )
        currentUrlRef.current = openingUrl
      disposeTourViewer(viewerRef.current, container)
      viewerRef.current = null
      tourRef.current = null

      const viewer = new Viewer({
        container,
        loadingTxt: '',
        lang: { loadError: 'No se pudo cargar el panorama.' },
        navbar: false,
        canvasBackground: 'transparent',
        defaultZoomLvl: 0,
        maxFov: isNarrow ? 85 : 90,
        minFov: 40,
        moveSpeed: isNarrow ? 1.45 : 1,
        moveInertia: isNarrow ? 0.55 : 0.8,
        touchmoveTwoFingers: false,
        mousewheelCtrlKey: false,
        rendererParameters: {
          alpha: true,
          // Celular: antialias + preserveDrawingBuffer + high-performance acumulan GPU y congelan la página.
          antialias: ios || window.matchMedia('(pointer: coarse)').matches ? false : !isNarrow,
          powerPreference: ios || window.matchMedia('(pointer: coarse)').matches ? 'low-power' : 'high-performance',
          preserveDrawingBuffer: ios || window.matchMedia('(pointer: coarse)').matches ? false : true,
        },
        defaultYaw: startNode.data?.initialYaw ?? 0,
        defaultPitch: startNode.data?.initialPitch ?? 0,
        defaultTransition: { speed: 0, rotation: false },
        plugins: [
          GyroscopePlugin.withConfig({
            // El dedo lo maneja el viewer (o el remap de force-landscape); el gyro no debe pelear.
            touchmove: false,
            roll: false,
            absolutePosition: false,
            moveMode: 'smooth',
          }),
          MarkersPlugin.withConfig({}),
          VirtualTourPlugin.withConfig({
            dataMode: 'client',
            positionMode: 'manual',
            renderMode: '3d',
            nodes: openingNodes,
            startNodeId: scene.startNodeId,
            preload: false,
            showLinkTooltip: true,
            getLinkTooltip: (_content, _link, node) => translateTourText(node.name ?? '', localeRef.current),
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
        const url = typeof node.panorama === 'string' ? node.panorama : ''
        if (url && (!shownPanoRef.current || url === desiredPanoRef.current)) {
          shownPanoRef.current = url
          currentUrlRef.current = url
          revealTourRef.current(url)
        }
        applyTourMarkersRef.current()
        requestAnimationFrame(() => applyTourMarkersRef.current())
      })

      const stepDownPanorama = () => {
        const failed = currentUrlRef.current
        const next = smallerTourUrl(failed)
        if (!next || next === failed || triedPanoRef.current.has(next)) return
        triedPanoRef.current.add(next)
        const requested = steppedPanoRef.current?.requested || panoRequestRef.current || failed
        steppedPanoRef.current = { requested, shown: next }
        currentUrlRef.current = next
        desiredPanoRef.current = next
        shownPanoRef.current = ''
        setPanoRevealed(false)
        void viewer.setPanorama(next, { showLoader: false, transition: false }).then(() => {
          if (currentUrlRef.current !== next) return
          shownPanoRef.current = next
          revealTourRef.current(next)
        }).catch(() => {
          setPanoRevealed(false)
        })
      }
      viewer.addEventListener(events.PanoramaErrorEvent.type, stepDownPanorama)
      let restoreTimer = 0
      viewer.container.addEventListener('webglcontextlost', (event) => {
        event.preventDefault()
        setPanoRevealed(false)
        if (restoreTimer) window.clearTimeout(restoreTimer)
        restoreTimer = window.setTimeout(() => {
          restoreTimer = 0
          try {
            sessionStorage.setItem('lavilet-tour-360-failed', '1')
          } catch {
            /* ignore */
          }
          const smaller = smallerTourUrl(currentUrlRef.current) || currentUrlRef.current
          if (smaller) desiredPanoRef.current = smaller
          const dying = viewerRef.current
          viewerRef.current = null
          tourRef.current = null
          disposeTourViewer(dying, container)
          setViewerMounted(false)
          mountTourViewer()
        }, 2000)
      })
      viewer.container.addEventListener('webglcontextrestored', () => {
        if (restoreTimer) {
          window.clearTimeout(restoreTimer)
          restoreTimer = 0
        }
        const recovering = currentUrlRef.current
        if (!recovering) return
        shownPanoRef.current = ''
        setPanoRevealed(false)
        void viewer.setPanorama(recovering, { showLoader: false, transition: false }).then(() => {
          if (currentUrlRef.current !== recovering) return
          shownPanoRef.current = recovering
          revealTourRef.current(recovering)
        }).catch(() => {
          stepDownPanorama()
        })
      })

      viewer.addEventListener(events.PanoramaLoadedEvent.type, () => {
        const panorama = viewer.config.panorama
        const url = typeof panorama === 'string' ? panorama : currentUrlRef.current
        if (!url) return
        shownPanoRef.current = url
        currentUrlRef.current = url
        preloadedRef.current.add(url)
        revealTourRef.current(url)
      })

      viewer.addEventListener(
        events.ReadyEvent.type,
        () => {
          const panorama = viewer.config.panorama
          const url = typeof panorama === 'string' ? panorama : ''
          if (url) {
            shownPanoRef.current = url
            currentUrlRef.current = url
            revealTourRef.current(url)
          }
          if (viewModeRef.current === 'tour') preloadCurrentRoom(viewer, startNode.id, openingUrl)
          if (!cancelled) setShowroomReady(true)
        },
        { once: true },
      )
      const queued = pendingPreloadUrlRef.current
      pendingPreloadUrlRef.current = null
      if (queued && queued !== openingUrl) {
        void viewer.textureLoader.preloadPanorama(queued).then(() => {
          preloadedRef.current.add(queued)
        }).catch(() => undefined)
      }
      setViewerMounted(true)
      }
      mountTourViewerRef.current = mountTourViewer
      if (viewModeRef.current === 'tour') mountTourViewer()
      else {
        setBooting(false)
        if (!cancelled) setShowroomReady(true)
      }
    }

    void boot().catch((error) => {
      console.error(error)
      if (!cancelled) {
        setBootError('No se pudo cargar el showroom. Revisa la conexión e intenta de nuevo.')
        setBooting(false)
      }
    })

    const onPageHide = () => {
      // Recarga / cambio de tab en iOS: soltar WebGL YA (no esperar al unmount de React).
      const v = viewerRef.current
      viewerRef.current = null
      tourRef.current = null
      disposeTourViewer(v, containerRef.current)
      clearTourDomFlags()
    }
    // Si Safari restaura desde bfcache tras pagehide, el canvas ya no sirve → recargar limpio.
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload()
    }
    window.addEventListener('pagehide', onPageHide)
    window.addEventListener('freeze', onPageHide as EventListener)
    window.addEventListener('pageshow', onPageShow)

    return () => {
      cancelled = true
      switchTokenRef.current += 1
      window.removeEventListener('pagehide', onPageHide)
      window.removeEventListener('freeze', onPageHide as EventListener)
      window.removeEventListener('pageshow', onPageShow)
      const v = viewerRef.current
      viewerRef.current = null
      tourRef.current = null
      disposeTourViewer(v, containerRef.current)
      // Si el root quedó colgado en body (immersive), devolverlo / limpiar flags.
      const root = rootRef.current
      const slot = slotRef.current
      if (root && slot && root.parentElement === document.body) {
        try {
          slot.appendChild(root)
        } catch {
          /* ignore */
        }
      }
      clearTourDomFlags()
      html.style.overflow = prevHtmlOverflow
      body.style.overflow = prevBodyOverflow
      html.style.overscrollBehavior = prevHtmlOverscroll
      body.style.overscrollBehavior = prevBodyOverscroll
    }
  }, [embedded, preloadCurrentRoom])

  useEffect(() => {
    if (viewMode !== 'tour') {
      setPanoRevealed(false)
      if (window.matchMedia('(pointer: coarse)').matches) {
        const viewer = viewerRef.current
        viewerRef.current = null
        tourRef.current = null
        disposeTourViewer(viewer, containerRef.current)
        setViewerMounted(false)
      }
      return
    }
    mountTourViewerRef.current?.()
  }, [viewMode])

  useEffect(() => {
    if (!showroomReady) return
    if (window.matchMedia('(pointer: coarse)').matches) return
    if (isIOSWebKit() && shellMode !== 'unit') return
    let timer = 0
    let idleId = 0
    const run = () => mountTourViewerRef.current?.()
    if (typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(run, { timeout: 1500 })
    } else {
      timer = window.setTimeout(run, 1500)
    }
    return () => {
      if (idleId) window.cancelIdleCallback(idleId)
      if (timer) window.clearTimeout(timer)
    }
  }, [showroomReady, shellMode])

  useEffect(() => {
    let cancelled = false
    void fetch('/api/tour/catalog', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: TourPublicCatalog | null) => {
        if (cancelled || !data) return
        setPublicCatalog(data)
        if (data.finishes?.length) {
          setFinish((prev) => (prev && data.finishes.some((item) => item.slug === prev) ? prev : data.finishes[0].slug))
        }
      })
      .catch((error) => console.error(error))
    return () => {
      cancelled = true
    }
  }, [])

  const selectedCatalogUnit=publicCatalog?.units.find(u=>u.id===selectedUnitId)
  const currentTypology: TourTypologyOption | undefined = selectedCatalogUnit
    ? publicCatalog?.typologies.find(item=>item.id===selectedCatalogUnit.unit_type_id)
    : publicCatalog?.typologies.find(item=>item.code===selectedTypology)
  const onFinish = (slug: string) => {
    if (slug === finish) return
    const finishes = publicCatalog?.finishes?.length ? publicCatalog.finishes : catalog?.finishes ?? []
    const source = (viewMode === 'galeria' ? currentTypology?.vistas : currentTypology?.rooms) ?? []
    const lookup = finishLookupSlugRef.current || room
    const entry = source.find((item) => item.slug === lookup) ?? source.find((item) => roomsShareSlot(item.slug, lookup))
    if (!hasBothFinishesForRoom(entry, finishes, light)) return
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

  const onLight = (nextLight?: TourLightMode) => {
    const next: TourLightMode = nextLight ?? (light === 'dia' ? 'noche' : 'dia')
    if (next === light) return
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
        area_total_m2: item.area_total_m2 ?? total,
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
        unit_type_id: item.unit_type_id ?? undefined,
        category: item.category ?? null,
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
    const typ =
      publicCatalog?.typologies.find((item) => item.id === match.unit_type_id) ??
      publicCatalog?.typologies.find((item) => item.code === match.typology_code)
    preloadLeadGallery(typ, publicCatalog?.finishes)
    const floor = unitFloorNumber(match)
    if (floor != null) setPlanFloor(floor)
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

  // Interés comercial: consulta de ficha de unidad concreta (mapa Marketing).
  useEffect(() => {
    if (!fichaOpen || !selectedUnit?.id) {
      if (!fichaOpen) consultUnitLoggedRef.current = null
      return
    }
    const key = selectedUnit.id
    if (consultUnitLoggedRef.current === key) return
    consultUnitLoggedRef.current = key
    logTourEvent({
      event_type: 'consultar_unidad',
      typology_code: selectedUnit.typology_code || selectedTypology || null,
      unit_type_id: currentTypology?.id ?? null,
      metadata: {
        unit_id: selectedUnit.id,
        unit_number: selectedUnit.unit_number,
        action: 'ficha',
      },
    })
  }, [
    fichaOpen,
    selectedUnit?.id,
    selectedUnit?.unit_number,
    selectedUnit?.typology_code,
    selectedTypology,
    currentTypology?.id,
  ])

  const compareUnitB = useMemo(
    () => allUnits.find((item) => item.id === compareUnitBId) ?? null,
    [allUnits, compareUnitBId],
  )

  const comparePreviewsB = useMemo(() => {
    if (!compareUnitB) return []
    const code = compareUnitB.typology_code || ''
    const typ =
      publicCatalog?.typologies?.find((item) => item.code === code) ??
      (code === selectedTypology ? currentTypology : null)
    return buildGaleriaStills(typ, publicCatalog?.finishes, {
      randomPerRoom: true,
      seed: compareGaleriaSeedB,
    }).map((item) => ({
      id: item.id,
      label: item.label,
      url: item.url,
    }))
  }, [
    compareUnitB,
    publicCatalog,
    currentTypology,
    selectedTypology,
    compareGaleriaSeedB,
  ])

  const fichaUnits = useMemo(() => {
    if (selectedUnit) return [selectedUnit]
    return displayUnits
  }, [selectedUnit, displayUnits])

  const showPlanShell = shellMode === 'plan'
  const showUnitChrome = shellMode === 'unit'

  const ensureUnitForTools = useCallback(() => {
    if (selectedUnitId) return
    const first = displayUnits[0]
    if (!first) return
    setSelectedUnitId(first.id)
    writeUnitQueryParam(first.unit_number)
  }, [selectedUnitId, displayUnits])

  const openSimulatorTool = useCallback(() => {
    setFichaOpen(false)
    setFichaExpanded(false)
    ensureUnitForTools()
    setSimulatorEntry({ mode: 'cash', section: 'rent' })
    if (!canAccessShowroomTools()) {
      setPhoneUnlock({ open: true, intent: 'simulator' })
      return
    }
    setSimulatorOpen(true)
  }, [ensureUnitForTools])

  const openFinancingTool = useCallback(() => {
    setFichaOpen(false)
    setFichaExpanded(false)
    ensureUnitForTools()
    setSimulatorEntry({ mode: 'financed', section: 'financing' })
    if (!canAccessShowroomTools()) {
      setPhoneUnlock({ open: true, intent: 'financing' })
      return
    }
    setSimulatorOpen(true)
  }, [ensureUnitForTools])

  const handlePhoneUnlocked = useCallback((intent: TourPhoneUnlockIntent) => {
    setShowroomIdentified(true)
    if (intent === 'simulator') {
      setSimulatorEntry({ mode: 'cash', section: 'rent' })
      setSimulatorOpen(true)
      return
    }
    setSimulatorEntry({ mode: 'financed', section: 'financing' })
    setSimulatorOpen(true)
  }, [])
  const galleryOnly =
    isGalleryOnlyTypology(currentTypology) ||
    normalizeUnitCategory(selectedUnit?.category) === 'local'
  const catalogFinishes = publicCatalog?.finishes?.length
    ? publicCatalog.finishes
    : catalog?.finishes ?? []
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
  tourMarkersRef.current = {
    viewMode,
    room,
    rooms: tourRooms,
    hotspots: currentTypology?.hotspots ?? [],
    homeSlug,
  }
  applyTourMarkersRef.current = () => {
    const viewer = viewerRef.current
    if (!viewer) return
    const markers = viewer.getPlugin<MarkersPlugin>(MarkersPlugin)
    const snap = tourMarkersRef.current
    markers?.setMarkers(buildTourMarkers(snap.viewMode, snap.room, snap.rooms, snap.hotspots, snap.homeSlug, localeRef.current))
  }

  useEffect(() => {
    if (!galleryOnly || shellMode !== 'unit') return
    if (viewMode !== 'galeria') setViewMode('galeria')
    if (compareOpen) setCompareOpen(false)
    if (finishCompareOpen) setFinishCompareOpen(false)
    if (terminacionesFocus) setTerminacionesFocus(false)
    if (navChooserOpen) setNavChooserOpen(false)
  }, [galleryOnly, shellMode, viewMode, compareOpen, finishCompareOpen, terminacionesFocus, navChooserOpen])

  const photoBySlug = useMemo(() => {
    const map: Record<string, string | null> = {}
    for (const item of tourRooms) {
      const roomItem =
        currentTypology?.rooms.find((entry) => entry.slug === item.slug) ??
        currentTypology?.rooms.find((entry) => roomsShareSlot(entry.slug, item.slug) && entry.url)
      const scene = pickRoomScene(roomItem?.scenes, finish || null, light)
      const picked = pickSceneUrl(scene, catalogWidthRef.current, { coarse: entryCoarse })
      map[item.slug] = picked ?? (entryCoarse ? tourCoarsePanoUrl(roomItem?.url) : roomItem?.url ?? null)
    }
    return map
  }, [tourRooms, currentTypology, finish, light, entryCoarse])

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
    { coarse: entryCoarse },
  )
  const activePanoUrl = urlForRoom(room) ?? (room === homeSlug ? typologyPanoUrl : null)
  const steppedLive = steppedPanoRef.current
  desiredPanoRef.current =
    steppedLive && activePanoUrl && steppedLive.requested === activePanoUrl
      ? steppedLive.shown
      : activePanoUrl
  revealTourRef.current = (url: string) => {
    if (viewModeRef.current !== 'tour' || !url || desiredPanoRef.current !== url || shownPanoRef.current !== url) return
    requestAnimationFrame(() => {
      if (viewModeRef.current !== 'tour' || desiredPanoRef.current !== url || shownPanoRef.current !== url) return
      setPanoRevealed(true)
      setPanoFailed(false)
      try {
        sessionStorage.removeItem('lavilet-tour-360-failed')
      } catch {
        /* ignore */
      }
    })
  }

  const queuePanoPreload = useCallback((url: string | null | undefined) => {
    if (!url || preloadedRef.current.has(url) || preloadingRef.current.has(url)) return
    const viewer = viewerRef.current
    if (!viewer) {
      pendingPreloadUrlRef.current = url
      return
    }
    preloadingRef.current.add(url)
    void viewer.textureLoader.preloadPanorama(url).then(() => {
      preloadedRef.current.add(url)
    }).catch(() => undefined).finally(() => {
      preloadingRef.current.delete(url)
    })
  }, [])

  const preloadTourEntry = useCallback(() => {
    const fromCatalog = pickCatalogPanoUrl(
      currentTypology?.panorama,
      targetWidthRef.current,
      finish || null,
      light,
      { coarse: entryCoarse },
    )
    const fromRoom = urlForRoom(homeSlug)
    queuePanoPreload(fromCatalog)
    if (fromRoom && fromRoom !== fromCatalog) queuePanoPreload(fromRoom)
  }, [currentTypology?.panorama, finish, light, homeSlug, urlForRoom, queuePanoPreload, entryCoarse])

  useEffect(() => {
    if (shellMode !== 'unit') return
    if (window.matchMedia('(pointer: coarse)').matches) return
    preloadTourEntry()
  }, [shellMode, selectedUnitId, selectedTypology, viewerMounted, preloadTourEntry])

  const compareTypologyB = useMemo(() => {
    if (!compareUnitB) return null
    const code = (compareUnitB.typology_code || '').trim()
    const typeId = compareUnitB.unit_type_id ?? null
    const typologies = publicCatalog?.typologies ?? []
    return (
      (typeId ? typologies.find((item) => item.id === typeId) : null) ??
      typologies.find((item) => item.code === code) ??
      typologies.find((item) => item.code.toLowerCase() === code.toLowerCase()) ??
      typologies.find((item) => item.name === code) ??
      (code && code === selectedTypology ? currentTypology : null) ??
      null
    )
  }, [compareUnitB, publicCatalog, selectedTypology, currentTypology])

  const compareHotspotsB = useMemo(() => {
    const own = compareTypologyB?.hotspots ?? []
    const sameAsA =
      Boolean(currentTypology) &&
      (compareTypologyB?.id === currentTypology?.id ||
        compareTypologyB?.code === currentTypology?.code ||
        (!compareTypologyB && (compareUnitB?.typology_code || '') === selectedTypology))
    const placed = own.length > 0 ? own : sameAsA ? (currentTypology?.hotspots ?? []) : []
    const shown = compareRoomB || room
    return placed.filter((item) => item.from === shown)
  }, [compareTypologyB, compareUnitB, currentTypology, selectedTypology, room, compareRoomB])

  const comparePanoBUrl = useMemo(() => {
    if (!compareUnitB) return null

    const typ = compareTypologyB
    const code = (compareUnitB.typology_code || '').trim()

    // Misma tipología que A: reutilizar el 360 que ya se ve a la izquierda.
    const sameAsA =
      Boolean(currentTypology) &&
      (typ?.id === currentTypology?.id ||
        typ?.code === currentTypology?.code ||
        (!typ && (!code || code === selectedTypology)))
    const roomShownByB = compareRoomB || room
    if (sameAsA && !compareRoomB && activePanoUrl) return activePanoUrl

    if (!typ) {
      // Último recurso: si no encontramos tipología B, no dejar el panel vacío.
      return activePanoUrl
    }

    const rooms = typ.rooms ?? []
    const sideWidth = 2048 as TourWidth

    const urlFromScenes = (
      scenes: (typeof rooms)[number]['scenes'] | undefined,
      roomUrl?: string | null,
    ) => {
      if (!scenes?.length) return roomUrl ?? null
      const scene = pickRoomScene(scenes, finish || null, light)
      return (
        pickSceneUrl(scene, sideWidth, { coarse: entryCoarse }) ??
        (entryCoarse ? tourCoarsePanoUrl(roomUrl) : roomUrl ?? scenes[0]?.url ?? null)
      )
    }

    const urlForSlug = (slug: string | null | undefined) => {
      if (!slug) return null
      const roomItem =
        rooms.find((entry) => entry.slug === slug) ??
        rooms.find((entry) => roomsShareSlot(entry.slug, slug) && (entry.url || entry.scenes.length)) ??
        rooms.find((entry) => roomsShareFamily(entry.slug, slug) && (entry.url || entry.scenes.length))
      if (!roomItem) return null
      return urlFromScenes(roomItem.scenes, roomItem.url)
    }

    const homeOfB = tourHomeSlug(rooms.map((item) => ({ slug: item.slug, label: item.label })))

    return (
      urlForSlug(roomShownByB) ??
      urlForSlug(homeOfB) ??
      urlForSlug(homeSlug) ??
      pickCatalogPanoUrl(typ.panorama, sideWidth, finish || null, light, { coarse: entryCoarse }) ??
      pickCatalogPanoUrl(typ.panorama, sideWidth, undefined, undefined, { coarse: entryCoarse }) ??
      rooms.map((item) => urlFromScenes(item.scenes, item.url)).find(Boolean) ??
      activePanoUrl ??
      null
    )
  }, [
    compareUnitB,
    compareTypologyB,
    currentTypology,
    finish,
    light,
    room,
    homeSlug,
    activePanoUrl,
    entryCoarse,
    compareRoomB,
  ])

  useEffect(() => {
    setCompareRoomB(null)
  }, [compareUnitB?.id, room])

  const isPanoRoom = viewMode === 'tour'
  const isComparador = compareOpen
  const isFinishCompare = finishCompareOpen
  const terminacionesUiOpen = terminacionesFocus || isFinishCompare
  const compareContentMode = viewMode === 'galeria' ? 'galeria' : 'tour'
  const syncCompareCameras =
    isFinishCompare || (isComparador && compareContentMode === 'tour' && Boolean(compareUnitB))

  useEffect(() => {
    if (isComparador || isFinishCompare) setVoiceAssistOpen(false)
  }, [isComparador, isFinishCompare])

  useEffect(() => {
    if (!syncCompareCameras) return
    const viewer = viewerRef.current
    if (!viewer) return

    const posesCloseLive = (a: ComparePanoPose, b: ComparePanoPose) =>
      Math.abs(a.yaw - b.yaw) < 0.0008 &&
      Math.abs(a.pitch - b.pitch) < 0.0008 &&
      Math.abs(a.zoom - b.zoom) < 0.15

    const read = (): ComparePanoPose => {
      const pos = viewer.getPosition()
      return { yaw: pos.yaw, pitch: pos.pitch, zoom: viewer.getZoomLevel() }
    }

    /** Cada frame: solo la ref (el lado B la lee en su before-render). */
    const pushLive = () => {
      if (comparePoseLockRef.current === 'side') return
      const next = read()
      const prev = comparePoseLiveRef.current
      if (prev && posesCloseLive(prev, next)) return
      comparePoseLiveRef.current = next
    }

    const publish = () => {
      if (comparePoseLockRef.current === 'side') return
      comparePoseLiveRef.current = read()
    }

    const commit = () => {
      const next = comparePoseLiveRef.current
      if (next) setComparePose(next)
    }

    viewer.addEventListener('position-updated', publish)
    viewer.addEventListener('zoom-updated', publish)
    viewer.addEventListener('before-render', pushLive)
    viewer.container.addEventListener('pointerup', commit)
    viewer.container.addEventListener('pointercancel', commit)
    publish()
    commit()
    return () => {
      viewer.removeEventListener('position-updated', publish)
      viewer.removeEventListener('zoom-updated', publish)
      viewer.removeEventListener('before-render', pushLive)
      viewer.container.removeEventListener('pointerup', commit)
      viewer.container.removeEventListener('pointercancel', commit)
      if (comparePoseRafRef.current) cancelAnimationFrame(comparePoseRafRef.current)
    }
  }, [syncCompareCameras, compareUnitB, viewMode, room, finish, finishRight])

  const onCompareSidePoseChange = useCallback((pose: ComparePanoPose) => {
    if (comparePoseLockRef.current === 'main') return
    comparePoseLockRef.current = 'side'
    comparePoseLiveRef.current = pose
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

  const commitComparePose = useCallback(() => {
    const next = comparePoseLiveRef.current
    if (next) setComparePose(next)
  }, [])
  const galleryFinishSlug = finish || catalogFinishes[0]?.slug || null
  const galeriaImages = useMemo(
    () =>
      buildGaleriaStills(currentTypology, catalogFinishes, {
        finish: galleryOnly ? null : galleryFinishSlug,
        light: galleryOnly ? null : light,
        strict: !galleryOnly,
        roomLabelOnly: !galleryOnly,
        rendersOnly: galleryOnly,
      }).map((item) => ({
        id: item.id,
        label: item.label,
        url: item.url,
        roomSlug: item.roomSlug,
      })),
    [currentTypology, catalogFinishes, galleryFinishSlug, light, galleryOnly],
  )
  const leadGalleryUrl = galeriaImages[0]?.url ?? null
  useLayoutEffect(() => {
    if (leadGalleryUrl) void preloadStill(leadGalleryUrl)
  }, [leadGalleryUrl])
  const galleryPhoto =
    galeriaImages[Math.min(galeriaIndex, Math.max(galeriaImages.length - 1, 0))]
  const finishLookupSlug = viewMode === 'galeria' ? galleryPhoto?.roomSlug || room : room
  finishLookupSlugRef.current = finishLookupSlug
  const finishSource = (viewMode === 'galeria' ? currentTypology?.vistas : currentTypology?.rooms) ?? []
  const finishRoom =
    finishSource.find((item) => item.slug === finishLookupSlug) ??
    finishSource.find((item) => roomsShareSlot(item.slug, finishLookupSlug))
  const terminacionesReady = hasBothFinishesForRoom(finishRoom, catalogFinishes, light)
  const modeButtons = modeButtonsForView({
    shellMode,
    viewMode,
    terminacionesFocus,
    galleryOnly,
    showTerminaciones: terminacionesReady,
  })

  useEffect(() => {
    if (terminacionesReady) return
    if (terminacionesFocus) setTerminacionesFocus(false)
    if (finishCompareOpen) setFinishCompareOpen(false)
  }, [terminacionesReady, terminacionesFocus, finishCompareOpen])
  const galleryPanelRooms = useMemo(() => {
    const seen = new Set<string>()
    const rooms: { slug: string; label: string }[] = []
    for (const item of galeriaImages) {
      if (!item.roomSlug || seen.has(item.roomSlug)) continue
      seen.add(item.roomSlug)
      rooms.push({ slug: item.roomSlug, label: item.label })
    }
    return rooms
  }, [galeriaImages])
  const galleryFinishOptions = useMemo(
    () =>
      catalogFinishes.map((item, index) => {
        const look = galleryFinishPresentation(item.slug, index)
        return { slug: item.slug, name: look.name, color: look.color }
      }),
    [catalogFinishes],
  )

  const galeriaImagesAll = useMemo(
    () =>
      buildGaleriaStills(currentTypology, publicCatalog?.finishes, {
        allScenes: true,
        rendersOnly: galleryOnly,
      }).map((item) => ({
        id: item.id,
        label: item.label,
        url: item.url,
      })),
    [currentTypology, publicCatalog?.finishes, galleryOnly],
  )

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

  const fichaImages = useMemo(
    () =>
      galeriaImagesAll.map((item) => ({
        id: item.id,
        label: item.label,
        url: item.url,
        kind: 'vista' as const,
      })),
    [galeriaImagesAll],
  )

  const warmTypologyStills = useCallback(
    (unit: TourUnitSummary) => {
      const code = (unit.typology_code || '').trim()
      const typeId = unit.unit_type_id ?? null
      const typologies = publicCatalog?.typologies ?? []
      const typ =
        (typeId ? typologies.find((item) => item.id === typeId) : null) ??
        typologies.find((item) => item.code === code) ??
        (code && code === selectedTypology ? currentTypology : null)
      if (!typ) return
      preloadLeadGallery(typ, publicCatalog?.finishes)
      const stills = buildGaleriaStills(typ, publicCatalog?.finishes, {
        allScenes: true,
        rendersOnly: isGalleryOnlyTypology(typ),
      })
      const urls = stills.map((item) => item.url)
      warmStills(urls.slice(0, 4))
    },
    [publicCatalog, selectedTypology, currentTypology],
  )

  useEffect(() => {
    if (!fichaOpen && shellMode !== 'unit') return
    if (leadGalleryUrl) void preloadStill(leadGalleryUrl)
    const urls = [
      ...fichaImages.map((item) => item.url),
      ...planoImages.map((item) => item.url),
    ]
    const index = Math.min(galeriaIndex, Math.max(urls.length - 1, 0))
    const priority = [leadGalleryUrl, urls[index], urls[index + 1], urls[index - 1], activePanoUrl]
    warmStills(urls, priority)
  }, [fichaOpen, shellMode, fichaImages, planoImages, galeriaIndex, activePanoUrl, leadGalleryUrl])

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

  const onCompareHotspotB = useCallback((pin: TourPlacedHotspot) => {
    if (pin.kind === 'look') {
      compareLookAtBRef.current?.(pin.yaw, pin.pitch)
      return
    }
    setCompareRoomB(pin.slug)
  }, [])

  const stillItems = isPlanosMode(viewMode) ? planoImages : viewMode === 'galeria' ? galeriaImages : []
  const stillIndex = isPlanosMode(viewMode) ? planoIndex : galeriaIndex
  const setStillIndex = isPlanosMode(viewMode) ? setPlanoIndex : setGaleriaIndex
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
  const stillScope = `${currentTypology?.id ?? ''}:${selectedUnitId ?? ''}`
  if (stillScopeRef.current !== stillScope) {
    stillScopeRef.current = stillScope
    lastStillRef.current = null
  }
  if (stillUrl) lastStillRef.current = stillUrl
  const overlayUrl = stillUrl ?? lastStillRef.current
  if (viewMode !== 'tour' && overlayUrl) coverStillRef.current = overlayUrl
  const tourCover = viewMode === 'tour' && !panoRevealed ? coverStillRef.current : null
  // En comparador/terminaciones el split es siempre 360, nunca stills.
  const showStill =
    Boolean(stillUrl) &&
    !isFinishCompare &&
    (!isComparador || compareContentMode === 'galeria')
  useEffect(() => {
    if (viewMode === 'galeria') return
    if (tourRooms.some((item) => item.slug === room)) return
    const aliased = resolveTourRoomSlug(room, tourRooms, (slug) => Boolean(urlForRoom(slug)))
    setRoom(aliased !== room && tourRooms.some((item) => item.slug === aliased) ? aliased : homeSlug)
  }, [tourRooms, room, homeSlug, urlForRoom, viewMode])

  useEffect(() => {
    if (galeriaImages.length === 0) {
      if (galeriaIndex !== 0) setGaleriaIndex(0)
      return
    }
    if (galeriaIndex >= galeriaImages.length) setGaleriaIndex(0)
  }, [galeriaImages.length, galeriaIndex])

  // Al cambiar tipología o entrar a galería: nuevo sorteo y la foto de la sala.
  const galleryOpenSalaRef = useRef(false)
  useEffect(() => {
    if (viewMode !== 'galeria') return
    galleryOpenSalaRef.current = true
    setGaleriaSeed(Math.floor(Math.random() * 1_000_000) + 1)
  }, [selectedTypology, viewMode])

  useEffect(() => {
    if (!isComparador || compareContentMode !== 'galeria') return
    setCompareGaleriaSeedB(Math.floor(Math.random() * 1_000_000) + 1)
    setComparePreviewIndex(0)
  }, [compareUnitBId, isComparador, compareContentMode])

  // Al cambiar acabado o luz, reubicar al mismo ambiente (no mezclar con otro combo).
  const galeriaRoomKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (viewMode === 'galeria' && galleryOpenSalaRef.current) {
      if (galeriaImages.length === 0) return
      galleryOpenSalaRef.current = false
      const sala = galeriaImages.findIndex((item) => (item.roomSlug || '').replace(/^vista-/, '') === 'sala')
      const index = sala >= 0 ? sala : 0
      const lead = galeriaImages[index]
      galeriaRoomKeyRef.current = lead?.roomSlug ?? lead?.id.split(':')[0] ?? 'sala'
      setGaleriaIndex(index)
      if (lead?.roomSlug && lead.roomSlug !== room) setRoom(lead.roomSlug)
      return
    }
    const current = galeriaImages[Math.min(galeriaIndex, Math.max(galeriaImages.length - 1, 0))]
    if (!current?.id) return
    galeriaRoomKeyRef.current = current.roomSlug ?? current.id.split(':')[0] ?? current.id
    if (viewMode === 'galeria' && current.roomSlug && current.roomSlug !== room) {
      setRoom(current.roomSlug)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al cambiar de slide
  }, [galeriaIndex, galeriaImages, viewMode])
  useEffect(() => {
    if (galeriaRoomKeyRef.current || galeriaImages.length === 0) return
    const first = galeriaImages[0]
    if (first?.id) galeriaRoomKeyRef.current = first.id.split(':')[0] ?? first.id
  }, [galeriaImages])

  useEffect(() => {
    if (viewMode !== 'galeria' || galeriaImages.length === 0) return
    const roomKey = galeriaRoomKeyRef.current
    if (!roomKey) return
    const matched = galeriaImages.findIndex(
      (item) => (item.roomSlug ?? item.id.split(':')[0] ?? item.id) === roomKey,
    )
    if (matched < 0) {
      setGaleriaIndex(0)
      return
    }
    setGaleriaIndex((prev) => (prev === matched ? prev : matched))
  }, [finish, light, galeriaImages, viewMode])

  // Comparador galería: lados independientes (no sincronizar slide B con A).
  useEffect(() => {
    if (comparePreviewsB.length === 0) {
      if (comparePreviewIndex !== 0) setComparePreviewIndex(0)
      return
    }
    if (comparePreviewIndex >= comparePreviewsB.length) setComparePreviewIndex(0)
  }, [comparePreviewsB.length, comparePreviewIndex])

  const compareBRoomKeyRef = useRef<string | null>(null)
  useEffect(() => {
    const current = comparePreviewsB[Math.min(comparePreviewIndex, Math.max(comparePreviewsB.length - 1, 0))]
    if (!current?.id) return
    compareBRoomKeyRef.current = current.id.split(':')[0] ?? current.id
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo al cambiar de slide B
  }, [comparePreviewIndex])
  useEffect(() => {
    if (compareBRoomKeyRef.current || comparePreviewsB.length === 0) return
    const first = comparePreviewsB[0]
    if (first?.id) compareBRoomKeyRef.current = first.id.split(':')[0] ?? first.id
  }, [comparePreviewsB])
  useEffect(() => {
    if (!isComparador || compareContentMode !== 'galeria' || comparePreviewsB.length === 0) return
    const roomKey = compareBRoomKeyRef.current
    if (!roomKey) return
    const matched = comparePreviewsB.findIndex((item) => (item.id.split(':')[0] ?? item.id) === roomKey)
    if (matched < 0) return
    setComparePreviewIndex((prev) => (prev === matched ? prev : matched))
  }, [comparePreviewsB, isComparador, compareContentMode])

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
      viewer.setOption('loadingTxt', '')
      applyTourMarkersRef.current()
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
  }, [booting, isPanoRoom, viewMode, tourRooms, onSelectRoom, currentTypology?.hotspots, room, homeSlug, locale])

  useEffect(() => {
    const viewer = viewerRef.current
    const root = rootRef.current
    if (!viewer || !root || booting) return
    const gyro = viewer.getPlugin<GyroscopePlugin>(GyroscopePlugin)
    if (!gyro) return
    stabilizeTourGyro(gyro)

    if (viewMode !== 'tour' || !isPanoRoom || tourNavMode !== 'gyro') {
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
            busy = false
            return
          }
          return gyro.start('smooth')
        })
        .catch(() => {
          busy = false
        })
        .finally(() => {
          busy = false
        })
    }
    // Arranque inmediato tras elegir giroscopio (el gesto del modal ya cuenta).
    start()
    root.addEventListener('click', start)
    root.addEventListener('touchend', start, { passive: true })
    return () => {
      root.removeEventListener('click', start)
      root.removeEventListener('touchend', start)
    }
  }, [booting, viewMode, isPanoRoom, tourNavMode])

  // Portrait + CSS rotate(90deg): remapar el dedo para que arriba/abajo coincidan con la vista.
  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || booting) return

    const needsRemap = forceLandscapeCss && viewMode === 'tour' && isPanoRoom
    try {
      viewer.setOption('mousemove', !needsRemap)
    } catch {
      /* viewer aún no listo */
    }

    if (!needsRemap) return

    const activeRef = { current: true }
    const detach = attachForceLandscapePan(viewer, {
      active: () => activeRef.current && forceLandscapeCss && viewMode === 'tour',
      speedMult: 1.35,
      inertia: 0.45,
    })
    return () => {
      activeRef.current = false
      detach()
      try {
        viewer.setOption('mousemove', true)
      } catch {
        /* ignore */
      }
    }
  }, [booting, forceLandscapeCss, viewMode, isPanoRoom])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || booting) return
    if (isIOSWebKit()) return
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

    const ios = isIOSWebKit()
    let resizeTimer: number | null = null
    const resize = () => {
      // Con force-landscape, autoSize en bucle (visualViewport) tumba Chrome/Safari.
      if (forceLandscapeCss) return
      if (resizeTimer != null) window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(() => {
        resizeTimer = null
        try {
          viewer?.autoSize()
        } catch {
          /* WebGL perdido en iOS */
        }
      }, ios ? 450 : 120)
    }

    const clearRootBox = () => {
        root.style.top = ''
        root.style.left = ''
        root.style.width = ''
        root.style.height = ''
    }

    const fitViewport = () => {
      // Con CSS force-landscape el layout lo define el rotate; no pelear con inline styles ni autoSize.
      if (forceLandscapeCss) {
        clearRootBox()
        return
      }
      if (!immersive) {
        clearRootBox()
        return
      }
      // iOS: al girar, innerWidth/Height son el viewport real. Evita 100dvh stale (plano/tour “compactados”).
      // No usamos visualViewport en bucle (tumba Safari); solo window resize/orientation.
      if (ios) {
        root.style.top = '0px'
        root.style.left = '0px'
        root.style.width = `${window.innerWidth}px`
        root.style.height = `${window.innerHeight}px`
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
    if (immersive || forceLandscapeCss) {
      // Debe ser hijo directo de body: globals.css oculta `body > *:not(.tour-root)`.
      if (root.parentElement !== document.body) document.body.appendChild(root)
      document.documentElement.classList.add('tour-is-immersive')
      document.documentElement.style.overflow = 'hidden'
      document.body.style.overflow = 'hidden'
      fitViewport()
      // Fullscreen + lock solo en landscape nativo (evita crash por pelear con CSS rotate).
      // iOS: ni fullscreen forzado (también tumba tabs con WebGL).
      if (!forceLandscapeCss && !ios) {
        void lockTourLandscape(root).finally(fitViewport)
      } else if (forceLandscapeCss) {
        // Un solo autoSize al entrar; nunca en cada resize del viewport.
        window.setTimeout(() => {
          try {
            viewer?.autoSize()
          } catch {
            /* ignore */
          }
        }, 160)
      } else if (ios) {
        // Tras girar el teléfono Safari tarda en reportar el tamaño final.
        window.setTimeout(() => {
          fitViewport()
          try {
            viewer?.autoSize()
          } catch {
            /* ignore */
          }
        }, 320)
      }
    } else {
      if (slot && root.parentElement !== slot) slot.appendChild(root)
      document.documentElement.classList.remove('tour-is-immersive')
      if (!ios) void leaveTourFullscreen().finally(resize)
      if (embedded) {
        document.documentElement.style.overflow = ''
        document.body.style.overflow = ''
      }
      fitViewport()
    }

    // Android/desktop: visualViewport. iOS: solo window (orientation/resize), sin visualViewport.
    if (!forceLandscapeCss && !ios) {
    window.visualViewport?.addEventListener('resize', fitViewport)
    window.visualViewport?.addEventListener('scroll', fitViewport)
    }

    const onIosOrient = () => {
      if (!ios || forceLandscapeCss || !immersive) return
      fitViewport()
      resize()
      window.setTimeout(() => {
        fitViewport()
        try {
          viewerRef.current?.autoSize()
        } catch {
          /* ignore */
        }
      }, 280)
      window.setTimeout(() => {
        fitViewport()
        try {
          viewerRef.current?.autoSize()
        } catch {
          /* ignore */
        }
      }, 700)
    }
    let iosOrientTimer: number | null = null
    const onIosOrientDebounced = () => {
      if (iosOrientTimer != null) window.clearTimeout(iosOrientTimer)
      // resize de barra URL: un solo fit; orientationchange dispara al instante abajo.
      iosOrientTimer = window.setTimeout(() => {
        iosOrientTimer = null
        onIosOrient()
      }, 120)
    }
    const onIosOrientationChange = () => {
      if (iosOrientTimer != null) window.clearTimeout(iosOrientTimer)
      iosOrientTimer = null
      onIosOrient()
    }
    if (ios && immersive && !forceLandscapeCss) {
      window.addEventListener('orientationchange', onIosOrientationChange)
      window.addEventListener('resize', onIosOrientDebounced)
      window.screen?.orientation?.addEventListener('change', onIosOrientationChange)
    }

    return () => {
      if (resizeTimer != null) window.clearTimeout(resizeTimer)
      if (iosOrientTimer != null) window.clearTimeout(iosOrientTimer)
      window.visualViewport?.removeEventListener('resize', fitViewport)
      window.visualViewport?.removeEventListener('scroll', fitViewport)
      window.removeEventListener('orientationchange', onIosOrientationChange)
      window.removeEventListener('resize', onIosOrientDebounced)
      window.screen?.orientation?.removeEventListener('change', onIosOrientationChange)
      clearRootBox()
      const slot = slotRef.current
      if (slot && root.parentElement !== slot) slot.appendChild(root)
      document.documentElement.classList.remove('tour-is-immersive')
      if (embedded) {
        document.documentElement.style.overflow = ''
        document.body.style.overflow = ''
      }
    }
  }, [immersive, forceLandscapeCss, embedded])

  // Al abrir en portrait: landscape visual por CSS (sin fullscreen: pelea con rotate y tumba el tab).
  useEffect(() => {
    if (!forceLandscapeCss) {
      document.documentElement.classList.remove('tour-is-force-landscape')
      return
    }
    document.documentElement.classList.add('tour-is-force-landscape')
    return () => {
      document.documentElement.classList.remove('tour-is-force-landscape')
    }
  }, [forceLandscapeCss])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || booting || !isPanoRoom || !activePanoUrl) {
      walkingRef.current = false
      setPanoEntering(false)
      setPanoLeaving(false)
      return
    }
    const url = activePanoUrl
    const stepped = steppedPanoRef.current
    const showingFallback = stepped?.requested === url && currentUrlRef.current === stepped.shown
    if (currentUrlRef.current === url || showingFallback) {
      walkingRef.current = false
      setPanoLeaving(false)
      applyTourMarkersRef.current()
      const visible = showingFallback ? stepped.shown : url
      if (shownPanoRef.current === visible) revealTourRef.current(visible)
      return
    }
    if (panoRequestRef.current !== url) {
      panoRequestRef.current = url
      triedPanoRef.current = new Set([url])
    }
    const token = ++switchTokenRef.current
    const look = walkToRef.current
    walkToRef.current = null
    const lookPromise = lookPromiseRef.current
    lookPromiseRef.current = null
    const changing = Boolean(currentUrlRef.current)

    const run = async () => {
      setPanoEntering(false)
      setPanoLeaving(false)
      setPanoGhost(null)

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
        if (!preloadedRef.current.has(url)) {
          setLoading(true)
          try {
            await Promise.race([
              viewer.textureLoader.preloadPanorama(url).then(() => {
                preloadedRef.current.add(url)
              }),
              sleep(2500),
            ])
          } catch {
            /* el fade usa lo que haya */
          }
          if (token !== switchTokenRef.current) {
            setLoading(false)
            return
          }
        }
      }

      setLoading(true)
      const candidates = [url, ...panoramaFallbackUrls(url)]
      let shownUrl = ''
      for (const candidate of candidates) {
        if (token !== switchTokenRef.current) break
        if (candidate !== url && triedPanoRef.current.has(candidate)) continue
        triedPanoRef.current.add(candidate)
        try {
          await viewer.setPanorama(candidate, {
            showLoader: false,
            transition: changing && candidate === url ? { effect: 'fade', speed: 400, rotation: false } : false,
            zoom: 0,
          })
          shownUrl = candidate
          break
        } catch {
          /* la siguiente pasada usa la resolución menor */
        }
      }
      if (token === switchTokenRef.current) setLoading(false)

      if (token !== switchTokenRef.current) {
        walkingRef.current = false
        setPanoLeaving(false)
        setPanoGhost(null)
        return
      }
      if (!shownUrl) {
        walkingRef.current = false
        setPanoLeaving(false)
        setPanoEntering(false)
        setPanoGhost(null)
        setPanoRevealed(false)
        setPanoFailed(true)
        try {
          sessionStorage.setItem('lavilet-tour-360-failed', '1')
        } catch {
          /* ignore */
        }
        return
      }
      if (shownUrl === url) steppedPanoRef.current = null
      else steppedPanoRef.current = { requested: url, shown: shownUrl }
      currentUrlRef.current = shownUrl
      desiredPanoRef.current = shownUrl
      shownPanoRef.current = shownUrl
      appliedPanoKeyRef.current = `${selectedTypology}:${url}`
      viewer.needsUpdate()
      walkingRef.current = false
      applyTourMarkersRef.current()
      revealTourRef.current(shownUrl)
      const neighborUrls = (currentTypology?.hotspots ?? [])
        .filter((item) => item.from === room && item.kind !== 'look' && item.slug !== room)
        .map((item) => urlForRoom(item.slug))
        .filter((item): item is string => Boolean(item))
      preloadUrls(viewer, neighborUrls)
      setPanoLeaving(false)
        setPanoEntering(false)
        setPanoGhost(null)
    }

    void run()
  }, [booting, isPanoRoom, activePanoUrl, selectedTypology, viewMode, room, tourRooms, currentTypology?.hotspots, homeSlug, urlForRoom, preloadUrls])

  useEffect(() => {
    const viewer = viewerRef.current
    if (!viewer || booting || !isPanoRoom || currentUrlRef.current !== activePanoUrl) return
    const urls = (currentTypology?.hotspots ?? [])
      .filter((item) => item.from === room && item.kind !== 'look' && item.slug !== room)
      .map((item) => urlForRoom(item.slug))
      .filter((item): item is string => Boolean(item))
    preloadUrls(viewer, urls)
  }, [booting, isPanoRoom, activePanoUrl, room, urlForRoom, currentTypology?.hotspots, preloadUrls])

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

  const sceneFinishes = publicCatalog?.finishes?.length
    ? publicCatalog.finishes
    : catalog?.finishes ?? []
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
        return pickSceneUrl(exact, sideWidth, { coarse: entryCoarse }) ?? pickSceneUrl(exact, catalogWidthRef.current, { coarse: entryCoarse })
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
          return pickSceneUrl(other, sideWidth, { coarse: entryCoarse }) ?? pickSceneUrl(other, catalogWidthRef.current, { coarse: entryCoarse })
        }
      }
      return pickSceneUrl(matched, sideWidth, { coarse: entryCoarse }) ?? pickSceneUrl(matched, catalogWidthRef.current, { coarse: entryCoarse })
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
      { coarse: entryCoarse },
    )
    if (fromPano) return fromPano

    // Último recurso: cualquier escena de la tipología con ese acabado
    for (const entry of currentTypology?.rooms ?? []) {
      const found = resolveFromScenes(entry.scenes)
      if (found) return found
    }
    return null
  }, [isFinishCompare, finishRightOption, currentTypology, room, light, homeSlug, finish, entryCoarse])

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
      lang={locale}
      className={cn(
        'tour-root overflow-hidden bg-black overscroll-none',
        immersive && 'is-immersive',
        forceLandscapeCss && 'tour-force-landscape',
        immersive || !embedded || forceLandscapeCss
          ? 'fixed inset-0 z-[200] h-auto w-auto'
          : 'relative h-full w-full',
      )}
    >
      {showUnitChrome && selectedUnit && (!currentTypology || (isPlanosMode(viewMode) && !stillUrl))?<div className="absolute inset-0 z-[12] flex items-center justify-center bg-[#29251e] p-8 text-center text-sm text-[#f7f3ee]">{t("La unidad ")}{t(selectedUnit.unit_number)} {t(" aún no tiene un recurso disponible para esta vista.")}</div>:null}
      <ShowroomMenu units={allUnits} catalog={publicCatalog} selected={selectedUnit} root={rootRef}
        hidden={fichaOpen}
        hideWebReturn={planEntryOpen}
        place={amenitiesOpen ? 'amenities' : shellMode === 'plan' ? 'home' : galleryOnly ? 'shops' : viewMode === 'tour' ? 'tour' : 'units'}
        onClosePanels={()=>{setFichaOpen(false);setSimulatorOpen(false);setVoiceAssistOpen(false)}}
        onHome={(view) => {
          setAmenitiesOpen(false)
          setEntryVideo(false)
          setDroneOn(false)
          setCoverHidden(false)
          setEntryExit(false)
          setAwaitPlanClose(false)
          entryFailedRef.current = false
          const drone = droneRef.current
          if (drone) {
            drone.pause()
            if (drone.readyState > 0) drone.currentTime = 0
          }
          setShellMode('plan')
          setViewMode('planos-3d')
          setPlanFloor(openingPlanFloor)
          const reopen = view !== 'plan'
          if (reopen && entryCoarse) setCoverReady(false)
          setPlanEntryOpen(reopen)
          setFichaOpen(false)
          setFichaExpanded(false)
          setCompareOpen(false)
          setFinishCompareOpen(false)
          setSimulatorOpen(false)
          setTerminacionesFocus(false)
          setVoiceAssistOpen(false)
          if (reopen) void coverVideoRef.current?.play().catch(() => undefined)
        }}
        onAmenities={()=>{setAmenitiesOpen(true);setFichaOpen(false);setCompareOpen(false);setFinishCompareOpen(false);setSimulatorOpen(false);setTerminacionesFocus(false);setVoiceAssistOpen(false)}}
        onPick={unit=>{setAmenitiesOpen(false);setSelectedUnitId(unit.id);if(unit.typology_code)setSelectedTypology(unit.typology_code);const floor=unitFloorNumber(unit);if(floor!=null)setPlanFloor(floor);setShellMode('unit');setViewMode('galeria');setCompareOpen(false);setFinishCompareOpen(false);setFichaExpanded(true);setFichaOpen(true);writeUnitQueryParam(unit.unit_number)}}
        onTour={unit=>{
          setAmenitiesOpen(false)
          setSelectedUnitId(unit.id)
          if(unit.typology_code)setSelectedTypology(unit.typology_code)
          const local = isGalleryOnlyTypology({ code: unit.typology_code, category: unit.category })
          setShellMode('unit')
          setCompareOpen(false)
          setFinishCompareOpen(false)
          writeUnitQueryParam(unit.unit_number)
          if (local) {
            setViewMode('galeria')
            setFichaOpen(false)
            setTerminacionesFocus(false)
            return
          }
          setViewMode('tour')
          setRoom(homeSlug)
          setFichaOpen(false)
          setTourNavMode(null)
          setNavChooserOpen(true)
        }}
      />
      <TourAmenitiesGallery open={amenitiesOpen} />
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
            'tour-pano-stage h-full w-full bg-transparent transition-opacity duration-300',
            viewMode === 'tour' ? 'opacity-100' : 'pointer-events-none opacity-0',
            panoLeaving && !showStill && !panoGhost && 'is-leaving',
            panoEntering && !showStill && 'is-entering',
          )}
        >
          <div
            ref={containerRef}
            className={cn('h-full w-full bg-transparent', (showStill || !panoRevealed) && 'pointer-events-none')}
          />
        </div>
        {panoGhost && !showStill ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={panoGhostKey}
            src={panoGhost}
            alt={t("")}
            className="tour-walk-out pointer-events-none absolute inset-0 z-[8] h-full w-full object-cover"
          />
        ) : null}

        {isComparador && compareContentMode === 'tour' ? (
          <p className="pointer-events-none absolute inset-x-0 bottom-16 z-[9] mx-auto hidden max-w-[90%] text-center text-[10px] font-medium tracking-[0.14em] text-white/80 uppercase sm:bottom-20 sm:block sm:text-[11px]">
            {t(" Haz clic y arrastra para mirar alrededor ")}</p>
        ) : null}
      </div>

      {isComparador ? (
        <TourComparador
          unitA={selectedUnit}
          unitB={compareUnitB}
          units={allUnits}
          contentMode={compareContentMode}
          panoBUrl={comparePanoBUrl}
          hotspotsB={compareHotspotsB}
          locale={locale}
          onHotspotB={onCompareHotspotB}
          previewsB={comparePreviewsB}
          previewIndexB={comparePreviewIndex}
          onPreviewIndexB={setComparePreviewIndex}
          split={compareSplit}
          onSplitChange={setCompareSplit}
          onSelectUnitB={(unit) => {
            setCompareUnitBId(unit.id)
            setCompareFinishB(finish || compareFinishB || '')
            setCompareLightB(light)
            setComparePreviewIndex(0)
          }}
          onSelectUnitA={(unit) => {
            setSelectedUnitId(unit.id)
            if (unit.typology_code) setSelectedTypology(unit.typology_code)
            writeUnitQueryParam(unit.unit_number)
            if (compareContentMode !== 'galeria') setViewMode('tour')
          }}
          onClearUnitB={() => {
            setCompareUnitBId(null)
            setComparePreviewIndex(0)
          }}
          onSwap={() => {
            if (!compareUnitB) return
            const prevA = selectedUnitId
            const prevFinishA = finish
            const prevLightA = light
            const prevIndexA = galeriaIndex
            setSelectedUnitId(compareUnitB.id)
            if (compareUnitB.typology_code) setSelectedTypology(compareUnitB.typology_code)
            setCompareUnitBId(prevA)
            if (compareContentMode === 'galeria') {
              setFinish(compareFinishB || finish)
              setLight(compareLightB)
              setCompareFinishB(prevFinishA)
              setCompareLightB(prevLightA)
              setGaleriaIndex(comparePreviewIndex)
              setComparePreviewIndex(prevIndexA)
            } else {
              setComparePreviewIndex(0)
            }
            setCompareSplit(50)
          }}
          onClose={() => {
            // Volver al depto de la izquierda (unidad A).
            if (selectedUnit) {
              setSelectedUnitId(selectedUnit.id)
              if (selectedUnit.typology_code) setSelectedTypology(selectedUnit.typology_code)
              writeUnitQueryParam(selectedUnit.unit_number)
            }
            setCompareOpen(false)
            setCompareUnitBId(null)
            setComparePreviewIndex(0)
            setCompareSplit(50)
            setShellMode('unit')
            setTerminacionesFocus(false)
            setFinishCompareOpen(false)
            setFichaOpen(false)
            setFichaExpanded(false)
            if (compareContentMode === 'galeria') {
              setViewMode('galeria')
            } else {
              setViewMode('tour')
              setRoom(homeSlug)
            }
          }}
          syncPose={syncCompareCameras ? comparePose : null}
          syncPoseRef={syncCompareCameras ? comparePoseLiveRef : undefined}
          onPoseChange={onCompareSidePoseChange}
          onPoseCommit={commitComparePose}
          lookAtRef={compareLookAtBRef}
          remapTouch={forceLandscapeCss}
          sceneControlsB={null}
        />
      ) : null}

      {isFinishCompare && finishLeftOption && finishRightOption ? (
        <TourFinishCompareOverlay
          left={{
            slug: finishLeftOption.slug,
            name: finishLeftOption.name,
            swatchUrl: null,
            label: `Acabado ${Math.max(1, sceneFinishes.findIndex((f) => f.slug === finishLeftOption.slug) + 1)}`,
          }}
          right={{
            slug: finishRightOption.slug,
            name: finishRightOption.name,
            swatchUrl: null,
            label: `Acabado ${Math.max(1, sceneFinishes.findIndex((f) => f.slug === finishRightOption.slug) + 1)}`,
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
          syncPoseRef={comparePoseLiveRef}
          onPoseChange={onCompareSidePoseChange}
          remapTouch={forceLandscapeCss}
        />
      ) : null}

      <div
        className={cn(
          'tour-layer-fade tour-still-layer absolute inset-0 z-10 overflow-hidden select-none',
          showStill || tourCover ? 'is-on' : 'pointer-events-none is-off',
          tourCover && !showStill && 'pointer-events-none',
          viewMode === 'tour' && 'is-handoff',
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
          key={stillScope}
          url={showStill ? overlayUrl : tourCover}
          alt={t(viewMode === 'tour' ? roomName : (stillItems[stillIndex]?.label ?? (isPlanosMode(viewMode) ? 'Plano' : 'Vista')))}
          contain={isPlanosMode(viewMode)}
          fit={isPlanosMode(viewMode) ? 'planos' : 'vistas'}
          lateralPan={viewMode === 'galeria'}
          zoom={viewMode === 'galeria' ? galleryZoom : undefined}
          onStep={stepStill}
        />
        {selectedUnit && showStill && !overlayUrl?<p className="pointer-events-none absolute bottom-3 left-1/2 z-10 max-w-[80%] -translate-x-1/2 rounded bg-black/70 px-3 py-1 text-center text-xs text-white">{t('Esta unidad no tiene un recurso disponible para esta vista.')}</p>:null}
        {viewMode !== 'tour' && stillItems.length > 1 && !fichaOpen ? (
          <>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                stepStill(-1)
              }}
              onPointerDown={(event) => event.stopPropagation()}
              className="pointer-events-auto absolute top-1/2 left-[max(0.4rem,env(safe-area-inset-left))] z-[2] flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white shadow-md ring-1 ring-white/25 backdrop-blur-sm transition hover:bg-black/60 sm:left-[max(0.5rem,env(safe-area-inset-left))] sm:h-11 sm:w-11"
              aria-label={t("Imagen anterior")}
            >
              <ChevronLeft size={20} strokeWidth={2} className="sm:hidden" />
              <ChevronLeft size={22} strokeWidth={2} className="hidden sm:block" />
            </button>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation()
                stepStill(1)
              }}
              onPointerDown={(event) => event.stopPropagation()}
              className={cn(
                'pointer-events-auto absolute top-1/2 z-[2] flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white shadow-md ring-1 ring-white/25 backdrop-blur-sm transition hover:bg-black/60 sm:h-11 sm:w-11',
                terminacionesUiOpen
                  ? 'right-[min(21rem,calc(100%-2.75rem))]'
                  : 'right-[max(0.4rem,env(safe-area-inset-right))] sm:right-[max(0.5rem,env(safe-area-inset-right))]',
              )}
              aria-label={t("Imagen siguiente")}
            >
              <ChevronRight size={20} strokeWidth={2} className="sm:hidden" />
              <ChevronRight size={22} strokeWidth={2} className="hidden sm:block" />
            </button>
          </>
        ) : null}
        {viewMode === 'galeria' && showStill && !fichaOpen ? (
          <div className="pointer-events-auto absolute bottom-[max(4.75rem,calc(env(safe-area-inset-bottom)+4rem))] left-[max(0.5rem,env(safe-area-inset-left))] z-[4] flex gap-2">
            <button
              type="button"
              aria-label={t('Alejar')}
              disabled={galleryZoom <= 1}
              onClick={() => setGalleryZoom((value) => Math.max(1, Math.round((value - 0.5) * 10) / 10))}
              onPointerDown={(event) => event.stopPropagation()}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-black/45 text-white shadow-md ring-1 ring-white/25 backdrop-blur-sm transition hover:bg-black/60 disabled:opacity-40"
            >
              <Minus size={18} strokeWidth={2.25} />
            </button>
            <button
              type="button"
              aria-label={t('Acercar')}
              disabled={galleryZoom >= 3}
              onClick={() => setGalleryZoom((value) => Math.min(3, Math.round((value + 0.5) * 10) / 10))}
              onPointerDown={(event) => event.stopPropagation()}
              className="flex h-11 w-11 items-center justify-center rounded-full bg-black/45 text-white shadow-md ring-1 ring-white/25 backdrop-blur-sm transition hover:bg-black/60 disabled:opacity-40"
            >
              <Plus size={18} strokeWidth={2.25} />
            </button>
          </div>
        ) : null}
        {viewMode === 'galeria' && stillItems[stillIndex]?.label ? (
          <div
            className={cn(
              'pointer-events-none absolute bottom-[max(1rem,calc(env(safe-area-inset-bottom)+0.75rem))] z-[3] flex justify-center px-3',
              !(isComparador && compareUnitB) && 'inset-x-0',
            )}
            style={
              isComparador && compareUnitB
                ? {
                    left: 0,
                    width: `${Math.max(12, Math.min(88, compareSplit))}%`,
                  }
                : undefined
            }
          >
            <div className="max-w-[min(100%,18rem)] truncate rounded-full bg-black/45 px-3.5 py-1.5 text-center text-[11px] font-semibold tracking-[0.12em] text-white uppercase shadow-md ring-1 ring-white/20 backdrop-blur-sm sm:text-[12px]">
              {t(stillItems[stillIndex]?.label)}
            </div>
          </div>
        ) : null}
      </div>

      {!booting && viewMode === 'tour' && panoFailed ? (
        <div className="pointer-events-none absolute inset-0 z-[12] flex flex-col items-center justify-center px-6 text-center">
          <p className="text-sm text-white">{t('No se pudo cargar la vista')}</p>
          <button
            type="button"
            className="pointer-events-auto mt-3 h-11 rounded-full bg-[#f7f3ee] px-5 text-[12px] font-semibold tracking-[0.14em] text-[#2B1A18] uppercase"
            onClick={() => {
              try {
                sessionStorage.removeItem('lavilet-tour-360-failed')
              } catch {
                /* ignore */
              }
              triedPanoRef.current.clear()
              setPanoFailed(false)
              setPanoRevealed(false)
              const dying = viewerRef.current
              viewerRef.current = null
              tourRef.current = null
              disposeTourViewer(dying, containerRef.current)
              setViewerMounted(false)
              const smaller = smallerTourUrl(desiredPanoRef.current) || desiredPanoRef.current
              if (smaller) desiredPanoRef.current = smaller
              mountTourViewerRef.current?.()
            }}
          >
            {t('Reintentar')}
          </button>
        </div>
      ) : null}

      {!booting && viewMode === 'tour' && !activePanoUrl && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black px-6 text-center">
          <p className="text-[13px] tracking-[0.16em] text-white/70 uppercase">{t("Falta el 360")}</p>
          <p className="mt-2 text-sm text-white/45">
            {t(roomName)}
          </p>
        </div>
      )}

      {!booting && viewMode === 'galeria' && galeriaImages.length === 0 && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black px-6 text-center">
          <p className="text-[13px] tracking-[0.16em] text-white/70 uppercase">{t("Galería")}</p>
          <p className="mt-2 text-sm text-white/45">{t("Aún no hay imágenes de galería en esta tipología.")}</p>
        </div>
      )}

      {!booting && isPlanosMode(viewMode) && planoImages.length === 0 && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-black px-6 text-center">
          <p className="text-[13px] tracking-[0.16em] text-white/70 uppercase">
            {t(viewMode === 'planos-3d' ? 'Planos 3D' : 'Planos 2D')}
          </p>
          <p className="mt-2 text-sm text-white/45">{t("Aún no hay planos en esta tipología.")}</p>
        </div>
      )}

      {booting && !showPlanShell ? (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#111] text-center">
          <p className="text-[11px] tracking-[0.28em] text-[#BDA27E] uppercase">{t("Showroom")}</p>
          <p className="mt-2 text-[13px] tracking-[0.16em] text-white/55 uppercase">{t("Cargando…")}</p>
        </div>
      ) : null}

      {bootError ? (
        <div className="absolute inset-0 z-[140] flex flex-col items-center justify-center bg-[#111] px-6 text-center">
          <p className="text-[11px] tracking-[0.28em] text-[#BDA27E] uppercase">{t("Showroom")}</p>
          <p className="mt-3 max-w-sm text-sm text-white/70">{t(bootError)}</p>
          <button
            type="button"
            className="tour-glass mt-5 px-4 py-2 text-[11px] font-semibold tracking-[0.16em] text-[#f7f3ee] uppercase"
            onClick={() => window.location.reload()}
          >
            {t(" Reintentar ")}</button>
        </div>
      ) : null}

      <div
        className={cn(
          'tour-vignette pointer-events-none absolute inset-0 z-[12]',
          immersive && 'is-immersive',
        )}
      />

      {showPlanShell ? (
        <>
          <TourFloorPlan
          units={allUnits}
          floor={planFloor}
          preferredVariant={viewMode === 'planos-2d' ? '2d' : '3d'}
          onPreferredVariantChange={(variant) => {
            setViewMode(variant === '3d' ? 'planos-3d' : 'planos-2d')
          }}
          onFloorChange={(next) => {
            setPlanFloor(next)
            setSelectedUnitId(null)
          }}
          selectedUnitId={selectedUnitId}
          onPrefetchUnit={warmTypologyStills}
          onSelectUnit={(unit) => {
            setSelectedUnitId(unit.id)
            if (unit.typology_code) setSelectedTypology(unit.typology_code)
            writeUnitQueryParam(unit.unit_number)
            // Si el simulador o financiamiento está abierto, actualiza la unidad ahí; si no, abre la ficha.
            if (simulatorOpen) {
              setFichaOpen(false)
              return
            }
            // Primera ficha (resumen). La expandida se abre con “Ver ficha”.
            setSimulatorOpen(false)
            setFichaExpanded(false)
            setFichaOpen(true)
          }}
          railTrailing={
            !voiceAssistOpen ? (
              <button
                type="button"
                data-tour-voice
                onClick={() => setVoiceAssistOpen(true)}
                className="tour-glass group inline-flex h-11 w-11 shrink-0 items-center justify-center border border-[#BDA27E]/40 text-[#f7f3ee] transition hover:border-[#BDA27E]/65 hover:bg-white/10"
                aria-label={t("Abrir asistente de voz")}
                title={t("Asistente de voz")}
              >
                <Mic
                  size={15}
                  strokeWidth={1.75}
                  className="text-[#E8D9C0] transition group-hover:scale-105"
                />
              </button>
            ) : null
          }
          onWhatsAppClick={() => {
            logTourEvent({
              event_type: 'whatsapp_interest',
              room: `piso-${planFloor}`,
              typology_code: selectedTypology,
              unit_type_id: currentTypology?.id,
            })
          }}
          touchesLocked={planTouchLock}
          onFloorPresented={() => setPlanPresented(true)}
        />
        </>
      ) : null}

      {/* Modos PC / móvil: no en el plano del edificio (ahí solo 2D/3D). */}
      {!booting && !isComparador && !isFinishCompare && !terminacionesUiOpen && !showPlanShell && !amenitiesOpen ? (
        <div
          className="pointer-events-auto absolute top-[calc(4rem+env(safe-area-inset-top))] right-0 z-[130] p-2 pt-[max(0.5rem,env(safe-area-inset-top))] pr-[max(0.5rem,env(safe-area-inset-right))]"
        >
          <div className="tour-modes-desktop">
              <DesktopModesList
                viewMode={viewMode}
                show={modeButtons}
                active={{
                  galeria: viewMode === 'galeria' && showUnitChrome && !terminacionesFocus && !isComparador,
                  tour: viewMode === 'tour' && showUnitChrome && !terminacionesFocus && !isComparador,
                  terminaciones: terminacionesFocus || isFinishCompare,
                  comparador: isComparador,
                }}
                onGaleria={() => {
                  setShellMode('unit')
                  setFichaOpen(false)
                  setTerminacionesFocus(false)
                  setFinishCompareOpen(false)
                  setCompareOpen(false)
                  setViewMode('galeria')
                  setGaleriaIndex(0)
                }}
                onPlanos={(mode) => {
                  setShellMode('unit')
                  setFichaOpen(false)
                  setTerminacionesFocus(false)
                  setFinishCompareOpen(false)
                  setCompareOpen(false)
                  setViewMode(mode)
                }}
                onTour={() => {
                  setShellMode('unit')
                  setFichaOpen(false)
                  setViewMode('tour')
                  setRoom(homeSlug)
                  setTerminacionesFocus(false)
                  setFinishCompareOpen(false)
                  setCompareOpen(false)
                  setTourNavMode(null)
                  setNavChooserOpen(true)
                }}
                onTourPrime={preloadTourEntry}
                onTerminaciones={() => {
                  setShellMode('unit')
                  setFichaOpen(false)
                  setFichaExpanded(false)
                  setCompareOpen(false)
                  setFinishCompareOpen(false)
                  setViewMode('galeria')
                  setTerminacionesFocus(true)
                }}
                onComparador={() => {
                  setShellMode('unit')
                  setFichaOpen(false)
                  setTerminacionesFocus(false)
                  setFinishCompareOpen(false)
                  setCompareOpen(true)
                  setCompareFinishB(finish)
                  setCompareLightB(light)
                  setComparePreviewIndex(0)
                  setCompareSplit(50)
                  // Mantener galería o 360 según el modo actual (pares homogéneos).
                  if (viewMode !== 'galeria') setViewMode('tour')
                }}
                terminacionesDisabled={!terminacionesReady}
          />
        </div>

          <div className="tour-modes-mobile">
            <button
              type="button"
              onClick={() => setMobilePanel((value) => (value === 'modes' ? null : 'modes'))}
              className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white text-[#1a2744] shadow-[0_4px_14px_rgba(15,23,42,0.28)]"
              aria-expanded={mobilePanel === 'modes'}
              aria-haspopup="menu"
              aria-label={t("Abrir modos de vista")}
            >
              <Menu size={18} strokeWidth={2.25} />
            </button>
            {mobilePanel === 'modes' ? (
              <div
                role="menu"
                className="tour-glass absolute top-[calc(100%+6px)] right-2 z-[121] flex max-h-[min(70dvh,24rem)] w-[11rem] flex-col gap-1 overflow-y-auto p-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.45)] [@media(max-height:500px)]:top-0 [@media(max-height:500px)]:right-[calc(100%+0.5rem)]"
              >
                {modeButtons.galeria ? (
                <ModeButton
                  active={viewMode === 'galeria' && showUnitChrome && !terminacionesFocus && !isComparador}
                  icon={<Images size={14} strokeWidth={1.75} />}
              onClick={() => {
                    setShellMode('unit')
                    setFichaOpen(false)
                    setTerminacionesFocus(false)
                    setFinishCompareOpen(false)
                    setCompareOpen(false)
                    setViewMode('galeria')
                    setGaleriaIndex(0)
                    setMobilePanel(null)
                  }}
                >
                  {t(" Galería ")}</ModeButton>
                ) : null}
                {modeButtons.planos ? (
                <>
                <ModeButton
                  active={viewMode === 'planos-3d' && showUnitChrome && !terminacionesFocus && !isComparador}
                  icon={<Layers size={14} strokeWidth={1.75} />}
                  onClick={() => {
                    setShellMode('unit')
                    setFichaOpen(false)
                    setTerminacionesFocus(false)
                    setFinishCompareOpen(false)
                    setCompareOpen(false)
                    setViewMode('planos-3d')
                    setMobilePanel(null)
                  }}
                >
                  {t(" Plano 3D ")}</ModeButton>
                <ModeButton
                  active={viewMode === 'planos-2d' && showUnitChrome && !terminacionesFocus && !isComparador}
                  icon={<Layers size={14} strokeWidth={1.75} />}
                  onClick={() => {
                    setShellMode('unit')
                    setFichaOpen(false)
                    setTerminacionesFocus(false)
                    setFinishCompareOpen(false)
                    setCompareOpen(false)
                    setViewMode('planos-2d')
                    setMobilePanel(null)
                  }}
                >
                  {t(" Plano 2D ")}</ModeButton>
                </>
                ) : null}
                {modeButtons.tour ? (
                <ModeButton
                  active={viewMode === 'tour' && showUnitChrome && !terminacionesFocus && !isComparador}
                  icon={<Rotate3d size={14} strokeWidth={1.75} />}
                  onClick={() => {
                    setShellMode('unit')
                    setFichaOpen(false)
                setViewMode('tour')
                setRoom(homeSlug)
                    setTerminacionesFocus(false)
                    setFinishCompareOpen(false)
                    setCompareOpen(false)
                    setMobilePanel(null)
                    setTourNavMode(null)
                    setNavChooserOpen(true)
                  }}
                  onPointerDown={preloadTourEntry}
                  onPointerEnter={preloadTourEntry}
                >
                  {t(" Tour 360° ")}</ModeButton>
                ) : null}
                {modeButtons.terminaciones ? (
                <ModeButton
                  active={terminacionesFocus || isFinishCompare}
                  disabled={!terminacionesReady}
                  title={terminacionesReady ? undefined : t('Este ambiente no tiene otra terminación')}
                  icon={<SwatchBook size={14} strokeWidth={1.75} />}
                  onClick={() => {
                    setShellMode('unit')
                    setFichaOpen(false)
                    setFichaExpanded(false)
                    setCompareOpen(false)
                    setFinishCompareOpen(false)
                    setViewMode('galeria')
                    setTerminacionesFocus(true)
                    setMobilePanel(null)
                  }}
                >
                  {t(" Terminaciones ")}</ModeButton>
                ) : null}
                {modeButtons.comparador ? (
                <ModeButton
                  active={isComparador}
                  icon={<Columns2 size={14} strokeWidth={1.75} />}
                  onClick={() => {
                    setShellMode('unit')
                    setFichaOpen(false)
                    setTerminacionesFocus(false)
                    setFinishCompareOpen(false)
                    setCompareOpen(true)
                    setCompareFinishB(finish)
                    setCompareLightB(light)
                    setComparePreviewIndex(0)
                    setCompareSplit(50)
                    if (viewMode !== 'galeria') setViewMode('tour')
                    setMobilePanel(null)
                  }}
                >
                  {t(" Comparador ")}</ModeButton>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div
              className={cn(
          /* Bajo la ficha (z-70): el chrome no debe tapar el panel de unidad. */
          'tour-chrome pointer-events-none absolute inset-0 z-20',
          immersive && 'is-immersive',
          (isComparador || isFinishCompare) && 'hidden',
        )}
      >
        <div
          className={cn(
            'pointer-events-none absolute top-[calc(4rem+env(safe-area-inset-top))] left-0 z-[80] flex w-[min(12rem,calc(100vw-1.5rem))] flex-col items-stretch gap-2 p-2 pt-[max(0.5rem,env(safe-area-inset-top))] pl-[max(0.5rem,env(safe-area-inset-left))] sm:w-[12.5rem] sm:p-3.5',
            showPlanShell && 'hidden',
          )}
        >
          {/* Desktop: botones sueltos */}
          <div className="tour-desktop-nav pointer-events-auto">
            {showUnitChrome ? (
              <button
                type="button"
                onClick={() => {
                  setShellMode('plan')
                  setViewMode('planos-3d')
                  setFichaOpen(false)
                  setTerminacionesFocus(false)
                  setCompareOpen(false)
                  setFinishCompareOpen(false)
                }}
                className="tour-glass inline-flex h-10 w-full items-center justify-start gap-1.5 px-3 text-[10px] font-medium tracking-[0.16em] text-[#f7f3ee] uppercase sm:text-[11px]"
              >
                <Layers size={13} strokeWidth={1.75} className="shrink-0" />
                {t(" Volver a los pisos ")}</button>
            ) : null}
            {showUnitChrome && !isComparador && !terminacionesUiOpen && selectedTypology ? (
              <button
                type="button"
                onClick={() => {
                  setFichaExpanded(false)
                  setSimulatorOpen(false)
                  setFichaOpen(true)
                }}
                className="tour-glass inline-flex h-10 w-full items-center justify-start gap-1.5 px-3 text-[10px] font-medium tracking-[0.16em] text-[#f7f3ee] uppercase sm:text-[11px]"
              >
                <FileText size={13} strokeWidth={1.75} className="shrink-0" />
                <span className="min-w-0 truncate">
                  {t(" Ficha técnica ")}{t(selectedUnit ? ` · ${selectedUnit.unit_number}` : '')}
                </span>
            </button>
            ) : null}
            {showUnitChrome && !isComparador && !terminacionesUiOpen && selectedTypology ? (
            <button
              type="button"
                onClick={openSimulatorTool}
                className="tour-glass inline-flex h-10 w-full items-center justify-start gap-1.5 px-3 text-[10px] font-medium tracking-[0.16em] text-[#f7f3ee] uppercase sm:text-[11px]"
              >
                <Calculator size={13} strokeWidth={1.75} className="shrink-0" />
                <span className="min-w-0 truncate">
                  {t(" Simular inversión ")}{t(selectedUnit ? ` · ${selectedUnit.unit_number}` : '')}
                </span>
              </button>
            ) : null}
            {showUnitChrome && !isComparador && !terminacionesUiOpen && selectedTypology ? (
              <button
                type="button"
                onClick={openFinancingTool}
              className={cn(
                  'tour-glass inline-flex h-10 w-full items-center justify-start gap-1.5 px-3 text-[10px] font-medium tracking-[0.16em] text-[#f7f3ee] uppercase sm:text-[11px]',
                  !showroomIdentified && 'opacity-80',
                )}
              >
                <Landmark size={13} strokeWidth={1.75} className="shrink-0" />
                <span className="min-w-0 truncate">
                  {t(" Financiamiento ")}{t(selectedUnit ? ` · ${selectedUnit.unit_number}` : '')}
                </span>
            </button>
            ) : null}
          </div>

          {/* Mobile / landscape: Menú agrupado */}
          <div className="tour-mobile-nav pointer-events-auto">
            {showUnitChrome ? (
              <>
                <button
                  type="button"
                  onClick={() =>
                    setMobilePanel((value) => (value === 'nav' ? null : 'nav'))
                  }
                  className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-white text-[#1a2744] shadow-[0_4px_14px_rgba(15,23,42,0.28)]"
                  aria-expanded={mobilePanel === 'nav'}
                  aria-label={t('Pisos')}
                >
                  <Layers size={18} strokeWidth={2.25} />
                </button>
                {mobilePanel === 'nav' ? (
                  <div className="tour-glass absolute top-[calc(100%+6px)] left-0 z-40 flex w-full flex-col gap-1 p-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        setShellMode('plan')
                        setViewMode('planos-3d')
                        setFichaOpen(false)
                        setTerminacionesFocus(false)
                        setCompareOpen(false)
                        setFinishCompareOpen(false)
                        setMobilePanel(null)
                      }}
                      className="inline-flex h-10 w-full items-center gap-1.5 px-3 text-[10px] font-medium tracking-[0.14em] text-[#f7f3ee] uppercase"
                    >
                      <Layers size={13} strokeWidth={1.75} />
                      {t(" Pisos ")}</button>
                    {selectedTypology ? (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setFichaExpanded(false)
                            setSimulatorOpen(false)
                            setFichaOpen(true)
                            setMobilePanel(null)
                          }}
                          className="inline-flex h-10 w-full items-center gap-1.5 px-3 text-[10px] font-medium tracking-[0.14em] text-[#f7f3ee] uppercase"
                        >
                          <FileText size={13} strokeWidth={1.75} />
                          {t(" Ficha ")}</button>
                        <button
                          type="button"
                          onClick={() => {
                            openSimulatorTool()
                            setMobilePanel(null)
                          }}
                          className="inline-flex h-10 w-full items-center gap-1.5 px-3 text-[10px] font-medium tracking-[0.14em] text-[#f7f3ee] uppercase"
                        >
                          <Calculator size={13} strokeWidth={1.75} />
                          {t(" Simular ")}</button>
                        <button
                          type="button"
                          onClick={() => {
                            openFinancingTool()
                            setMobilePanel(null)
                          }}
                          className={cn(
                            'inline-flex h-10 w-full items-center gap-1.5 px-3 text-[10px] font-medium tracking-[0.14em] text-[#f7f3ee] uppercase',
                            !showroomIdentified && 'opacity-80',
                          )}
                        >
                          <Landmark size={13} strokeWidth={1.75} />
                          {t(" Financiar ")}</button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>

        {showUnitChrome ? (
          <TourTerminacionesPanel
            open={terminacionesUiOpen}
            onClose={() => {
              setTerminacionesFocus(false)
              setFinishCompareOpen(false)
            }}
            contained={embedded && !immersive}
            rooms={galleryPanelRooms}
            room={room}
            onRoomChange={(slug) => {
              setViewMode('galeria')
              setRoom(slug)
              const index = galeriaImages.findIndex((item) => item.roomSlug === slug)
              if (index >= 0) setGaleriaIndex(index)
            }}
            finishes={galleryFinishOptions}
            finish={finish || galleryFinishOptions[0]?.slug || ''}
            onFinishChange={(slug) => {
              setViewMode('galeria')
              onFinish(slug)
            }}
            light={light}
            onLightChange={(next) => {
              setViewMode('galeria')
              onLight(next)
            }}
          />
        ) : null}

        {showUnitChrome && !isComparador && !terminacionesUiOpen ? (
        <div
          className={cn(
            CONSTANTS.CAPTURE_EVENTS_CLASS,
              'pointer-events-none absolute inset-x-0 bottom-0 flex w-full min-w-0 flex-col items-center gap-1.5 p-2 pb-[max(0.45rem,env(safe-area-inset-bottom))] pr-[max(3.75rem,calc(env(safe-area-inset-right)+3.25rem))] sm:gap-2.5 sm:p-3.5 sm:pr-[max(4.25rem,calc(env(safe-area-inset-right)+3.75rem))]',
            )}
          >
            {loading && <div className="tour-glass tour-caption self-center px-3 py-1.5">{t("Cargando")}</div>}
          </div>
        ) : null}
      </div>

      {showUnitChrome && !fichaOpen && !navChooserOpen ? (
        <div className="tour-unit-actions absolute right-[max(0.5rem,env(safe-area-inset-right))] bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-30 flex flex-col items-end gap-1.5 sm:right-[max(0.75rem,env(safe-area-inset-right))] sm:gap-2">
          <div
            className="tour-actions-secondary"
            onClick={() => {
              if (moreActionsRef.current?.open) moreActionsRef.current.open = false
            }}
          >
          {!isComparador && !isFinishCompare && !voiceAssistOpen ? (
                  <button
                    type="button"
              data-tour-voice
              onClick={() => setVoiceAssistOpen(true)}
              className="tour-glass group inline-flex h-11 w-11 shrink-0 items-center justify-center border border-[#BDA27E]/40 text-[#f7f3ee] transition hover:border-[#BDA27E]/65 hover:bg-white/10"
              aria-label={t("Abrir asistente de voz")}
              title={t("Asistente de voz")}
            >
              <Mic
                size={16}
                strokeWidth={1.75}
                className="text-[#E8D9C0] transition group-hover:scale-105"
              />
                  </button>
                ) : null}
                  <button
                    type="button"
            onClick={() => setFavoritesOpen(true)}
            className="tour-glass inline-flex h-11 w-11 shrink-0 items-center justify-center text-[#f7f3ee]"
            aria-label={t("Ver favoritos")}
            title={t("Favoritos")}
          >
            <Heart size={15} strokeWidth={2} className="sm:hidden" />
            <Heart size={16} strokeWidth={2} className="hidden sm:block" />
                  </button>
                  <button
                    type="button"
            onClick={() => {
              setSaveUnitOpen(true)
            }}
            className="tour-glass inline-flex h-11 w-11 shrink-0 items-center justify-center text-[#f7f3ee]"
            aria-label={t("Guardar favorito")}
            title={t("Guardar favorito")}
          >
            <Bookmark size={15} strokeWidth={2} className="sm:hidden" />
            <Bookmark size={16} strokeWidth={2} className="hidden sm:block" />
                  </button>
          {SITE.whatsapp ? (
            <a
              href={tourWhatsAppHref(
                buildTourWhatsAppMessage({
                  locale,
                  unitNumber: selectedUnit?.unit_number,
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
              className="tour-glass inline-flex h-11 w-11 shrink-0 items-center justify-center text-[#f7f3ee]"
              aria-label={t("Consultar por WhatsApp")}
              title={t("Consultar por WhatsApp")}
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
              <WhatsAppIcon size={15} />
            </a>
          ) : null}
          </div>
          <details ref={moreActionsRef} className="tour-actions-more">
            <summary className="tour-glass inline-flex h-11 items-center gap-1 px-2.5 text-[10px] font-semibold tracking-[0.12em] text-[#f7f3ee] uppercase">
              <MoreHorizontal size={16} strokeWidth={1.75} />
              {t('Más')}
            </summary>
          </details>
          {viewMode === 'tour' && showUnitChrome ? (
                  <button
                    type="button"
              onClick={() => setNavChooserOpen(true)}
              className="tour-glass pointer-events-auto inline-flex h-11 min-h-11 items-center gap-1.5 px-2.5 text-[#f7f3ee] sm:gap-2 sm:px-3"
              aria-label={t("Cambiar control del tour")}
              title={t("Cambiar entre giroscopio y dedo")}
            >
              {tourNavMode === 'gyro' ? (
                <Compass size={15} strokeWidth={1.75} />
              ) : (
                <Hand size={15} strokeWidth={1.75} />
              )}
              <span className="text-[10px] font-semibold tracking-[0.12em] uppercase">
                {t(tourNavMode === 'gyro' ? 'Giroscopio' : 'Dedo')}
              </span>
              </button>
          ) : null}
          {selectedUnit && !fichaOpen ? (
            <TourFloorLocationPeek unit={selectedUnit} units={allUnits} />
          ) : null}
            </div>
      ) : null}

      {embedded || showUnitChrome ? (
        <TourSaveUnitModal
          open={saveUnitOpen}
          contained={embedded && !immersive}
          onClose={() => setSaveUnitOpen(false)}
          onIdentified={() => tracking.markIdentified()}
          context={{
            typologyCode: selectedTypology,
            unitTypeId: currentTypology?.id,
            unitId: selectedUnit?.id ?? null,
            unitNumber: selectedUnit?.unit_number ?? null,
            roomLabel: roomName,
            floor: selectedUnit?.floor ?? null,
            finish,
            light,
          }}
        />
      ) : null}

      {showUnitChrome || showPlanShell ? (
        <TourFavoritesPanel
          open={favoritesOpen}
          contained={embedded && !immersive}
          onClose={() => setFavoritesOpen(false)}
          onIdentified={() => tracking.markIdentified()}
          context={{
            typologyCode: selectedTypology,
            unitTypeId: currentTypology?.id,
            unitId: selectedUnit?.id ?? null,
            unitNumber: selectedUnit?.unit_number ?? null,
            floor: selectedUnit?.floor ?? null,
            roomLabel: roomName,
            finish,
            light,
          }}
          onOpenUnit={(favorite) => {
            const match =
              allUnits.find((item) => item.id === favorite.unitId) ??
              findUnitByNumber(allUnits, favorite.unitNumber)
            if (!match) return
            setSelectedUnitId(match.id)
            if (match.typology_code || favorite.typologyCode) {
              setSelectedTypology(match.typology_code || favorite.typologyCode || selectedTypology)
            }
            const floor = unitFloorNumber(match)
            if (floor != null) setPlanFloor(floor)
            setShellMode('unit')
            setViewMode('galeria')
            setFichaExpanded(true)
            setFichaOpen(true)
            writeUnitQueryParam(match.unit_number)
          }}
        />
      ) : null}

      {selectedUnit ? (
        <MetaViewContentUnit
          enabled={fichaOpen}
          unitId={selectedUnit.id}
          unitNumber={selectedUnit.unit_number}
          category={selectedUnit.category}
        />
      ) : null}
      <MetaViewContentShowroom ready={showroomReady && !bootError} />

      {showPlanShell || showUnitChrome ? (
        <TourFichaDrawer
          open={fichaOpen}
          onClose={() => {
            setFichaOpen(false)
            setFichaExpanded(false)
            setSelectedUnitId(null)
            writeUnitQueryParam(null)
          }}
          contained={embedded && !immersive}
          expanded={fichaExpanded}
          typologyCode={selectedTypology}
          typologyName={currentTypology?.name}
          galleryOnly={galleryOnly}
          units={fichaUnits}
          suggestionUnits={allUnits}
          images={fichaImages}
          initialUnitId={selectedUnitId}
          onSelectUnit={(unit) => {
            setSelectedUnitId(unit.id)
            if (unit.typology_code) setSelectedTypology(unit.typology_code)
            writeUnitQueryParam(unit.unit_number)
          }}
          onVerFicha={(unit) => {
            setSelectedUnitId(unit.id)
            if (unit.typology_code) setSelectedTypology(unit.typology_code)
            const floor = unitFloorNumber(unit)
            if (floor != null) setPlanFloor(floor)
            setTerminacionesFocus(false)
            setCompareOpen(false)
            setFinishCompareOpen(false)
            setSimulatorOpen(false)
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
            const local =
              isGalleryOnlyTypology(currentTypology) ||
              isGalleryOnlyTypology({ code: unit.typology_code, category: unit.category })
            setFichaOpen(false)
            setFichaExpanded(false)
            setShellMode('unit')
            setCompareOpen(false)
            setFinishCompareOpen(false)
            setTerminacionesFocus(false)
            writeUnitQueryParam(unit.unit_number)
            if (local) {
              setViewMode('galeria')
              setGaleriaIndex(0)
              return
            }
            setViewMode('tour')
            setRoom(homeSlug)
            setTourNavMode(null)
            setNavChooserOpen(true)
          }}
          onSelectGalleryImage={(index) => {
            if (viewMode === 'galeria') setGaleriaIndex(index)
          }}
          onBack={() => {
            if (fichaExpanded) {
              setFichaExpanded(false)
              return
            }
            setFichaOpen(false)
            setFichaExpanded(false)
            setSelectedUnitId(null)
            writeUnitQueryParam(null)
            if (shellMode !== 'plan') {
              setShellMode('plan')
              setViewMode('planos-3d')
            }
          }}
          onRequestInfo={(unit) => {
            setSelectedUnitId(unit.id)
            if (unit.typology_code) setSelectedTypology(unit.typology_code)
            const floor = unitFloorNumber(unit)
            if (floor != null) setPlanFloor(floor)
            setFichaOpen(false)
            setFichaExpanded(false)
            setTerminacionesFocus(false)
            setCompareOpen(false)
            setFinishCompareOpen(false)
            setShellMode('unit')
            setViewMode('galeria')
            setGaleriaIndex(0)
            setInfoRequestOpen(true)
            writeUnitQueryParam(unit.unit_number)
          }}
        />
      ) : null}

      {showPlanShell || showUnitChrome ? (
        <TourSimulatorDrawer
          open={simulatorOpen}
          onClose={() => {
            setSimulatorOpen(false)
            setSimulatorEntry({})
          }}
          contained={embedded && !immersive}
          unitNumber={selectedUnit?.unit_number ?? null}
          units={allUnits.length > 0 ? allUnits : fichaUnits.length > 0 ? fichaUnits : displayUnits}
          initialMode={simulatorEntry.mode}
          initialSection={simulatorEntry.section}
          onRequestInfo={() => {
            setSimulatorOpen(false)
            setInfoRequestOpen(true)
          }}
          onSelectUnit={(unit) => {
            setSelectedUnitId(unit.id)
            if (unit.typology_code) setSelectedTypology(unit.typology_code)
            writeUnitQueryParam(unit.unit_number)
          }}
        />
      ) : null}

      {(showPlanShell || showUnitChrome) && !isComparador && !isFinishCompare ? (
        <TourVoiceAssist
          units={allUnits}
          publicCatalog={publicCatalog}
          sceneKey={`${shellMode}:${viewMode}:${room}:${selectedTypology || ''}`}
          hideTrigger
          layout={showPlanShell ? 'plan' : 'unit'}
          open={voiceAssistOpen}
          tipsEnabled={!navChooserOpen && !saveUnitOpen && !phoneUnlock.open && !infoRequestOpen && !gateOpen && !fichaOpen && !planEntryOpen}
          onOpenChange={setVoiceAssistOpen}
          onPreviewUnit={(unit) => {
            setSelectedUnitId(unit.id)
            if (unit.typology_code) setSelectedTypology(unit.typology_code)
            const floor = unitFloorNumber(unit)
            if (floor != null) setPlanFloor(floor)
            setSimulatorOpen(false)
            setTerminacionesFocus(false)
            setCompareOpen(false)
            setFinishCompareOpen(false)
            // Adelanto: galería de la tipología, sin ficha ni WhatsApp.
            setShellMode('unit')
            setViewMode('galeria')
            setGaleriaIndex(0)
            setFichaExpanded(false)
            setFichaOpen(false)
          }}
          onPickUnit={(unit) => {
            setSelectedUnitId(unit.id)
            if (unit.typology_code) setSelectedTypology(unit.typology_code)
            const floor = unitFloorNumber(unit)
            if (floor != null) setPlanFloor(floor)
            setSimulatorOpen(false)
            setTerminacionesFocus(false)
            setCompareOpen(false)
            setFinishCompareOpen(false)
            // Igual que abrir unidad desde favoritos / ficha: galería + ficha.
            setShellMode('unit')
            setViewMode('galeria')
            setGaleriaIndex(0)
            setFichaExpanded(true)
            setFichaOpen(true)
            writeUnitQueryParam(unit.unit_number)
          }}
        />
      ) : null}

      <TourNavModeModal
        open={navChooserOpen}
        contained={embedded && !immersive}
        currentMode={tourNavMode}
        onClose={() => {
          setNavChooserOpen(false)
          // Sin elección: dedo (no pelea con el peek de ubicación).
          setTourNavMode((prev) => prev ?? 'finger')
        }}
        onChoose={(mode) => {
          setTourNavMode(mode)
          setNavChooserOpen(false)
        }}
      />

      <TourPhoneUnlockModal
        open={phoneUnlock.open}
        intent={phoneUnlock.intent}
        contained={embedded && !immersive}
        onClose={() => setPhoneUnlock((prev) => ({ ...prev, open: false }))}
        onUnlocked={(intent) => {
          tracking.markIdentified()
          handlePhoneUnlocked(intent)
        }}
        typologyCode={selectedTypology}
        unitTypeId={currentTypology?.id}
        unitId={selectedUnit?.id ?? null}
        unitNumber={selectedUnit?.unit_number ?? null}
        finish={finish}
        light={light}
      />

      <TourInfoRequestModal
        open={infoRequestOpen}
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

      {planTouchLock ? <div className="absolute inset-0 z-[35]" aria-hidden="true" /> : null}

      <TourRotateHint contained target={rootRef} inTour={viewMode === 'tour'} />

      {shellMode === 'plan' ? (
        <div
          className={cn(
            'absolute inset-0 z-[30] bg-[#14110e]',
            entryExit
              ? 'pointer-events-none opacity-0 transition-opacity duration-[400ms] ease-linear [&_*]:pointer-events-none'
              : planEntryOpen
                ? 'opacity-100'
                : 'pointer-events-none opacity-0 [&_*]:pointer-events-none',
          )}
          aria-hidden={!planEntryOpen || entryExit}
          inert={!planEntryOpen || entryExit ? true : undefined}
        >
          <div
            className={cn(
              'absolute inset-0 bg-[#14110e]',
              coverHidden ? 'pointer-events-none opacity-0' : 'opacity-100',
            )}
          >
            <CmafVideo
              mp4={
                entryCoarse
                  ? '/inicio/portada-v2/portada-v2-mobile.mp4'
                  : '/inicio/portada-v2/portada-v2.mp4'
              }
              preload="auto"
              defer={entryCoarse && !planEntryOpen}
              autoPlay={planEntryOpen && !coverHidden}
              label={t('Fachada Lavilet del día a la noche')}
              videoRef={coverVideoRef}
              onFirstFrame={() => setCoverReady(true)}
              onError={() => setCoverReady(true)}
              className="tour-entry-video absolute inset-0 h-full w-full"
            />
          </div>
          <div className={`absolute inset-0 transition-opacity duration-[400ms] ease-linear ${droneOn ? 'opacity-100' : 'pointer-events-none opacity-0'}`}>
            {!planEntryOpen || ingresoCoarse === null ? null : (
            <EntryLateral active={entryVideo && ingresoCoarse}>
              <CmafVideo
                mp4={ingresoCoarse ? '/tour/ingreso-v2/ingreso-v2-mobile.mp4' : '/tour/ingreso-v2/ingreso-v2.mp4'}
                hls={ingresoCoarse ? undefined : '/tour/ingreso-v2/hls/index.m3u8'}
                autoPlay={entryVideo}
                preload="auto"
                loop={false}
                videoRef={droneRef}
                onError={() => {
                  entryFailedRef.current = true
                  if (entryVideo) requestEntryClose()
                }}
                onEnded={() => {
                  const video = droneRef.current
                  if (video) video.pause()
                  requestEntryClose()
                }}
                className="tour-entry-video absolute inset-0 h-full w-full"
              />
            </EntryLateral>
            )}
          </div>
          {entryVideo ? (
            <button
              type="button"
              onClick={() => requestEntryClose()}
              className="absolute bottom-[max(1rem,env(safe-area-inset-bottom))] left-1/2 z-10 inline-flex min-h-11 min-w-11 -translate-x-1/2 items-center justify-center rounded-full bg-[#29251e]/80 px-4 py-2 text-xs text-[#f7f3ee]"
            >
              {t('Saltar')}
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                if (entryFailedRef.current) {
                  requestEntryClose()
                  return
                }
                setEntryVideo(true)
                void droneRef.current?.play().catch(() => undefined)
                if (window.matchMedia('(pointer: coarse)').matches && !isIOSWebKit() && rootRef.current) {
                  void requestTourFullscreen(rootRef.current)
                }
              }}
              className={cn(
                'absolute top-1/2 left-1/2 z-10 inline-flex min-h-11 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#BDA27E] px-8 py-3 text-sm font-semibold tracking-[0.18em] text-[#2B1A18] uppercase transition-opacity duration-200',
                coverReady ? 'opacity-100' : 'pointer-events-none opacity-0',
              )}
            >
              {t('Ingresar')}
            </button>
          )}
        </div>
      ) : null}
    </div>
    </div>
  )
}
