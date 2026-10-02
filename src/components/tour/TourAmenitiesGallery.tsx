'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
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
  const startRef = useRef<{ x: number; y: number } | null>(null)

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
  const caption = slide ? (locale === 'en' ? slide.titleEn : slide.title) : ''
  const buffers = useDualBuffer(slide?.imageUrl ?? null)

  if (!open) return null

  return (
    <div
      className="absolute inset-0 z-[80] bg-[#14110e]"
      onPointerDown={(event) => {
        if (event.button !== 0) return
        startRef.current = { x: event.clientX, y: event.clientY }
      }}
      onPointerUp={(event) => {
        const start = startRef.current
        startRef.current = null
        if (!start || count < 2) return
        const dx = event.clientX - start.x
        const dy = event.clientY - start.y
        if (Math.abs(dx) < 48 || Math.abs(dx) <= Math.abs(dy) * 1.2) return
        step(dx < 0 ? 1 : -1)
      }}
      onPointerCancel={() => {
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
                className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-[400ms] ease-linear ${buffers.front === slot ? 'opacity-100' : 'opacity-0'}`}
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
            className="absolute top-1/2 left-[max(0.4rem,env(safe-area-inset-left))] z-[2] flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white shadow-md ring-1 ring-white/25 backdrop-blur-sm transition hover:bg-black/60 sm:left-[max(0.5rem,env(safe-area-inset-left))] sm:h-11 sm:w-11"
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
            className="absolute top-1/2 right-[max(0.4rem,env(safe-area-inset-right))] z-[2] flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white shadow-md ring-1 ring-white/25 backdrop-blur-sm transition hover:bg-black/60 sm:right-[max(0.5rem,env(safe-area-inset-right))] sm:h-11 sm:w-11"
            aria-label={t('Imagen siguiente')}
          >
            <ChevronRight size={22} strokeWidth={2} />
          </button>
        </>
      ) : null}

      {caption ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-[max(1rem,calc(env(safe-area-inset-bottom)+0.75rem))] z-[3] flex justify-center px-3">
          <div className="max-w-[min(100%,18rem)] truncate rounded-full bg-black/45 px-3.5 py-1.5 text-center text-[11px] font-semibold tracking-[0.12em] text-white uppercase shadow-md ring-1 ring-white/20 backdrop-blur-sm sm:text-[12px]">
            {caption}
          </div>
        </div>
      ) : null}
    </div>
  )
}
