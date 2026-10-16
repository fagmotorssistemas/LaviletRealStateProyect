'use client'

import { useEffect, useState } from 'react'
import { Images, X } from 'lucide-react'
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

  const photos = items.flatMap(update => update.media.filter(media => media.type === 'image').map(media => ({ media, date: update.date, description: update.description })))
  const videos = items.flatMap(update => update.media.filter(media => media.type === 'video').map(media => ({ media, date: update.date, description: update.description })))
  const ready = state === 'ready'

  return (
    <section
      role="dialog"
      aria-modal="true"
      aria-label={t('Avance de obra')}
      className="absolute inset-0 z-[80] overflow-x-hidden overflow-y-auto bg-[#f7f3ee]"
    >
      <div className="mx-auto w-full max-w-[1800px] pb-16 pl-[max(1.25rem,env(safe-area-inset-left))] pr-[max(1.25rem,env(safe-area-inset-right))] lg:pl-[max(2rem,env(safe-area-inset-left))] lg:pr-[max(2rem,env(safe-area-inset-right))]"
        style={{ paddingBottom: 'max(4rem, env(safe-area-inset-bottom))' }}>
        <div data-construction-toolbar className="sticky top-0 z-10 mb-5 flex items-center justify-between gap-4 border-b border-[#bda27e]/25 bg-[#f7f3ee] pb-4 pt-[max(5.5rem,calc(env(safe-area-inset-top)+5rem))]">
          <p className="text-[10px] font-semibold tracking-[0.24em] text-[#8e7654] uppercase">La Vilet</p>
          <button type="button" onClick={onClose} aria-label={t('Cerrar')}
            className="mt-1 grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#bda27e]/50 text-[#8e7654] transition-colors hover:bg-[#eae3d8] focus-visible:outline-2 focus-visible:outline-[#8e7654]">
            <X size={18} strokeWidth={2} />
          </button>
        </div>
        <div className="grid gap-7 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-8 xl:grid-cols-[15rem_minmax(0,1fr)]">
          <header className="min-w-0 lg:sticky lg:top-[calc(10rem+env(safe-area-inset-top))] lg:self-start">
            <span aria-hidden className="mb-5 block h-px w-10 bg-[#bda27e]" />
            <h2 className="font-serif text-[clamp(2rem,3.5vw,3.25rem)] leading-[1.04] tracking-[-0.035em] text-[#29251e]">{t('Avance de obra')}</h2>
            {ready && items[0] ? <p className="mt-4 text-[11px] leading-relaxed tracking-[0.12em] text-[#8e7654] uppercase">
              {t('Última actualización')} <time className="mt-1 block" dateTime={items[0].date}>{updateDate(items[0].date, true)}</time>
            </p> : null}
            {ready && (photos.length > 0 || videos.length > 0) ? (
              <div className="mt-6 flex items-center gap-3 rounded-2xl border border-[#bda27e]/25 bg-[#efe8dd] px-4 py-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-[#bda27e]/50 text-[#8e7654]"><Images size={18} strokeWidth={1.5} /></span>
                <div>
                  <p className="text-xs font-medium text-[#29251e]">{t('Registro de obra')}</p>
                  <p className="mt-1 text-[11px] text-[#8e7654]">{photos.length} {t('fotos')}{videos.length > 0 ? ` · ${videos.length} ${t('videos')}` : ''}</p>
                </div>
              </div>
            ) : null}
          </header>
        {ready && (photos.length > 0 || videos.length > 0) ? (
          <div data-construction-grid className="grid min-w-0 grid-cols-1 content-start gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {photos.map(({ media, date, description }, index) => (
              <article key={`${index}-${media.url}`} className="min-w-0">
              <button type="button" onClick={() => onOpenPhoto(index)}
                aria-label={`${updateDate(date, true)} — ${index + 1}`}
                className="relative block aspect-[4/3] w-full overflow-hidden rounded-2xl border border-[#bda27e]/35 transition-transform duration-200 hover:scale-[1.01] focus-visible:outline-2 focus-visible:outline-[#8e7654]">
                {/* eslint-disable-next-line @next/next/no-img-element -- Thumbnails preserve the original construction media URL. */}
                <img src={media.url} alt={media.caption || updateDate(date, true)} className="h-full w-full object-cover" draggable={false} loading="lazy" decoding="async" />
                <span className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[#29251e]/85 to-transparent" />
                <time dateTime={date} className="pointer-events-none absolute inset-x-0 bottom-3 text-center text-[11px] font-semibold tracking-[0.16em] text-[#f7f3ee] uppercase">{updateDate(date)}</time>
              </button>
              {description ? <p className="mt-3 px-1 text-sm leading-relaxed whitespace-pre-line break-words text-[#6d645b]">{description}</p> : null}
              </article>
            ))}
            {videos.map(({ media, date, description }, index) => (
              <article key={`${index}-${media.url}`} className="min-w-0">
              <div className="relative aspect-[4/3] overflow-hidden rounded-2xl border border-[#bda27e]/35">
                <video src={media.url} aria-label={media.caption || updateDate(date, true)} controls preload="metadata" className="h-full w-full object-cover" />
              </div>
              {description ? <p className="mt-3 px-1 text-sm leading-relaxed whitespace-pre-line break-words text-[#6d645b]">{description}</p> : null}
              </article>
            ))}
          </div>
        ) : <p role="status" className="py-12 text-center text-sm text-[#29251e]">
          {state === 'error' ? t('No se pudo cargar el avance de obra.')
            : state === 'loading' || state === 'idle' ? t('Cargando…')
              : t('Aún no hay fotos del avance de obra.')}
        </p>}
        </div>
      </div>
    </section>
  )
}
