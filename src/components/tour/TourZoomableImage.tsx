'use client'

import { useEffect, useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { useDualBuffer } from './useDualBuffer'
import { fitStill } from '@/lib/tour/stillFit'
import { useTourLanguage } from '@/lib/tour/tourLocale'

/** Independently measured gallery pane, including when the comparison divider moves. */
export function TourZoomableImage({ src, alt, onStep }: { src: string; alt: string; onStep?: (delta: -1 | 1) => void }) {
  const { t } = useTourLanguage()
  const root = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [aspects, setAspects] = useState<Record<string, number>>({})
  const [zoom, setZoom] = useState(1)
  const buffers = useDualBuffer(src)
  const front = buffers.assigned[buffers.front]
  const fit = fitStill(box, aspects[front || src] || 1.6, zoom)
  const min = fit?.minZoom ?? 1
  const effective = zoom <= min + 0.01 ? min : Math.max(min, zoom)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ distance: number; zoom: number } | null>(null)
  const swipeStart = useRef<{ id: number; x: number; y: number } | null>(null)
  const change = (value: number) => setZoom(Math.max(min, Math.min(1, value)))
  useEffect(() => {
    const element = root.current
    if (!element) return
    const measure = () => setBox({ w: element.clientWidth, h: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    pointers.current.clear()
    pinch.current = null
    swipeStart.current = null
  }, [src])
  const release = (id: number) => {
    pointers.current.delete(id)
    if (pointers.current.size < 2) pinch.current = null
  }
  return <div ref={root} className="absolute inset-0 overflow-hidden touch-none"
    onPointerDown={(event) => {
      if (event.button !== 0) return
      event.currentTarget.setPointerCapture(event.pointerId)
      swipeStart.current = pointers.current.size === 0 && event.pointerType === 'touch'
        ? { id: event.pointerId, x: event.clientX, y: event.clientY }
        : null
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      const [a, b] = [...pointers.current.values()]
      if (a && b) pinch.current = { distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), zoom: effective }
    }}
    onPointerMove={(event) => {
      if (!pointers.current.has(event.pointerId)) return
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      const [a, b] = [...pointers.current.values()]
      if (a && b && pinch.current) change(pinch.current.zoom * Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.distance)
    }}
    onPointerUp={(event) => {
      const start = swipeStart.current
      const singlePointer = pointers.current.size === 1
      swipeStart.current = null
      release(event.pointerId)
      if (!onStep || !singlePointer || start?.id !== event.pointerId) return
      const dx = event.clientX - start.x
      const dy = event.clientY - start.y
      if (Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy) * 1.2) onStep(dx < 0 ? 1 : -1)
    }}
    onPointerCancel={(event) => {
      swipeStart.current = null
      release(event.pointerId)
    }}
    onLostPointerCapture={(event) => {
      swipeStart.current = null
      release(event.pointerId)
    }}>
    {front ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={front}
        alt=""
        aria-hidden
        draggable={false}
        className="pointer-events-none absolute inset-[-12%] h-[124%] w-[124%] max-w-none object-cover"
        style={{ filter: 'blur(28px) brightness(0.72) saturate(1.05)' }}
      />
    ) : null}
    {(['a', 'b'] as const).map((slot) => {
      const url = buffers.assigned[slot]
      if (!url) return null
      return <img // eslint-disable-line @next/next/no-img-element
        key={slot} ref={slot === 'a' ? buffers.aRef : buffers.bRef}
        src={url} alt={slot === buffers.front ? alt : ''} draggable={false}
        onLoad={(event) => {
          const img = event.currentTarget
          if (img.naturalHeight) setAspects((previous) => ({ ...previous, [url]: img.naturalWidth / img.naturalHeight }))
        }}
        className={`absolute object-cover transition-opacity duration-300 ${slot === buffers.front ? 'opacity-100' : 'opacity-0'}`}
        style={fitStill(box, aspects[url] || 1.6, effective)?.style} />
    })}
    <div
      className={`absolute z-[5] flex flex-wrap justify-center gap-2 ${box.w < 170
        ? 'bottom-[calc(var(--fab)+var(--edge-bottom)+var(--fab-gap))] left-1 right-1'
        : 'bottom-3 left-2 right-[calc(var(--fab)+var(--edge-right)+var(--fab-gap))]'}`}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <button type="button" className="tour-zoom-btn" aria-label={t('Acercar')} disabled={effective >= 0.99} onClick={() => change(effective + 0.12)}><Plus size={18} /></button>
      <button type="button" className="tour-zoom-btn" aria-label={t('Alejar')} disabled={effective <= min + 0.01} onClick={() => change(effective - 0.12)}><Minus size={18} /></button>
    </div>
  </div>
}
