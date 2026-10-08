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

export function TourAmenitiesGallery({ open }: { open: boolean }) {
  const { locale, t } = useTourLanguage()
  const [items, setItems] = useState<AmenitySlide[]>([])
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [index, setIndex] = useState(0)
  const [zoom, setZoom] = useState(1)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const pointersRef = useRef(new Map<number, { x: number; y: number }>())
  const pinchRef = useRef<{ dist: number; scale: number } | null>(null)
  const aspectRef = useRef(1.6)

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
        const box = event.currentTarget.getBoundingClientRect()
        const boxAspect = box.height > 0 ? box.width / box.height : 1
        const contain = Math.min(boxAspect, aspectRef.current) / Math.max(boxAspect, aspectRef.current)
        const next = Math.max(contain, Math.min(3, pinchRef.current.scale * (dist / pinchRef.current.dist)))
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
                          aspectRef.current = img.naturalWidth / img.naturalHeight
                        }
                      }
                    : undefined
                }
                className={`absolute inset-0 h-full w-full origin-center object-cover transition-opacity duration-[400ms] ease-linear ${buffers.front === slot ? 'opacity-100' : 'opacity-0'}`}
                style={{ transform: `scale(${zoom})` }}
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
          disabled={zoom <= 0.45}
          onClick={() => setZoom((value) => Math.max(0.45, Math.round((value - 0.25) * 100) / 100))}
          onPointerDown={(event) => event.stopPropagation()}
          className="tour-zoom-btn disabled:opacity-40"
        >
          <Minus size={18} strokeWidth={2.25} />
        </button>
        <button
          type="button"
          aria-label={t('Acercar')}
          disabled={zoom >= 3}
          onClick={() => setZoom((value) => Math.min(3, Math.round((value + 0.25) * 100) / 100))}
          onPointerDown={(event) => event.stopPropagation()}
          className="tour-zoom-btn disabled:opacity-40"
        >
          <Plus size={18} strokeWidth={2.25} />
        </button>
      </div>

    </div>
  )
}
