'use client'

import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { ConstructionUpdate } from '@/lib/tour/constructionProgress'
import { useTourLanguage } from '@/lib/tour/tourLocale'

function updateDate(date: string, full = false) {
  const label = new Date(`${date}T12:00:00Z`).toLocaleDateString('es-EC', full
    ? { day: 'numeric', month: 'long', year: 'numeric' }
    : { month: 'long', year: 'numeric' })
  return full ? label : label.replace(' de ', ' ')
}

export function TourConstructionBoard({ open, onClose, onOpenPhoto }: {
  open: boolean
  onClose: () => void
  onOpenPhoto: (index: number) => void
}) {
  const { t } = useTourLanguage()
  const [items, setItems] = useState<ConstructionUpdate[]>([])
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    void (async () => {
      setState('loading')
      try {
        const response = await fetch('/api/tour/construction-updates', { cache: 'no-store', signal: controller.signal })
        if (!response.ok) throw new Error('construction')
        const data = await response.json() as { items?: ConstructionUpdate[] }
        if (controller.signal.aborted) return
        setItems(data.items ?? [])
        setState('ready')
      } catch {
        if (!controller.signal.aborted) setState('error')
      }
    })()
    return () => controller.abort()
  }, [open])

  if (!open) return null

  const photos = items.flatMap(update => update.media.filter(media => media.type === 'image').map(media => ({ media, date: update.date })))
  const videos = items.flatMap(update => update.media.filter(media => media.type === 'video').map(media => ({ media, date: update.date })))
  const ready = state === 'ready'

  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-label={t('Avance de obra')}
      className="absolute inset-0 z-[80] overflow-x-hidden overflow-y-auto bg-[#f7f3ee]"
      style={{
        paddingTop: 'max(1.5rem, env(safe-area-inset-top))',
        paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))',
        paddingLeft: 'max(1.5rem, env(safe-area-inset-left))',
        paddingRight: 'max(1.5rem, env(safe-area-inset-right))',
      }}
    >
      <button type="button" onClick={onClose} aria-label={t('Cerrar')}
        className="absolute z-10 grid h-10 w-10 place-items-center rounded-full border border-[#bda27e]/50 text-[#8e7654] hover:bg-[#eae3d8] focus-visible:outline-2 focus-visible:outline-[#8e7654]"
        style={{ top: 'max(1rem, env(safe-area-inset-top))', right: 'max(1rem, env(safe-area-inset-right))' }}>
        <X size={20} />
      </button>
      <div className="mx-auto grid max-w-[1600px] gap-8 pt-12 lg:grid-cols-[minmax(14rem,0.65fr)_minmax(0,2fr)]">
        <header>
          <h2 className="font-serif text-[clamp(1.75rem,4vw,2.5rem)] text-[#29251e]">{t('Avance de obra')}</h2>
          {ready && items[0] ? <p className="mt-3 text-[11px] tracking-[0.16em] text-[#8e7654] uppercase">
            {t('Última actualización')} <time dateTime={items[0].date}>{updateDate(items[0].date, true)}</time>
          </p> : null}
        </header>
        {ready && (photos.length > 0 || videos.length > 0) ? (
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {photos.map(({ media, date }, index) => (
              <button key={`${index}-${media.url}`} type="button" onClick={() => onOpenPhoto(index)}
                aria-label={`${updateDate(date, true)} — ${index + 1}`}
                className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-[#bda27e]/35 transition-transform duration-200 hover:scale-[1.01] focus-visible:outline-2 focus-visible:outline-[#8e7654]">
                {/* eslint-disable-next-line @next/next/no-img-element -- Thumbnails preserve the original construction media URL. */}
                <img src={media.url} alt={media.caption || updateDate(date, true)} className="h-full w-full object-cover" draggable={false} loading="lazy" decoding="async" />
                <span className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[#29251e]/85 to-transparent" />
                <time dateTime={date} className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-[11px] font-semibold tracking-[0.16em] text-[#f7f3ee] uppercase">{updateDate(date)}</time>
              </button>
            ))}
            {videos.map(({ media, date }, index) => (
              <div key={`${index}-${media.url}`} className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-[#bda27e]/35">
                <video src={media.url} aria-label={media.caption || updateDate(date, true)} controls preload="metadata" className="h-full w-full object-cover" />
              </div>
            ))}
          </div>
        ) : <p role="status" className="py-12 text-center text-sm text-[#29251e]">
          {state === 'error' ? t('No se pudo cargar el avance de obra.')
            : state === 'loading' || state === 'idle' ? t('Cargando…')
              : t('Aún no hay fotos del avance de obra.')}
        </p>}
      </div>
    </section>
  )
}
