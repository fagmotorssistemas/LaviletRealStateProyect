'use client'

import { useTourLanguage } from '@/lib/tour/tourLocale'

import { UnitPublicQr } from './UnitPublicQr'

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
  Images,
  Ruler,
  Share2,
  X,
} from 'lucide-react'
import { UNIT_STATUS_OPTIONS, type UnitStatus } from '@/types/inmobiliaria'
import type { TourUnitSummary } from '@/types/tour'
import { buildFichaSpecRows, formatAreaM2 } from '@/lib/tour/fichaSpecs'
import { preloadStill } from '@/lib/tour/stillPreload'
import { cn } from '@/lib/utils'
import { useShowroomSheet } from '@/components/tour/useShowroomSheet'
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
  /** Locales: el segundo botón abre la galería, no el 360. */
  galleryOnly?: boolean
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

function formatPrice(value: number | null, locale: string = 'es') {
  if (value == null) return 'Consultar'
  const amount = new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'es-AR', { maximumFractionDigits: 0 }).format(value)
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
  tile = false,
}: {
  icon?: ReactNode
  label: string
  value: string
  tile?: boolean
}) {
  const { t } = useTourLanguage()

  if (tile) {
    return (
      <div className="tour-ficha-tile flex min-h-[4.5rem] flex-col justify-between rounded-2xl bg-[#f6f3ee] px-3 py-2.5 sm:min-h-[8rem] sm:px-3.5 sm:py-3.5">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold leading-none tracking-normal text-[#8a7760] uppercase">
          {icon ? <span className="shrink-0 text-[#8e7654]">{t(icon)}</span> : null}
          {t(label)}
        </span>
        <p className="mt-1.5 text-base leading-tight font-semibold text-[#1a2744] sm:mt-2 sm:text-xl">{t(value)}</p>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 border-b border-[#eceff3] py-1.5 last:border-b-0">
      {icon ? (
        <span className="flex h-6 w-6 shrink-0 items-center justify-center text-[#6b7280]">
          {t(icon)}
        </span>
      ) : null}
      <p className="min-w-0 flex-1 text-[12px] text-[#4b5563]">{t(label)}</p>
      <p className="max-w-[55%] shrink-0 text-right text-[12px] font-semibold text-[#1a2744] tabular-nums">
        {t(value)}
      </p>
    </div>
  )
}

function specIcon(label: string): ReactNode {
  const key = label.toLowerCase()
  if (key.includes('superficie') || key.includes('terraza')) {
    return <Ruler size={15} strokeWidth={1.6} />
  }
  if (key.includes('dormitorio')) return <BedDouble size={15} strokeWidth={1.6} />
  if (key.includes('baño')) return <Bath size={15} strokeWidth={1.6} />
  if (key.includes('piso') || key.includes('tipolog')) return <Layers size={15} strokeWidth={1.6} />
  return <Ruler size={15} strokeWidth={1.6} />
}

function preloadUrl(url: string) {
  void preloadStill(url)
}

function leadSlide(items: FichaGalleryImage[]) {
  const index = items.findIndex((item) => {
    const id = item.id.replace(/^vista-/, '')
    return id === 'sala' || id.startsWith('sala:')
  })
  if (index >= 0) return index
  const byLabel = items.findIndex((item) => /^sala\b/i.test(item.label.trim()))
  return byLabel >= 0 ? byLabel : 0
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
  galleryOnly = false,
  onRequestInfo,
  onSelectUnit,
  onBack,
  onSelectGalleryImage,
}: TourFichaDrawerProps) {
  const { t, locale } = useTourLanguage()
  const sheetRef = useRef<HTMLElement>(null)
  useShowroomSheet(open, sheetRef)

  const reduceMotion = useReducedMotion()
  const [unitId, setUnitId] = useState<string | null>(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [slide, setSlide] = useState(0)
  const [showSuggestions, setShowSuggestions] = useState(false)
  const lastUrlRef = useRef<string | null>(null)
  const slideTouchedRef = useRef(false)
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
  if (activeImage?.url) lastUrlRef.current = activeImage.url
  const shownUrl = activeImage?.url ?? lastUrlRef.current

  useEffect(() => {
    if (!open) {
      slideTouchedRef.current = false
      setSlide(0)
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
    slideTouchedRef.current = false
    setSlide(leadSlide(images))
    setShowSuggestions(false)
  }, [open, sorted, initialUnitId])

  useEffect(() => {
    if (!open || slideTouchedRef.current) return
    setSlide(leadSlide(images))
  }, [open, images])

  useEffect(() => {
    if (carousel.length === 0) {
      setSlide(0)
      return
    }
    setSlide((i) => Math.min(i, carousel.length - 1))
  }, [carousel.length])

  useEffect(() => {
    if (!activeImage) return
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
    slideTouchedRef.current = true
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
  const detailRows = unit ? buildFichaSpecRows(unit, locale) : []
  // Primera ficha: solo lo básico (como la referencia)
  const compactRows = unit
    ? [
        {
          label: 'Superficie total',
          value: formatAreaM2(unit.area_total_m2 ?? unit.area_internal_m2, locale),
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
  const displayRows = (expanded ? detailRows : compactRows).filter(row=>unit?.category!=='local'||row.label!=='Dormitorios')
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
        locale,
        typologyCode,
        typologyName,
        unit,
        images: carousel.map((item) => ({ label: item.label, url: item.url })),
      })
      toast.success(t('Ficha descargada'))
    } catch {
      toast.error(t('No se pudo generar la ficha'))
    } finally {
      setPdfBusy(false)
    }
  }

  const onShare = async () => {
    if (!unit) return
    const { buildUnitShareUrl } = await import('@/lib/tour/unitDeepLink')
    const url = buildUnitShareUrl(unit.unit_number, { locale })
    const title = `La Vilet · ${t(`Unidad ${unit.unit_number}`)}`
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({ title, url, text: url })
        return
      }
      await navigator.clipboard.writeText(url)
      toast.success(t(`Enlace de la unidad ${unit.unit_number} copiado`))
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
      try {
        await navigator.clipboard.writeText(url)
        toast.success(t(`Enlace de la unidad ${unit.unit_number} copiado`))
      } catch {
        toast.error(t('No se pudo copiar el enlace'))
      }
    }
  }

  return (
    <AnimatePresence>
      {open ? (
        <>
          <motion.div
            aria-hidden="true"
            className={cn(
              'pointer-events-none z-[60] bg-transparent',
              contained ? 'absolute inset-0' : 'fixed inset-0',
            )}
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0 }}
          />

          <motion.aside
            ref={sheetRef}
            role="dialog"
            aria-modal="true"
            aria-label={t("Ficha técnica")}
            className={cn(
              'tour-modal-sheet tour-ficha-sheet z-[95] flex flex-col overflow-hidden rounded-[1.75rem] bg-white shadow-[0_12px_40px_rgba(15,23,42,0.22)]',
              'w-[min(22.5rem,calc(100%-1.5rem))] left-3 sm:left-4',
              // Reserve the showroom toolbar in both embedded and fullscreen layouts.
              'top-[calc(4.75rem+env(safe-area-inset-top))] bottom-[max(0.75rem,env(safe-area-inset-bottom))]',
              contained ? 'absolute' : 'fixed',
            )}
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={reduceMotion ? undefined : { opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 36 }}
            onWheel={(event) => event.stopPropagation()}
          >
            <div className="tour-ficha-shorthead relative z-10 shrink-0 items-center gap-2 border-b border-[#eceff3] bg-white px-3">
              <p className="min-w-0 flex-1 truncate text-[13px] leading-none font-bold text-[#1a2744]">
                {unit
                  ? `${t('Unidad')} ${unit.unit_number} · ${formatPrice(unit.published_commercial_price, locale)}`
                  : t('Ficha técnica')}
              </p>
              <button
                type="button"
                onClick={onClose}
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#f3f4f6] text-[#1a2744]"
                aria-label={t('Cerrar')}
              >
                <X size={16} strokeWidth={2.25} />
              </button>
            </div>
            {/* Header compacto en celular (sin imágenes). */}
            <div className="tour-ficha-chrome-mobile shrink-0 items-center justify-between gap-2 border-b border-[#eceff3] bg-white px-3 py-2.5">
              {onBack ? (
                <button
                  type="button"
                  onClick={onBack}
                  className="flex h-8 items-center gap-1 rounded-full bg-[#f3f4f6] px-2.5 text-[11px] font-semibold tracking-[0.08em] text-[#1a2744] uppercase"
                  aria-label={t(expanded ? 'Volver a ficha resumida' : 'Volver')}
                >
                  <ChevronLeft size={16} strokeWidth={2.25} />
                  {t(expanded ? 'Resumen' : 'Volver')}
                </button>
              ) : (
                <p className="text-[11px] font-semibold tracking-[0.14em] text-[#BDA27E] uppercase">
                  {t(expanded ? 'Ficha completa' : 'Ficha técnica')}
                </p>
              )}
              <button
                type="button"
                onClick={onClose}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f3f4f6] text-[#1a2744]"
                aria-label={t("Cerrar")}
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
              {shownUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={shownUrl}
                  src={shownUrl}
                  alt={t(activeImage?.label ?? 'Vista')}
                  decoding="async"
                  fetchPriority="high"
                  className="absolute inset-0 h-full w-full object-cover"
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-sm text-[#6b7280]">
                  {t(" Sin imágenes ")}</div>
              )}

              <button
                type="button"
                onClick={onClose}
                className="absolute top-2.5 right-2.5 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-white text-[#1a2744] shadow-md"
                aria-label={t("Cerrar")}
              >
                <X size={16} strokeWidth={2.25} />
              </button>

              {onBack ? (
                <button
                  type="button"
                  onClick={onBack}
                  className="absolute top-2.5 left-2.5 z-10 flex h-8 items-center gap-1 rounded-full bg-white px-2.5 text-[11px] font-semibold tracking-[0.08em] text-[#1a2744] uppercase shadow-md"
                  aria-label={t("Volver")}
                >
                  <ChevronLeft size={16} strokeWidth={2.25} />
                  {t(" Volver ")}</button>
              ) : null}

              {carousel.length > 1 ? (
                <div className="absolute inset-x-2 bottom-2 z-10 flex items-center gap-1.5">
                  <button
                    type="button"
                    aria-label={t("Anterior")}
                    onClick={() => goSlide(safeSlide - 1)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/95 text-[#1a2744] shadow"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <div className="flex min-w-0 flex-1 items-center justify-center gap-1 overflow-x-auto px-1">
                    {carousel.map((item, index) => (
                      <button
                        key={item.id}
                        type="button"
                        aria-label={t(`Imagen ${index + 1}`)}
                        onClick={() => goSlide(index)}
                        className={cn(
                          'h-1.5 shrink-0 rounded-full transition-all',
                          index === safeSlide ? 'w-3.5 bg-white' : 'w-1.5 bg-white/55',
                        )}
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    aria-label={t("Siguiente")}
                    onClick={() => goSlide(safeSlide + 1)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/95 text-[#1a2744] shadow"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              ) : null}
            </div>

            {sorted.length === 0 ? (
              <div className="flex flex-1 items-center justify-center px-6 py-8 text-center text-sm text-[#6b7280]">
                {t(" Todavía no hay unidades publicadas para esta tipología. ")}</div>
            ) : unit ? (
              <div className="tour-ficha-body flex min-h-0 flex-1 flex-col overflow-hidden">
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
                          {t(item.unit_number)}
                        </button>
                      )
                    })}
                  </div>
                ) : null}

                <div className="tour-ficha-scroll flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-4 pt-2.5 pb-1.5">
                  <div className="flex flex-col">
                  <div className="tour-ficha-identity flex flex-wrap items-center gap-2">
                    <h2 className="text-[1.35rem] leading-none font-bold tracking-tight text-[#1a2744]">
                      {t(" Unidad ")}{t(unit.unit_number)}
                    </h2>
                    <span
                      className={cn(
                        'rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] uppercase',
                        statusBadgeClass(unit.status),
                      )}
                    >
                      {t(statusLabel(unit.status))}
                    </span>
                    {`${unit.category ?? ''} ${unit.typology_code ?? ''} ${typologyName ?? ''} ${typologyCode ?? ''}`.toLowerCase().includes('penthouse') ? (
                      <span className="rounded-full bg-[#9a3b2f] px-2 py-0.5 text-[10px] font-semibold tracking-[0.14em] text-white">
                        HOT
                      </span>
                    ) : null}
                  </div>
                  <p className="tour-ficha-identity mt-2 text-[1.45rem] font-bold tracking-tight text-[#2B1A18] tabular-nums">
                    {t(formatPrice(unit.published_commercial_price, locale))}
                  </p>

                  {onRequestInfo ? (
                    <button
                      type="button"
                      onClick={() => onRequestInfo(unit)}
                      className="tour-modal-submit mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#BDA27E] text-[11px] font-semibold tracking-[0.16em] text-[#2B1A18] uppercase transition-colors hover:bg-[#ad926e]"
                    >
                      <Mail size={15} strokeWidth={2} />
                      {t(" Solicitar información ")}</button>
                  ) : null}

                  {!unitAvailable ? (
                    <button
                      type="button"
                      onClick={() => setShowSuggestions((value) => !value)}
                      className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-full border border-[#2B1A18]/15 bg-white text-[11px] font-semibold tracking-[0.16em] text-[#2B1A18] uppercase transition-colors hover:bg-[#2B1A18]/5"
                    >
                      {t(showSuggestions ? 'Ocultar sugerencias' : 'Ver sugerencias')}
                    </button>
                  ) : null}

                  {showSuggestions && !unitAvailable ? (
                    <div className="mt-3 rounded-xl border border-[#2B1A18]/10 bg-[#f7f3ee]/80 p-3">
                      <p className="text-[10px] font-semibold tracking-[0.14em] text-[#BDA27E] uppercase">
                        {t(" Unidades similares disponibles ")}</p>
                      {similarUnits.length === 0 ? (
                        <p className="mt-2 text-[12px] leading-relaxed text-[#2B1A18]/60">
                          {t(" No encontramos alternativas con las mismas características ahora. Pedí información y te ayudamos a buscar. ")}</p>
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
                                    {t(" Unidad ")}{t(item.unit_number)}
                                  </span>
                                  <span className="mt-0.5 block text-[11px] text-[#2B1A18]/55">
                                    {t([
                                      item.typology_code,
                                      item.bedrooms != null ? `${item.bedrooms} dorm.` : null,
                                      item.area_total_m2 != null
                                        ? formatAreaM2(item.area_total_m2, locale)
                                        : null,
                                      item.floor?.trim() || null,
                                    ]
                                      .filter(Boolean)
                                      .join(' · '))}
                                  </span>
                                </span>
                                <span className="shrink-0 text-[11px] font-semibold text-[#2B1A18] tabular-nums">
                                  {t(formatPrice(item.published_commercial_price, locale))}
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
                      {t(" Especificaciones ")}</p>
                  ) : null}

                  <div className={expanded ? 'tour-ficha-specs mt-3' : 'tour-ficha-specs mt-4 grid grid-cols-2 gap-2.5'}>
                    {displayRows.map((row) => (
                      <SpecRow
                        key={row.label}
                        tile={!expanded}
                        icon={specIcon(row.label)}
                        label={t(row.label)}
                        value={row.value}
                      />
                    ))}
                  </div>

                  {expanded ? <UnitPublicQr number={unit.unit_number} /> : null}
                  </div>
                </div>

                {expanded ? (
                  <div className="tour-ficha-footer flex shrink-0 items-center gap-2 border-t border-[#2B1A18]/8 bg-white px-3 py-2.5">
                    <button
                      type="button"
                      disabled={pdfBusy}
                      onClick={() => void onDownloadPdf()}
                      className="tour-ficha-pdf flex h-11 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full bg-[#BDA27E] text-[11px] font-semibold tracking-[0.16em] text-[#2B1A18] uppercase transition-colors hover:bg-[#ad926e] disabled:opacity-60"
                    >
                      <Download size={14} strokeWidth={2} />
                      {t(pdfBusy ? 'Generando…' : 'Descargar PDF')}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onShare()}
                      className="tour-ficha-share-btn flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#2B1A18]/12 bg-white text-[#2B1A18]"
                      aria-label={t('Compartir')}
                    >
                      <Share2 size={16} strokeWidth={1.75} />
                    </button>
                  </div>
                ) : (
                  <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 border-t border-[#2B1A18]/8 bg-white px-3 py-2.5">
                    <button
                      type="button"
                      onClick={() => {
                        if (onVerFicha) onVerFicha(unit)
                      }}
                      className="flex h-11 min-w-0 items-center justify-center rounded-full bg-[#BDA27E] px-2 text-center text-[11px] font-semibold tracking-[0.16em] text-[#2B1A18] uppercase transition-colors hover:bg-[#ad926e]"
                    >
                      {t(" Ver Ficha ")}</button>
                    <button
                      type="button"
                      onClick={() => {
                        onTour360?.(unit)
                      }}
                      className="flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-full border border-[#2B1A18]/15 bg-white px-2 text-center text-[11px] font-semibold tracking-[0.16em] text-[#2B1A18] uppercase transition-colors hover:bg-[#2B1A18]/5"
                    >
                      {galleryOnly ? <Images size={15} strokeWidth={1.75} /> : <Rotate3d size={15} strokeWidth={1.75} />}
                      {t(galleryOnly ? 'Galería' : ' Tour 360° ')}</button>
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
