'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Minus, Plus } from 'lucide-react'
import { useTourLanguage } from '@/lib/tour/tourLocale'
import { useDualBuffer } from '@/components/tour/useDualBuffer'
import { preloadStill } from '@/lib/tour/stillPreload'

type AmenitySlide = {
  title: string
  titleEn: string
  imageUrl: string
}

/** Zoom 1 es la foto a pantalla completa. Por debajo, se abre hasta que toca los bordes. */
function amenityFit(box: { w: number; h: number }, aspect: number, zoom: number) {
  if (box.w < 8 || box.h < 8 || aspect <= 0) return null
  const boxAspect = box.w / box.h
  const coverH = boxAspect > aspect ? box.w / aspect : box.h
  const containH = boxAspect > aspect ? box.h : box.w / aspect
  const minZoom = coverH > 0 ? containH / coverH : 1
  const clamped = Math.min(1, Math.max(minZoom, zoom))
  const span = Math.max(0.0001, 1 - minZoom)
  const height = clamped >= 1 ? coverH : containH + (coverH - containH) * ((clamped - minZoom) / span)
  return {
    minZoom: Math.min(1, minZoom),
    style: {
      width: height * aspect,
      height,
      maxWidth: 'none' as const,
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
    },
  }
}

export function TourAmenitiesGallery({ open }: { open: boolean }) {
  const { locale, t } = useTourLanguage()
  const [items, setItems] = useState<AmenitySlide[]>([])
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [index, setIndex] = useState(0)
  const [zoom, setZoom] = useState(1)
  const stageRef = useRef<HTMLDivElement>(null)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchRef = useRef<{ dist: number; scale: number } | null>(null)
  const [aspect, setAspect] = useState(1.6)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const fit = amenityFit(box, aspect, zoom)
  const zoomMin = fit?.minZoom ?? 1

  useEffect(() => {
    if (open) setZoom(1)
  }, [open])

  useEffect(() => {
    const el = stageRef.current
    if (!el || !open) return
    const sync = () => {
      const rect = el.getBoundingClientRect()
      setBox({ w: rect.width, h: rect.height })
    }
    sync()
    const obs = new ResizeObserver(sync)
    obs.observe(el)
    return () => obs.disconnect()
  }, [open])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setState((current) => (current === 'ready' ? current : 'loading'))
    void fetch('/api/tour/amenities')
      .then(async (response) => {
        if (!response.ok) throw new Error('amenities')
        return response.json() as Promise<{ items: AmenitySlide[] }>
      })
      .then((data) => {
        if (cancelled) return
        const next = data.items ?? []
        setItems(next)
        setState('ready')
      })
      .catch(() => {
        if (!cancelled) setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [open])

  const count = items.length
  const step = useCallback(
    (delta: -1 | 1) => {
      if (count < 2) return
      setIndex((current) => (current + delta + count) % count)
      setZoom(1)
    },
    [count],
  )

  useEffect(() => {
    if (!open || count === 0) return
    const current = items[index]
    const next = items[(index + 1) % count]
    const prev = items[(index - 1 + count) % count]
    void preloadStill(current?.imageUrl)
    void preloadStill(next?.imageUrl)
    void preloadStill(prev?.imageUrl)
  }, [open, items, index, count])

  const slide = open ? items[index] : undefined
  const caption = slide
    ? (locale === 'en' ? slide.titleEn : slide.title)
        .replace(/[-_\s]?r\d{6,}/gi, '')
        .replace(/\s+\d+\s*$/u, '')
        .replace(/\s+/g, ' ')
        .trim()
    : ''
  const buffers = useDualBuffer(slide?.imageUrl ?? null)

  if (!open) return null

  return (
    <div
      ref={stageRef}
      className="absolute inset-0 z-[80] overflow-hidden bg-[#14110e]"
      onPointerDown={(event) => {
        if (event.button !== 0) return
        pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
        if (pointersRef.current.size >= 2) {
          const pts = [...pointersRef.current.values()]
          const a = pts[0]
          const b = pts[1]
          if (a && b) {
            pinchRef.current = {
              dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
              scale: zoom,
            }
          }
          startRef.current = null
          return
        }
        startRef.current = { x: event.clientX, y: event.clientY }
      }}
      onPointerMove={(event) => {
        if (!pointersRef.current.has(event.pointerId)) return
        pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
        if (pointersRef.current.size < 2 || !pinchRef.current) return
        const pts = [...pointersRef.current.values()]
        const a = pts[0]
        const b = pts[1]
        if (!a || !b) return
        const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y))
        const next = Math.max(zoomMin, Math.min(1, pinchRef.current.scale * (dist / pinchRef.current.dist)))
        setZoom(Number(next.toFixed(3)))
      }}
      onPointerUp={(event) => {
        pointersRef.current.delete(event.pointerId)
        if (pointersRef.current.size < 2) pinchRef.current = null
        const start = startRef.current
        startRef.current = null
        if (!start || count < 2 || pointersRef.current.size > 0) return
        const dx = event.clientX - start.x
        const dy = event.clientY - start.y
        if (Math.abs(dx) < 48 || Math.abs(dx) <= Math.abs(dy) * 1.2) return
        step(dx < 0 ? 1 : -1)
      }}
      onPointerCancel={() => {
        pointersRef.current.clear()
        pinchRef.current = null
        startRef.current = null
      }}
    >
      {slide ? (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={slide.imageUrl}
            alt=""
            aria-hidden
            draggable={false}
            className="pointer-events-none absolute inset-[-12%] h-[124%] w-[124%] max-w-none object-cover"
            style={{ filter: 'blur(28px) brightness(0.72) saturate(1.05)' }}
          />
          {(['a', 'b'] as const).map((slot) => {
            const src = buffers.assigned[slot]
            if (!src) return null
            return (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                key={slot}
                ref={slot === 'a' ? buffers.aRef : buffers.bRef}
                src={src}
                alt={buffers.front === slot ? caption : ''}
                draggable={false}
                decoding="async"
                fetchPriority={buffers.front === slot ? 'high' : 'low'}
                onLoad={
                  buffers.front === slot
                    ? (event) => {
                        const img = event.currentTarget
                        if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                          setAspect(img.naturalWidth / img.naturalHeight)
                        }
                      }
                    : undefined
                }
                style={fit?.style}
                className={`pointer-events-none absolute object-cover object-center transition-opacity duration-[400ms] ease-linear ${buffers.front === slot ? 'opacity-100' : 'opacity-0'} ${fit ? 'max-w-none' : 'inset-0 h-full w-full'}`}
              />
            )
          })}
        </>
      ) : (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-sm text-[#f7f3ee]">
          {state === 'error'
            ? t('No se pudieron consultar las instalaciones.')
            : state === 'loading' || state === 'idle'
              ? t('Cargando…')
              : t('Aún no hay fotos de amenidades.')}
        </div>
      )}

      {count > 1 ? (
        <>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              step(-1)
            }}
            onPointerDown={(event) => event.stopPropagation()}
            className="tour-gallery-arrow tour-gallery-arrow--prev"
            aria-label={t('Imagen anterior')}
          >
            <ChevronLeft size={22} strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              step(1)
            }}
            onPointerDown={(event) => event.stopPropagation()}
            className="tour-gallery-arrow tour-gallery-arrow--next"
            aria-label={t('Imagen siguiente')}
          >
            <ChevronRight size={22} strokeWidth={2} />
          </button>
        </>
      ) : null}

      <div className="tour-zoom-row pointer-events-auto">
        <button
          type="button"
          aria-label={t('Alejar')}
          disabled={zoom <= zoomMin + 0.01}
          onClick={() => setZoom((value) => Math.max(zoomMin, Math.round((value - 0.25) * 100) / 100))}
          onPointerDown={(event) => event.stopPropagation()}
          className="tour-zoom-btn disabled:opacity-40"
        >
          <Minus size={18} strokeWidth={2.25} />
        </button>
        <button
          type="button"
          aria-label={t('Acercar')}
          disabled={zoom >= 1 - 0.01}
          onClick={() => setZoom((value) => Math.min(1, Math.round((value + 0.25) * 100) / 100))}
          onPointerDown={(event) => event.stopPropagation()}
          className="tour-zoom-btn disabled:opacity-40"
        >
          <Plus size={18} strokeWidth={2.25} />
        </button>
      </div>

    </div>
  )
}
