'use client'

import { useTourLanguage } from '@/lib/tour/tourLocale'

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { ArrowLeftRight, ChevronDown, ChevronLeft, ChevronRight, Moon, Reply, Sun, X } from 'lucide-react'
import { CompareSidePano, type ComparePanoPose } from '@/components/tour/CompareSidePano'
import { finishSwatchStyle } from '@/lib/tour/finishSwatch'
import type { TourFinishOption, TourLightMode, TourUnitSummary } from '@/types/tour'
import { cn } from '@/lib/utils'

function formatPrice(value: number | null) {
  if (value == null) return 'Consultar'
  const amount = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(value)
  return `USD ${amount}`
}

function formatArea(value: number | null | undefined) {
  if (value == null) return '—'
  return `${value} m²`
}

export type ComparadorPreview = {
  id: string
  label: string
  url: string
}

export type ComparadorContentMode = 'tour' | 'galeria'

export type ComparadorSceneControls = {
  finishes: TourFinishOption[]
  finish: string
  light: TourLightMode
  onFinish: (slug: string) => void
  onLight: (light: TourLightMode) => void
}

/** Controles de acabado y luz en un solo panel unificado. */
export function TourFinishLightControls({
  finishes,
  finish,
  light,
  onFinish,
  onLight,
  className,
  tone = 'neutral',
  showFinish = true,
  showLight = true,
  compact = false,
}: ComparadorSceneControls & {
  className?: string
  /** A/B del comparador: acento sutil del lado. */
  tone?: 'a' | 'b' | 'neutral'
  showFinish?: boolean
  showLight?: boolean
  compact?: boolean
}) {
  const { t } = useTourLanguage()

  const shell = cn(
    'w-full overflow-hidden border border-white/10 bg-[#14110e]/55 shadow-[0_4px_18px_rgba(0,0,0,0.22)] backdrop-blur-md',
    compact ? 'rounded-lg' : 'rounded-xl',
    tone === 'a' && 'border-[#8fa8d4]/20',
    tone === 'b' && 'border-[#8fbf96]/20',
  )
  const pad = compact ? 'px-1.5 py-1 sm:px-2 sm:py-1.5' : 'px-2.5 py-2'
  const labelCls = cn(
    'font-medium tracking-[0.14em] text-white/40 uppercase',
    compact ? 'mb-0.5 text-[7px] sm:mb-1 sm:text-[8px]' : 'mb-1.5 text-[9px]',
  )
  const btnBase = cn(
    'inline-flex min-w-0 flex-1 items-center justify-center gap-1 transition',
    compact
      ? 'rounded-md px-1 py-1 text-[8px] font-medium tracking-wide sm:gap-1.5 sm:px-1.5 sm:text-[9px]'
      : 'rounded-md px-2.5 py-1.5 text-[10px] font-medium tracking-wide',
  )
  const btnIdle = 'text-white/55 hover:bg-white/[0.06] hover:text-white/85'
  const btnOn = 'bg-white/14 text-white/95 ring-1 ring-white/15'
  const swatch = compact
    ? 'h-2 w-2 shrink-0 rounded-full sm:h-2.5 sm:w-2.5'
    : 'h-3 w-3 shrink-0 rounded-full'
  const icon = compact ? 10 : 12
  const showBoth = showFinish && showLight && finishes.length > 0

  return (
    <div className={cn(shell, className)}>
      {/* Compacto: Acabado | Luz en fila para no tapar pantallas chicas / mitades del comparador. */}
      <div
        className={cn(
          'flex w-full',
          compact && showBoth ? 'flex-row items-stretch' : 'flex-col',
        )}
      >
        {showFinish && finishes.length > 0 ? (
          <div
            className={cn(
              pad,
              'min-w-0',
              showBoth && !compact && 'border-b border-white/[0.08]',
              compact && showBoth && 'flex-1 border-r border-white/[0.08]',
            )}
          >
            <p className={labelCls}>{t("Acabado")}</p>
            <div className="flex w-full items-center gap-0.5 sm:gap-1">
              {finishes.map((item, index) => {
                const active = item.slug === finish
                const label = `Acabado ${index + 1}`
                return (
                  <button
                    key={item.slug}
                    type="button"
                    onClick={() => onFinish(item.slug)}
                    className={cn(btnBase, active ? btnOn : btnIdle)}
                    title={t(item.name)}
                    aria-label={t(label)}
                    aria-pressed={active}
                  >
                    <span
                      className={cn(swatch, 'ring-1 ring-white/20')}
                      style={{ background: finishSwatchStyle(item.slug, item.name) }}
                    />
                    <span className="truncate">{t(label)}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}

        {showLight ? (
          <div className={cn(pad, compact && showBoth && 'min-w-0 flex-[0.95]')}>
            <p className={labelCls}>{t("Luz")}</p>
            <div className="grid grid-cols-2 gap-0.5 sm:gap-1">
              <button
                type="button"
                onClick={() => onLight('dia')}
                className={cn(btnBase, light === 'dia' ? btnOn : btnIdle)}
                aria-pressed={light === 'dia'}
              >
                <Sun size={icon} strokeWidth={1.75} className="opacity-80" />
                {t(" Día ")}</button>
              <button
                type="button"
                onClick={() => onLight('noche')}
                className={cn(btnBase, light === 'noche' ? btnOn : btnIdle)}
                aria-pressed={light === 'noche'}
              >
                <Moon size={icon} strokeWidth={1.75} className="opacity-80" />
                {t(" Noche ")}</button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

type TourComparadorProps = {
  unitA: TourUnitSummary | null
  unitB: TourUnitSummary | null
  units: TourUnitSummary[]
  contentMode: ComparadorContentMode
  panoBUrl: string | null
  previewsB: ComparadorPreview[]
  previewIndexB: number
  onPreviewIndexB: (index: number) => void
  onSelectUnitA: (unit: TourUnitSummary) => void
  onSelectUnitB: (unit: TourUnitSummary) => void
  onClearUnitB: () => void
  onSwap: () => void
  onClose: () => void
  split: number
  onSplitChange: (split: number) => void
  syncPose?: ComparePanoPose | null
  syncPoseRef?: MutableRefObject<ComparePanoPose | null>
  onPoseChange?: (pose: ComparePanoPose) => void
  /** Con CSS force-landscape, remapea el dedo también en el lado B. */
  remapTouch?: boolean
  /** Galería: acabado/luz solo del lado B (independiente de A). */
  sceneControlsB?: ComparadorSceneControls | null
}

type PickingSide = 'a' | 'b'

export function TourComparador({
  unitA,
  unitB,
  units,
  contentMode,
  panoBUrl,
  previewsB,
  previewIndexB,
  onPreviewIndexB,
  onSelectUnitA,
  onSelectUnitB,
  onClearUnitB,
  onSwap,
  onClose,
  split,
  onSplitChange,
  syncPose = null,
  syncPoseRef,
  onPoseChange,
  remapTouch = false,
  sceneControlsB = null,
}: TourComparadorProps) {
  const { t } = useTourLanguage()

  const [picking, setPicking] = useState<PickingSide | null>(() => {
    if (!unitA) return 'a'
    if (!unitB) return 'b'
    return null
  })
  const [statsOpen, setStatsOpen] = useState(false)
  const dragRef = useRef(false)
  const rootRef = useRef<HTMLDivElement>(null)

  const candidates = useMemo(() => {
    const excludeId = picking === 'a' ? unitB?.id : unitA?.id
    return [...units]
      .filter((item) => item.id !== excludeId)
      .sort((a, b) => a.unit_number.localeCompare(b.unit_number, 'es', { numeric: true }))
  }, [units, unitA?.id, unitB?.id, picking])

  const activePreview = previewsB[previewIndexB] ?? previewsB[0] ?? null
  const waitingForB = !unitB
  const splitClamped = waitingForB ? 100 : Math.min(88, Math.max(12, split))
  const showPanoB = contentMode === 'tour'
  const drawerOpen = picking != null

  useEffect(() => {
    if (!unitA) {
      setPicking('a')
      return
    }
    if (!unitB) {
      setPicking((prev) => (prev === 'a' ? 'a' : 'b'))
    }
  }, [unitA, unitB])

  const setSplitFromClientX = useCallback(
    (clientX: number) => {
      if (waitingForB) return
      const root = rootRef.current
      if (!root) return
      const rect = root.getBoundingClientRect()
      if (rect.width <= 0) return
      const next = ((clientX - rect.left) / rect.width) * 100
      onSplitChange(Math.min(88, Math.max(12, next)))
    },
    [onSplitChange, waitingForB],
  )

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (!dragRef.current) return
      setSplitFromClientX(event.clientX)
    }
    const onUp = () => {
      dragRef.current = false
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [setSplitFromClientX])

  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0 z-[125]">
      {/* Capa B — solo con unidad elegida (evita media pantalla blanca) */}
      {!waitingForB ? (
        <div
          className="pointer-events-auto absolute inset-0"
          style={{ clipPath: `inset(0 0 0 ${splitClamped}%)` }}
        >
          {showPanoB ? (
            <CompareSidePano
              key={`${unitB?.id ?? 'b'}:${panoBUrl ?? 'empty'}`}
              url={panoBUrl}
              className="h-full w-full bg-[#111]"
              syncPose={syncPose}
              syncPoseRef={syncPoseRef}
              onPoseChange={onPoseChange}
              remapTouch={remapTouch}
            />
          ) : (
            <div className="relative h-full bg-[#111]">
              {activePreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={activePreview.url}
                  alt={t(activePreview.label)}
                  className="absolute inset-0 h-full w-full object-cover"
                  draggable={false}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-white/50">
                  {t(" Sin imágenes para esta tipología ")}</div>
              )}
              {activePreview?.label ? (
                <div
                  className="pointer-events-none absolute bottom-[max(1rem,calc(env(safe-area-inset-bottom)+0.75rem))] z-[4] flex justify-center px-2"
                  style={{ left: `${splitClamped}%`, right: 0 }}
                >
                  <div className="max-w-[min(100%,14rem)] truncate rounded-full bg-black/45 px-3 py-1.5 text-center text-[10px] font-semibold tracking-[0.12em] text-white uppercase shadow-md ring-1 ring-white/20 backdrop-blur-sm sm:text-[11px]">
                    {t(activePreview.label)}
                  </div>
                </div>
              ) : null}
              {sceneControlsB ? (
                <div
                  className="tour-compare-scene-controls pointer-events-none absolute bottom-[max(4.75rem,calc(env(safe-area-inset-bottom)+3.75rem))] z-[4] flex justify-center px-1.5 sm:bottom-[max(5.75rem,calc(env(safe-area-inset-bottom)+5rem))] sm:px-2"
                  style={{ left: `${splitClamped}%`, right: 0 }}
                >
                  <div className="pointer-events-auto w-full max-w-[min(100%,15.5rem)] sm:max-w-[min(100%,18rem)]">
                    <TourFinishLightControls {...sceneControlsB} tone="b" compact />
                  </div>
                </div>
              ) : null}
              {previewsB.length > 1 ? (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      onPreviewIndexB((previewIndexB - 1 + previewsB.length) % previewsB.length)
                    }
                    className="absolute top-1/2 left-[max(0.35rem,env(safe-area-inset-left))] z-[3] flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white shadow-md ring-1 ring-white/25 backdrop-blur-sm transition hover:bg-black/60 sm:left-2 sm:h-10 sm:w-10"
                    aria-label={t("Imagen anterior")}
                  >
                    <ChevronLeft size={18} strokeWidth={2} className="sm:hidden" />
                    <ChevronLeft size={20} strokeWidth={2} className="hidden sm:block" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onPreviewIndexB((previewIndexB + 1) % previewsB.length)}
                    className="absolute top-1/2 right-[max(0.35rem,env(safe-area-inset-right))] z-[3] flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white shadow-md ring-1 ring-white/25 backdrop-blur-sm transition hover:bg-black/60 sm:right-2 sm:h-10 sm:w-10"
                    aria-label={t("Imagen siguiente")}
                  >
                    <ChevronRight size={18} strokeWidth={2} className="sm:hidden" />
                    <ChevronRight size={20} strokeWidth={2} className="hidden sm:block" />
                  </button>
                </>
              ) : null}
            </div>
          )}
          {showPanoB && !panoBUrl ? (
            <div className="pointer-events-none absolute inset-0 z-[3] flex items-center justify-center bg-[#111]/55 px-6 text-center">
              <p className="max-w-xs text-sm text-white/70">
                {t(" Esta tipología no tiene tour 360 cargado. Elige otra unidad o sube el 360 en Inventario. ")}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Badges clickeables — cambian A/B sin pelear con el menú de modos */}
      <div className="pointer-events-none absolute top-[max(0.5rem,env(safe-area-inset-top))] right-[max(0.5rem,env(safe-area-inset-right))] left-[max(0.5rem,env(safe-area-inset-left))] z-[32] flex items-start justify-between gap-1.5 sm:top-4 sm:right-4 sm:left-4 sm:gap-2">
        <button
          type="button"
          onClick={() => setPicking('a')}
          className="pointer-events-auto inline-flex max-w-[min(46vw,15rem)] items-center rounded-full bg-[#1a2744] px-2.5 py-1 text-left text-[10px] font-semibold tracking-wide text-white shadow-md transition hover:brightness-110 sm:px-3 sm:py-1.5 sm:text-[12px]"
          title={t("Cambiar unidad A")}
        >
          <span className="truncate">
            {t(unitA
              ? `${unitA.unit_number} — ${formatPrice(unitA.published_commercial_price)}`
              : 'Elegir unidad A')}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setPicking('b')}
          className={cn(
            'pointer-events-auto inline-flex max-w-[min(46vw,15rem)] items-center rounded-full bg-[#3d9b4a] px-2.5 py-1 text-left text-[10px] font-semibold tracking-wide text-white shadow-md transition hover:brightness-110 sm:px-3 sm:py-1.5 sm:text-[12px]',
            drawerOpen && 'mr-0',
          )}
          title={t("Cambiar unidad B")}
        >
          <span className="truncate">
            {t(unitB
              ? `${unitB.unit_number} — ${formatPrice(unitB.published_commercial_price)}`
              : 'Elegir unidad B')}
          </span>
        </button>
      </div>

      <button
        type="button"
        onClick={onClose}
        className="pointer-events-auto absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-[max(0.5rem,env(safe-area-inset-left))] z-[34] inline-flex h-10 items-center gap-1.5 rounded-full bg-[#14110e] px-3 text-white shadow-[0_4px_16px_rgba(0,0,0,0.4)] ring-1 ring-white/15 transition-transform hover:scale-[1.03] sm:bottom-[max(1rem,env(safe-area-inset-bottom))] sm:left-[max(0.75rem,env(safe-area-inset-left))] sm:h-11 sm:gap-2 sm:px-3.5"
        aria-label={
          t(unitA
            ? `Volver a la unidad ${unitA.unit_number}`
            : 'Volver')
        }
        title={
          t(unitA
            ? `Volver a ${unitA.unit_number}`
            : 'Volver')
        }
      >
        <Reply size={16} strokeWidth={2} className="-scale-x-100 shrink-0 sm:hidden" />
        <Reply size={18} strokeWidth={2} className="-scale-x-100 hidden shrink-0 sm:block" />
        <span className="pr-0.5 text-[10px] font-semibold tracking-wide uppercase sm:text-[11px]">
          {t(unitA ? `Volver · ${unitA.unit_number}` : 'Volver')}
        </span>
      </button>

      {!waitingForB && !drawerOpen ? (
        <div
          role="slider"
          aria-valuemin={12}
          aria-valuemax={88}
          aria-valuenow={Math.round(splitClamped)}
          aria-label={t("Comparar unidades")}
          tabIndex={0}
          className="pointer-events-auto absolute top-0 bottom-0 z-[30] w-8 -translate-x-1/2 cursor-ew-resize touch-none"
          style={{ left: `${splitClamped}%` }}
          onPointerDown={(event) => {
            event.preventDefault()
            dragRef.current = true
            setSplitFromClientX(event.clientX)
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') onSplitChange(Math.max(12, splitClamped - 2))
            if (event.key === 'ArrowRight') onSplitChange(Math.min(88, splitClamped + 2))
            if (event.key === 'Home') onSplitChange(50)
          }}
          onDoubleClick={() => onSplitChange(50)}
        >
          <div className="absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 bg-white shadow-[0_0_12px_rgba(0,0,0,0.35)]" />
          <div className="absolute top-1/2 left-1/2 flex h-11 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white shadow-[0_4px_18px_rgba(0,0,0,0.28)] ring-1 ring-black/10">
            <span className="flex gap-[3px]">
              <span className="h-3.5 w-[2px] rounded-full bg-[#9ca3af]" />
              <span className="h-3.5 w-[2px] rounded-full bg-[#9ca3af]" />
            </span>
          </div>
        </div>
      ) : null}

      {unitA && unitB && !drawerOpen ? (
        <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-[31] pb-[3.25rem] sm:pb-14">
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => setStatsOpen((value) => !value)}
              className="mb-1 inline-flex items-center gap-1 rounded-t-lg bg-white/95 px-3 py-1 text-[11px] font-semibold tracking-wide text-[#1a2744] uppercase shadow-sm"
            >
              {t(statsOpen ? 'Ocultar' : 'Comparación')}
              <ChevronDown
                size={14}
                className={cn('transition-transform', statsOpen ? '' : 'rotate-180')}
              />
            </button>
          </div>
          {statsOpen ? (
            <div className="border-t border-[#e5e7eb] bg-white/95 px-3 py-3 backdrop-blur-sm sm:px-5">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-[10px] font-semibold tracking-[0.18em] text-[#6b7280] uppercase">
                  {t(" Comparación ")}</p>
                <div className="flex items-center gap-3 text-[11px] font-semibold">
                  <span className="inline-flex items-center gap-1.5 text-[#1a2744]">
                    <span className="h-2 w-2 rounded-full bg-[#1a2744]" />
                    {t(unitA.unit_number)}
                  </span>
                  <span className="inline-flex items-center gap-1.5 text-[#3d9b4a]">
                    <span className="h-2 w-2 rounded-full bg-[#3d9b4a]" />
                    {t(unitB.unit_number)}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {(
                  [
                    { label: 'Total', kind: 'area' as const, a: unitA.area_total_m2, b: unitB.area_total_m2 },
                    { label: 'Amb.', kind: 'text' as const, a: unitA.bedrooms, b: unitB.bedrooms },
                    { label: 'Baños', kind: 'text' as const, a: unitA.bathrooms, b: unitB.bathrooms },
                    { label: 'Piso', kind: 'text' as const, a: unitA.floor, b: unitB.floor },
                    {
                      label: 'Precio',
                      kind: 'price' as const,
                      a: unitA.published_commercial_price,
                      b: unitB.published_commercial_price,
                    },
                    {
                      label: 'Tipo',
                      kind: 'text' as const,
                      a: unitA.typology_code,
                      b: unitB.typology_code,
                    },
                  ]
                ).map((row) => (
                  <div key={row.label} className="rounded-lg bg-[#f7f8fa] px-2 py-2 text-center">
                    <p className="text-[9px] font-semibold tracking-[0.14em] text-[#9ca3af] uppercase">
                      {t(row.label)}
                    </p>
                    <p className="mt-1 text-[11px] font-semibold tabular-nums">
                      <span className="text-[#1a2744]">
                        {t(row.kind === 'price'
                          ? formatPrice(typeof row.a === 'number' ? row.a : null)
                          : row.kind === 'area'
                            ? formatArea(typeof row.a === 'number' ? row.a : null)
                            : (row.a ?? '—'))}
                      </span>
                      <span className="text-[#9ca3af]"> / </span>
                      <span className="text-[#3d9b4a]">
                        {t(row.kind === 'price'
                          ? formatPrice(typeof row.b === 'number' ? row.b : null)
                          : row.kind === 'area'
                            ? formatArea(typeof row.b === 'number' ? row.b : null)
                            : (row.b ?? '—'))}
                      </span>
                    </p>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPicking('a')}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#1a2744] px-2.5 py-1.5 text-[10px] font-semibold tracking-wide text-white uppercase"
                >
                  {t(" Cambiar A ")}</button>
                <button
                  type="button"
                  onClick={() => {
                    onClearUnitB()
                    setPicking('b')
                  }}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#14110e] px-2.5 py-1.5 text-[10px] font-semibold tracking-wide text-white uppercase"
                >
                  <ArrowLeftRight size={12} />
                  {t(" Cambiar B ")}</button>
                <button
                  type="button"
                  onClick={onSwap}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#eef0f3] px-2.5 py-1.5 text-[10px] font-semibold tracking-wide text-[#1a2744] uppercase"
                >
                  {t(" Intercambiar ")}</button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {drawerOpen ? (
        <div className="pointer-events-auto absolute inset-y-0 right-0 z-[40] flex w-[min(100%,20rem)] flex-col border-l border-[#eceff3] bg-white shadow-2xl sm:w-[22rem]">
          <div className="flex items-center justify-between border-b border-[#eceff3] px-4 py-3">
            <p className="text-sm font-semibold text-[#1a2744]">
              {t(picking === 'a' ? 'Elegir unidad A' : 'Elegir unidad B')}
            </p>
            <button
              type="button"
              onClick={() => {
                if (picking === 'b' && waitingForB) onClose()
                else if (picking === 'a' && !unitA) onClose()
                else setPicking(null)
              }}
              className="rounded-full p-1.5 text-[#6b7280] hover:bg-[#f3f4f6]"
              aria-label={t("Cerrar listado")}
            >
              <X size={16} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {candidates.length === 0 ? (
              <p className="px-2 py-8 text-center text-sm text-[#9ca3af]">
                {t(" No hay otras unidades para comparar. ")}</p>
            ) : (
              <ul className="space-y-1">
                {candidates.map((unit) => {
                  const active =
                    picking === 'a' ? unit.id === unitA?.id : unit.id === unitB?.id
                  return (
                    <li key={unit.id}>
                      <button
                        type="button"
                        onClick={() => {
                          if (picking === 'a') onSelectUnitA(unit)
                          else onSelectUnitB(unit)
                          setPicking(null)
                          onSplitChange(50)
                        }}
                        className={cn(
                          'flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-[#f3f4f6]',
                          active && 'bg-[#f3f4f6] ring-1 ring-[#1a2744]/15',
                        )}
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-[#1a2744]">
                            {t(" Unidad ")}{t(unit.unit_number)}
                          </span>
                          <span className="mt-0.5 block text-[11px] text-[#6b7280]">
                            {t(unit.typology_code ? `${unit.typology_code} · ` : '')}
                            {t(unit.floor ? `Piso ${unit.floor}` : 'Sin piso')}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs font-semibold tabular-nums text-[#1a2744]">
                          {t(formatPrice(unit.published_commercial_price))}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
