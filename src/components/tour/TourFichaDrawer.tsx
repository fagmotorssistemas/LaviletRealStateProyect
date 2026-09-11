'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import {
  Bath,
  BedDouble,
  ChevronLeft,
  ChevronRight,
  Download,
  Layers,
  Mail,
  Rotate3d,
  Ruler,
  Share2,
  X,
} from 'lucide-react'
import { UNIT_STATUS_OPTIONS, type UnitStatus } from '@/types/inmobiliaria'
import type { TourUnitSummary } from '@/types/tour'
import { buildFichaSpecRows, formatAreaM2 } from '@/lib/tour/fichaSpecs'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import './tour-viewer.css'

export type FichaGalleryImage = {
  id: string
  label: string
  url: string
  kind: 'vista' | 'plano' | 'ambiente'
}

type TourFichaDrawerProps = {
  open: boolean
  onClose: () => void
  typologyCode: string
  typologyName?: string
  units: TourUnitSummary[]
  /** Pool para sugerencias (todas las unidades del showroom). */
  suggestionUnits?: TourUnitSummary[]
  images?: FichaGalleryImage[]
  initialUnitId?: string | null
  contained?: boolean
  /** Vista completa de ficha (todas las specs + PDF) mientras la galería muestra fotos. */
  expanded?: boolean
  onVerFicha?: (unit: TourUnitSummary) => void
  onTour360?: (unit: TourUnitSummary) => void
  onRequestInfo?: (unit: TourUnitSummary) => void
  onSelectUnit?: (unit: TourUnitSummary) => void
  onBack?: () => void
  onSelectGalleryImage?: (index: number) => void
}

/** Compacta: solo número (p. ej. "2"). Detalle: texto en español. */
function formatBathroomsCompact(
  full?: number | null,
  half?: number | null,
  total?: number | null,
): string {
  const f = full != null && full > 0 ? full : 0
  const h = half != null && half > 0 ? half : 0
  if (f + h > 0) return String(f + h)
  if (total != null && total > 0) return String(total)
  return '—'
}

function statusLabel(status: UnitStatus) {
  return UNIT_STATUS_OPTIONS.find((item) => item.value === status)?.label ?? status
}

function statusBadgeClass(status: UnitStatus) {
  if (status === 'disponible' || status === 'en_preventa') {
    return 'bg-[#3d9b4a] text-white'
  }
  if (status === 'reservado' || status === 'en_proceso' || status === 'bajo_contrato') {
    return 'bg-[#e8a54b] text-white'
  }
  if (status === 'vendido' || status === 'deshabilitado') {
    return 'bg-[#d64545] text-white'
  }
  return 'bg-[#9ca3af] text-white'
}

function formatPrice(value: number | null) {
  if (value == null) return 'Consultar'
  const amount = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 }).format(value)
  return `USD ${amount}`
}

function isUnitOfferable(status: UnitStatus) {
  return status === 'disponible' || status === 'en_preventa'
}

function suggestionScore(base: TourUnitSummary, candidate: TourUnitSummary) {
  let score = 0
  if (base.typology_code && candidate.typology_code === base.typology_code) score += 4
  if (base.bedrooms != null && candidate.bedrooms === base.bedrooms) score += 3
  if (base.bathrooms != null && candidate.bathrooms === base.bathrooms) score += 2
  if (
    base.bathrooms_full != null &&
    candidate.bathrooms_full != null &&
    base.bathrooms_full === candidate.bathrooms_full
  ) {
    score += 1
  }
  const baseArea = base.area_total_m2 ?? base.area_internal_m2
  const candArea = candidate.area_total_m2 ?? candidate.area_internal_m2
  if (baseArea != null && candArea != null && baseArea > 0) {
    const delta = Math.abs(candArea - baseArea) / baseArea
    if (delta <= 0.12) score += 2
    else if (delta <= 0.25) score += 1
  }
  return score
}

function findSimilarUnits(base: TourUnitSummary, pool: TourUnitSummary[], limit = 6) {
  const offerable = pool.filter((item) => item.id !== base.id && isUnitOfferable(item.status))
  const ranked = offerable
    .map((item) => ({ item, score: suggestionScore(base, item) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score
      return a.item.unit_number.localeCompare(b.item.unit_number, 'es', { numeric: true })
    })

  const preferred = ranked.filter((row) => row.score > 0)
  const list = (preferred.length > 0 ? preferred : ranked).slice(0, limit)
  return list.map((row) => row.item)
}

function SpecRow({
  icon,
  label,
  value,
}: {
  icon?: ReactNode
  label: string
  value: string
}) {
  return (
    <div className="flex items-center gap-2 border-b border-[#eceff3] py-1.5 last:border-b-0">
      {icon ? (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center text-[#6b7280]">
          {icon}
        </span>
      ) : null}
      <p className="min-w-0 flex-1 text-[12px] text-[#4b5563]">{label}</p>
      <p className="max-w-[55%] shrink-0 text-right text-[12px] font-semibold text-[#1a2744] tabular-nums">
        {value}
      </p>
    </div>
  )
}

function specIcon(label: string): ReactNode {
  const key = label.toLowerCase()
  if (key.includes('superficie') || key.includes('terraza')) {
    return <Ruler size={16} strokeWidth={1.6} />
  }
  if (key.includes('dormitorio')) return <BedDouble size={16} strokeWidth={1.6} />
  if (key.includes('baño')) return <Bath size={16} strokeWidth={1.6} />
  if (key.includes('piso') || key.includes('tipolog')) return <Layers size={16} strokeWidth={1.6} />
  return <Ruler size={16} strokeWidth={1.6} />
}

function preloadUrl(url: string) {
  if (typeof window === 'undefined' || !url) return
  const img = new window.Image()
  img.decoding = 'async'
  img.src = url
}

export function TourFichaDrawer({
  open,
  onClose,
  typologyCode,
  typologyName,
  units,
  suggestionUnits,
  images = [],
  initialUnitId = null,
  contained = false,
  expanded = false,
  onVerFicha,
  onTour360,
  onRequestInfo,
  onSelectUnit,
  onBack,
  onSelectGalleryImage,
}: TourFichaDrawerProps) {
  const reduceMotion = useReducedMotion()
  const [unitId, setUnitId] = useState<string | null>(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [slide, setSlide] = useState(0)
  const [displayUrl, setDisplayUrl] = useState<string | null>(null)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const busyRef = useRef(false)

  const sorted = useMemo(
    () =>
      [...units].sort((a, b) =>
        a.unit_number.localeCompare(b.unit_number, 'es', { numeric: true }),
      ),
    [units],
  )

  // Compacto: hasta 12; expandido: todas las fotos de la tipología
  const carousel = useMemo(
    () => (expanded ? images : images.slice(0, 12)),
    [images, expanded],
  )
  const safeSlide = carousel.length === 0 ? 0 : Math.min(slide, carousel.length - 1)
  const activeImage = carousel[safeSlide] ?? null

  useEffect(() => {
    if (!open) {
      setSlide(0)
      setDisplayUrl(null)
      setShowSuggestions(false)
      busyRef.current = false
      return
    }
    setUnitId((prev) => {
      if (initialUnitId && sorted.some((item) => item.id === initialUnitId)) {
        return initialUnitId
      }
      if (prev && sorted.some((item) => item.id === prev)) return prev
      return sorted[0]?.id ?? null
    })
    setSlide(0)
    setShowSuggestions(false)
  }, [open, sorted, initialUnitId])

  useEffect(() => {
    if (carousel.length === 0) {
      setSlide(0)
      return
    }
    setSlide((i) => Math.min(i, carousel.length - 1))
  }, [carousel.length])

  useEffect(() => {
    if (!activeImage) {
      setDisplayUrl(null)
      return
    }
    setDisplayUrl(activeImage.url)
    const prev = carousel[(safeSlide - 1 + carousel.length) % carousel.length]
    const next = carousel[(safeSlide + 1) % carousel.length]
    if (prev) preloadUrl(prev.url)
    if (next) preloadUrl(next.url)
    const idle = window.setTimeout(() => {
      for (const item of carousel) preloadUrl(item.url)
    }, 280)
    return () => window.clearTimeout(idle)
  }, [activeImage, carousel, safeSlide])

  const goSlide = (nextIndex: number) => {
    if (carousel.length < 2 || busyRef.current) return
    busyRef.current = true
    const idx = ((nextIndex % carousel.length) + carousel.length) % carousel.length
    setSlide(idx)
    onSelectGalleryImage?.(idx)
    window.setTimeout(() => {
      busyRef.current = false
    }, 120)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowLeft') goSlide(safeSlide - 1)
      if (event.key === 'ArrowRight') goSlide(safeSlide + 1)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- goSlide usa refs/estado actual
  }, [open, onClose, safeSlide, carousel.length])

  const unit = sorted.find((item) => item.id === unitId) ?? sorted[0] ?? null
  const detailRows = unit ? buildFichaSpecRows(unit) : []
  // Primera ficha: solo lo básico (como la referencia)
  const compactRows = unit
    ? [
        {
          label: 'Superficie total',
          value: formatAreaM2(unit.area_total_m2 ?? unit.area_internal_m2),
        },
        {
          label: 'Dormitorios',
          value: unit.bedrooms != null ? String(unit.bedrooms) : '—',
        },
        {
          label: 'Baños',
          value: formatBathroomsCompact(unit.bathrooms_full, unit.bathrooms_half, unit.bathrooms),
        },
        { label: 'Piso', value: unit.floor?.trim() || '—' },
      ]
    : []
  const displayRows = expanded ? detailRows : compactRows
  const unitAvailable = unit ? isUnitOfferable(unit.status) : false
  const suggestionPool = suggestionUnits?.length ? suggestionUnits : units
  const similarUnits = unit ? findSimilarUnits(unit, suggestionPool) : []

  const pickUnit = (next: TourUnitSummary) => {
    setUnitId(next.id)
    setShowSuggestions(false)
    onSelectUnit?.(next)
  }

  const onDownloadPdf = async () => {
    if (!unit || pdfBusy) return
    setPdfBusy(true)
    try {
      const { downloadFichaTecnicaPdf } = await import('@/lib/tour/fichaTecnicaPdf')
      await downloadFichaTecnicaPdf({
        typologyCode,
        typologyName,
        unit,
        images: carousel.map((item) => ({ label: item.label, url: item.url })),
      })
      toast.success('Ficha descargada')
    } catch {
      toast.error('No se pudo generar la ficha')
    } finally {
      setPdfBusy(false)
    }
  }

  const onShare = async () => {
    if (!unit) return
    const { buildUnitShareUrl } = await import('@/lib/tour/unitDeepLink')
    const url = buildUnitShareUrl(unit.unit_number)
    const title = `La Vilet · Unidad ${unit.unit_number}`
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({ title, url, text: url })
        return
      }
      await navigator.clipboard.writeText(url)
      toast.success(`Enlace de la unidad ${unit.unit_number} copiado`)
    } catch (error) {
      // Cancelar share no es error; si clipboard falla, avisar.
      if (error instanceof DOMException && error.name === 'AbortError') return
      try {
        await navigator.clipboard.writeText(url)
        toast.success(`Enlace de la unidad ${unit.unit_number} copiado`)
      } catch {
        toast.error('No se pudo copiar el enlace')
      }
    }
  }

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.button
            type="button"
            aria-label="Cerrar ficha técnica"
            className={cn(
              'z-[60]',
              contained ? 'absolute inset-0' : 'fixed inset-0',
              // Expandida: no cerrar al tocar el fondo (así no se pierden las imágenes).
              expanded ? 'pointer-events-none bg-transparent' : 'bg-transparent',
            )}
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0 }}
            onClick={expanded ? undefined : onClose}
          />

          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label="Ficha técnica"
            className={cn(
              'z-[70] flex flex-col overflow-hidden rounded-2xl bg-white shadow-[0_12px_40px_rgba(15,23,42,0.22)]',
              'w-[min(100%-1.25rem,22.5rem)]',
              contained
                ? cn(
                    'absolute left-3 sm:left-4',
                    'top-3 bottom-3 max-h-[calc(100%-1.5rem)] sm:top-4 sm:bottom-4',
                  )
                : cn(
                    'fixed left-3 sm:left-5',
                    // Altura definida (top+bottom) → scroll interno funciona en móvil
                    'top-3 bottom-3 max-h-[calc(100dvh-1.5rem)]',
                    expanded
                      ? 'sm:top-5 sm:bottom-5 sm:h-auto sm:max-h-[calc(100dvh-2.5rem)]'
                      : 'sm:top-5 sm:bottom-auto sm:h-[min(36rem,calc(100dvh-2.5rem))] sm:max-h-[calc(100dvh-2.5rem)]',
                    // Landscape móvil: ocupar alto útil aunque el ancho sea “sm”
                    '[@media(max-height:520px)]:left-[max(0.5rem,env(safe-area-inset-left))]',
                    '[@media(max-height:520px)]:top-[max(0.5rem,env(safe-area-inset-top))]',
                    '[@media(max-height:520px)]:bottom-[max(0.5rem,env(safe-area-inset-bottom))]',
                    '[@media(max-height:520px)]:h-auto',
                    '[@media(max-height:520px)]:max-h-none',
                    '[@media(max-height:520px)]:w-[min(20rem,calc(100vw-1rem))]',
                  ),
            )}
            initial={reduceMotion ? false : { x: -28, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={reduceMotion ? undefined : { x: -20, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 36 }}
            onWheel={(event) => event.stopPropagation()}
          >
            {/* Header compacto en celular (sin imágenes). */}
            <div className="tour-ficha-chrome-mobile shrink-0 items-center justify-between gap-2 border-b border-[#eceff3] bg-white px-3 py-2.5">
              {onBack ? (
                <button
                  type="button"
                  onClick={onBack}
                  className="flex h-8 items-center gap-1 rounded-full bg-[#f3f4f6] px-2.5 text-[11px] font-semibold tracking-[0.08em] text-[#1a2744] uppercase"
                  aria-label={expanded ? 'Volver a ficha resumida' : 'Volver'}
                >
                  <ChevronLeft size={16} strokeWidth={2.25} />
                  {expanded ? 'Resumen' : 'Volver'}
                </button>
              ) : (
                <p className="text-[11px] font-semibold tracking-[0.14em] text-[#BDA27E] uppercase">
                  {expanded ? 'Ficha completa' : 'Ficha técnica'}
                </p>
              )}
              <button
                type="button"
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f3f4f6] text-[#1a2744]"
                aria-label="Cerrar"
              >
                <X size={16} strokeWidth={2.25} />
              </button>
            </div>

            <div
              className={cn(
                'tour-ficha-media relative shrink-0 bg-[#dfe3ea]',
                expanded
                  ? 'aspect-[16/10] max-h-[28%] min-h-[6.5rem]'
                  : 'aspect-[16/10] max-h-[10rem] min-h-[6rem]',
              )}
            >
              {displayUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={displayUrl}
                  src={displayUrl}
                  alt={activeImage?.label ?? 'Vista'}
                  decoding="async"
                  fetchPriority="high"
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-[#6b7280]">
                  Sin imágenes
                </div>
              )}

              <button
                type="button"
                onClick={onClose}
                className="absolute top-2.5 right-2.5 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white text-[#1a2744] shadow-md"
                aria-label="Cerrar"
              >
                <X size={16} strokeWidth={2.25} />
              </button>

              {onBack ? (
                <button
                  type="button"
                  onClick={onBack}
                  className="absolute top-2.5 left-2.5 z-10 flex h-8 items-center gap-1 rounded-full bg-white px-2.5 text-[11px] font-semibold tracking-[0.08em] text-[#1a2744] uppercase shadow-md"
                  aria-label="Volver"
                >
                  <ChevronLeft size={16} strokeWidth={2.25} />
                  Volver
                </button>
              ) : null}

              {carousel.length > 1 ? (
                <>
                  <button
                    type="button"
                    aria-label="Anterior"
                    onClick={() => goSlide(safeSlide - 1)}
                    className="absolute top-1/2 left-2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-[#1a2744] shadow"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    type="button"
                    aria-label="Siguiente"
                    onClick={() => goSlide(safeSlide + 1)}
                    className="absolute top-1/2 right-2 z-10 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 text-[#1a2744] shadow"
                  >
                    <ChevronRight size={18} />
                  </button>
                  <div className="absolute bottom-2 left-1/2 z-10 flex max-w-[90%] -translate-x-1/2 gap-1 overflow-x-auto px-1">
                    {carousel.map((item, index) => (
                      <button
                        key={item.id}
                        type="button"
                        aria-label={`Imagen ${index + 1}`}
                        onClick={() => goSlide(index)}
                        className={cn(
                          'h-1.5 shrink-0 rounded-full transition-all',
                          index === safeSlide ? 'w-3.5 bg-white' : 'w-1.5 bg-white/55',
                        )}
                      />
                    ))}
                  </div>
                </>
              ) : null}
            </div>

            {sorted.length === 0 ? (
              <div className="flex flex-1 items-center justify-center px-6 py-8 text-center text-sm text-[#6b7280]">
                Todavía no hay unidades publicadas para esta tipología.
              </div>
            ) : unit ? (
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                {sorted.length > 1 ? (
                  <div className="flex shrink-0 gap-1.5 overflow-x-auto border-b border-[#eceff3] px-3 py-1.5">
                    {sorted.map((item) => {
                      const active = item.id === unit.id
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => pickUnit(item)}
                          className={cn(
                            'shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium',
                            active
                              ? 'bg-[#2B1A18] text-white'
                              : 'bg-[#f3f4f6] text-[#4b5563]',
                          )}
                        >
                          {item.unit_number}
                        </button>
                      )
                    })}
                  </div>
                ) : null}

                <div className="tour-ficha-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-2.5 pb-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-[1.15rem] leading-none font-bold tracking-tight text-[#1a2744]">
                      Unidad {unit.unit_number}
                    </h2>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] font-semibold',
                        statusBadgeClass(unit.status),
                      )}
                    >
                      {statusLabel(unit.status)}
                    </span>
                  </div>
                  {expanded && typologyCode ? (
                    <p className="mt-1 text-[11px] tracking-[0.06em] text-[#6b7280] uppercase">
                      {typologyCode}
                      {typologyName ? ` · ${typologyName}` : ''}
                    </p>
                  ) : null}
                  <p className="mt-1 text-[1.2rem] font-bold tracking-tight text-[#2B1A18] tabular-nums">
                    {formatPrice(unit.published_commercial_price)}
                  </p>

                  {onRequestInfo ? (
                    <button
                      type="button"
                      onClick={() => onRequestInfo(unit)}
                      className="mt-3 flex h-10 w-full items-center justify-center gap-2 bg-[#BDA27E] text-[11px] font-semibold tracking-[0.16em] text-[#2B1A18] uppercase transition-colors hover:bg-[#ad926e]"
                    >
                      <Mail size={15} strokeWidth={2} />
                      Solicitar información
                    </button>
                  ) : null}

                  {!unitAvailable ? (
                    <button
                      type="button"
                      onClick={() => setShowSuggestions((value) => !value)}
                      className="mt-2 flex h-10 w-full items-center justify-center gap-2 border border-[#2B1A18]/15 bg-white text-[11px] font-semibold tracking-[0.16em] text-[#2B1A18] uppercase transition-colors hover:bg-[#2B1A18]/5"
                    >
                      {showSuggestions ? 'Ocultar sugerencias' : 'Ver sugerencias'}
                    </button>
                  ) : null}

                  {showSuggestions && !unitAvailable ? (
                    <div className="mt-3 rounded-xl border border-[#2B1A18]/10 bg-[#f7f3ee]/80 p-3">
                      <p className="text-[10px] font-semibold tracking-[0.14em] text-[#BDA27E] uppercase">
                        Unidades similares disponibles
                      </p>
                      {similarUnits.length === 0 ? (
                        <p className="mt-2 text-[12px] leading-relaxed text-[#2B1A18]/60">
                          No encontramos alternativas con las mismas características ahora. Pedí
                          información y te ayudamos a buscar.
                        </p>
                      ) : (
                        <ul className="mt-2 space-y-1.5">
                          {similarUnits.map((item) => (
                            <li key={item.id}>
                              <button
                                type="button"
                                onClick={() => pickUnit(item)}
                                className="flex w-full items-center justify-between gap-2 rounded-lg bg-white px-2.5 py-2 text-left ring-1 ring-[#2B1A18]/8 transition-colors hover:ring-[#BDA27E]/50"
                              >
                                <span className="min-w-0">
                                  <span className="block text-[12px] font-semibold text-[#2B1A18]">
                                    Unidad {item.unit_number}
                                  </span>
                                  <span className="mt-0.5 block text-[11px] text-[#2B1A18]/55">
                                    {[
                                      item.typology_code,
                                      item.bedrooms != null ? `${item.bedrooms} dorm.` : null,
                                      item.area_total_m2 != null
                                        ? formatAreaM2(item.area_total_m2)
                                        : null,
                                      item.floor?.trim() || null,
                                    ]
                                      .filter(Boolean)
                                      .join(' · ')}
                                  </span>
                                </span>
                                <span className="shrink-0 text-[11px] font-semibold text-[#2B1A18] tabular-nums">
                                  {formatPrice(item.published_commercial_price)}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : null}

                  {expanded ? (
                    <p className="mt-4 mb-1 text-[10px] font-semibold tracking-[0.14em] text-[#BDA27E] uppercase">
                      Especificaciones
                    </p>
                  ) : null}

                  <div className={expanded ? 'mt-0' : 'mt-0.5'}>
                    {displayRows.map((row) => (
                      <SpecRow
                        key={row.label}
                        icon={specIcon(row.label)}
                        label={row.label}
                        value={row.value}
                      />
                    ))}
                  </div>

                  {expanded && unit.spaces && unit.spaces.length > 0 ? (
                    <div className="mt-3">
                      <p className="mb-1.5 text-[10px] font-semibold tracking-[0.14em] text-[#BDA27E] uppercase">
                        Espacios
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {unit.spaces.map((space) => (
                          <span
                            key={space}
                            className="rounded-full bg-[#f3f4f6] px-2.5 py-1 text-[11px] text-[#4b5563]"
                          >
                            {space}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {expanded && carousel.length > 0 ? (
                    <div className="tour-ficha-gallery-grid mt-4 pb-1">
                      <p className="mb-1.5 text-[10px] font-semibold tracking-[0.14em] text-[#BDA27E] uppercase">
                        Galería ({carousel.length})
                      </p>
                      <div className="grid grid-cols-3 gap-1.5">
                        {carousel.map((item, index) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => goSlide(index)}
                            className={cn(
                              'relative aspect-square overflow-hidden rounded-md ring-1 ring-[#2B1A18]/10',
                              index === safeSlide && 'ring-2 ring-[#BDA27E]',
                            )}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={item.url}
                              alt={item.label}
                              className="h-full w-full object-cover"
                              loading="lazy"
                            />
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>

                {expanded ? (
                  <div className="grid shrink-0 grid-cols-[1fr_auto] gap-2 border-t border-[#2B1A18]/8 bg-white p-3">
                    <button
                      type="button"
                      disabled={pdfBusy}
                      onClick={() => void onDownloadPdf()}
                      className="flex h-10 items-center justify-center gap-1.5 bg-[#BDA27E] text-[11px] font-semibold tracking-[0.16em] text-[#2B1A18] uppercase transition-colors hover:bg-[#ad926e] disabled:opacity-60"
                    >
                      <Download size={14} strokeWidth={2} />
                      {pdfBusy ? 'Generando…' : 'Descargar PDF'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onShare()}
                      className="flex h-10 w-10 items-center justify-center border border-[#2B1A18]/12 bg-white text-[#2B1A18] transition-colors hover:bg-[#2B1A18]/5"
                      aria-label="Compartir"
                    >
                      <Share2 size={15} strokeWidth={1.75} />
                    </button>
                  </div>
                ) : (
                  <div className="grid shrink-0 grid-cols-2 gap-2 border-t border-[#2B1A18]/8 bg-white px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        if (onVerFicha) onVerFicha(unit)
                      }}
                      className="flex h-9 items-center justify-center bg-[#BDA27E] text-[11px] font-semibold tracking-[0.16em] text-[#2B1A18] uppercase transition-colors hover:bg-[#ad926e]"
                    >
                      Ver Ficha
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onTour360?.(unit)
                      }}
                      className="flex h-9 items-center justify-center gap-1.5 border border-[#2B1A18]/15 bg-white text-[11px] font-semibold tracking-[0.16em] text-[#2B1A18] uppercase transition-colors hover:bg-[#2B1A18]/5"
                    >
                      <Rotate3d size={15} strokeWidth={1.75} />
                      Tour 360°
                    </button>
                  </div>
                )}
              </div>
            ) : null}
          </motion.aside>
        </>
      ) : null}
    </AnimatePresence>
  )
}
